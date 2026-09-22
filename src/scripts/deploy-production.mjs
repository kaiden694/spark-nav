#!/usr/bin/env node
/**
 * Unified Production Deployment Pipeline for XIU Navigation System
 *
 * Dual-Track Architecture:
 * 1. Webhook Mode (Cloudflare Deploy Hook):
 *    - Triggered when CF_DEPLOY_HOOK or CLOUDFLARE_DEPLOY_HOOK is set in environment.
 *    - Instantaneous HTTP POST request triggering Cloudflare Cloud Build.
 * 2. Autonomous VPS Mode (Wrangler Direct Upload):
 *    - Used when Deploy Hook is not configured and Wrangler credentials exist.
 *    - Runs `npm run build` and `CI=true npx wrangler pages deploy dist --project-name=xiu-theme --branch=main --commit-dirty=true`.
 *    - Guarded by file lock (logs/deploy.lock) with automatic debounced queuing to prevent build race conditions.
 *    - Can run detached/in the background to keep approval callbacks responsive (<100ms).
 *    - Sends completion status to Telegram Admin if configured.
 *
 * Usage:
 *   node src/scripts/deploy-production.mjs                     # Synchronous direct deploy
 *   node src/scripts/deploy-production.mjs --async             # Detached background execution
 *   node src/scripts/deploy-production.mjs --reason "Audit"   # Deploy with reason label
 *   node src/scripts/deploy-production.mjs --status            # Check deployment lock/history
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const LOCK_FILE = path.join(LOGS_DIR, 'deploy.lock');
const DEPLOY_LOG_FILE = path.join(LOGS_DIR, 'deploy.log');

// Auto-load .env
if (typeof process.loadEnvFile === 'function') {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch (e) {}
  }
}

/**
 * Ensure logs directory exists
 */
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Append entry to deploy log file
 */
function logDeploy(msg) {
  ensureLogsDir();
  const time = new Date().toISOString();
  const line = `[${time}] ${msg}\n`;
  try {
    fs.appendFileSync(DEPLOY_LOG_FILE, line, 'utf-8');
  } catch (e) {}
  console.log(line.trim());
}

/**
 * Send notification to Telegram Admin
 */
async function notifyTelegram({ title, details, success = true }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !adminChatId) return;

  const apiBase = process.env.TELEGRAM_API_BASE
    ? `${process.env.TELEGRAM_API_BASE.replace(/\/+$/, '')}/bot${token}`
    : `https://api.telegram.org/bot${token}`;

  const icon = success ? '🚀' : '⚠️';
  const text = `<b>${icon} 【${title}】</b>\n\n` +
    details + '\n\n' +
    `• <b>边缘域名</b>：<a href="https://xiu-theme.pages.dev/nav.html">xiu-theme.pages.dev</a>\n` +
    `• <b>同步时间</b>：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;

  try {
    await fetch(`${apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    console.warn(`[Deploy Notification Warning] Telegram 消息发送异常:`, err.message);
  }
}

/**
 * Acquire lock or register queued flag
 */
function acquireLock(reason = '') {
  ensureLogsDir();
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const ageMs = Date.now() - (lockData.timestamp || 0);

      // If older than 10 minutes, lock is stale, override it
      if (ageMs < 10 * 60 * 1000) {
        // Mark queued so current runner re-executes
        lockData.queued = true;
        lockData.lastQueuedReason = reason;
        fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2), 'utf-8');
        return { acquired: false, runningPid: lockData.pid, ageMs };
      }
    } catch (e) {
      // Corrupt lock file, override
    }
  }

  const newLock = {
    pid: process.pid,
    timestamp: Date.now(),
    reason: reason,
    queued: false
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(newLock, null, 2), 'utf-8');
  return { acquired: true };
}

/**
 * Release lock and check if a queue execution was requested
 */
function releaseLock() {
  if (!fs.existsSync(LOCK_FILE)) return { hadQueue: false };
  try {
    const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    fs.unlinkSync(LOCK_FILE);
    return { hadQueue: Boolean(lockData.queued), queuedReason: lockData.lastQueuedReason };
  } catch (e) {
    try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
    return { hadQueue: false };
  }
}

/**
 * Deploy via Cloudflare Pages Deploy Hook (Track 1)
 */
async function deployViaHook(hookUrl, { reason = 'Manual trigger' } = {}) {
  const startTime = Date.now();
  logDeploy(`[Track 1] 正在通过 Cloudflare Deploy Hook 触发远程构建流水线... (${reason})`);

  try {
    const res = await fetch(hookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(12000)
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    if (res.ok) {
      logDeploy(`[Track 1] ✅ Deploy Hook 触发成功 (HTTP ${res.status}, 耗时 ${duration}s)`);
      return {
        success: true,
        mode: 'deploy_hook',
        status: res.status,
        duration: duration
      };
    } else {
      const errText = await res.text().catch(() => '');
      logDeploy(`[Track 1] ⚠️ Deploy Hook 返回非正常状态码: HTTP ${res.status} (${errText})`);
      return {
        success: false,
        mode: 'deploy_hook',
        status: res.status,
        error: `HTTP ${res.status}: ${errText}`
      };
    }
  } catch (err) {
    logDeploy(`[Track 1] ⚠️ Deploy Hook 网络请求异常: ${err.message}`);
    return {
      success: false,
      mode: 'deploy_hook',
      error: err.message
    };
  }
}

/**
 * Deploy via Local Build & Wrangler Direct Upload (Track 2)
 */
async function deployViaWrangler({ reason = 'Autonomous build' } = {}) {
  const startTime = Date.now();
  logDeploy(`[Track 2] 正在启动全自主构建与 Wrangler Direct Upload 流水线... (${reason})`);

  // Step 1: Run Astro build & search indexing
  logDeploy(`[Track 2] [1/2] 正在编译生产静态资源 (npm run build)...`);
  const buildResult = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: true,
    env: { ...process.env, NODE_ENV: 'production' }
  });

  if (buildResult.status !== 0) {
    const errMsg = buildResult.stderr || buildResult.stdout || '构建失败';
    logDeploy(`[Track 2] ❌ npm run build 编译失败:\n${errMsg}`);
    return {
      success: false,
      mode: 'wrangler_direct',
      error: `Build failed: ${errMsg.slice(0, 300)}`
    };
  }
  logDeploy(`[Track 2] ✅ 静态资源编译完成！`);

  // Step 2: Run Wrangler Direct Deploy
  logDeploy(`[Track 2] [2/2] 正在向 Cloudflare Pages 同步增量资产 (wrangler pages deploy)...`);
  const deployResult = spawnSync('npx', [
    'wrangler', 'pages', 'deploy', 'dist',
    '--project-name=xiu-theme',
    '--branch=main',
    '--commit-dirty=true'
  ], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: true,
    env: { ...process.env, CI: 'true' }
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  if (deployResult.status !== 0) {
    const deployErr = deployResult.stderr || deployResult.stdout || '部署失败';
    logDeploy(`[Track 2] ❌ Wrangler 部署失败:\n${deployErr}`);
    return {
      success: false,
      mode: 'wrangler_direct',
      error: `Wrangler deploy failed: ${deployErr.slice(0, 300)}`
    };
  }

  logDeploy(`[Track 2] 🚀 Cloudflare Pages 边缘分发完成！总耗时: ${duration}s`);
  return {
    success: true,
    mode: 'wrangler_direct',
    duration: duration,
    output: deployResult.stdout
  };
}

/**
 * Main Deployment Execution Flow
 */
export async function runProductionDeploy({ reason = 'Data mutation', notify = true } = {}) {
  const hookUrl = process.env.CF_DEPLOY_HOOK || process.env.CLOUDFLARE_DEPLOY_HOOK;

  // Track 1: If Deploy Hook is configured, execute via Hook
  if (hookUrl) {
    const result = await deployViaHook(hookUrl, { reason });
    if (notify) {
      if (result.success) {
        await notifyTelegram({
          title: 'Cloudflare 边缘发布成功',
          details: `• <b>触发原因</b>：${reason}\n• <b>发布途径</b>：Cloudflare Deploy Hook\n• <b>耗时</b>：${result.duration}s`,
          success: true
        });
      } else {
        await notifyTelegram({
          title: 'Cloudflare 边缘发布异常',
          details: `• <b>触发原因</b>：${reason}\n• <b>发布途径</b>：Cloudflare Deploy Hook\n• <b>错误信息</b>：<code>${result.error}</code>`,
          success: false
        });
      }
    }
    return result;
  }

  // Track 2: Autonomous Local Wrangler Deployment
  const lock = acquireLock(reason);
  if (!lock.acquired) {
    logDeploy(`[Lock] 另一部署进程正在进行中 (PID: ${lock.runningPid})，已将本请求加入排队队列。`);
    return {
      success: true,
      queued: true,
      message: 'Deployment already running; queued for next iteration'
    };
  }

  let finalResult;
  try {
    finalResult = await deployViaWrangler({ reason });

    if (notify) {
      if (finalResult.success) {
        await notifyTelegram({
          title: '生产边缘 CDN 自动发布成功',
          details: `• <b>触发原因</b>：${reason}\n• <b>发布途径</b>：VPS 全自主构建 (Wrangler Direct Upload)\n• <b>部署耗时</b>：${finalResult.duration}s`,
          success: true
        });
      } else {
        await notifyTelegram({
          title: '生产边缘 CDN 发布失败',
          details: `• <b>触发原因</b>：${reason}\n• <b>发布途径</b>：VPS 全自主构建\n• <b>错误摘要</b>：<code>${finalResult.error}</code>`,
          success: false
        });
      }
    }
  } finally {
    const { hadQueue, queuedReason } = releaseLock();
    // If requests were queued while we were running, trigger one debounced final cycle
    if (hadQueue) {
      logDeploy(`[Queue] 检测到排队队列中有新变更 (${queuedReason || '后续申请'})，自动启动后续闭环构建...`);
      setTimeout(() => {
        runProductionDeploy({ reason: `Queued: ${queuedReason || 'Subsequent mutation'}`, notify: false }).catch(err => {
          logDeploy(`[Queue Error] 后续构建异常: ${err.message}`);
        });
      }, 2000);
    }
  }

  return finalResult;
}

/**
 * Trigger deployment either synchronously or in detached background mode
 */
export function triggerProductionDeploy({ reason = 'Data mutation', background = true } = {}) {
  if (background) {
    ensureLogsDir();
    const logStream = fs.openSync(DEPLOY_LOG_FILE, 'a');
    const child = spawn(process.execPath, [__filename, '--reason', reason], {
      cwd: ROOT_DIR,
      detached: true,
      stdio: ['ignore', logStream, logStream]
    });
    child.unref();
    return {
      triggered: true,
      mode: 'background',
      pid: child.pid
    };
  } else {
    return runProductionDeploy({ reason });
  }
}

// CLI Execution Handler
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);

  // Check status
  if (args.includes('--status')) {
    console.log('=== Production Deploy Status ===');
    if (fs.existsSync(LOCK_FILE)) {
      console.log('Lock: ACTIVE');
      console.log(fs.readFileSync(LOCK_FILE, 'utf-8'));
    } else {
      console.log('Lock: IDLE (No active deployments)');
    }
    if (fs.existsSync(DEPLOY_LOG_FILE)) {
      const logs = fs.readFileSync(DEPLOY_LOG_FILE, 'utf-8').trim().split('\n');
      console.log('\nRecent Deploy Logs (last 10 lines):');
      console.log(logs.slice(-10).join('\n'));
    }
    process.exit(0);
  }

  const reasonIdx = args.indexOf('--reason');
  const reason = reasonIdx !== -1 && args[reasonIdx + 1] ? args[reasonIdx + 1] : 'Manual CLI trigger';

  if (args.includes('--async') || args.includes('--background')) {
    const res = triggerProductionDeploy({ reason, background: true });
    console.log(`[Deploy] Background process started (PID: ${res.pid})`);
    process.exit(0);
  } else {
    runProductionDeploy({ reason })
      .then(res => {
        if (!res.success) {
          console.error(`Deploy finished with error:`, res.error);
          process.exit(1);
        }
        console.log(`Deploy finished successfully:`, res);
        process.exit(0);
      })
      .catch(err => {
        console.error(`Deploy fatal error:`, err);
        process.exit(1);
      });
  }
}
