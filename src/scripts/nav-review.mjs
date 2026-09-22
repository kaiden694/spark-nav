#!/usr/bin/env node
/**
 * XIU Navigation - Admin Review & Ingestion Pipeline
 * Review pending submissions and broken link reports collected via @xiunav_bot or web forms.
 *
 * Usage:
 *   node src/scripts/nav-review.mjs                     # List pending queue
 *   node src/scripts/nav-review.mjs --approve <sub_id>  # Approve & ingest into production nav datasets
 *   node src/scripts/nav-review.mjs --reject <sub_id>   # Reject a submission
 *   node src/scripts/nav-review.mjs --resolve-report <rep_id> # Mark a report as handled
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { triggerProductionDeploy } from './deploy-production.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const NAV_DATA_DIR = path.join(ROOT_DIR, 'src/data/nav');

const SUBMISSIONS_FILE = path.join(NAV_DATA_DIR, 'pending_submissions.json');
const REPORTS_FILE = path.join(NAV_DATA_DIR, 'pending_reports.json');
const WEBSITES_FILE = path.join(NAV_DATA_DIR, 'websites.json');
const GITHUB_FILE = path.join(NAV_DATA_DIR, 'github.json');
const TELEGRAM_FILE = path.join(NAV_DATA_DIR, 'telegram.json');
const AI_OVERRIDES_FILE = path.join(NAV_DATA_DIR, 'ai-overrides.json');

const CATEGORY_MAP = {
  featured: { id: 'featured', name: '常用精选', icon: '🌟', label: '🌟 常用精选' },
  tools: { id: 'tools', name: '实用工具', icon: '🛠️', label: '🛠️ 实用工具' },
  github: { id: 'github', name: '开源矩阵', icon: '💻', label: '💻 开源矩阵' },
  telegram: { id: 'telegram', name: '电报生态', icon: '✈️', label: '✈️ 电报生态' },
  creators: { id: 'creators', name: '优质博主', icon: '👤', label: '👤 优质博主' }
};

function normalizeCategory(rawCat, urlStr = '') {
  if (rawCat) {
    const s = String(rawCat).toLowerCase().trim();
    if (s.includes('精选') || s.includes('featured')) return CATEGORY_MAP.featured;
    if (s.includes('工具') || s.includes('tool')) return CATEGORY_MAP.tools;
    if (s.includes('开源') || s.includes('github') || s.includes('代码')) return CATEGORY_MAP.github;
    if (s.includes('电报') || s.includes('telegram') || s.includes('tg')) return CATEGORY_MAP.telegram;
    if (s.includes('博主') || s.includes('creator') || s.includes('作者')) return CATEGORY_MAP.creators;
  }
  if (urlStr) {
    const u = String(urlStr).toLowerCase();
    if (u.includes('github.com')) return CATEGORY_MAP.github;
    if (u.includes('t.me') || u.includes('telegram.me')) return CATEGORY_MAP.telegram;
    if (u.includes('x.com') || u.includes('twitter.com') || u.includes('youtube.com')) return CATEGORY_MAP.creators;
  }
  return CATEGORY_MAP.tools;
}

const FAVICONS_DIR = path.join(ROOT_DIR, 'public/assets/images/nav/favicons');

function inferSubcategory(categoryKey, meta = {}) {
  const text = `${meta.title || ''} ${meta.description || ''} ${meta.url || ''}`.toLowerCase();

  if (categoryKey === 'tools') {
    if (/ai|gpt|llm|大模型|智能|chat|agent|生成|深度学习|prompt/i.test(text)) return 'ai';
    if (/dev|api|git|运维|代码|docker|k8s|linux|编译|sdk|ci|cd/i.test(text)) return 'dev';
    if (/影音|视频|音乐|图片|media|video|audio|壁纸|下载|设计|影视/i.test(text)) return 'media';
    return 'efficiency';
  }

  if (categoryKey === 'github') {
    if (/clash|proxy|vpn|代理|sing-box|mihomo|v2ray|trojan|翻墙|梯子/i.test(text)) return 'proxy-clients';
    if (/ai|llm|gpt|agent|ollama|model|diffusers|transformer/i.test(text)) return 'ai-models';
    return 'devtools';
  }

  if (categoryKey === 'telegram') {
    if (/bot|机器人|群管|安全|verify|captcha|防广告/i.test(text)) return 'management';
    if (/视频|影视|音乐|下载|解析|电影/i.test(text)) return 'media';
    if (/ai|开发|编程|极客|linux|code/i.test(text)) return 'ai-dev';
    if (/新闻|资讯|金融|快讯|行情|外贸|出海/i.test(text)) return 'news';
    if (/主机|vps|节点|机场|网络|宽带/i.test(text)) return 'network';
    return 'official';
  }

  if (categoryKey === 'creators') {
    if (/ai|科技|算法|research|ml|前沿/i.test(text)) return 'tech';
    if (/全栈|开发|独立|indie|engineer|coder|开发者/i.test(text)) return 'dev';
    return 'content';
  }

  if (categoryKey === 'featured') {
    if (/论坛|社区|极客|community|bbs|group/i.test(text)) return 'community';
    return 'core';
  }

  return 'efficiency';
}

async function cacheFaviconLocally(remoteUrl, slug) {
  if (!remoteUrl || typeof remoteUrl !== 'string') return '/favicon.ico';
  if (remoteUrl.startsWith('/') || remoteUrl.startsWith('./')) return remoteUrl;

  try {
    fs.mkdirSync(FAVICONS_DIR, { recursive: true });
    let ext = '.png';
    if (remoteUrl.includes('.ico')) ext = '.ico';
    else if (remoteUrl.includes('.svg')) ext = '.svg';
    else if (remoteUrl.includes('.webp')) ext = '.webp';

    const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().slice(0, 32);
    const fileName = `${safeSlug}${ext}`;
    const destPath = path.join(FAVICONS_DIR, fileName);

    const res = await fetch(remoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) XIU-Asset-Sync/1.0',
        'Accept': 'image/*,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 0) {
        fs.writeFileSync(destPath, buffer);
        console.log(`[Icon Cached] 已持久化至本地: public/assets/images/nav/favicons/${fileName} (${buffer.length} bytes)`);
        return `/assets/images/nav/favicons/${fileName}`;
      }
    }
  } catch (err) {
    console.warn(`[Icon Warning] 本地缓存下载失败 (${remoteUrl}):`, err.message);
  }

  return remoteUrl;
}

function readJsonSafe(file, defaultVal = []) {
  if (!fs.existsSync(file)) return defaultVal;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return defaultVal;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function detectUrlType(urlStr) {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname;

    if (host.includes('github.com')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { type: 'github', owner: parts[0], repo: `${parts[0]}/${parts[1]}` };
      }
    }
    if (host.includes('t.me') || host.includes('telegram.me')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1) {
        const username = parts[0].replace(/^s\//, '');
        return { type: 'telegram', username };
      }
    }
    return { type: 'website' };
  } catch (err) {
    return { type: 'website' };
  }
}

function listQueues() {
  const subs = readJsonSafe(SUBMISSIONS_FILE);
  const reps = readJsonSafe(REPORTS_FILE);

  const pendingSubs = subs.filter(s => s.status === 'pending');
  const pendingReps = reps.filter(r => r.status === 'pending');

  console.log(`\n======================================================`);
  console.log(`📋 XIU NAVIGATION PENDING AUDIT DASHBOARD`);
  console.log(`======================================================`);
  console.log(`• 待审收录项: ${pendingSubs.length} (历史总数: ${subs.length})`);
  console.log(`• 待办反馈项: ${pendingReps.length} (历史总数: ${reps.length})`);

  if (pendingSubs.length > 0) {
    console.log(`\n--- 📥 待审站点收录 (Pending Submissions) ---`);
    pendingSubs.forEach((item, idx) => {
      const probe = item.probeResult || {};
      const probeStatus = probe.ok
        ? `🟢 200 OK (${probe.latencyMs || 0}ms)`
        : `🔴 Error (${probe.error || probe.statusCode || 'Unreachable'})`;

      console.log(`[${idx + 1}] ID: ${item.id}`);
      console.log(`    标题: ${item.title}`);
      const catMeta = normalizeCategory(item.category, item.url);
      console.log(`    分类: ${catMeta.label} | 提交人: ${item.contact}`);
      console.log(`    探活: ${probeStatus}`);
      console.log(`    说明: ${item.description || '无'}`);
      console.log(`    批准命令: node src/scripts/nav-review.mjs --approve ${item.id}`);
      console.log(`    --------------------------------------------------`);
    });
  } else {
    console.log(`\n✅ 暂无待审收录申请。`);
  }

  if (pendingReps.length > 0) {
    console.log(`\n--- 🚨 待办失效反馈 (Pending Reports) ---`);
    pendingReps.forEach((item, idx) => {
      console.log(`[${idx + 1}] ID: ${item.id}`);
      console.log(`    目标: ${item.target}`);
      console.log(`    类型: ${item.issueType}`);
      console.log(`    说明: ${item.details || '无'}`);
      console.log(`    解决命令: node src/scripts/nav-review.mjs --resolve-report ${item.id}`);
      console.log(`    --------------------------------------------------`);
    });
  } else {
    console.log(`\n✅ 暂无待处理失效报告。`);
  }
}

async function approveSubmission(subId, operator = 'Admin') {
  const subs = readJsonSafe(SUBMISSIONS_FILE);
  const targetIndex = subs.findIndex(s => s.id === subId);

  if (targetIndex === -1) {
    const err = `找不到单号为 ${subId} 的收录申请！`;
    console.error(`[Error] ${err}`);
    return { success: false, error: err };
  }

  const sub = subs[targetIndex];
  if (sub.status === 'approved') {
    const err = `单号 ${subId} 之前已被批准入库！`;
    console.warn(`[Warning] ${err}`);
    return { success: false, error: err };
  }

  const urlMeta = detectUrlType(sub.url);
  const catMeta = normalizeCategory(sub.category, sub.url);
  const subcat = inferSubcategory(catMeta.id, sub);
  const now = new Date().toISOString().split('T')[0];
  const slug = sub.url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30);

  console.log(`[Approve] 正在核准入库: ${sub.title} (${sub.url}) by ${operator} ...`);
  let insertedId = '';
  let targetDataset = '';

  // Download and cache remote favicon locally to prevent hotlink breakage
  const localIcon = await cacheFaviconLocally(sub.icon, slug);

  if (urlMeta.type === 'github') {
    targetDataset = 'github.json';
    const ghList = readJsonSafe(GITHUB_FILE);
    const existing = ghList.find(g => g.repo.toLowerCase() === urlMeta.repo.toLowerCase());
    if (existing) {
      insertedId = existing.id;
      console.warn(`[Warning] 仓库 ${urlMeta.repo} 已经存在于 github.json 中 (ID: ${existing.id})`);
    } else {
      insertedId = `gh-${slug}`;
      const forksVal = typeof sub.forks === 'number' ? sub.forks : (parseInt(sub.forks, 10) || 0);
      const newRecord = {
        id: insertedId,
        repo: urlMeta.repo,
        owner: urlMeta.owner,
        name: urlMeta.repo.split('/')[1] || urlMeta.repo,
        title: sub.title,
        url: sub.url,
        description: sub.description || `${sub.title} GitHub 官方代码仓库`,
        language: sub.language || 'Unknown',
        stars: typeof sub.stars === 'number' ? sub.stars : (parseInt(sub.stars, 10) || 0),
        forks: forksVal,
        category: 'github',
        subcategory: sub.subcategory || subcat,
        tags: (Array.isArray(sub.tags) && sub.tags.length) ? sub.tags : [catMeta.name, '开源项目'],
        is_featured: false,
        created_at: now,
        avatar_url: localIcon || sub.icon || `https://github.com/${urlMeta.owner}.png`
      };
      ghList.push(newRecord);
      writeJson(GITHUB_FILE, ghList);
      console.log(`[Success] 已成功写入 github.json (ID: ${newRecord.id})`);
    }
  } else if (urlMeta.type === 'telegram') {
    targetDataset = 'telegram.json';
    const tgList = readJsonSafe(TELEGRAM_FILE);
    const existing = tgList.find(t => (t.username || '').toLowerCase() === urlMeta.username.toLowerCase());
    if (existing) {
      insertedId = existing.id;
      console.warn(`[Warning] Telegram 用户名 @${urlMeta.username} 已存在于 telegram.json (ID: ${existing.id})`);
    } else {
      const isBot = urlMeta.username.toLowerCase().endsWith('bot');
      insertedId = `tg-${urlMeta.username.toLowerCase()}`;
      const finalSubcat = sub.subcategory || subcat;
      const finalTags = (Array.isArray(sub.tags) && sub.tags.length)
        ? sub.tags
        : [catMeta.name, isBot ? '机器人' : '电报频道'];
      const finalIsNsfw = typeof sub.is_nsfw === 'boolean' ? sub.is_nsfw : false;

      const newRecord = {
        id: insertedId,
        username: urlMeta.username,
        title: sub.title,
        url: sub.url,
        description: sub.description || `${sub.title} 官方频道/社群`,
        type: isBot ? 'bot' : 'channel',
        member_count: 0,
        avatar_url: localIcon || '/assets/images/nav/avatars/telegram-default.png',
        category: 'telegram',
        subcategory: finalSubcat,
        tags: finalTags,
        is_nsfw: finalIsNsfw,
        is_featured: false,
        created_at: now
      };
      tgList.push(newRecord);
      writeJson(TELEGRAM_FILE, tgList);
      console.log(`[Success] 已成功写入 telegram.json (ID: ${newRecord.id})`);

      // Sync to ai-overrides.json
      try {
        const overrides = readJsonSafe(AI_OVERRIDES_FILE, {});
        const ovKey = urlMeta.username.toLowerCase();
        overrides[ovKey] = {
          title: sub.title,
          subcategory: finalSubcat,
          is_nsfw: finalIsNsfw,
          description: newRecord.description,
          tags: finalTags,
          updated_at: now
        };
        writeJson(AI_OVERRIDES_FILE, overrides);
        console.log(`[Overrides] 已同步至 ai-overrides.json (@${ovKey})`);
      } catch (e) {
        console.warn(`[Overrides Warning] Failed to update ai-overrides.json:`, e.message);
      }
    }
  } else {
    targetDataset = 'websites.json';
    const siteList = readJsonSafe(WEBSITES_FILE);
    const existing = siteList.find(s => s.url.replace(/\/+$/, '') === sub.url.replace(/\/+$/, ''));
    if (existing) {
      insertedId = existing.id;
      console.warn(`[Warning] 站点 URL ${sub.url} 已存在于 websites.json (ID: ${existing.id})`);
    } else {
      insertedId = `site-${slug}`;
      const newRecord = {
        id: insertedId,
        title: sub.title,
        url: sub.url,
        description: sub.description || `${sub.title} 官方网站与实用工具`,
        icon: localIcon || '/favicon.ico',
        category: catMeta.id === 'tools' ? 'tools' : 'featured',
        subcategory: subcat,
        tags: (Array.isArray(sub.tags) && sub.tags.length) ? sub.tags : [catMeta.name, '精选推荐'],
        pricing: 'free',
        is_featured: false,
        created_at: now
      };
      siteList.push(newRecord);
      writeJson(WEBSITES_FILE, siteList);
      console.log(`[Success] 已成功写入 websites.json (ID: ${newRecord.id})`);
    }
  }

  // Mark status as approved
  subs[targetIndex].status = 'approved';
  subs[targetIndex].approvedAt = new Date().toISOString();
  subs[targetIndex].approvedBy = operator;
  writeJson(SUBMISSIONS_FILE, subs);

  // Trigger search index rebuild
  try {
    console.log(`[Index] 正在重新生成多维导航搜索索引...`);
    execSync('npm run nav:search:index', { stdio: 'inherit', cwd: ROOT_DIR });
  } catch (err) {
    console.warn(`[Index Warning] 自动索引重建提示:`, err.message);
  }

  // Trigger Production Deployment (Cloudflare Deploy Hook or Autonomous VPS Wrangler Direct Upload)
  let deployResult = null;
  const deployReason = `审批入库: ${sub.title} (${subId}) 由 ${operator} 批准`;
  const deployHookUrl = process.env.CF_DEPLOY_HOOK || process.env.CLOUDFLARE_DEPLOY_HOOK;

  if (deployHookUrl) {
    try {
      console.log(`[Deploy] 正在触发 Cloudflare Deploy Hook 边缘流水线...`);
      const deployRes = await fetch(deployHookUrl, { method: 'POST', signal: AbortSignal.timeout(10000) });
      if (deployRes.ok) {
        console.log(`[Deploy] ✅ Cloudflare Pages 构建触发成功 (${deployRes.status})`);
        deployResult = { ok: true, mode: 'deploy_hook', status: deployRes.status };
      } else {
        console.warn(`[Deploy] ⚠️ 触发失败，状态码: ${deployRes.status}`);
        deployResult = { ok: false, mode: 'deploy_hook', status: deployRes.status };
      }
    } catch (dhErr) {
      console.warn(`[Deploy] ⚠️ 触发网络异常:`, dhErr.message);
      deployResult = { ok: false, mode: 'deploy_hook', error: dhErr.message };
    }
  } else {
    try {
      console.log(`[Deploy] 未配置 CF_DEPLOY_HOOK，已调度全自主后台构建与边缘部署 (Wrangler Direct Upload)...`);
      const bgRes = triggerProductionDeploy({ reason: deployReason, background: true });
      deployResult = { ok: true, mode: 'wrangler_background', pid: bgRes.pid };
    } catch (bgErr) {
      console.warn(`[Deploy Warning] 后台部署调度异常:`, bgErr.message);
      deployResult = { ok: false, mode: 'wrangler_background', error: bgErr.message };
    }
  }

  console.log(`[Done] 单号 ${subId} 审批入库完成！`);
  return {
    success: true,
    item: subs[targetIndex],
    insertedId: insertedId,
    targetDataset: targetDataset,
    deployHookResult: deployResult,
    deployResult: deployResult
  };
}

function rejectSubmission(subId, operator = 'Admin', reason = '') {
  const subs = readJsonSafe(SUBMISSIONS_FILE);
  const targetIndex = subs.findIndex(s => s.id === subId);

  if (targetIndex === -1) {
    const err = `找不到单号为 ${subId} 的收录申请！`;
    console.error(`[Error] ${err}`);
    return { success: false, error: err };
  }

  subs[targetIndex].status = 'rejected';
  subs[targetIndex].rejectedAt = new Date().toISOString();
  subs[targetIndex].rejectedBy = operator;
  if (reason) subs[targetIndex].rejectReason = reason;
  writeJson(SUBMISSIONS_FILE, subs);

  console.log(`[Done] 单号 ${subId} 已被驳回 (${reason || '未注明原因'})`);
  return { success: true, item: subs[targetIndex] };
}

function resolveReport(repId, operator = 'Admin') {
  const reps = readJsonSafe(REPORTS_FILE);
  const targetIndex = reps.findIndex(r => r.id === repId);

  if (targetIndex === -1) {
    const err = `找不到单号为 ${repId} 的失效报告！`;
    console.error(`[Error] ${err}`);
    return { success: false, error: err };
  }

  reps[targetIndex].status = 'resolved';
  reps[targetIndex].resolvedAt = new Date().toISOString();
  reps[targetIndex].resolvedBy = operator;
  writeJson(REPORTS_FILE, reps);

  console.log(`[Done] 反馈单号 ${repId} 已标记为已解决 (Resolved)！`);
  return { success: true, item: reps[targetIndex] };
}

export {
  detectUrlType,
  readJsonSafe,
  writeJson,
  approveSubmission,
  rejectSubmission,
  resolveReport,
  listQueues,
  SUBMISSIONS_FILE,
  REPORTS_FILE,
  CATEGORY_MAP,
  normalizeCategory,
  inferSubcategory,
  cacheFaviconLocally
};

// CLI Arg Router
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const approveIdx = args.indexOf('--approve');
  const reportIdx = args.indexOf('--resolve-report');

  if (approveIdx !== -1 && args[approveIdx + 1]) {
    await approveSubmission(args[approveIdx + 1]);
  } else if (reportIdx !== -1 && args[reportIdx + 1]) {
    resolveReport(args[reportIdx + 1]);
  } else {
    listQueues();
  }
}
