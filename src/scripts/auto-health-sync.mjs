#!/usr/bin/env node
/**
 * auto-health-sync.mjs
 * 
 * Telegram 资源全自动健康探活、状态持久化与边缘同步编排器
 * 
 * 功能：
 * 1. 调用 probeTelegramItem 巡检频道/群组可用性；
 * 2. 发现失效或已恢复条目，双写持久化更新 telegram.json 与 ai-overrides.json；
 * 3. 自动重新编译多维导航搜索索引 (nav-search-index.json)；
 * 4. 支持 --deploy 参数自动触发 Cloudflare Pages 边缘分发；
 * 5. 适合作为 nightly cron 或 systemd timer 周期性执行。
 * 
 * 用法：
 *   node src/scripts/auto-health-sync.mjs [--limit 50] [--concurrency 5] [--deploy]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeTelegramItem } from './check-tg-health.mjs';
import { buildNavIndex } from './build-nav-search-index.mjs';
import { triggerProductionDeploy } from './deploy-production.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const TELEGRAM_JSON_PATH = path.join(REPO_ROOT, 'src/data/nav/telegram.json');
const AI_OVERRIDES_PATH = path.join(REPO_ROOT, 'src/data/nav/ai-overrides.json');
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
const SHOULD_DEPLOY = args.includes('--deploy');

export async function runAutoHealthSync({
  limit = LIMIT,
  concurrency = CONCURRENCY,
  deploy = SHOULD_DEPLOY
} = {}) {
  const startTime = Date.now();
  console.log('======================================================');
  console.log('🩺 XIU Navigation - Telegram Automated Health Sync');
  console.log(`• Concurrency: ${concurrency}`);
  console.log(`• Sample Limit: ${limit > 0 ? limit : 'Full Pool'}`);
  console.log(`• Auto Deploy: ${deploy ? 'Enabled' : 'Disabled'}`);
  console.log('======================================================\n');

  const rawData = await fs.readFile(TELEGRAM_JSON_PATH, 'utf-8');
  let items = JSON.parse(rawData);

  let targetItems = items;
  if (limit > 0) {
    targetItems = items.slice(0, limit);
  }

  const results = [];
  let healthyCount = 0;
  let deadCount = 0;
  let unknownCount = 0;

  for (let i = 0; i < targetItems.length; i += concurrency) {
    const chunk = targetItems.slice(i, i + concurrency);
    const chunkPromises = chunk.map(it => probeTelegramItem(it));
    const chunkResults = await Promise.all(chunkPromises);

    for (const r of chunkResults) {
      results.push(r);
      if (r.is_alive === true) healthyCount++;
      else if (r.is_alive === false) deadCount++;
      else unknownCount++;
    }

    process.stdout.write(`\r[Progress] Probed ${Math.min(i + concurrency, targetItems.length)} / ${targetItems.length} items...`);
    await new Promise(res => setTimeout(res, 200));
  }

  console.log('\n\n================ HEALTH PROBE SUMMARY ================');
  console.log(`• Total Probed: ${results.length}`);
  console.log(`• Healthy / Alive: ${healthyCount}`);
  console.log(`• Confirmed Dead / Blocked: ${deadCount}`);
  console.log(`• Unknown / Network Limited: ${unknownCount}`);
  console.log('======================================================\n');

  // Save report
  try {
    await fs.mkdir(path.dirname(REPORT_OUTPUT_PATH), { recursive: true });
    await fs.writeFile(REPORT_OUTPUT_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: { total: results.length, healthy: healthyCount, dead: deadCount, unknown: unknownCount },
      details: results
    }, null, 2));
    console.log(`📄 Health report written to: ${REPORT_OUTPUT_PATH}`);
  } catch (err) {
    console.warn(`[Report Warning] Failed to write report:`, err.message);
  }

  // Update states in telegram.json and ai-overrides.json
  let changesCount = 0;
  const deadSet = new Set(results.filter(r => r.is_alive === false).map(r => String(r.id || r.username).toLowerCase()));

  if (deadCount > 0) {
    // 1. Update telegram.json
    for (const it of items) {
      const key = String(it.id || it.username || '').toLowerCase();
      if (deadSet.has(key) && it.is_alive !== false) {
        it.is_alive = false;
        changesCount++;
      }
    }

    if (changesCount > 0) {
      await fs.writeFile(TELEGRAM_JSON_PATH, JSON.stringify(items, null, 2) + '\n');
      console.log(`💾 Updated ${changesCount} item(s) to is_alive: false in telegram.json`);

      // 2. Persist to ai-overrides.json
      let overrides = {};
      try {
        overrides = JSON.parse(await fs.readFile(AI_OVERRIDES_PATH, 'utf-8'));
      } catch (e) {
        overrides = {};
      }

      for (const r of results.filter(r => r.is_alive === false)) {
        const k = (r.username || r.id || '').toLowerCase().replace(/^tg-/, '');
        if (k) {
          if (!overrides[k]) overrides[k] = {};
          overrides[k].is_alive = false;
          overrides[k].health_status = r.status;
          overrides[k].health_reason = r.reason;
          overrides[k].health_checked_at = new Date().toISOString().split('T')[0];
        }
      }

      await fs.writeFile(AI_OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + '\n');
      console.log(`💾 Persisted dead status to ai-overrides.json`);

      // 3. Rebuild search index
      console.log(`⚡ Rebuilding navigation search index...`);
      buildNavIndex();
    }
  }

  // Deploy if requested and there are changes
  let deployRes = null;
  if (deploy && changesCount > 0) {
    console.log(`🚀 Changes detected. Triggering production edge deployment...`);
    deployRes = triggerProductionDeploy({
      reason: `Automated health check marked ${changesCount} dead item(s)`,
      background: false
    });
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Automated Health Sync completed in ${durationSec}s. (Changes: ${changesCount})`);

  return {
    success: true,
    probed: results.length,
    healthy: healthyCount,
    dead: deadCount,
    unknown: unknownCount,
    changes: changesCount,
    deploy: deployRes
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAutoHealthSync().catch(err => {
    console.error('Fatal error in auto health sync:', err);
    process.exit(1);
  });
}
