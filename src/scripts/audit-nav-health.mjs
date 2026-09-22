#!/usr/bin/env node
/**
 * Unified Navigation Health Auditor & Self-Healing Engine
 * Probes GitHub repositories, Telegram channels, websites and tool mirrors.
 * Supports auto-healing: automatically promotes healthy mirrors when primary is down.
 * Generates structured audit diagnostic reports and synchronizes navigation search indexes.
 *
 * Usage:
 *   node src/scripts/audit-nav-health.mjs [--write] [--auto-heal] [--dry-run]
 *                                         [--github-only] [--telegram-only] [--websites-only]
 *                                         [--concurrency <N>] [--limit <N>] [--report <path>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { triggerProductionDeploy } from './deploy-production.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// Automatically load .env if present in project root
if (typeof process.loadEnvFile === 'function') {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch (e) {}
  }
}

export const GITHUB_FILE = path.join(ROOT_DIR, 'src/data/nav/github.json');
export const TELEGRAM_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram.json');
export const WEBSITES_FILE = path.join(ROOT_DIR, 'src/data/nav/websites.json');
export const DEFAULT_REPORT_FILE = path.join(ROOT_DIR, 'audit-reports/nav-health-report.json');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Concurrent worker pool with bounded parallelism
 */
export async function runConcurrentPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency || 4, items.length));
  if (items.length === 0) return results;

  const workers = new Array(limit).fill(0).map(async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Auto-heals a resource by promoting a healthy mirror to primary URL
 */
export function autoHealResource(item, probeRes) {
  if (!probeRes || !probeRes.mirrorAlive || !probeRes.activeMirror) {
    return false;
  }
  const failedUrl = item.url;
  const activeMirror = probeRes.activeMirror;
  if (failedUrl === activeMirror) return false;

  item.url = activeMirror;
  const rawMirrors = Array.isArray(item.mirror_urls) ? item.mirror_urls : [];
  const remainingMirrors = rawMirrors.filter(m => m !== activeMirror && m !== failedUrl);
  if (failedUrl) {
    remainingMirrors.push(failedUrl);
  }
  item.mirror_urls = remainingMirrors;

  item.is_alive = true;
  item.auto_healed = true;
  item.healed_at = new Date().toISOString();
  item.last_healed_from = failedUrl;
  return true;
}

// ==================== 1. GitHub Prober ====================
export async function probeGithubRepo(item, options = {}) {
  const repoName = item.repo || `${item.owner}/${item.name}`;
  const apiUrl = `https://api.github.com/repos/${repoName}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) XIU-Nav-HealthCheck/1.0',
    'Accept': 'application/vnd.github.v3+json'
  };
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  const customFetch = options.fetch || fetch;

  try {
    const res = await customFetch(apiUrl, { headers });
    if (res.status === 404) {
      // Primary repo 404: check mirror_urls if present
      if (Array.isArray(item.mirror_urls) && item.mirror_urls.length > 0) {
        for (const mirror of item.mirror_urls) {
          try {
            const mRes = await customFetch(mirror, { method: 'HEAD', headers });
            if (mRes.ok || mRes.status === 401 || mRes.status === 403) {
              return {
                id: item.id,
                repo: repoName,
                alive: false,
                mirrorAlive: true,
                activeMirror: mirror,
                reason: `REPO_NOT_FOUND (404) | MIRROR_OK (${mirror})`
              };
            }
          } catch (e) {}
        }
      }
      return { id: item.id, repo: repoName, alive: false, reason: 'REPO_NOT_FOUND (404)' };
    }
    if (res.status === 403 || res.status === 429) {
      return { id: item.id, repo: repoName, alive: true, skipped: true, reason: 'RATE_LIMITED' };
    }
    if (!res.ok) {
      return { id: item.id, repo: repoName, alive: false, reason: `HTTP_${res.status}` };
    }

    const data = await res.json();
    return {
      id: item.id,
      repo: repoName,
      alive: !data.archived && !data.disabled,
      archived: !!data.archived,
      disabled: !!data.disabled,
      stars: data.stargazers_count ?? item.stars,
      forks: data.forks_count ?? item.forks,
      description: data.description || item.description,
      language: data.language || item.language,
      pushed_at: data.pushed_at ? data.pushed_at.split('T')[0] : item.last_commit
    };
  } catch (err) {
    return { id: item.id, repo: repoName, alive: false, reason: err.message };
  }
}

// ==================== 2. Telegram Prober ====================
export async function probeTelegramChannel(item, options = {}) {
  const username = item.username || (item.url ? item.url.replace(/^https?:\/\/t\.me\//, '').replace(/\//g, '') : '');
  if (!username) return { id: item.id, alive: false, reason: 'NO_USERNAME' };

  const standardUrl = `https://t.me/${username}`;
  const previewUrl = `https://t.me/s/${username}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  const customFetch = options.fetch || fetch;

  try {
    let res = await customFetch(previewUrl, { headers, redirect: 'manual' });
    let html = '';
    if (res.status === 200) {
      html = await res.text();
    }
    if (!html.includes('tgme_page_title')) {
      res = await customFetch(standardUrl, { headers, redirect: 'follow' });
      if (res.status === 200) {
        html = await res.text();
      }
    }

    if (!html || (!html.includes('tgme_page_title') && !html.includes('tgme_page_extra'))) {
      return { id: item.id, username, alive: false, reason: 'CHANNEL_NOT_FOUND' };
    }

    const isScam = /scam|fake/i.test(html) && html.includes('tgme_page_context_action');
    if (isScam) {
      return { id: item.id, username, alive: false, reason: 'SCAM_WARNING' };
    }

    // Parse member count
    let memberCount = item.member_count || 0;
    const extraMatch = html.match(/class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/);
    if (extraMatch) {
      const extraText = extraMatch[1].replace(/<[^>]+>/g, '').trim();
      const numMatch = extraText.match(/([\d\s,.]+)\s*(?:subscribers|members|位订阅者|名成员|members)/i);
      if (numMatch) {
        let clean = numMatch[1].replace(/[\s,]/g, '');
        let factor = 1;
        if (/k/i.test(clean)) {
          factor = 1000;
          clean = clean.replace(/k/i, '');
        } else if (/m/i.test(clean)) {
          factor = 1000000;
          clean = clean.replace(/m/i, '');
        }
        const parsed = Math.round(parseFloat(clean) * factor);
        if (!isNaN(parsed) && parsed > 0) {
          memberCount = parsed;
        }
      }
    }

    return {
      id: item.id,
      username,
      alive: true,
      member_count: memberCount
    };
  } catch (err) {
    return { id: item.id, username, alive: true, skipped: true, reason: err.message };
  }
}

// ==================== 3. Website & Mirror Prober ====================
export async function probeWebsite(item, options = {}) {
  const url = item.url;
  const timeoutMs = options.timeoutMs || 5000;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) XIU-Nav-HealthCheck/1.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };

  const customFetch = options.fetch || fetch;

  async function checkUrl(targetUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res = await customFetch(targetUrl, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
        redirect: 'follow'
      });
      if (res.status === 405) {
        res = await customFetch(targetUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
          redirect: 'follow'
        });
      }
      clearTimeout(timer);
      const isOk = (res.status >= 200 && res.status < 400) || res.status === 401 || res.status === 403 || res.status === 429;
      return { ok: isOk, status: res.status, wafProtected: res.status === 403 };
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, status: 0, error: err.message };
    }
  }

  const primaryRes = await checkUrl(url);
  if (primaryRes.ok) {
    return { id: item.id, url, alive: true, status: primaryRes.status, waf: primaryRes.wafProtected };
  }

  // Primary URL failed; probe mirror_urls if configured
  if (Array.isArray(item.mirror_urls) && item.mirror_urls.length > 0) {
    for (const mirror of item.mirror_urls) {
      const mirrorRes = await checkUrl(mirror);
      if (mirrorRes.ok) {
        return {
          id: item.id,
          url,
          alive: false,
          mirrorAlive: true,
          activeMirror: mirror,
          reason: `PRIMARY_FAIL (${primaryRes.status || primaryRes.error}) | MIRROR_OK (${mirror})`
        };
      }
    }
  }

  return {
    id: item.id,
    url,
    alive: false,
    reason: `UNREACHABLE (${primaryRes.status || primaryRes.error})`
  };
}

// ==================== 4. Health Check Runner ====================
export async function runHealthCheck(cliArgs = process.argv.slice(2)) {
  const isWriteMode = cliArgs.includes('--write');
  const isAutoHeal = cliArgs.includes('--auto-heal');
  const isDryRun = cliArgs.includes('--dry-run') || !isWriteMode;
  const githubOnly = cliArgs.includes('--github-only');
  const telegramOnly = cliArgs.includes('--telegram-only');
  const websitesOnly = cliArgs.includes('--websites-only');

  const concurrencyArgIdx = cliArgs.indexOf('--concurrency');
  const concurrency = (concurrencyArgIdx !== -1 && parseInt(cliArgs[concurrencyArgIdx + 1], 10)) || 4;

  const limitArgIdx = cliArgs.indexOf('--limit');
  const globalLimit = (limitArgIdx !== -1 && parseInt(cliArgs[limitArgIdx + 1], 10)) || 0;

  const reportArgIdx = cliArgs.indexOf('--report');
  const reportPath = (reportArgIdx !== -1 && cliArgs[reportArgIdx + 1]) || DEFAULT_REPORT_FILE;

  console.log('===========================================================');
  console.log(`🧭 NAVIGATION ECOSYSTEM HEALTH CHECK & AUTO-HEALING ENGINE`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN (Read Only)' : (isAutoHeal ? 'WRITE + AUTO-HEAL (Live Mutation & Mirror Promotion)' : 'WRITE (Live Mutation)')}`);
  console.log(`Concurrency: ${concurrency} parallel workers`);
  console.log(`GitHub Token: ${GITHUB_TOKEN ? 'PRESENT (5000 req/hr)' : 'ABSENT (60 req/hr)'}`);
  console.log('===========================================================\n');

  let ghUpdated = 0;
  let tgUpdated = 0;
  let webUpdated = 0;
  let autoHealedCount = 0;

  const unreachableResources = [];
  const autoHealedResources = [];

  // 1. Audit GitHub Repos
  if (!telegramOnly && !websitesOnly && fs.existsSync(GITHUB_FILE)) {
    console.log('[1/3] Auditing GitHub Repositories...');
    const ghList = JSON.parse(fs.readFileSync(GITHUB_FILE, 'utf-8'));
    const itemsToAudit = globalLimit > 0 ? ghList.slice(0, globalLimit) : ghList;
    console.log(`Found ${ghList.length} GitHub entries. Auditing ${itemsToAudit.length}...`);

    await runConcurrentPool(itemsToAudit, Math.min(concurrency, 3), async (it, i) => {
      process.stdout.write(`  [${i + 1}/${itemsToAudit.length}] Probing ${it.repo}... `);
      const probeRes = await probeGithubRepo(it);

      if (probeRes.skipped) {
        console.log(`SKIPPED (${probeRes.reason})`);
        return;
      }

      if (!probeRes.alive) {
        if (isAutoHeal && probeRes.mirrorAlive && probeRes.activeMirror) {
          const healed = autoHealResource(it, probeRes);
          if (healed) {
            console.log(`PRIMARY DOWN | 🩹 AUTO-HEALED -> Promoted ${probeRes.activeMirror}`);
            autoHealedCount++;
            ghUpdated++;
            autoHealedResources.push({
              id: it.id,
              type: 'github',
              title: it.repo,
              previous_url: it.last_healed_from,
              promoted_url: it.url
            });
            return;
          }
        }
        console.log(`DEAD/FLAGGED (${probeRes.reason})`);
        it.is_alive = false;
        ghUpdated++;
        unreachableResources.push({
          id: it.id,
          type: 'github',
          title: it.repo,
          url: it.url,
          reason: probeRes.reason
        });
      } else {
        const starDiff = probeRes.stars - (it.stars || 0);
        const starDiffStr = starDiff >= 0 ? `+${starDiff}` : `${starDiff}`;
        console.log(`ALIVE | ⭐ ${probeRes.stars} (${starDiffStr})`);

        it.is_alive = true;
        it.stars = probeRes.stars;
        it.forks = probeRes.forks;
        if (probeRes.pushed_at) it.last_commit = probeRes.pushed_at;
        it.updated_at = new Date().toISOString().split('T')[0];
        ghUpdated++;
      }
    });

    if (isWriteMode && ghUpdated > 0) {
      fs.writeFileSync(GITHUB_FILE, JSON.stringify(ghList, null, 2) + '\n', 'utf-8');
      console.log(`[GitHub] Successfully wrote updates to ${GITHUB_FILE}`);
    }
  }

  // 2. Audit Telegram Resources
  if (!githubOnly && !websitesOnly && fs.existsSync(TELEGRAM_FILE)) {
    console.log('\n[2/3] Auditing Telegram Channels & Bots...');
    const tgList = JSON.parse(fs.readFileSync(TELEGRAM_FILE, 'utf-8'));
    const probeLimit = globalLimit > 0 ? Math.min(tgList.length, globalLimit) : Math.min(tgList.length, 25);
    const itemsToAudit = tgList.slice(0, probeLimit);
    console.log(`Found ${tgList.length} Telegram entries. Auditing first ${probeLimit}...`);

    await runConcurrentPool(itemsToAudit, Math.min(concurrency, 2), async (it, j) => {
      process.stdout.write(`  [${j + 1}/${probeLimit}] Probing @${it.username}... `);
      const probeRes = await probeTelegramChannel(it);

      if (probeRes.skipped) {
        console.log(`SKIPPED (${probeRes.reason})`);
        return;
      }

      if (!probeRes.alive) {
        console.log(`DEAD/FLAGGED (${probeRes.reason})`);
        it.is_alive = false;
        tgUpdated++;
        unreachableResources.push({
          id: it.id,
          type: 'telegram',
          title: it.title || it.username,
          url: it.url,
          reason: probeRes.reason
        });
      } else {
        console.log(`ALIVE | 👥 ${probeRes.member_count}`);
        it.is_alive = true;
        if (probeRes.member_count > 0) it.member_count = probeRes.member_count;
        it.updated_at = new Date().toISOString().split('T')[0];
        tgUpdated++;
      }
    });

    if (isWriteMode && tgUpdated > 0) {
      fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(tgList, null, 2) + '\n', 'utf-8');
      console.log(`[Telegram] Successfully wrote updates to ${TELEGRAM_FILE}`);
    }
  }

  // 3. Audit Websites & Tool Mirrors
  if (!githubOnly && !telegramOnly && fs.existsSync(WEBSITES_FILE)) {
    console.log('\n[3/3] Auditing Websites, Web Tools & Mirrors...');
    const webList = JSON.parse(fs.readFileSync(WEBSITES_FILE, 'utf-8'));
    const itemsToAudit = globalLimit > 0 ? webList.slice(0, globalLimit) : webList;
    console.log(`Found ${webList.length} Website entries. Auditing ${itemsToAudit.length}...`);

    await runConcurrentPool(itemsToAudit, concurrency, async (it, k) => {
      process.stdout.write(`  [${k + 1}/${itemsToAudit.length}] Probing ${it.title} (${it.url})... `);
      const probeRes = await probeWebsite(it);

      if (!probeRes.alive) {
        if (isAutoHeal && probeRes.mirrorAlive && probeRes.activeMirror) {
          const healed = autoHealResource(it, probeRes);
          if (healed) {
            console.log(`PRIMARY DOWN | 🩹 AUTO-HEALED -> Promoted ${probeRes.activeMirror}`);
            autoHealedCount++;
            webUpdated++;
            autoHealedResources.push({
              id: it.id,
              type: 'website',
              title: it.title,
              previous_url: it.last_healed_from,
              promoted_url: it.url
            });
            return;
          }
        }

        if (probeRes.mirrorAlive) {
          console.log(`PRIMARY DOWN | 🪞 MIRROR OK (${probeRes.activeMirror})`);
        } else {
          console.log(`DEAD/OFFLINE (${probeRes.reason})`);
        }
        it.is_alive = false;
        it.updated_at = new Date().toISOString().split('T')[0];
        webUpdated++;
        unreachableResources.push({
          id: it.id,
          type: 'website',
          title: it.title,
          url: it.url,
          reason: probeRes.reason,
          mirror_available: probeRes.mirrorAlive ? probeRes.activeMirror : null
        });
      } else {
        console.log(`ALIVE (HTTP ${probeRes.status || 200})`);
        it.is_alive = true;
        it.updated_at = new Date().toISOString().split('T')[0];
        webUpdated++;
      }
    });

    if (isWriteMode && webUpdated > 0) {
      fs.writeFileSync(WEBSITES_FILE, JSON.stringify(webList, null, 2) + '\n', 'utf-8');
      console.log(`[Websites] Successfully wrote updates to ${WEBSITES_FILE}`);
    }
  }

  // 4. Save Structured Diagnostic Report
  const reportDir = path.dirname(reportPath);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPayload = {
    generated_at: new Date().toISOString(),
    mode: isDryRun ? 'dry-run' : (isAutoHeal ? 'write-auto-heal' : 'write'),
    summary: {
      github_updated: ghUpdated,
      telegram_updated: tgUpdated,
      websites_updated: webUpdated,
      auto_healed_count: autoHealedCount,
      unreachable_count: unreachableResources.length
    },
    auto_healed_resources: autoHealedResources,
    unreachable_resources: unreachableResources
  };

  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2) + '\n', 'utf-8');
  console.log(`\n[Report] Diagnostic audit report written to ${reportPath}`);

  // 5. Rebuild search indexes if in write mode with mutations
  if (isWriteMode && (ghUpdated > 0 || tgUpdated > 0 || webUpdated > 0)) {
    console.log('\n[Rebuild] Synchronizing nav search index...');
    const syncRes = spawnSync('node', ['src/scripts/build-nav-search-index.mjs'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: 'inherit'
    });
    if (syncRes.status === 0) {
      console.log('[Rebuild] Nav search index synchronized successfully.');
    }
  }

  // 6. Push Telegram Notification if anomalies found or auto-healed
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const apiBase = process.env.TELEGRAM_API_BASE
    ? `${process.env.TELEGRAM_API_BASE.replace(/\/+$/, '')}/bot${botToken}`
    : `https://api.telegram.org/bot${botToken}`;

  if (botToken && adminChatId && (autoHealedCount > 0 || unreachableResources.length > 0)) {
    try {
      console.log('\n[Telegram] 推送健康巡检与死链自愈报告至管理员...');
      let msg = `<b>🛡️ 【XIU 导航站健康巡检报告】</b>\n\n` +
        `• <b>巡检时间</b>：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n` +
        `• <b>自愈镜像</b>：<b>${autoHealedCount}</b> 项\n` +
        `• <b>失效异常</b>：<b>${unreachableResources.length}</b> 项\n`;

      if (autoHealedCount > 0) {
        msg += `\n🩹 <b>【自动提升镜像自愈】</b>\n`;
        autoHealedResources.slice(0, 5).forEach(r => {
          msg += `• <b>${r.title}</b>: <code>${r.previous_url}</code> &rarr; <code>${r.promoted_url}</code>\n`;
        });
      }

      if (unreachableResources.length > 0) {
        msg += `\n🚨 <b>【当前失联死链】</b>\n`;
        unreachableResources.slice(0, 5).forEach(r => {
          msg += `• <b>${r.title}</b> (${r.url}): <i>${r.reason}</i>\n`;
        });
      }

      const tgRes = await fetch(`${apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminChatId,
          text: msg,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (tgRes.ok) {
        console.log('[Telegram] ✅ 巡检报告已成功推送至 Telegram');
      }
    } catch (tgErr) {
      console.warn('[Telegram Warning] 报告推送失败:', tgErr.message);
    }
  }

  // Trigger Production Deployment if auto-healed or mutations occurred
  if (autoHealedCount > 0 || (isWriteMode && (ghUpdated > 0 || tgUpdated > 0 || webUpdated > 0))) {
    try {
      console.log('[Deploy] 巡检产生了数据更新，正在调度生产边缘构建与发布...');
      triggerProductionDeploy({
        reason: `巡检自愈: ${autoHealedCount} 个镜像提升, 变更项目 G(${ghUpdated})/T(${tgUpdated})/W(${webUpdated})`,
        background: true
      });
    } catch (dhErr) {
      console.warn('[Deploy Warning] 边缘发布调度异常:', dhErr.message);
    }
  }

  console.log('\n===========================================================');
  console.log(`🎉 AUDIT COMPLETE: GitHub (${ghUpdated}), Telegram (${tgUpdated}), Websites (${webUpdated}), Auto-Healed (${autoHealedCount}).`);
  console.log('===========================================================');

  return reportPayload;
}

// Direct CLI Invocation Check
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runHealthCheck().catch(err => {
    console.error('Fatal health check error:', err);
    process.exit(1);
  });
}
