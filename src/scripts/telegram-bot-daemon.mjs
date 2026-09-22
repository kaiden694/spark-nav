#!/usr/bin/env node
/**
 * XIU Navigation - Telegram Bot Ingestion Daemon
 * Listens for /submit and /report messages from @xiunav_bot, automatically extracts site
 * metadata & summarizes descriptions, aligns categories to the navigation taxonomy,
 * pushes interactive Inline Keyboard approval cards to admin, and processes callback queries.
 *
 * Usage:
 *   node src/scripts/telegram-bot-daemon.mjs [--token <bot_token>] [--admin <chat_id>] [--once]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approveSubmission,
  rejectSubmission,
  resolveReport,
  readJsonSafe,
  writeJson,
  SUBMISSIONS_FILE,
  REPORTS_FILE,
  normalizeCategory
} from './nav-review.mjs';
import { summarizeWithLLM, classifyAndSummarizeWithLLM } from './llm-summarizer.mjs';
import { expandIntentTags } from './enrich-intent-tags.mjs';
import { buildNavIndex } from './build-nav-search-index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const NAV_DATA_DIR = path.join(ROOT_DIR, 'src/data/nav');
const TELEGRAM_DATA_FILE = path.join(NAV_DATA_DIR, 'telegram.json');
const AI_OVERRIDES_FILE = path.join(NAV_DATA_DIR, 'ai-overrides.json');

const VALID_SUBCATEGORIES = {
  tools: '🛠️ 实用工具箱 (tools)',
  dev: '💻 开源开发 (dev)',
  network: '🌐 网络与协议 (network)',
  media: '🎬 影音媒体 (media)',
  news: '📰 资讯新闻 (news)',
  community: '👥 综合社群 (community)',
  nsfw: '🔞 成人敏感 (nsfw)'
};

function normalizeSubcategoryInput(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (VALID_SUBCATEGORIES[s]) return s;
  if (/工具|软件|tool/i.test(s)) return 'tools';
  if (/开发|开源|代码|dev|code|git/i.test(s)) return 'dev';
  if (/网络|梯子|节点|代理|vpn|network/i.test(s)) return 'network';
  if (/影视|影音|视频|音乐|media|movie/i.test(s)) return 'media';
  if (/资讯|新闻|动态|news/i.test(s)) return 'news';
  if (/社群|综合|闲聊|讨论|community/i.test(s)) return 'community';
  if (/成人|黄色|福利|nsfw|18\+/i.test(s)) return 'nsfw';
  return null;
}

function reclassifyTelegramResource(targetIdentifier, targetSubcatInput, operator = 'Admin') {
  if (!targetIdentifier) {
    return { success: false, error: '未提供目标频道标识或链接' };
  }
  const normSubcat = normalizeSubcategoryInput(targetSubcatInput);
  if (!normSubcat) {
    return { success: false, error: `无效的分类目标: "${targetSubcatInput}"。可选: tools, dev, network, media, news, community, nsfw` };
  }

  const items = readJsonSafe(TELEGRAM_DATA_FILE);
  if (!Array.isArray(items) || !items.length) {
    return { success: false, error: 'telegram.json 数据文件为空或不存在' };
  }

  let cleanTarget = String(targetIdentifier).trim();
  const urlMatch = cleanTarget.match(/https?:\/\/t\.me\/([a-zA-Z0-9_+]+)/i);
  if (urlMatch) {
    cleanTarget = urlMatch[1];
  } else {
    cleanTarget = cleanTarget.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '').trim();
  }
  const cleanTargetLower = cleanTarget.toLowerCase();

  const targetIdx = items.findIndex(it => {
    if (it.username && it.username.toLowerCase() === cleanTargetLower) return true;
    if (it.id && it.id.toLowerCase() === cleanTargetLower) return true;
    if (it.url && it.url.toLowerCase().includes(cleanTargetLower)) return true;
    if (it.title && it.title.toLowerCase().includes(cleanTargetLower)) return true;
    return false;
  });

  if (targetIdx === -1) {
    return { success: false, error: `未能在数据库中匹配到目标频道: "${targetIdentifier}"` };
  }

  const item = items[targetIdx];
  const oldSubcat = item.subcategory || 'community';
  item.subcategory = normSubcat;
  if (normSubcat === 'nsfw') {
    item.is_nsfw = true;
  } else if (item.is_nsfw && oldSubcat === 'nsfw') {
    item.is_nsfw = false;
  }

  // Update telegram.json
  items[targetIdx] = item;
  writeJson(TELEGRAM_DATA_FILE, items);

  // Update ai-overrides.json
  const overrides = readJsonSafe(AI_OVERRIDES_FILE) || {};
  const overrideKey = item.username || item.id;
  const existingOverride = overrides[overrideKey] || {};

  overrides[overrideKey] = {
    title: item.title || existingOverride.title || item.username,
    subcategory: normSubcat,
    is_nsfw: Boolean(item.is_nsfw),
    description: item.description || existingOverride.description || '',
    tags: item.tags || existingOverride.tags || [],
    updated_at: new Date().toISOString().slice(0, 10)
  };
  writeJson(AI_OVERRIDES_FILE, overrides);

  // Rebuild search index
  try {
    buildNavIndex();
  } catch (err) {
    console.warn('[Reclass] buildNavIndex failed:', err.message);
  }

  return {
    success: true,
    item: item,
    oldSubcat: oldSubcat,
    newSubcat: normSubcat,
    subcatLabel: VALID_SUBCATEGORIES[normSubcat] || normSubcat,
    operator: operator
  };
}



// Automatically load .env if present in project root
if (typeof process.loadEnvFile === 'function') {
  const envPath = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch (e) {}
  }
}

// Default fallback token placeholder for testing / dev (override via .env or CLI arg)
const DEFAULT_TOKEN = 'your_telegram_bot_token_here';
const DEFAULT_ADMIN_ID = '100000000'; // Default admin chat ID placeholder

const args = process.argv.slice(2);
const tokenArgIndex = args.indexOf('--token');
const BOT_TOKEN = tokenArgIndex !== -1 ? args[tokenArgIndex + 1] : (process.env.TELEGRAM_BOT_TOKEN || DEFAULT_TOKEN);

const adminArgIndex = args.indexOf('--admin');
const ADMIN_CHAT_ID = adminArgIndex !== -1 ? args[adminArgIndex + 1] : (process.env.TELEGRAM_ADMIN_CHAT_ID || DEFAULT_ADMIN_ID);

const isRunOnce = args.includes('--once');

const CUSTOM_API_BASE = process.env.TELEGRAM_API_BASE;
const API_BASE = CUSTOM_API_BASE
  ? `${CUSTOM_API_BASE.replace(/\/+$/, '')}/bot${BOT_TOKEN}`
  : `https://api.telegram.org/bot${BOT_TOKEN}`;

// Ensure data files exist
function ensureDataFiles() {
  if (!fs.existsSync(NAV_DATA_DIR)) {
    fs.mkdirSync(NAV_DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SUBMISSIONS_FILE)) {
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  if (!fs.existsSync(REPORTS_FILE)) {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

// Telegram API Request Helper
async function tgRequest(method, params = {}) {
  const url = `${API_BASE}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API Error [${method}]: ${res.status} ${text}`);
  }
  return await res.json();
}

// Send Markdown or plain text message to chat
async function sendMessage(chatId, text, replyToMessageId = null, replyMarkup = null) {
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (replyToMessageId) {
      payload.reply_parameters = { message_id: replyToMessageId };
    }
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    return await tgRequest('sendMessage', payload);
  } catch (err) {
    console.error(`[Telegram] Failed to send message to ${chatId}:`, err.message);
  }
}

// Answer Callback Query (Toast on user's Telegram client)
async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
  try {
    return await tgRequest('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: showAlert
    });
  } catch (err) {
    console.error(`[Telegram] Failed to answer callback query:`, err.message);
  }
}

// Edit existing message text and remove/update keyboard
async function editMessageText(chatId, messageId, text, replyMarkup = null) {
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    return await tgRequest('editMessageText', payload);
  } catch (err) {
    console.error(`[Telegram] Failed to edit message ${messageId}:`, err.message);
  }
}

// Interactive Keyboard Generators
function getAdminSubmissionKeyboard(subId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ 批准入库', callback_data: `app:${subId}` },
        { text: '❌ 驳回申请', callback_data: `rej:${subId}` }
      ],
      [
        { text: '🔄 重新AI润色', callback_data: `reroll:${subId}` },
        { text: '🔀 改派专区', callback_data: `chg_cat:${subId}` }
      ]
    ]
  };
}

function getCategorySelectionKeyboard(subId) {
  return {
    inline_keyboard: [
      [
        { text: '🌟 常用精选', callback_data: `set_cat:${subId}:featured` },
        { text: '🛠️ 实用工具', callback_data: `set_cat:${subId}:tools` }
      ],
      [
        { text: '💻 开源矩阵', callback_data: `set_cat:${subId}:github` },
        { text: '✈️ 电报生态', callback_data: `set_cat:${subId}:telegram` }
      ],
      [
        { text: '👤 优质博主', callback_data: `set_cat:${subId}:creators` }
      ],
      [
        { text: '↩️ 取消返回', callback_data: `back_cat:${subId}` }
      ]
    ]
  };
}

// Well-known domain heuristic profiles for rich summarization and anti-bot fallback
const KNOWN_PROFILES = [
  {
    match: /linux\.do/i,
    title: 'LINUX DO',
    category: 'featured',
    description: '新一代极客开源技术论坛与高价值讨论社区，涵盖大模型技巧、网络技术与极客资源分享。',
    icon: 'https://linux.do/uploads/default/optimized/1X/1c52d43e34b9cfcfcc1d00c3bcf52ee240742137_2_32x32.png'
  },
  {
    match: /v0\.dev/i,
    title: 'v0 by Vercel',
    category: 'tools',
    description: 'Vercel 出品的生成式 UI 交互平台，基于 Tailwind CSS 与 React 快速生成现代界面组件。',
    icon: 'https://v0.dev/favicon.ico'
  },
  {
    match: /cursor\.com/i,
    title: 'Cursor',
    category: 'featured',
    description: '下一代 AI 优先的智能代码编辑器，基于 VS Code 底层深度融合代码多模态上下文理解。',
    icon: 'https://www.cursor.com/favicon.ico'
  },
  {
    match: /dify\.ai/i,
    title: 'Dify.ai',
    category: 'tools',
    description: '下一代开源 LLM 应用开发平台，融合 Agent 智能体编排、Prompt 工程与 RAG 知识库检索增强。',
    icon: 'https://dify.ai/favicon.ico'
  },
  {
    match: /huggingface\.co/i,
    title: 'Hugging Face',
    category: 'featured',
    description: '全球最大的机器学习与开源模型社区平台，汇聚海量开源权重、Datasets 数据集与 Spaces 在线演示。',
    icon: 'https://huggingface.co/favicon.ico'
  }
];

// Comprehensive Metadata Scraper & Auto-Summarizer
async function fetchAndSummarizeMetadata(targetUrl) {
  const startTime = Date.now();
  let probe = { ok: false, statusCode: 0, latencyMs: 0, error: '' };
  let title = '';
  let description = '';
  let icon = '';
  let categoryKey = 'tools';

  try {
    const urlObj = new URL(targetUrl);
    const host = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname;

    // 1. Check known domain heuristic profiles
    const matchedProfile = KNOWN_PROFILES.find(p => p.match.test(targetUrl));
    if (matchedProfile) {
      title = matchedProfile.title;
      description = matchedProfile.description;
      icon = matchedProfile.icon;
      categoryKey = matchedProfile.category;
    }

    // 2. Special Case: GitHub Repository
    if (host.includes('github.com')) {
      categoryKey = 'github';
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1];
        if (!title) title = `${repo} (${owner}/${repo})`;
        if (!icon) icon = `https://github.com/${owner}.png`;
        let subcategory = 'dev';
        let tags = ['开源项目', 'GitHub'];
        let lang = '';
        let stars = 0;
        let forks = 0;
        try {
          const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: { 'User-Agent': 'xiunav-bot/1.0' },
            signal: AbortSignal.timeout(6000)
          });
          if (ghRes.ok) {
            const ghData = await ghRes.json();
            probe = { ok: true, statusCode: 200, latencyMs: Date.now() - startTime };
            if (ghData.name) title = ghData.name;
            stars = ghData.stargazers_count || 0;
            forks = ghData.forks_count || 0;
            lang = ghData.language || '';
            const topics = Array.isArray(ghData.topics) ? ghData.topics : [];
            const rawDesc = ghData.description || 'GitHub 开源项目';

            // Infer subcategory from topics / description / language
            const combinedText = `${title} ${rawDesc} ${topics.join(' ')} ${lang}`.toLowerCase();
            if (/proxy|clash|sing-box|vpn|shadowrocket|agent|network|protocol|dns/i.test(combinedText)) {
              subcategory = 'network';
            } else if (/video|media|audio|player|youtube|music|stream|bilibili/i.test(combinedText)) {
              subcategory = 'media';
            } else if (/tool|utility|cli|desktop|app|helper|cleaner|download/i.test(combinedText)) {
              subcategory = 'tools';
            } else {
              subcategory = 'dev';
            }

            // Expand intent tags using rule engine
            tags = expandIntentTags({
              title,
              description: rawDesc,
              subcategory,
              existingTags: [lang, ...topics.slice(0, 3)].filter(Boolean)
            });

            // Call LLM with rich GitHub context
            try {
              const llmRes = await summarizeWithLLM({
                title,
                url: targetUrl,
                rawDescription: rawDesc,
                language: lang,
                topics,
                stars,
                category: 'github'
              }, { timeoutMs: 9000 });

              if (llmRes && llmRes.ok && llmRes.summary && llmRes.provider !== 'fallback') {
                description = llmRes.summary;
              } else {
                const starStr = stars ? ` ★${stars}` : '';
                const langStr = lang ? `[${lang}] ` : '';
                description = `${langStr}${rawDesc}${starStr}`.trim();
              }
            } catch (e) {
              const starStr = stars ? ` ★${stars}` : '';
              const langStr = lang ? `[${lang}] ` : '';
              description = `${langStr}${rawDesc}${starStr}`.trim();
            }

            return { probe, title, description, icon, categoryKey, subcategory, tags, language: lang, stars, forks, is_nsfw: false };
          }
        } catch (e) {}
      }
    }

    // 3. Special Case: Telegram Channel / Group / Bot
    if (host.includes('t.me') || host.includes('telegram.me')) {
      categoryKey = 'telegram';
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 1) {
        const username = parts[0].replace(/^s\//, '');
        if (!title) title = `@${username}`;
        try {
          const tgRes = await fetch(`https://t.me/s/${username}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(6000)
          });
          const html = await tgRes.text();
          probe = { ok: tgRes.status >= 200 && tgRes.status < 400, statusCode: tgRes.status, latencyMs: Date.now() - startTime };
          const titleM = html.match(/<div class="tgme_page_title"[^>]*>([^<]+)<\/div>/i);
          if (titleM) title = titleM[1].trim();
          const descM = html.match(/<div class="tgme_page_description"[^>]*>([^<]+)<\/div>/i);
          if (descM) description = descM[1].trim();
          const imgM = html.match(/<img class="tgme_page_photo_image" src="([^"]+)"/i);
          if (imgM) icon = imgM[1];
          if (!description) description = `Telegram 优质频道/社群 @${username}`;
          let subcategory = 'community';
          let tags = ['精选推荐', '电报社群'];
          let is_nsfw = false;
          try {
            const isBot = username.toLowerCase().endsWith('bot');
            const clRes = await classifyAndSummarizeWithLLM({
              title,
              username,
              rawDescription: description,
              type: isBot ? 'bot' : 'channel',
              currentCategory: 'telegram'
            }, { timeoutMs: 5000 });
            if (clRes && clRes.summary) {
              description = clRes.summary;
              subcategory = clRes.subcategory || subcategory;
              tags = clRes.tags || tags;
              is_nsfw = Boolean(clRes.is_nsfw);
            }
          } catch (e) {}
          return { probe, title, description, icon, categoryKey, subcategory, tags, is_nsfw };
        } catch (e) {}
      }
    }

    // 4. General Webpage Fetching
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(8000)
    });

    probe = {
      ok: res.status >= 200 && res.status < 400,
      statusCode: res.status,
      latencyMs: Date.now() - startTime
    };

    if (res.ok) {
      const html = await res.text();

      // Extract title if not set
      if (!title) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].replace(/[-_|(].*$/, '').trim(); // Strip suffixes
        }
      }

      // Extract description if not set
      if (!description) {
        const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
                          html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }

      // Extract icon if not set
      if (!icon) {
        const iconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i);
        if (iconMatch) {
          const raw = iconMatch[1];
          icon = raw.startsWith('http') ? raw : (raw.startsWith('/') ? `${urlObj.origin}${raw}` : `${urlObj.origin}/${raw}`);
        } else {
          icon = `${urlObj.origin}/favicon.ico`;
        }
      }
    }
  } catch (err) {
    probe = {
      ok: false,
      statusCode: 0,
      error: err.name === 'TimeoutError' ? '网络连接超时 (>8s)' : err.message,
      latencyMs: Date.now() - startTime
    };
  }

  // Fallback defaults if still empty
  if (!title) {
    try {
      const u = new URL(targetUrl);
      title = u.hostname.replace(/^www\./, '');
    } catch (e) {
      title = '精选推荐站点';
    }
  }

  if (!description) {
    description = '精选实用工具与高价值网络资源，经初筛探活已受理。';
  }

  // Apply LLM-assisted geek summarization if available (Gemini / OpenAI / Ollama)
  try {
    const llmRes = await summarizeWithLLM({
      title,
      url: targetUrl,
      rawDescription: description
    }, { timeoutMs: 9000 });
    if (llmRes && llmRes.ok && llmRes.summary && llmRes.provider !== 'fallback') {
      console.log(`[LLM Summary (${llmRes.provider})] Generated: ${llmRes.summary}`);
      description = llmRes.summary;
    }
  } catch (e) {
    // Graceful fallback
  }

  return { probe, title, description, icon, categoryKey };
}

// Parse /submit text
function parseSubmission(text) {
  let title = '';
  let url = '';
  let category = '';
  let desc = '';
  let contact = '';

  const isStructured = /站点名称|访问地址/i.test(text);

  if (isStructured) {
    const titleM = text.match(/站点名称[：:]\s*(.+)/i);
    if (titleM) title = titleM[1].trim();

    const urlM = text.match(/访问地址[：:]\s*(https?:\/\/[^\s]+)/i) || text.match(/(https?:\/\/[^\s]+)/i);
    if (urlM) url = urlM[1].trim();

    const catM = text.match(/建议分类[：:]\s*(.+)/i);
    if (catM) category = catM[1].trim();

    const descM = text.match(/推荐理由[：:]\s*(.+)/i);
    if (descM) desc = descM[1].trim();

    const contactM = text.match(/申请联系[：:]\s*(.+)/i);
    if (contactM) contact = contactM[1].trim();
  } else {
    // Single-line format: /submit https://example.com [Title...]
    const rawTokens = text.replace(/^\/submit\s*/i, '').trim().split(/\s+/);
    if (rawTokens[0] && rawTokens[0].startsWith('http')) {
      url = rawTokens[0];
      if (rawTokens.length > 1) {
        title = rawTokens.slice(1).join(' ');
      }
    }
  }

  return { title, url, category, desc, contact };
}

// Parse /report text
function parseReport(text) {
  let target = '';
  let issueType = 'broken';
  let details = '';

  const targetM = text.match(/目标站点[：:]\s*(.+)/i);
  if (targetM) target = targetM[1].trim();

  const typeM = text.match(/异常类型[：:]\s*(.+)/i);
  if (typeM) issueType = typeM[1].trim();

  const detailsM = text.match(/详细说明[：:]\s*(.+)/i);
  if (detailsM) details = detailsM[1].trim();

  if (!target) {
    const raw = text.replace(/^\/report\s*/i, '').trim();
    if (raw) target = raw;
  }

  return { target, issueType, details };
}

// Handle Incoming Message
async function handleMessage(msg, updateId) {
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const fromUser = msg.from || {};
  const userHandle = fromUser.username ? `@${fromUser.username}` : (fromUser.first_name || 'Anonymous');
  const text = msg.text.trim();

  console.log(`[Telegram Message #${updateId}] From: ${userHandle} (${chatId}) Text: ${text.slice(0, 50)}...`);

  // 1. /start or /help
  if (text.startsWith('/start') || text.startsWith('/help')) {
    const welcome = `<b>👋 欢迎使用 xiunav 官方收录与维护机器人！</b>\n\n` +
      `本 Bot 支持 7×24 小时全自动接收站点收录申请与失效反馈，提交后即刻进行初筛探活并通知管理员双向审批。\n\n` +
      `<b>📌 常用指令：</b>\n` +
      `• <code>/submit 网址 [站点名称]</code> - 提交收录申请（或直接向我粘贴网址）\n` +
      `• <code>/report 站点名称或网址 问题说明</code> - 反馈死链或纠错\n` +
      `• <code>/status</code> - 查询系统收录与反馈工单统计\n\n` +
      `💡 推荐直接访问 <a href="https://xiu.org/nav.html">XIU 神站导航</a> 右侧悬浮工具条使用“在线收录”或“失效纠错”，自动生成标准格式指令！`;
    await sendMessage(chatId, welcome, msg.message_id);
    return;
  }

  // 2. /status
  if (text.startsWith('/status')) {
    ensureDataFiles();
    const subs = readJsonSafe(SUBMISSIONS_FILE);
    const reps = readJsonSafe(REPORTS_FILE);
    const pendingSubs = subs.filter(s => s.status === 'pending').length;
    const pendingReps = reps.filter(r => r.status === 'pending').length;

    const statusMsg = `<b>📊 XIU 神站导航收录中心运行状态</b>\n\n` +
      `• 待审收录清单：<b>${pendingSubs}</b> 项 (历史累计 ${subs.length})\n` +
      `• 待办失效反馈：<b>${pendingReps}</b> 项 (历史累计 ${reps.length})\n` +
      `• 探活与元数据调度器：<b>🟢 在线正常</b>\n` +
      `• 管理员审批通道：<b>${ADMIN_CHAT_ID ? '🟢 已配置' : '⚠️ 未配置'}</b>\n` +
      `• 导航站直达：<a href="https://xiu.org/nav.html">xiu.org/nav.html</a>`;
    await sendMessage(chatId, statusMsg, msg.message_id);
    return;
  }

  // 3. /submit or direct URL or structured text
  if (text.startsWith('/submit') || text.startsWith('http://') || text.startsWith('https://') || text.includes('【站点收录申请】')) {
    const inputData = parseSubmission(text);
    if (!inputData.url) {
      await sendMessage(chatId, `⚠️ <b>请提供有效的访问链接</b>\n格式：<code>/submit https://example.com 站点名称</code> 或使用导航站右侧悬浮条复制标准文案。`, msg.message_id);
      return;
    }

    // Inform user scraping & probing started
    await sendMessage(chatId, `🔍 正在对 <code>${inputData.url}</code> 自动抓取站点元数据与连通性探活，请稍候...`, msg.message_id);

    // Fetch rich metadata & summarize
    const meta = await fetchAndSummarizeMetadata(inputData.url);
    const finalTitle = inputData.title || meta.title;
    const finalDesc = inputData.desc || meta.description;
    const finalIcon = meta.icon || '/favicon.ico';

    // Align category with navigation standards (e.g. 🌟 常用精选, 🛠️ 实用工具)
    const catMeta = normalizeCategory(inputData.category || meta.categoryKey, inputData.url);

    const probe = meta.probe;
    const probeText = probe.ok
      ? `🟢 <b>网络探活成功</b> (HTTP ${probe.statusCode}, 耗时 ${probe.latencyMs}ms)`
      : `🟠 <b>网络探活异常</b> (${probe.error || '状态码 ' + probe.statusCode}, 耗时 ${probe.latencyMs}ms)`;

    // Deduplicate: check if this URL is already in pending queue
    ensureDataFiles();
    const subs = readJsonSafe(SUBMISSIONS_FILE);
    const cleanUrl = inputData.url.trim().replace(/\/+$/, '');
    const existingIndex = subs.findIndex(s => s.status === 'pending' && s.url.trim().replace(/\/+$/, '') === cleanUrl);

    let currentRecord;
    let isUpdate = false;

    if (existingIndex !== -1) {
      isUpdate = true;
      subs[existingIndex].title = finalTitle;
      subs[existingIndex].category = catMeta.id;
      subs[existingIndex].categoryLabel = catMeta.label;
      subs[existingIndex].subcategory = meta.subcategory || subs[existingIndex].subcategory || '';
      subs[existingIndex].tags = (meta.tags && meta.tags.length) ? meta.tags : (subs[existingIndex].tags || []);
      subs[existingIndex].language = meta.language || subs[existingIndex].language || '';
      subs[existingIndex].stars = meta.stars || subs[existingIndex].stars || 0;
      subs[existingIndex].forks = meta.forks || subs[existingIndex].forks || 0;
      subs[existingIndex].description = finalDesc;
      subs[existingIndex].icon = finalIcon;
      subs[existingIndex].probeResult = probe;
      subs[existingIndex].updatedAt = new Date().toISOString();
      currentRecord = subs[existingIndex];
    } else {
      currentRecord = {
        id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        submittedBy: {
          userId: fromUser.id,
          username: fromUser.username || '',
          name: `${fromUser.first_name || ''} ${fromUser.last_name || ''}`.trim()
        },
        title: finalTitle,
        url: inputData.url,
        category: catMeta.id,
        categoryLabel: catMeta.label,
        subcategory: meta.subcategory || '',
        tags: meta.tags || [],
        language: meta.language || '',
        stars: meta.stars || 0,
        forks: meta.forks || 0,
        is_nsfw: Boolean(meta.is_nsfw),
        description: finalDesc,
        icon: finalIcon,
        contact: inputData.contact || userHandle,
        probeResult: probe,
        status: 'pending'
      };
      subs.push(currentRecord);
    }
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(subs, null, 2), 'utf-8');

    // User receipt with aligned Chinese category & auto-summarized description
    const receiptPrefix = isUpdate ? `ℹ️ <b>收录申请信息已同步更新！</b>` : `✅ <b>收录申请已受理！</b>`;
    const reply = `${receiptPrefix}\n\n` +
      `• <b>申请单号</b>：<code>${currentRecord.id}</code>\n` +
      `• <b>资源名称</b>：<b>${finalTitle}</b>\n` +
      `• <b>访问地址</b>：${currentRecord.url}\n` +
      `• <b>归属分类</b>：<b>${catMeta.label}</b>\n` +
      `• <b>概况描述</b>：${finalDesc}\n` +
      `• <b>探活结果</b>：${probeText}\n\n` +
      (isUpdate
        ? `该站点已在待审队列中，已为您更新最新元数据与探活指标，请静候管理员审批。`
        : `已自动补充站点概况并推送给管理员审批，审核通过后即刻正式入库，感谢你的支持！`);
    await sendMessage(chatId, reply, msg.message_id);

    // Push Interactive Card to Admin with aligned Chinese category & rich summary (only if newly created)
    if (ADMIN_CHAT_ID && !isUpdate) {
      const subcatText = currentRecord.subcategory ? ` (子类: <code>${currentRecord.subcategory}</code>)` : '';
      const nsfwText = currentRecord.is_nsfw ? ' [🔞 NSFW/18+]' : '';
      const tagsText = (currentRecord.tags && currentRecord.tags.length) ? `\n• <b>标签</b>：${currentRecord.tags.join(', ')}` : '';
      const adminCardText = `<b>🔔 【待审收录提醒】收到新的站点收录申请！</b>\n\n` +
        `• <b>申请单号</b>：<code>${currentRecord.id}</code>\n` +
        `• <b>站点名称</b>：<b>${finalTitle}</b>\n` +
        `• <b>访问地址</b>：${currentRecord.url}\n` +
        `• <b>建议分类</b>：<b>${catMeta.label}</b>${subcatText}${nsfwText}\n` +
        `• <b>概况描述</b>：${finalDesc}${tagsText}\n` +
        `• <b>提交人</b>：${userHandle} (ID: <code>${fromUser.id}</code>)\n` +
        `• <b>网络探活</b>：${probeText}\n\n` +
        `👇 请在下方轻触按钮直接审批：`;

      const inlineKeyboard = getAdminSubmissionKeyboard(currentRecord.id);
      await sendMessage(ADMIN_CHAT_ID, adminCardText, null, inlineKeyboard);
    }
    return;
  }

  // 4. /report
  if (text.startsWith('/report')) {
    const data = parseReport(text);
    if (!data.target) {
      await sendMessage(chatId, `⚠️ <b>请提供失效站点的名称或网址</b>\n格式：<code>/report https://example.com 无法访问</code>`, msg.message_id);
      return;
    }

    ensureDataFiles();
    const reps = readJsonSafe(REPORTS_FILE);
    const newRep = {
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      submittedBy: {
        userId: fromUser.id,
        username: fromUser.username || '',
        name: `${fromUser.first_name || ''} ${fromUser.last_name || ''}`.trim()
      },
      target: data.target,
      issueType: data.issueType,
      details: data.details,
      status: 'pending'
    };
    reps.push(newRep);
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(reps, null, 2), 'utf-8');

    // User receipt
    const reply = `🚨 <b>失效反馈已登记！</b>\n\n` +
      `• <b>反馈单号</b>：<code>${newRep.id}</code>\n` +
      `• <b>问题目标</b>：${newRep.target}\n` +
      `• <b>异常类型</b>：${newRep.issueType}\n` +
      `• <b>补充说明</b>：${newRep.details || '无'}\n\n` +
      `已向管理员推送待办工单，将尽快核实并更新备用镜像或下架死链，感谢维护社区生态！`;
    await sendMessage(chatId, reply, msg.message_id);

    // Push Interactive Card to Admin
    if (ADMIN_CHAT_ID) {
      const adminReportText = `<b>🚨 【失效纠错提醒】收到站点异常报告！</b>\n\n` +
        `• <b>工单单号</b>：<code>${newRep.id}</code>\n` +
        `• <b>目标站点</b>：<b>${newRep.target}</b>\n` +
        `• <b>异常类型</b>：${newRep.issueType}\n` +
        `• <b>反馈人</b>：${userHandle} (ID: <code>${fromUser.id}</code>)\n` +
        `• <b>补充说明</b>：${newRep.details || '无'}\n\n` +
        `👇 请在下方轻触按钮处置：`;

      const isTgResource = /t\.me\/|@/i.test(newRep.target) || (newRep.issueType && newRep.issueType.includes('分类')) || newRep.issueType === 'cat_err';
      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '🛠️ 标记已解决', callback_data: `rep_ok:${newRep.id}` },
            { text: '🗑️ 忽略关闭', callback_data: `rep_ign:${newRep.id}` }
          ],
          ...(isTgResource ? [
            [
              { text: '🏷️ 一键纠正分类', callback_data: `rep_cat:${newRep.id}` }
            ]
          ] : [])
        ]
      };

      await sendMessage(ADMIN_CHAT_ID, adminReportText, null, inlineKeyboard);
    }
    return;
  }

  // 5. /reclass command (Admin only)
  if (text.startsWith('/reclass')) {
    if (ADMIN_CHAT_ID && fromUser.id.toString() !== ADMIN_CHAT_ID.toString()) {
      await sendMessage(chatId, '⛔ 权限不足：仅站点管理员有权执行分类变更！', msg.message_id);
      return;
    }

    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
      await sendMessage(chatId, `⚠️ <b>格式有误</b>\n用法：<code>/reclass &lt;频道链接或用户名&gt; &lt;目标分类&gt;</code>\n例如：<code>/reclass @openwrt_flippy tools</code>\n可选分类：tools, dev, network, media, news, community, nsfw`, msg.message_id);
      return;
    }

    const target = parts[1];
    const targetSubcat = parts[2];
    const res = reclassifyTelegramResource(target, targetSubcat, userHandle);

    if (res.success) {
      const reply = `✅ <b>频道分类已成功调优！</b>\n\n` +
        `• <b>频道名称</b>：<b>${res.item.title}</b> (@${res.item.username})\n` +
        `• <b>分类变更</b>：<code>${res.oldSubcat}</code> ➔ <b>${res.subcatLabel}</b>\n` +
        `• <b>成人标识</b>：${res.item.is_nsfw ? '🔞 包含敏感内容' : '🟢 正常'}\n` +
        `• <b>数据覆盖</b>：已写入 <code>ai-overrides.json</code> 并持久化\n` +
        `• <b>索引状态</b>：多维拼音搜索索引已自动重编译完毕`;
      await sendMessage(chatId, reply, msg.message_id);
    } else {
      await sendMessage(chatId, `❌ <b>调优失败</b>：${res.error}`, msg.message_id);
    }
    return;
  }

  // Default fallback for any other private message
  if (msg.chat.type === 'private') {
    const hint = `💡 你好！如需申请站点收录请发送 <code>/submit 链接</code> 或直接粘贴网址；如需反馈失效请发送 <code>/report 链接</code>；或发送 <code>/help</code> 查看说明。`;
    await sendMessage(chatId, hint, msg.message_id);
  }
}

// Handle Callback Query (Inline Keyboard Buttons)
async function handleCallbackQuery(cq) {
  const data = cq.data || '';
  const fromUser = cq.from || {};
  const operator = fromUser.username ? `@${fromUser.username}` : (fromUser.first_name || 'Admin');
  const chatId = cq.message ? cq.message.chat.id : null;
  const messageId = cq.message ? cq.message.message_id : null;
  const originalText = cq.message ? cq.message.text : '';

  console.log(`[Telegram Callback] Data: ${data} by ${operator} (ID: ${fromUser.id})`);

  // 1. Permission check
  if (ADMIN_CHAT_ID && fromUser.id.toString() !== ADMIN_CHAT_ID.toString()) {
    await answerCallbackQuery(cq.id, '⛔ 权限不足：仅管理员有权审批入库！', true);
    return;
  }

  // 2. Action: Approve Submission (app:<sub_id>)
  if (data.startsWith('app:')) {
    const subId = data.slice(4);
    const result = await approveSubmission(subId, operator);

    if (result.success) {
      const catMeta = normalizeCategory(result.item.category, result.item.url);
      await answerCallbackQuery(cq.id, `✅ 已核准入库至【${catMeta.name}】并完成索引重建！`);
      if (chatId && messageId) {
        let deployMsg = '• 边缘发布：ℹ️ 本地索引已更新（配置 CF_DEPLOY_HOOK 可自动触发边缘部署）';
        const dRes = result.deployResult || result.deployHookResult;
        if (dRes?.mode === 'deploy_hook' && dRes.ok) {
          deployMsg = `• 边缘发布：🚀 已触发 Cloudflare Pages 构建流水线 (${dRes.status})`;
        } else if (dRes?.mode === 'wrangler_background' && dRes.ok) {
          deployMsg = `• 边缘发布：⚡ 全自主后台构建与边缘分发已启动 (PID: ${dRes.pid})`;
        } else if (dRes?.error) {
          deployMsg = `• 边缘发布：⚠️ 边缘发布调度异常 (${dRes.error})`;
        }

        const updatedText = `${originalText}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `✅ <b>【已核准入库】</b>\n` +
          `• 审批管理员：${operator}\n` +
          `• 归属专区：<b>${catMeta.label}</b> (<code>${result.targetDataset}</code>)\n` +
          `• 记录单号：<code>${subId}</code>\n` +
          `${deployMsg}\n` +
          `• 处理时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        await editMessageText(chatId, messageId, updatedText, null);
      }

      // Notify original applicant if available and not the admin themselves
      const applicantId = result.item?.submittedBy?.userId;
      if (applicantId && applicantId.toString() !== ADMIN_CHAT_ID.toString()) {
        const notifyText = `🎉 <b>收录成功通告</b>\n\n` +
          `你此前申请收录的站点【<b>${result.item.title}</b>】已通过管理员审核，正式收录入库【${catMeta.name}】！\n` +
          `已可在 <a href="https://xiu.org/nav.html">XIU 神站导航</a> 检索查阅，感谢你的优质推荐！`;
        await sendMessage(applicantId, notifyText);
      }
    } else {
      await answerCallbackQuery(cq.id, `⚠️ 审批未成功：${result.error}`, true);
    }
    return;
  }

  // 2.5 Action: Reroll AI Summary (reroll:<sub_id>)
  if (data.startsWith('reroll:')) {
    const subId = data.slice(7);
    const subs = readJsonSafe(SUBMISSIONS_FILE);
    const targetIndex = subs.findIndex(s => s.id === subId);

    if (targetIndex === -1) {
      await answerCallbackQuery(cq.id, '⚠️ 找不到该收录单号！', true);
      return;
    }

    const currentSub = subs[targetIndex];
    if (currentSub.status === 'approved') {
      await answerCallbackQuery(cq.id, 'ℹ️ 该站点已批准入库，不可重新润色。', true);
      return;
    }

    await answerCallbackQuery(cq.id, '🤖 正在调度 AI 模型重新提炼极客文案与分类，请稍候...');

    try {
      const isTg = /t\.me\//i.test(currentSub.url) || currentSub.category === 'telegram';
      if (isTg) {
        let tgUser = '';
        try {
          const u = new URL(currentSub.url);
          const parts = u.pathname.split('/').filter(Boolean);
          tgUser = parts[0] === 's' ? parts[1] : parts[0];
        } catch (e) {}

        const classifyRes = await classifyAndSummarizeWithLLM({
          title: currentSub.title,
          username: tgUser,
          rawDescription: currentSub.description,
          type: (tgUser && tgUser.toLowerCase().endsWith('bot')) ? 'bot' : 'channel',
          currentCategory: 'telegram',
          currentSubcategory: currentSub.subcategory || 'community',
          tags: currentSub.tags || []
        }, { timeoutMs: 8000 });

        if (classifyRes && classifyRes.summary) {
          currentSub.description = classifyRes.summary;
          currentSub.subcategory = classifyRes.subcategory;
          currentSub.is_nsfw = classifyRes.is_nsfw;
          currentSub.tags = classifyRes.tags;
          subs[targetIndex] = currentSub;
          writeJson(SUBMISSIONS_FILE, subs);

          let updatedText = originalText;
          if (/• <b>概况描述<\/b>[：:][^\n]+/i.test(updatedText)) {
            updatedText = updatedText.replace(/• <b>概况描述<\/b>[：:][^\n]+/i, `• <b>概况描述</b>：${currentSub.description}`);
          }
          const nsfwBadge = currentSub.is_nsfw ? ' [🔞 NSFW/18+]' : '';
          if (/• <b>建议分类<\/b>[：:][^\n]+/i.test(updatedText)) {
            updatedText = updatedText.replace(/• <b>建议分类<\/b>[：:][^\n]+/i, `• <b>建议分类</b>：<b>✈️ 电报生态</b> (子类: <code>${currentSub.subcategory}</code>)${nsfwBadge}`);
          }
          if (Array.isArray(currentSub.tags) && currentSub.tags.length) {
            if (/• <b>标签<\/b>[：:][^\n]+/i.test(updatedText)) {
              updatedText = updatedText.replace(/• <b>标签<\/b>[：:][^\n]+/i, `• <b>标签</b>：${currentSub.tags.join(', ')}`);
            } else if (/• <b>概况描述<\/b>/i.test(updatedText)) {
              updatedText = updatedText.replace(/(• <b>概况描述<\/b>[：:][^\n]+)/i, `$1\n• <b>标签</b>：${currentSub.tags.join(', ')}`);
            }
          }

          if (chatId && messageId) {
            await editMessageText(chatId, messageId, updatedText, getAdminSubmissionKeyboard(subId));
          }
          await answerCallbackQuery(cq.id, `✨ AI 提炼已更新 (${classifyRes.provider} / ${classifyRes.subcategory})！`);
          return;
        }
      }

      // Check if this submission is GitHub
      const isGh = /github\.com/i.test(currentSub.url) || currentSub.category === 'github';
      let llmRes;
      if (isGh) {
        // Re-fetch GitHub metadata or use stored info
        let ghData = null;
        try {
          const u = new URL(currentSub.url);
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 2) {
            const ghRes = await fetch(`https://api.github.com/repos/${parts[0]}/${parts[1]}`, {
              headers: { 'User-Agent': 'xiunav-bot/1.0' },
              signal: AbortSignal.timeout(6000)
            });
            if (ghRes.ok) ghData = await ghRes.json();
          }
        } catch (e) {}

        const topics = Array.isArray(ghData?.topics) ? ghData.topics : [];
        const lang = ghData?.language || currentSub.language || '';
        const stars = ghData?.stargazers_count || currentSub.stars || 0;
        const rawDesc = ghData?.description || currentSub.description;

        llmRes = await summarizeWithLLM({
          title: currentSub.title,
          url: currentSub.url,
          rawDescription: rawDesc,
          language: lang,
          topics,
          stars,
          category: 'github'
        }, { timeoutMs: 9000 });

        if (llmRes && llmRes.ok && llmRes.provider !== 'fallback' && llmRes.summary) {
          if (!currentSub.subcategory || currentSub.subcategory === 'dev') {
            const combined = `${currentSub.title} ${rawDesc} ${topics.join(' ')} ${lang}`.toLowerCase();
            if (/proxy|clash|sing-box|vpn|shadowrocket|agent|network/i.test(combined)) currentSub.subcategory = 'network';
            else if (/video|media|audio|player|youtube|music|stream/i.test(combined)) currentSub.subcategory = 'media';
            else if (/tool|utility|cli|desktop|app|helper/i.test(combined)) currentSub.subcategory = 'tools';
          }
          currentSub.tags = expandIntentTags({
            title: currentSub.title,
            description: llmRes.summary,
            subcategory: currentSub.subcategory || 'dev',
            existingTags: [lang, ...topics.slice(0, 3)].filter(Boolean)
          });
          if (lang) currentSub.language = lang;
          if (stars) currentSub.stars = stars;
          if (typeof ghData?.forks_count === 'number') currentSub.forks = ghData.forks_count;
        }
      } else {
        llmRes = await summarizeWithLLM({
          title: currentSub.title,
          url: currentSub.url,
          rawDescription: currentSub.description
        }, { timeoutMs: 9000 });
      }

      if (llmRes && llmRes.ok && llmRes.provider !== 'fallback' && llmRes.summary) {
        currentSub.description = llmRes.summary;
        subs[targetIndex] = currentSub;
        writeJson(SUBMISSIONS_FILE, subs);

        let updatedText = originalText;
        if (/• <b>概况描述<\/b>[：:][^\n]+/i.test(updatedText)) {
          updatedText = updatedText.replace(/• <b>概况描述<\/b>[：:][^\n]+/i, `• <b>概况描述</b>：${currentSub.description}`);
        } else if (/• 概况描述[：:][^\n]+/i.test(updatedText)) {
          updatedText = updatedText.replace(/• 概况描述[：:][^\n]+/i, `• 概况描述：${currentSub.description}`);
        }
        if (Array.isArray(currentSub.tags) && currentSub.tags.length) {
          if (/• <b>标签<\/b>[：:][^\n]+/i.test(updatedText)) {
            updatedText = updatedText.replace(/• <b>标签<\/b>[：:][^\n]+/i, `• <b>标签</b>：${currentSub.tags.join(', ')}`);
          } else if (/• <b>概况描述<\/b>/i.test(updatedText)) {
            updatedText = updatedText.replace(/(• <b>概况描述<\/b>[：:][^\n]+)/i, `$1\n• <b>标签</b>：${currentSub.tags.join(', ')}`);
          }
        }

        if (chatId && messageId) {
          await editMessageText(chatId, messageId, updatedText, getAdminSubmissionKeyboard(subId));
        }
        await answerCallbackQuery(cq.id, `✨ AI 润色已更新 (${llmRes.provider})！`);
      } else {
        await answerCallbackQuery(cq.id, '⚠️ AI 润色服务暂不可用或超时，已保留原简介', true);
      }
    } catch (err) {
      console.error(`[Reroll Error]`, err);
      await answerCallbackQuery(cq.id, `⚠️ 重新润色失败: ${err.message}`, true);
    }
    return;
  }

  // 3. Action: Reject Submission (rej:<sub_id>)
  if (data.startsWith('rej:')) {
    const subId = data.slice(4);
    const result = rejectSubmission(subId, operator);

    if (result.success) {
      await answerCallbackQuery(cq.id, `❌ 已驳回该申请。`);
      if (chatId && messageId) {
        const updatedText = `${originalText}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `❌ <b>【已驳回申请】</b>\n` +
          `• 经办管理员：${operator}\n` +
          `• 记录单号：<code>${subId}</code>\n` +
          `• 处理时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        await editMessageText(chatId, messageId, updatedText, null);
      }

      const applicantId = result.item?.submittedBy?.userId;
      if (applicantId && applicantId.toString() !== ADMIN_CHAT_ID.toString()) {
        const notifyText = `ℹ️ <b>收录审核结果</b>\n\n` +
          `抱歉，你此前提交的站点【<b>${result.item.title}</b>】经审核暂未满足收录准则，已予以驳回。感谢你的支持。`;
        await sendMessage(applicantId, notifyText);
      }
    } else {
      await answerCallbackQuery(cq.id, `⚠️ 驳回失败：${result.error}`, true);
    }
    return;
  }

  // 4. Action: Open Category Selection Menu (chg_cat:<sub_id>)
  if (data.startsWith('chg_cat:')) {
    const subId = data.slice(8);
    await answerCallbackQuery(cq.id, '请在下方轻触选择目标专区：');
    if (chatId && messageId) {
      await editMessageText(chatId, messageId, originalText, getCategorySelectionKeyboard(subId));
    }
    return;
  }

  // 5. Action: Cancel Category Selection (back_cat:<sub_id>)
  if (data.startsWith('back_cat:')) {
    const subId = data.slice(9);
    await answerCallbackQuery(cq.id, '已取消改派操作');
    if (chatId && messageId) {
      await editMessageText(chatId, messageId, originalText, getAdminSubmissionKeyboard(subId));
    }
    return;
  }

  // 6. Action: Set Category (set_cat:<sub_id>:<target_cat>)
  if (data.startsWith('set_cat:')) {
    const parts = data.split(':');
    const subId = parts[1];
    const targetCat = parts[2];

    const subs = readJsonSafe(SUBMISSIONS_FILE);
    const targetIndex = subs.findIndex(s => s.id === subId);
    if (targetIndex === -1) {
      await answerCallbackQuery(cq.id, '⚠️ 找不到该收录单号！', true);
      return;
    }

    const catMeta = normalizeCategory(targetCat, subs[targetIndex].url);
    subs[targetIndex].category = catMeta.id;
    subs[targetIndex].categoryLabel = catMeta.label;
    writeJson(SUBMISSIONS_FILE, subs);

    await answerCallbackQuery(cq.id, `✅ 已成功改派为【${catMeta.name}】！`);

    let updatedText = originalText;
    if (/• <b>建议分类<\/b>[：:][^\n]+/i.test(updatedText)) {
      updatedText = updatedText.replace(/• <b>建议分类<\/b>[：:][^\n]+/i, `• <b>建议分类</b>：<b>${catMeta.label}</b>`);
    } else if (/• 建议分类[：:][^\n]+/i.test(updatedText)) {
      updatedText = updatedText.replace(/• 建议分类[：:][^\n]+/i, `• 建议分类：${catMeta.label}`);
    }

    if (chatId && messageId) {
      await editMessageText(chatId, messageId, updatedText, getAdminSubmissionKeyboard(subId));
    }
    return;
  }

  // 7. Action: Resolve Report (rep_ok:<rep_id>)
  if (data.startsWith('rep_ok:')) {
    const repId = data.slice(7);
    const result = resolveReport(repId, operator);

    if (result.success) {
      await answerCallbackQuery(cq.id, `🛠️ 该失效反馈已标记为已解决！`);
      if (chatId && messageId) {
        const updatedText = `${originalText}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🛠️ <b>【已完成处置】</b>\n` +
          `• 处理管理员：${operator}\n` +
          `• 工单单号：<code>${repId}</code>\n` +
          `• 处理时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        await editMessageText(chatId, messageId, updatedText, null);
      }
    } else {
      await answerCallbackQuery(cq.id, `⚠️ 处理失败：${result.error}`, true);
    }
    return;
  }

  // 8. Action: Ignore Report (rep_ign:<rep_id>)
  if (data.startsWith('rep_ign:')) {
    const repId = data.slice(8);
    const result = resolveReport(repId, `${operator} (已忽略)`);

    if (result.success) {
      await answerCallbackQuery(cq.id, `🗑️ 已忽略并关闭该反馈。`);
      if (chatId && messageId) {
        const updatedText = `${originalText}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🗑️ <b>【已忽略归档】</b>\n` +
          `• 经办管理员：${operator}\n` +
          `• 工单单号：<code>${repId}</code>\n` +
          `• 处理时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        await editMessageText(chatId, messageId, updatedText, null);
      }
    } else {
      await answerCallbackQuery(cq.id, `⚠️ 操作失败：${result.error}`, true);
    }
    return;
  }

  // 9. Action: Select Subcategory for Report (rep_cat:<rep_id>)
  if (data.startsWith('rep_cat:')) {
    const repId = data.slice(8);
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🛠️ 实用工具', callback_data: `set_rep_cat:${repId}:tools` },
          { text: '💻 开源开发', callback_data: `set_rep_cat:${repId}:dev` }
        ],
        [
          { text: '🌐 网络协议', callback_data: `set_rep_cat:${repId}:network` },
          { text: '🎬 影音媒体', callback_data: `set_rep_cat:${repId}:media` }
        ],
        [
          { text: '📰 资讯新闻', callback_data: `set_rep_cat:${repId}:news` },
          { text: '👥 综合社群', callback_data: `set_rep_cat:${repId}:community` }
        ],
        [
          { text: '🔞 成人敏感', callback_data: `set_rep_cat:${repId}:nsfw` },
          { text: '↩️ 取消返回', callback_data: `rep_cancel:${repId}` }
        ]
      ]
    };
    await answerCallbackQuery(cq.id, '请轻触选择目标业务分类：');
    if (chatId && messageId) {
      await editMessageText(chatId, messageId, originalText, keyboard);
    }
    return;
  }

  // 10. Action: Execute Report Reclassification (set_rep_cat:<rep_id>:<target_subcat>)
  if (data.startsWith('set_rep_cat:')) {
    const parts = data.split(':');
    const repId = parts[1];
    const targetSubcat = parts[2];

    const reps = readJsonSafe(REPORTS_FILE);
    const targetRep = reps.find(r => r.id === repId);
    if (!targetRep) {
      await answerCallbackQuery(cq.id, '⚠️ 找不到该工单单号！', true);
      return;
    }

    const reclassRes = reclassifyTelegramResource(targetRep.target, targetSubcat, operator);
    if (reclassRes.success) {
      resolveReport(repId, operator);
      await answerCallbackQuery(cq.id, `✅ 已成功重设为【${reclassRes.subcatLabel}】！`);
      if (chatId && messageId) {
        const updatedText = `${originalText}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🏷️ <b>【分类已一键纠正】</b>\n` +
          `• 频道名称：<b>${reclassRes.item.title}</b> (@${reclassRes.item.username})\n` +
          `• 调整分类：<code>${reclassRes.oldSubcat}</code> ➔ <b>${reclassRes.subcatLabel}</b>\n` +
          `• 经办管理：${operator}\n` +
          `• 覆盖状态：已双写至 ai-overrides.json 并重新编译搜索索引\n` +
          `• 处理时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        await editMessageText(chatId, messageId, updatedText, null);
      }
    } else {
      await answerCallbackQuery(cq.id, `⚠️ 纠错失败：${reclassRes.error}`, true);
    }
    return;
  }

  // 11. Action: Cancel Report Reclass Menu (rep_cancel:<rep_id>)
  if (data.startsWith('rep_cancel:')) {
    const repId = data.slice(11);
    await answerCallbackQuery(cq.id, '已取消改派操作');
    if (chatId && messageId) {
      const defaultKeyboard = {
        inline_keyboard: [
          [
            { text: '🛠️ 标记已解决', callback_data: `rep_ok:${repId}` },
            { text: '🗑️ 忽略关闭', callback_data: `rep_ign:${repId}` }
          ],
          [
            { text: '🏷️ 一键纠正分类', callback_data: `rep_cat:${repId}` }
          ]
        ]
      };
      await editMessageText(chatId, messageId, originalText, defaultKeyboard);
    }
    return;
  }
}

// Global Update Dispatcher
async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(update.message, update.update_id);
    return;
  }
}

// Main Polling Loop
async function runDaemon() {
  ensureDataFiles();
  console.log(`====================================================`);
  console.log(`🚀 XIU Navigation - Telegram Bot Daemon Initializing`);
  console.log(`• Queue Directory: ${NAV_DATA_DIR}`);
  console.log(`• Admin Chat ID: ${ADMIN_CHAT_ID || 'None'}`);
  console.log(`====================================================`);

  // Verify Bot identity
  try {
    const me = await tgRequest('getMe');
    console.log(`[Telegram Auth] Connected as @${me.result.username} (ID: ${me.result.id}, Name: ${me.result.first_name})`);
  } catch (err) {
    console.error(`[Telegram Auth Error] Failed to connect:`, err.message);
    process.exit(1);
  }

  const OFFSET_FILE = path.join(NAV_DATA_DIR, '.bot_offset');
  let offset = 0;
  if (fs.existsSync(OFFSET_FILE)) {
    try {
      offset = parseInt(fs.readFileSync(OFFSET_FILE, 'utf-8').trim(), 10) || 0;
    } catch (e) {}
  }
  console.log(`[Telegram Polling] Listening for updates... (isRunOnce: ${isRunOnce}, initialOffset: ${offset})`);

  while (true) {
    try {
      const updates = await tgRequest('getUpdates', {
        offset: offset,
        timeout: 20,
        allowed_updates: ['message', 'callback_query']
      });

      if (updates.ok && Array.isArray(updates.result)) {
        for (const update of updates.result) {
          offset = update.update_id + 1;
          try {
            fs.writeFileSync(OFFSET_FILE, String(offset), 'utf-8');
          } catch (e) {}
          await handleUpdate(update);
        }
      }

      if (isRunOnce) {
        if (offset > 0) {
          try {
            await tgRequest('getUpdates', { offset: offset, limit: 1 });
          } catch (e) {}
        }
        console.log(`[Telegram Polling] Single batch processed (--once). Exiting.`);
        break;
      }
    } catch (err) {
      console.error(`[Telegram Polling Error]`, err.message);
      // Backoff
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

export {
  parseSubmission,
  parseReport,
  fetchAndSummarizeMetadata,
  ensureDataFiles,
  handleUpdate,
  handleMessage,
  handleCallbackQuery,
  getAdminSubmissionKeyboard,
  getCategorySelectionKeyboard,
  reclassifyTelegramResource,
  normalizeSubcategoryInput,
  ADMIN_CHAT_ID
};

// Auto-run if executed directly or launched via PM2 ProcessContainer
const isLaunchedByPM2 = Boolean(process.env.pm_id !== undefined || (process.argv[1] && process.argv[1].includes('ProcessContainer')));
const isDirectCli = Boolean(process.argv[1] && (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) || process.argv[1].endsWith('telegram-bot-daemon.mjs')));

if (isDirectCli || isLaunchedByPM2) {
  try {
    fs.appendFileSync(path.join(ROOT_DIR, 'logs/pm2-bot-out.log'), `[${new Date().toISOString()}] Bot daemon started (PID: ${process.pid}, PM2: ${isLaunchedByPM2})\n`);
  } catch (e) {}
  runDaemon().catch(err => {
    try {
      fs.appendFileSync(path.join(ROOT_DIR, 'logs/pm2-bot-error.log'), `[Fatal Error] ${err.stack || err.message}\n`);
    } catch (e) {}
    console.error('[Fatal Error]', err);
    process.exit(1);
  });
}
