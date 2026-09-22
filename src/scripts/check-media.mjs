import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_FILE = path.join(ROOT_DIR, 'src/data/creators.json');

function resolveTestUrl(urlStr) {
  if (!urlStr) return null;
  if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
    return urlStr;
  }
  const upstreamBase = process.env.MEDIA_PROXY_UPSTREAM || '';
  if (!upstreamBase) return null;
  if (urlStr.startsWith('/api/media?key=')) {
    const key = decodeURIComponent(urlStr.replace('/api/media?key=', '')).replace(/^\/+/, '');
    return `${upstreamBase.replace(/\/+$/, '')}/${key}`;
  }
  return `${upstreamBase.replace(/\/+$/, '')}/${urlStr.replace(/^\/+/, '')}`;
}

async function checkUrl(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: err.name === 'AbortError' ? 'TIMEOUT' : err.message };
  }
}

async function runPool(items, limit, workerFn) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < items.length) {
      const i = index++;
      results[i] = await workerFn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let sampleCount = 0;
  let isVerbose = args.includes('--verbose');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample' && args[i + 1]) {
      sampleCount = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[MEDIA-CHECK] Data file not found: ${DATA_FILE}`);
    process.exit(1);
  }

  let creators = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (sampleCount > 0 && sampleCount < creators.length) {
    creators = creators.slice(0, sampleCount);
    console.log(`[MEDIA-CHECK] Testing sample of ${sampleCount} creators...`);
  } else {
    console.log(`[MEDIA-CHECK] Testing all ${creators.length} creators...`);
  }

  const tasks = [];
  for (const c of creators) {
    if (c.avatar_url) {
      tasks.push({ screenName: c.screen_name, type: 'avatar', url: resolveTestUrl(c.avatar_url) });
    }
  }

  console.log(`[MEDIA-CHECK] Total media resources to verify: ${tasks.length} (Concurrency: 10)`);

  let successCount = 0;
  let failCount = 0;
  const failures = [];

  const results = await runPool(tasks, 10, async (task, idx) => {
    const res = await checkUrl(task.url);
    if (res.ok) {
      successCount++;
      if (isVerbose) console.log(`  [OK] ${task.screenName} (${task.type}): ${res.status}`);
    } else {
      failCount++;
      failures.push({ ...task, error: res.error || res.status });
      console.warn(`  [FAIL] ${task.screenName} (${task.type}): ${res.error || res.status} -> ${task.url}`);
    }
    return res;
  });

  console.log('\n================ MEDIA CHECK REPORT ================');
  console.log(`Total checked: ${tasks.length}`);
  console.log(`Reachable:     ${successCount} (${((successCount / tasks.length) * 100).toFixed(1)}%)`);
  console.log(`Failed:        ${failCount}`);

  if (failures.length > 0) {
    console.log(`\nFailed Details (Top 10):`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  - @${f.screenName} [${f.type}]: ${f.error}`);
    }
  } else {
    console.log('✅ All sampled media URLs are healthy and reachable!');
  }
}

main().catch(err => {
  console.error('[MEDIA-CHECK] Fatal error:', err);
  process.exit(1);
});
