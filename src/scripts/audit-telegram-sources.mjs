#!/usr/bin/env node
/**
 * Telegram Source Auditor & Live Prober
 * Scrapes and verifies Telegram handles extracted from itgoyo/TelegramGroup
 * Tests accessibility, scam/fake flags, member counts, and public avatars.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const CACHE_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram-candidates.json');
const TELEGRAM_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram.json');
const README_URL = 'https://raw.githubusercontent.com/itgoyo/TelegramGroup/master/README.md';

const args = process.argv.slice(2);
const sampleArg = args.indexOf('--sample');
const sampleLimit = sampleArg !== -1 ? parseInt(args[sampleArg + 1], 10) : 0;
const shouldMerge = args.includes('--merge');
const mergeOnly = args.includes('--merge-only');
const concurrency = 8;
const delayMs = 120;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapCategory(srcCat) {
  const cat = String(srcCat || '').toLowerCase();
  if (/搜索|搜/.test(cat)) return 'search';
  if (/技术|编程|开发|代码|开发者|linux|python|it/.test(cat)) return 'dev';
  if (/翻墙|梯子|科学上网|节点|代理|vpn|clash|v2ray/.test(cat)) return 'network';
  if (/软件|工具|破解|开源|资源|效率/.test(cat)) return 'tools';
  if (/影视|电影|音乐|吃瓜|娱乐|视频|美图|动漫|小说/.test(cat)) return 'media';
  if (/金融|虚拟币|币圈|股票|理财|crypto|btc|eth|交易/.test(cat)) return 'finance';
  if (/官方|telegram|tg/.test(cat)) return 'official';
  return 'other';
}

function mergeCandidatesIntoTelegram(candidates) {
  if (!fs.existsSync(TELEGRAM_FILE)) {
    fs.writeFileSync(TELEGRAM_FILE, '[]\n', 'utf-8');
  }
  const existing = JSON.parse(fs.readFileSync(TELEGRAM_FILE, 'utf-8'));
  const existingMap = new Map();
  for (const item of existing) {
    if (item.username) {
      existingMap.set(item.username.toLowerCase(), item);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const cand of candidates) {
    if (!cand.alive || cand.is_scam) continue;
    const lowerUser = cand.username.toLowerCase();
    const cleanUser = cand.username;

    if (existingMap.has(lowerUser)) {
      const item = existingMap.get(lowerUser);
      if (cand.member_count && item.member_count !== cand.member_count) {
        item.member_count = cand.member_count;
        item.updated_at = new Date().toISOString().split('T')[0];
        updatedCount++;
      }
      if (cand.avatar_url && (!item.avatar_url || item.avatar_url.includes('default-avatar'))) {
        item.avatar_url = cand.avatar_url;
        item.updated_at = new Date().toISOString().split('T')[0];
        updatedCount++;
      }
    } else {
      const subcat = mapCategory(cand.sourceCategory);
      const newItem = {
        id: `tg-${lowerUser}`,
        username: cleanUser,
        title: cand.title || cleanUser,
        url: `https://t.me/${cleanUser}`,
        description: cand.description || `${cand.title || cleanUser} - Telegram 高品质频道/社群`,
        type: cand.type || 'channel',
        member_count: cand.member_count || 0,
        avatar_url: cand.avatar_url || '',
        category: 'telegram',
        subcategory: subcat,
        tags: [cand.sourceCategory || '精选', cand.type === 'bot' ? '机器人' : (cand.type === 'group' ? '群组' : '频道')].filter(Boolean),
        is_featured: false,
        created_at: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString().split('T')[0]
      };
      existing.push(newItem);
      existingMap.set(lowerUser, newItem);
      addedCount++;
    }
  }

  fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  console.log(`[Merge] Successfully added ${addedCount} new entities, updated ${updatedCount} existing entities.`);
  console.log(`[Merge] Total Telegram dataset size is now ${existing.length} entries.`);
}

async function fetchSourceReadme() {
  console.log('[Audit] Fetching itgoyo/TelegramGroup README.md...');
  const res = await fetch(README_URL);
  if (!res.ok) throw new Error(`Failed to fetch README: HTTP ${res.status}`);
  return await res.text();
}

function extractUniqueHandles(markdown) {
  const handles = new Map();
  const lines = markdown.split('\n');

  let currentCategory = '其他';
  for (const line of lines) {
    const hMatch = line.match(/^#+\s+(.+)/);
    if (hMatch) {
      currentCategory = hMatch[1].trim();
    }

    const linkMatches = line.matchAll(/https?:\/\/t\.me\/([A-Za-z0-9_]{3,})/g);
    for (const match of linkMatches) {
      const raw = match[1];
      const lower = raw.toLowerCase();
      if (['joinchat', 'addstickers', 'addtheme', 'share', 'socks', 'proxy', 'c'].includes(lower)) continue;
      if (!handles.has(lower)) {
        handles.set(lower, {
          username: raw,
          sourceCategory: currentCategory,
          context: line.trim().slice(0, 100)
        });
      }
    }
  }

  return Array.from(handles.values());
}

async function probeHandle(item) {
  const username = item.username;
  const previewUrl = `https://t.me/s/${username}`;
  const standardUrl = `https://t.me/${username}`;

  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  try {
    // Step 1: Try public web channel preview first
    let res = await fetch(previewUrl, { headers: defaultHeaders, redirect: 'manual' });
    let html = '';
    let isChannelPreview = false;

    if (res.status === 200) {
      html = await res.text();
      // Verify it's a real preview page, not an empty shell
      if (html.includes('tgme_page_title')) {
        isChannelPreview = true;
      }
    }

    // Step 2: Fallback to standard t.me landing page (for bots, groups without preview)
    if (!isChannelPreview) {
      res = await fetch(standardUrl, { headers: defaultHeaders, redirect: 'follow' });
      if (res.status !== 200) {
        return { username, alive: false, reason: `HTTP_${res.status}` };
      }
      html = await res.text();
    }

    // Check if Telegram returned an empty "User not found" page
    if (!html.includes('tgme_page_title') && !html.includes('tgme_page_extra')) {
      return { username, alive: false, reason: 'NO_TITLE_FOUND' };
    }

    // Check for Scam / Fake badge
    const isScam = /scam|fake/i.test(html) && html.includes('tgme_page_context_action');
    if (isScam) {
      return { username, alive: false, reason: 'FLAGGED_SCAM_OR_FAKE' };
    }

    // Extract Title
    const titleMatch = html.match(/<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : username;

    // Extract Description
    const descMatch = html.match(/<div class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i);
    const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Extract Extra / Member count
    let memberCount = 0;
    let entityType = 'channel';
    const extraMatch = html.match(/<div class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/i);

    if (extraMatch && extraMatch[1]) {
      const extraText = extraMatch[1].trim();
      if (/member/i.test(extraText)) entityType = 'group';
      if (/subscriber/i.test(extraText)) entityType = 'channel';

      const numMatch = extraText.match(/([\d\s.,]+)\s*([KkMm]?)\s*(subscribers|members)/i);
      if (numMatch) {
        let num = parseFloat(numMatch[1].replace(/\s/g, '').replace(',', '.'));
        const unit = (numMatch[2] || '').toUpperCase();
        if (unit === 'K') num *= 1000;
        if (unit === 'M') num *= 1000000;
        memberCount = Math.floor(num);
      }
    }

    // Check if it's a Bot
    if (username.toLowerCase().endsWith('bot') || html.includes('Send Message') && !html.includes('subscribers') && !html.includes('members')) {
      entityType = 'bot';
    }

    // Extract Avatar
    let avatarUrl = '';
    const avatarMatch = html.match(/<img class="tgme_page_photo_image"[^>]*src="([^"]+)"/i);
    if (avatarMatch && avatarMatch[1]) {
      avatarUrl = avatarMatch[1];
    }

    return {
      username,
      alive: true,
      type: entityType,
      title: title || username,
      description: desc,
      member_count: memberCount,
      is_scam: false,
      avatar_url: avatarUrl
    };
  } catch (err) {
    return { username, alive: false, reason: err.message };
  }
}

async function runWorkerPool(items, limit, workerFn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      const res = await workerFn(item);
      results[currentIndex] = res;
      await sleep(delayMs);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('=== Telegram Source Auditor Started ===');

  if (mergeOnly) {
    console.log('[Audit] --merge-only mode: Merging existing candidates from cache...');
    if (!fs.existsSync(CACHE_FILE)) {
      console.error(`[FATAL] Candidates cache file not found: ${CACHE_FILE}`);
      process.exit(1);
    }
    const candidates = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    mergeCandidatesIntoTelegram(candidates);
    return;
  }

  const markdown = await fetchSourceReadme();
  let handleList = extractUniqueHandles(markdown);
  console.log(`[Audit] Total unique Telegram handles extracted: ${handleList.length}`);

  if (sampleLimit > 0) {
    console.log(`[Audit] Running in sample mode (first ${sampleLimit} handles)...`);
    handleList = handleList.slice(0, sampleLimit);
  }

  console.log(`[Audit] Probing ${handleList.length} handles with concurrency = ${concurrency}...`);
  const startTime = Date.now();

  const auditResults = await runWorkerPool(handleList, concurrency, async (item) => {
    const result = await probeHandle(item);
    return {
      ...item,
      ...result
    };
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Audit] Probing finished in ${duration}s.`);

  const alive = auditResults.filter(r => r.alive);
  const dead = auditResults.filter(r => !r.alive);
  const withSubscribers = alive.filter(r => r.member_count >= 500);

  console.log('=== Audit Summary ===');
  console.log(`- Total Tested: ${auditResults.length}`);
  console.log(`- Alive & Accessible: ${alive.length}`);
  console.log(`- Inactive / Dead / Scam: ${dead.length}`);
  console.log(`- High Quality (>=500 members): ${withSubscribers.length}`);

  // Sort by member_count descending
  alive.sort((a, b) => (b.member_count || 0) - (a.member_count || 0));

  fs.writeFileSync(CACHE_FILE, JSON.stringify(alive, null, 2) + '\n', 'utf-8');
  console.log(`[Audit] Output saved to: ${CACHE_FILE}`);

  if (shouldMerge) {
    console.log('\n[Audit] Automatically merging verified alive candidates into telegram.json...');
    mergeCandidatesIntoTelegram(alive);
  }
}

main().catch(err => {
  console.error('[Audit Error]', err);
  process.exit(1);
});
