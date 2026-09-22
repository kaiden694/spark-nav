#!/usr/bin/env node
/**
 * XIU Navigation - Intent Synonym & Tag Expansion Engine
 * 
 * Enriches navigation resources with 3-5 high-value search intent tags
 * (colloquial query phrases, pain-point keywords, and LSI semantic tokens)
 * for instant client-side search ranking and static HTML SEO markup.
 * 
 * Modes:
 *   node src/scripts/enrich-intent-tags.mjs [--dry-run] [--write] [--offline]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const NAV_DATA_DIR = path.join(ROOT_DIR, 'src/data/nav');

export const TELEGRAM_FILE = path.join(NAV_DATA_DIR, 'telegram.json');
export const WEBSITES_FILE = path.join(NAV_DATA_DIR, 'websites.json');
export const GITHUB_FILE = path.join(NAV_DATA_DIR, 'github.json');
export const AI_OVERRIDES_FILE = path.join(NAV_DATA_DIR, 'ai-overrides.json');

// Subcategory Core Intent Lexicon (Default Fallbacks)
export const SUBCAT_CORE_INTENTS = {
  tools: ['实用软件', '极客工具', '效率神器', '玩机工具'],
  dev: ['开源项目', '编程开发', '极客技术', '技术架构'],
  network: ['科学上网', '节点网络', '翻墙工具', '代理客户端'],
  media: ['免费看电影', '影音资源', '在线播放', '高清影视'],
  news: ['科技资讯', '实时快讯', '数码早报', '行业动态'],
  finance: ['数字货币', '区块链', '加密行情', '金融理财'],
  community: ['社群交流', '同好圈子', '资源互助', '精选推荐'],
  nsfw: ['成人内容', '18+', '私密社群']
};

// High-Precision Semantic Pattern Rules
export const SEMANTIC_INTENT_RULES = [
  {
    name: 'Video & Streaming',
    pattern: /电影|影视|电视剧|追剧|美剧|韩剧|日剧|番剧|动漫|4k|蓝光|高清视频|播放器|在线看|剧集|影院|观影|剧荒/i,
    tags: ['免费看剧', '影视资源', '在线播放']
  },
  {
    name: 'Cloud Drives & Pan Search',
    pattern: /网盘|夸克|阿里|百度网盘|迅雷|磁力|bt下载|种子|盘搜|搜盘|找资源|合集/i,
    tags: ['网盘搜索', '磁力下载', '资源检索']
  },
  {
    name: 'Mod APK & Ad Blocking',
    pattern: /破解|去广告|免root|mod|apk|绿色版|纯净版|精简版|无弹窗|特权版|玩机/i,
    tags: ['去广告', '安卓破解', '纯净版']
  },
  {
    name: 'VPN & Proxy & Nodes',
    pattern: /科学上网|翻墙|梯子|机场|节点|v2ray|clash|sing-box|shadowrocket|surge|vmess|trojan|代理|订阅/i,
    tags: ['科学上网', '节点订阅', '代理客户端']
  },
  {
    name: 'Tech & Open Source & AI',
    pattern: /开源|github|代码|编程|python|前端|全栈|算法|docker|linux|copilot|chatgpt|大模型|ai助手/i,
    tags: ['开源项目', 'AI工具', '极客技术']
  },
  {
    name: 'Wallpaper & Visual Art',
    pattern: /壁纸|美图|4k壁纸|原神插画|插画|摄影|二次元壁纸|写真/i,
    tags: ['高清壁纸', '视觉美图']
  },
  {
    name: 'Music & Audio',
    pattern: /无损音乐|flac|hifi|音乐下载|车载无损|网易云|mp3/i,
    tags: ['无损音乐', '音频资源']
  },
  {
    name: 'Crypto & Web3',
    pattern: /btc|eth|比特币|以太坊|加密货币|空投|web3|交易所|合约|现货/i,
    tags: ['数字货币', '加密行情']
  },
  {
    name: 'News & Digest',
    pattern: /早报|快讯|时事|今日要闻|科技新闻|情报|资讯/i,
    tags: ['科技快讯', '实时资讯']
  }
];

/**
 * Expand intent tags for a single item deterministically
 */
export function expandIntentTags({
  title = '',
  description = '',
  subcategory = 'community',
  existingTags = []
} = {}) {
  const combinedText = `${title} ${description} ${(existingTags || []).join(' ')}`.toLowerCase();
  const tagSet = new Set();

  // 1. Keep high-value existing tags (filter noise)
  if (Array.isArray(existingTags)) {
    for (const t of existingTags) {
      const clean = String(t || '').trim().replace(/^#+/, '');
      if (clean && clean.length >= 2 && clean.length <= 16) {
        tagSet.add(clean);
      }
    }
  }

  // 2. Match Semantic Intent Rules against combined text
  for (const rule of SEMANTIC_INTENT_RULES) {
    if (rule.pattern.test(combinedText)) {
      for (const tag of rule.tags) {
        tagSet.add(tag);
      }
    }
  }

  // 3. If tags count is less than 3, backfill from Subcategory Core Lexicon
  const normSubcat = String(subcategory || 'community').toLowerCase();
  const defaultIntents = SUBCAT_CORE_INTENTS[normSubcat] || SUBCAT_CORE_INTENTS.community;
  for (const tag of defaultIntents) {
    if (tagSet.size >= 4) break;
    tagSet.add(tag);
  }

  // 4. Bound tags between 3 and 5, prioritize intent-specific over generic
  const result = Array.from(tagSet);
  return result.slice(0, 5);
}

/**
 * Batch enrichment runner
 */
export async function runIntentEnrichment(options = {}) {
  const isDryRun = options.dryRun !== false && !options.write;
  console.log(`================ INTENT TAG ENRICHMENT ENGINE ================`);
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (Preview only)' : '💾 WRITE (Persisting to disk)'}`);

  const readJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      return [];
    }
  };

  const telegramList = readJson(TELEGRAM_FILE);
  const websiteList = readJson(WEBSITES_FILE);
  const githubList = readJson(GITHUB_FILE);
  const aiOverrides = (() => {
    try {
      return JSON.parse(fs.readFileSync(AI_OVERRIDES_FILE, 'utf-8'));
    } catch (e) {
      return {};
    }
  })();

  let totalProcessed = 0;
  let totalEnriched = 0;
  const now = new Date().toISOString().split('T')[0];

  function processDataset(dataset, typeName, idKey = 'id') {
    let updated = 0;
    for (const item of dataset) {
      totalProcessed++;
      const oldTags = Array.isArray(item.tags) ? [...item.tags] : [];
      const newTags = expandIntentTags({
        title: item.title,
        description: item.description,
        subcategory: item.subcategory,
        existingTags: oldTags
      });

      // Check if new intent tags were added
      const oldStr = oldTags.sort().join(',');
      const newStr = [...newTags].sort().join(',');
      if (oldStr !== newStr) {
        item.tags = newTags;
        updated++;
        totalEnriched++;

        // Persist to ai-overrides if telegram
        if (typeName === 'telegram') {
          const ovKey = (item.username || item.id || '').toLowerCase();
          if (ovKey) {
            aiOverrides[ovKey] = {
              ...(aiOverrides[ovKey] || {}),
              title: item.title,
              subcategory: item.subcategory,
              is_nsfw: Boolean(item.is_nsfw),
              description: item.description,
              tags: newTags,
              updated_at: now
            };
          }
        }
      }
    }
    console.log(`[${typeName}] Processed ${dataset.length} items, enriched ${updated} items.`);
    return updated;
  }

  processDataset(websiteList, 'websites');
  processDataset(githubList, 'github');
  processDataset(telegramList, 'telegram', 'username');

  console.log('------------------------------------------------------');
  console.log(`📊 Summary: ${totalEnriched} / ${totalProcessed} resources enriched with intent tags.`);

  if (!isDryRun) {
    fs.writeFileSync(WEBSITES_FILE, JSON.stringify(websiteList, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(GITHUB_FILE, JSON.stringify(githubList, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(telegramList, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(AI_OVERRIDES_FILE, JSON.stringify(aiOverrides, null, 2) + '\n', 'utf-8');
    console.log(`[WRITE] Saved updated data to nav datasets and ai-overrides.json cleanly.`);

    // Rebuild Search Indexes
    try {
      console.log(`[INDEX] Rebuilding unified and nav search indexes...`);
      execSync('npm run search:index', { stdio: 'inherit', cwd: ROOT_DIR });
      console.log(`[INDEX] Successfully updated search indexes with intent tags!`);
    } catch (err) {
      console.warn(`[INDEX WARN] Index rebuild error: ${err.message}`);
    }
  }

  return {
    totalProcessed,
    totalEnriched
  };
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith('enrich-intent-tags.mjs')) {
  const isWrite = process.argv.includes('--write');
  const isDryRun = process.argv.includes('--dry-run') || !isWrite;
  runIntentEnrichment({ dryRun: isDryRun, write: isWrite });
}
