#!/usr/bin/env node
/**
 * check-tg-health.mjs
 * Telegram 频道、群组、机器人资源可用性探活巡检系统
 * 
 * 用法:
 *   node src/scripts/check-tg-health.mjs [--limit 20] [--concurrency 5] [--fix]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const TELEGRAM_JSON_PATH = path.join(REPO_ROOT, 'src/data/nav/telegram.json');
const REPORT_OUTPUT_PATH = path.join(REPO_ROOT, 'dist/tg-health-report.json');

const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return defaultValue;
}

const LIMIT = parseInt(getArg('--limit', '0'), 10);
const CONCURRENCY = parseInt(getArg('--concurrency', '5'), 10);
const SHOULD_FIX = args.includes('--fix');

/**
 * 探测单个 Telegram 用户名的公开可用性
 * @param {Object} item
 * @param {number} timeoutMs
 */
export async function probeTelegramItem(item, timeoutMs = 8000) {
  const username = item.username || (item.url ? item.url.replace(/^https?:\/\/t\.me\//, '').split('/')[0] : null);
  if (!username) {
    return { id: item.id || item.title, username: '', status: 'unknown', reason: 'Missing username' };
  }

  // 针对频道优先探测 /s/ 公开归档页，群组和机器人探测根页
  const targetUrl = item.type === 'channel' 
    ? `https://t.me/s/${encodeURIComponent(username)}` 
    : `https://t.me/${encodeURIComponent(username)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });

    clearTimeout(timer);

    if (res.status === 404) {
      return { id: item.id || username, username, is_alive: false, status: 'not_found', reason: 'HTTP 404 Not Found' };
    }

    if (!res.ok) {
      return { id: item.id || username, username, is_alive: null, status: 'http_error', reason: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // 检查明确的错误标记
    if (html.includes('tgme_page_error') || html.includes('was not found') || html.includes('Channel not found')) {
      return { id: item.id || username, username, is_alive: false, status: 'deleted', reason: 'Channel or entity not found' };
    }

    if (html.includes('is unavailable due to') || html.includes('has been blocked') || html.includes('copyright infringement')) {
      return { id: item.id || username, username, is_alive: false, status: 'blocked', reason: 'Blocked / Copyright violation' };
    }

    // 正常状态标记
    if (html.includes('tgme_page_title') || html.includes('tgme_page_extra') || html.includes('tgme_page_action')) {
      return { id: item.id || username, username, is_alive: true, status: 'healthy', reason: 'Public profile verified' };
    }

    return { id: item.id || username, username, is_alive: true, status: 'fallback_ok', reason: 'Page returned 200 without error signatures' };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return {
      id: item.id || username,
      username,
      is_alive: null,
      status: isTimeout ? 'timeout' : 'network_error',
      reason: isTimeout ? `Timeout after ${timeoutMs}ms` : err.message
    };
  }
}

async function main() {
  console.log('✈️  Telegram 资源健康探活巡检系统启动...');
  const rawData = await fs.readFile(TELEGRAM_JSON_PATH, 'utf-8');
  let items = JSON.parse(rawData);

  if (LIMIT > 0) {
    console.log(`ℹ️  检测样本限制为前 ${LIMIT} 项`);
    items = items.slice(0, LIMIT);
  } else {
    console.log(`ℹ️  全量巡检模式，数据池规模: ${items.length} 项`);
  }

  const results = [];
  let healthyCount = 0;
  let deadCount = 0;
  let unknownCount = 0;

  console.log(`⚡ 并发度: ${CONCURRENCY}，开始低频探测以保障边缘不被限频...\n`);

  // 并发控制分批处理
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    const chunkPromises = chunk.map(item => probeTelegramItem(item));
    const chunkResults = await Promise.all(chunkPromises);

    for (const r of chunkResults) {
      results.push(r);
      if (r.is_alive === true) {
        healthyCount++;
      } else if (r.is_alive === false) {
        deadCount++;
        console.warn(`❌ [失效/异常] @${r.username} -> ${r.status} (${r.reason})`);
      } else {
        unknownCount++;
      }
    }

    process.stdout.write(`\r[进度] 已巡检 ${Math.min(i + CONCURRENCY, items.length)} / ${items.length} 项...`);
    // 微延迟防限频
    await new Promise(res => setTimeout(res, 200));
  }

  console.log('\n\n================ 巡检报告汇总 ================');
  console.log(`总检测项: ${results.length}`);
  console.log(`✅ 正常存活 (Healthy): ${healthyCount}`);
  console.log(`❌ 异常失效 (Dead/Blocked): ${deadCount}`);
  console.log(`⚠️  网络受限/超时 (Unknown): ${unknownCount}`);
  console.log('==============================================\n');

  try {
    await fs.mkdir(path.dirname(REPORT_OUTPUT_PATH), { recursive: true });
    await fs.writeFile(REPORT_OUTPUT_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: { total: results.length, healthy: healthyCount, dead: deadCount, unknown: unknownCount },
      details: results
    }, null, 2));
    console.log(`📄 详细体检报告已保存至: ${REPORT_OUTPUT_PATH}`);
  } catch (err) {
    console.error('Failed to write report file:', err.message);
  }

  if (SHOULD_FIX && deadCount > 0) {
    console.log(`🔧 正在更新本地数据池与覆盖层中的 is_alive 状态...`);
    const deadSet = new Set(results.filter(r => r.is_alive === false).map(r => r.id));
    const allRaw = JSON.parse(await fs.readFile(TELEGRAM_JSON_PATH, 'utf-8'));
    let fixCount = 0;
    for (const it of allRaw) {
      if (deadSet.has(it.id || it.username)) {
        it.is_alive = false;
        fixCount++;
      }
    }
    await fs.writeFile(TELEGRAM_JSON_PATH, JSON.stringify(allRaw, null, 2) + '\n');
    console.log(`✅ 已标记 ${fixCount} 个失效条目至 telegram.json`);

    // 同步持久化至 ai-overrides.json
    const overridesPath = path.join(REPO_ROOT, 'src/data/nav/ai-overrides.json');
    let overrides = {};
    try {
      overrides = JSON.parse(await fs.readFile(overridesPath, 'utf-8'));
    } catch (e) {
      overrides = {};
    }

    for (const r of results.filter(r => r.is_alive === false)) {
      const key = (r.username || r.id || '').toLowerCase().replace(/^tg-/, '');
      if (key) {
        if (!overrides[key]) {
          overrides[key] = {};
        }
        overrides[key].is_alive = false;
        overrides[key].health_status = r.status;
        overrides[key].health_reason = r.reason;
        overrides[key].health_checked_at = new Date().toISOString().split('T')[0];
      }
    }
    await fs.writeFile(overridesPath, JSON.stringify(overrides, null, 2) + '\n');
    console.log(`💾 已将 ${deadCount} 个失效条目持久化同步至 ai-overrides.json`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal error in health check:', err);
    process.exit(1);
  });
}
