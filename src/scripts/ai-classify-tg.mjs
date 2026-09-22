#!/usr/bin/env node
/**
 * ai-classify-tg.mjs
 * 
 * Telegram Resource AI-Assisted Semantic Classification & Structured Summarization CLI
 *
 * Usage:
 *   node src/scripts/ai-classify-tg.mjs --target pjapk               # Test single item in dry-run
 *   node src/scripts/ai-classify-tg.mjs --limit 5                    # Dry-run on first 5 items
 *   node src/scripts/ai-classify-tg.mjs --only-generic --limit 10    # Dry-run on 10 generic 'community' items
 *   node src/scripts/ai-classify-tg.mjs --target pjapk --write      # Classify & write back to telegram.json
 *   node src/scripts/ai-classify-tg.mjs --only-generic --write      # Batch refine generic items and persist
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAndSummarizeWithLLM } from './llm-summarizer.mjs';
import { buildNavIndex } from './build-nav-search-index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TELEGRAM_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram.json');
const AI_OVERRIDES_FILE = path.join(ROOT_DIR, 'src/data/nav/ai-overrides.json');

// Auto-load .env if present
if (typeof process.loadEnvFile === 'function') {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch (e) {}
  }
}

function parseArgs(argv) {
  const args = {
    target: '',
    limit: 0,
    onlyGeneric: false,
    concurrency: 2,
    timeoutMs: 12000,
    delayMs: 300,
    write: false,
    dryRun: true,
    verbose: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target' && i + 1 < argv.length) {
      args.target = argv[++i].trim().replace(/^@/, '');
    } else if (arg === '--limit' && i + 1 < argv.length) {
      args.limit = parseInt(argv[++i], 10) || 0;
    } else if (arg === '--concurrency' && i + 1 < argv.length) {
      args.concurrency = Math.max(1, parseInt(argv[++i], 10) || 2);
    } else if (arg === '--timeout' && i + 1 < argv.length) {
      args.timeoutMs = parseInt(argv[++i], 10) || 6000;
    } else if (arg === '--delay' && i + 1 < argv.length) {
      args.delayMs = parseInt(argv[++i], 10) || 300;
    } else if (arg === '--only-generic') {
      args.onlyGeneric = true;
    } else if (arg === '--write') {
      args.write = true;
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.write = false;
    } else if (arg === '--verbose') {
      args.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printUsage() {
  console.log(`
XIU Navigation - Telegram AI Semantic Classifier & Summarizer

Usage:
  node src/scripts/ai-classify-tg.mjs [options]

Options:
  --target <username>   Process only a specific Telegram resource (e.g. pjapk)
  --limit <number>      Max number of items to process
  --only-generic        Only process items currently under 'community' subcategory
  --concurrency <num>   Concurrent worker count (default: 2)
  --timeout <ms>        Per-item timeout in milliseconds (default: 6000)
  --delay <ms>          Delay between batch executions in ms (default: 300)
  --write               Persist changes to src/data/nav/telegram.json and rebuild index
  --dry-run             Simulate without writing to disk (default)
  --verbose             Display raw model outputs and detailed traces
  --help, -h            Show this help message
`);
}

/**
 * Bounded concurrency worker pool
 */
async function runConcurrentPool(items, concurrency, fn, delayMs = 0) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runAiClassification(argv = process.argv) {
  const options = parseArgs(argv);

  if (options.help) {
    printUsage();
    return { ok: true };
  }

  console.log('================ XIU TELEGRAM AI CLASSIFIER ================');
  console.log(`Mode: ${options.write ? '🔴 WRITE (Persist to Disk)' : '🟢 DRY-RUN (Read-Only)'}`);
  console.log(`Target: ${options.target ? `@${options.target}` : 'All matching items'}`);
  if (options.limit > 0) console.log(`Limit: ${options.limit}`);
  if (options.onlyGeneric) console.log(`Filter: Only 'community' generic subcategory`);
  console.log(`Concurrency: ${options.concurrency}, Timeout: ${options.timeoutMs}ms`);

  if (!fs.existsSync(TELEGRAM_FILE)) {
    console.error(`[FATAL] telegram.json not found at: ${TELEGRAM_FILE}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(TELEGRAM_FILE, 'utf-8');
  const allItems = JSON.parse(rawData);
  console.log(`[DATA] Loaded ${allItems.length} total Telegram entries from database.`);

  // Filter candidates
  let candidates = allItems.map((item, index) => ({ item, index }));

  if (options.target) {
    const targetNorm = options.target.toLowerCase();
    candidates = candidates.filter(({ item }) => {
      const u = String(item.username || '').toLowerCase();
      const id = String(item.id || '').toLowerCase();
      return u === targetNorm || id === `tg-${targetNorm}` || id === targetNorm;
    });

    if (candidates.length === 0) {
      console.warn(`[WARN] No matching item found for target: @${options.target}`);
      return { ok: false, count: 0 };
    }
  }

  if (options.onlyGeneric) {
    let existingOverrideKeys = new Set();
    if (fs.existsSync(AI_OVERRIDES_FILE)) {
      try {
        const overrides = JSON.parse(fs.readFileSync(AI_OVERRIDES_FILE, 'utf-8'));
        existingOverrideKeys = new Set(Object.keys(overrides).map(k => k.toLowerCase()));
      } catch (e) {}
    }
    candidates = candidates.filter(({ item }) => {
      const k = String(item.username || item.id || '').toLowerCase().replace(/^tg-/, '');
      return item.subcategory === 'community' && !existingOverrideKeys.has(k);
    });
  }

  if (options.limit > 0 && candidates.length > options.limit) {
    candidates = candidates.slice(0, options.limit);
  }

  console.log(`[QUEUE] Filtered ${candidates.length} candidate(s) for AI classification.\n`);

  const stats = {
    total: candidates.length,
    byProvider: { gemini: 0, 'openai-compatible': 0, ollama: 0, fallback: 0 },
    subcatChanged: 0,
    nsfwChanged: 0,
    summaryUpdated: 0,
    tagsUpdated: 0,
    errors: 0
  };

  const modifiedIndices = new Map();
  let lastFlushedCount = 0;
  const flushChangesToDisk = (force = false) => {
    if (!options.write || modifiedIndices.size === 0) return;
    if (!force && modifiedIndices.size - lastFlushedCount < 15) return;

    for (const [idx, updatedItem] of modifiedIndices.entries()) {
      allItems[idx] = updatedItem;
    }
    fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(allItems, null, 2) + '\n', 'utf-8');

    try {
      let overrides = {};
      if (fs.existsSync(AI_OVERRIDES_FILE)) {
        overrides = JSON.parse(fs.readFileSync(AI_OVERRIDES_FILE, 'utf-8'));
      }
      for (const updatedItem of modifiedIndices.values()) {
        const key = (updatedItem.username || updatedItem.id || '').toLowerCase().replace(/^tg-/, '');
        if (key) {
          overrides[key] = {
            title: updatedItem.title,
            subcategory: updatedItem.subcategory,
            is_nsfw: Boolean(updatedItem.is_nsfw),
            description: updatedItem.description,
            tags: updatedItem.tags || [],
            updated_at: updatedItem.updated_at || new Date().toISOString().slice(0, 10)
          };
        }
      }
      fs.writeFileSync(AI_OVERRIDES_FILE, JSON.stringify(overrides, null, 2) + '\n', 'utf-8');
      lastFlushedCount = modifiedIndices.size;
      console.log(`[CHECKPOINT] 💾 Progress auto-persisted: ${modifiedIndices.size} items written to disk.`);
    } catch (err) {
      console.warn(`[WARN] Failed to auto-persist checkpoint:`, err.message);
    }
  };

  await runConcurrentPool(
    candidates,
    options.concurrency,
    async ({ item, index }, queueIdx) => {
      const prefix = `[${queueIdx + 1}/${candidates.length}] @${item.username || item.id}`;
      try {
        const result = await classifyAndSummarizeWithLLM(
          {
            title: item.title,
            username: item.username,
            rawDescription: item.description,
            type: item.type || 'channel',
            currentCategory: item.category,
            currentSubcategory: item.subcategory,
            tags: item.tags
          },
          { timeoutMs: options.timeoutMs }
        );

        stats.byProvider[result.provider] = (stats.byProvider[result.provider] || 0) + 1;

        const subcatDiff = item.subcategory !== result.subcategory;
        const nsfwDiff = Boolean(item.is_nsfw) !== Boolean(result.is_nsfw);
        const descDiff = item.description !== result.summary;
        const tagsDiff = JSON.stringify(item.tags || []) !== JSON.stringify(result.tags || []);

        if (subcatDiff) stats.subcatChanged++;
        if (nsfwDiff) stats.nsfwChanged++;
        if (descDiff) stats.summaryUpdated++;
        if (tagsDiff) stats.tagsUpdated++;

        console.log(`------------------------------------------------------------`);
        console.log(`${prefix} [${result.provider.toUpperCase()}]`);
        if (subcatDiff) {
          console.log(`  Subcategory: ${item.subcategory} ➔  \x1b[32m${result.subcategory}\x1b[0m`);
        } else {
          console.log(`  Subcategory: ${item.subcategory} (unchanged)`);
        }

        if (nsfwDiff) {
          console.log(`  NSFW: ${Boolean(item.is_nsfw)} ➔  \x1b[31m${result.is_nsfw}\x1b[0m`);
        }

        if (descDiff) {
          console.log(`  Old Summary: ${item.description || '（无）'}`);
          console.log(`  New Summary: \x1b[36m${result.summary}\x1b[0m (${result.summary.length} chars)`);
        }

        if (tagsDiff) {
          console.log(`  Tags: [${(item.tags || []).join(', ')}] ➔  [${(result.tags || []).join(', ')}]`);
        }

        if (options.write && (subcatDiff || nsfwDiff || descDiff || tagsDiff)) {
          const updatedItem = {
            ...item,
            subcategory: result.subcategory,
            is_nsfw: result.is_nsfw,
            description: result.summary,
            tags: result.tags,
            updated_at: new Date().toISOString().slice(0, 10)
          };
          modifiedIndices.set(index, updatedItem);
          flushChangesToDisk(false);
        }
      } catch (err) {
        stats.errors++;
        console.error(`${prefix} Error:`, err.message);
      }
    },
    options.delayMs
  );

  console.log('\n================ CLASSIFICATION SUMMARY ================');
  console.log(`Processed Total:      ${stats.total}`);
  console.log(`Providers Used:       Gemini: ${stats.byProvider.gemini}, OpenAI: ${stats.byProvider['openai-compatible']}, Ollama: ${stats.byProvider.ollama}, Fallback: ${stats.byProvider.fallback}`);
  console.log(`Subcategory Changes:  ${stats.subcatChanged}`);
  console.log(`NSFW Adjustments:     ${stats.nsfwChanged}`);
  console.log(`Summaries Refined:    ${stats.summaryUpdated}`);
  console.log(`Tags Updated:         ${stats.tagsUpdated}`);
  console.log(`Errors Encountered:   ${stats.errors}`);

  if (options.write && modifiedIndices.size > 0) {
    flushChangesToDisk(true);
    console.log(`\n[PERSIST] Final sync complete for ${modifiedIndices.size} modified records.`);

    try {
      console.log(`[INDEX] Rebuilding search indexes...`);
      buildNavIndex();
      console.log(`[INDEX] Nav search index successfully synced.`);
    } catch (err) {
      console.warn(`[WARN] Failed to rebuild search index:`, err);
    }
  } else if (!options.write) {
    console.log(`\n[DRY-RUN] No files were modified on disk. Use --write to persist changes.`);
  }

  return { ok: true, stats, modifiedCount: modifiedIndices.size };
}

// Direct execution from CLI
const isDirectCall = process.argv[1] && (
  process.argv[1].endsWith('ai-classify-tg.mjs') ||
  process.argv[1].endsWith('ai-classify-tg')
);

if (isDirectCall) {
  runAiClassification(process.argv).catch(err => {
    console.error('[FATAL] Script error:', err);
    process.exit(1);
  });
}
