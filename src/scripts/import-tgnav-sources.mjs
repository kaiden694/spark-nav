#!/usr/bin/env node
/**
 * TGNAV.org Source Ingestion & Synchronization Pipeline
 * 
 * Fetches, cleanses, deduplicates and ingests Telegram channels, groups, and bots
 * from the open-source repository of tgnav.org (tgnav/tgnav.github.io).
 *
 * Usage:
 *   node src/scripts/import-tgnav-sources.mjs                 # Dry-run analysis (no disk write)
 *   node src/scripts/import-tgnav-sources.mjs --write         # Ingest and write into src/data/nav/telegram.json
 *   node src/scripts/import-tgnav-sources.mjs --write --exclude-nsfw  # Ingest excluding adult content (default)
 *   node src/scripts/import-tgnav-sources.mjs --limit 50      # Sample run on first 50 items
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const TELEGRAM_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram.json');
const AI_OVERRIDES_FILE = path.join(ROOT_DIR, 'src/data/nav/ai-overrides.json');

const SITEMAP_URL = 'https://raw.githubusercontent.com/tgnav/tgnav.github.io/main/sitemap.xml';
const DETAIL_BASE_URL = 'https://raw.githubusercontent.com/tgnav/tgnav.github.io/main/detail';

/**
 * Parse human readable count (e.g. 10.7K -> 10700, 2.5M -> 2500000)
 */
export function parseMemberCount(str) {
  if (!str) return 0;
  const clean = String(str).trim().replace(/,/g, '');
  const mMatch = clean.match(/^([\d.]+)\s*M$/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);
  const kMatch = clean.match(/^([\d.]+)\s*K$/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const num = parseInt(clean, 10);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Clean description text
 */
export function cleanDescription(rawText) {
  if (!rawText) return '';
  let text = String(rawText)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .trim();

  // Strip tgnav boilerplate metadata prefix if found
  text = text.replace(/^Telegram\s*(?:频道|群组|机器人)\s*@\S+\s*\([^)]*\)\s*的详情介绍与直达加入链接[。，\s]*包含订阅成员数[^\n：:]*[：:]\s*/i, '');
  text = text.replace(/^[（(]?\s*暂无描述\s*[)）]?[.。]*$/i, '');
  text = text.replace(/^[（(]?\s*暂无描述\s*[)）]?\s*[.。]*\s*/i, '');
  return text.trim();
}

/**
 * Map TGNAV category to XIU Navigation taxonomy
 */
export function mapTgnavCategory(rawCat, type, title = '', desc = '') {
  const cat = String(rawCat || '').trim().toLowerCase();
  const t = String(title || '').trim().toLowerCase();
  const d = String(desc || '').trim().toLowerCase();
  const fullText = `${cat} ${t} ${d}`;

  // 1. 正常业务核心词优先保护（防止被误伤到 NSFW）
  const isSoftwareTool = /破解|软件|apk|安卓|root|去广告|xp模块|插件|工具箱|巨魔|trollstore|捷径|快捷指令|脚本|surge|clash|loon|shadowrocket/i.test(t) || /软件|工具|破解|apk|app/i.test(cat);
  const isProgramming = /编程|代码|python|linux|docker|开发|开发者|算法|前端|后端|开源/i.test(t) || /开发|编程|技术/i.test(cat);
  const isNews = /新闻|资讯|早报|快讯|时事|rss|周报/i.test(t) || /资讯|新闻|时事|快讯/i.test(cat);
  const isStudy = /学习|哲学|汉服|英语|图书|书籍|考研|知识/i.test(t) || /知识|学习|书籍/i.test(cat);
  const isNetwork = /机场|vps|节点|梯子|翻墙|代理|服务器/i.test(t) || /机场|vps|主机|代理/i.test(cat);

  // 2. 严密的成人/NSFW判定（排除免责声明、规避“福利/妹子”等口语词误判）
  const hasNsfwDisclaimer = /禁止.*(nsfw|色情|成人|黄赌毒)|莫谈.*(nsfw|色情)|不属于.*nsfw/i.test(fullText);
  const isExplicitAdult = (/r18|18\+|成人|色情|cos外围|自慰|无码|探花|情色|\bav\b|禁漫|黄油|里番|本子|色图|足控|福利姬|missav|galgame/i.test(t) || 
                          /r18|18\+|成人|色情|cos外围|自慰|无码|探花|情色|\bav\b|禁漫|黄油|里番|本子|色图|足控|福利姬|missav|galgame/i.test(cat) ||
                          /r18|18\+|成人|色情|cos外围|自慰|无码|探花|情色|\bav\b|禁漫|黄油|里番|本子|色图|足控|福利姬|missav|galgame/i.test(d) ||
                          (/nsfw/i.test(t) && !hasNsfwDisclaimer) ||
                          (/nsfw/i.test(cat) && !hasNsfwDisclaimer) ||
                          (/nsfw/i.test(d) && !hasNsfwDisclaimer));

  // 正规分类优先保护
  if (isSoftwareTool && !/missav|黄油|里番|\bav\b/i.test(fullText)) {
    return { subcat: 'tools', isNsfw: false, tags: ['实用软件', '极客工具'] };
  }
  if (isProgramming && !/missav|黄油|里番|av/i.test(t)) {
    return { subcat: 'dev', isNsfw: false, tags: ['编程开发', '极客技术'] };
  }
  if (isNews && !/missav|黄油|里番|av/i.test(t)) {
    return { subcat: 'news', isNsfw: false, tags: ['资讯新闻', '实时动态'] };
  }
  if (isStudy && !/missav|黄油|里番|av/i.test(t)) {
    return { subcat: 'dev', isNsfw: false, tags: ['知识学习', '深度思考'] };
  }
  if (isNetwork && !/missav|黄油|里番|av/i.test(t)) {
    return { subcat: 'network', isNsfw: false, tags: ['节点网络', '主机网络'] };
  }

  // 纯成人内容
  if (isExplicitAdult && !hasNsfwDisclaimer) {
    return { subcat: 'nsfw', isNsfw: true, tags: ['NSFW', '成人内容', '18+'] };
  }

  // 兜底基础分类
  if (/资讯|新闻|时事|播报|express|news|经济|观察|早报|快讯/i.test(cat)) {
    return { subcat: 'news', isNsfw: false, tags: ['资讯新闻', '实时动态'] };
  }
  if (/软件|工具|破解|开源|脚本|surge|clash|loon|shadowrocket|ios|apk|mac|windows|app/i.test(cat)) {
    return { subcat: 'tools', isNsfw: false, tags: ['实用软件', '极客工具'] };
  }
  if (/开发|编程|技术|代码|linux|docker|python|前端|后端|dev|算法|ai|copilot|chatgpt/i.test(cat)) {
    return { subcat: 'dev', isNsfw: false, tags: ['编程开发', '极客技术'] };
  }
  if (/机场|vps|主机|代理|节点|翻墙|科学上网|network|server|mtproxy/i.test(cat)) {
    return { subcat: 'network', isNsfw: false, tags: ['节点网络', '主机网络'] };
  }
  if (/影音|影视|电影|音乐|剧集|动漫|美图|壁纸|二次元|media|netflix|spotify|acg/i.test(cat)) {
    return { subcat: 'media', isNsfw: false, tags: ['影音资源', '娱乐多媒体'] };
  }
  if (/知识|学习|书籍|读书|英语|考研|学科|科普|wiki|哲学/i.test(cat)) {
    return { subcat: 'dev', isNsfw: false, tags: ['知识学习', '深度思考'] };
  }
  if (/金融|区块链|加密货币|股票|理财|btc|eth|crypto|交易|出金/i.test(cat)) {
    return { subcat: 'finance', isNsfw: false, tags: ['金融理财', '数字货币'] };
  }
  if (/群组管理|消息收发|抽奖|验证|bot|机器人/i.test(cat) || type === 'bot') {
    return { subcat: 'tools', isNsfw: false, tags: ['电报机器人', '自动化效率'] };
  }
  if (/兴趣|生活|交流|讨论|社群|chat|同好/i.test(cat)) {
    return { subcat: 'community', isNsfw: false, tags: ['社群交流', '同好圈子'] };
  }

  return { subcat: 'community', isNsfw: false, tags: [rawCat || '电报社群', '精选推荐'] };
}

/**
 * Parse an individual TGNAV detail HTML page
 */
export function parseDetailPage(html, slug) {
  if (!html) return null;

  // Title
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  // Type: 频道 -> channel, 群组 -> group, 机器人 -> bot
  let type = 'channel';
  const typeMatch = html.match(/type-badge[^>]*>([^<]+)<\/span>/i);
  if (typeMatch) {
    const rawType = typeMatch[1].trim();
    if (rawType.includes('群组')) type = 'group';
    else if (rawType.includes('机器人')) type = 'bot';
    else type = 'channel';
  }

  // Username
  let username = slug;
  const goMatch = html.match(/\/go\/\?username=([^&"']+)/i);
  if (goMatch) {
    username = decodeURIComponent(goMatch[1]).trim().replace(/^@+/, '');
  } else {
    const userRowMatch = html.match(/用户名[\s\S]*?class="title-large"[^>]*>@?([^<]+)<\/span>/i);
    if (userRowMatch) {
      username = userRowMatch[1].trim().replace(/^@+/, '');
    }
  }
  if (username.toLowerCase().endsWith('bot') && type !== 'bot') {
    type = 'bot';
  }

  // Raw category
  let rawCategory = '综合';
  const catMatch = html.match(/category-badge[^>]*>([^<]+)<\/a>/i);
  if (catMatch) {
    rawCategory = catMatch[1].trim();
  }

  // Member count
  let memberCount = 0;
  const countMatch = html.match(/订阅\/群员数[\s\S]*?class="title-large"[^>]*>([^<]+)<\/span>/i) ||
                     html.match(/class="title-large"[^>]*>([0-9.]+\s*[KM]?|\d+)<\/span>/i);
  if (countMatch) {
    memberCount = parseMemberCount(countMatch[1].trim());
  }

  // Description from article body
  let description = '';
  const bodyMatch = html.match(/class="body-large"[^>]*>([\s\S]*?)<\/div>/i);
  if (bodyMatch) {
    description = cleanDescription(bodyMatch[1]);
  }
  if (!description) {
    const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    if (metaMatch) {
      description = cleanDescription(metaMatch[1]);
    }
  }
  if (!description) {
    description = `${title} (@${username}) Telegram 优质${type === 'bot' ? '机器人' : (type === 'group' ? '互动交流群' : '公开频道')}`;
  }

  // Avatar URL
  let avatarUrl = `https://avatar.tgnav.org/small/${username}.jpg`;
  const avatarMatch = html.match(/data-src=["'](https:\/\/avatar\.tgnav\.org\/small\/[^"']+)["']/i);
  if (avatarMatch) {
    avatarUrl = avatarMatch[1].trim();
  }

  // Map category taxonomy
  const { subcat, isNsfw, tags } = mapTgnavCategory(rawCategory, type, title, description);

  return {
    id: `tg-${username.toLowerCase()}`,
    username: username,
    title: title,
    url: `https://t.me/${username}`,
    description: description,
    type: type,
    member_count: memberCount,
    avatar_url: avatarUrl,
    category: 'telegram',
    subcategory: subcat,
    tags: tags,
    is_nsfw: isNsfw,
    is_featured: memberCount >= 50000,
    created_at: new Date().toISOString().split('T')[0],
    updated_at: new Date().toISOString().split('T')[0]
  };
}

/**
 * Execute concurrent task pool
 */
async function runConcurrentPool(items, concurrencyLimit, workerFn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        const res = await workerFn(items[currentIndex], currentIndex);
        if (res) results.push(res);
      } catch (err) {
        console.warn(`[Worker Error] Item ${currentIndex} failed:`, err.message);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrencyLimit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Main Ingestion Pipeline
 */
export async function runIngestion({
  write = false,
  excludeNsfw = false,
  limit = 0,
  concurrency = 16
} = {}) {
  console.log('======================================================');
  console.log('📡 TGNAV.ORG TELEGRAM RESOURCES INGESTION ENGINE');
  console.log(`• Mode: ${write ? 'WRITE (Live Data Mutation)' : 'DRY-RUN (Inspection Only)'}`);
  console.log(`• Filter Adult/NSFW: ${excludeNsfw ? 'YES (Excluded)' : 'NO (Included)'}`);
  console.log(`• Concurrency: ${concurrency} parallel streams`);
  console.log('======================================================\n');

  // Step 1: Fetch Sitemap
  console.log('[1/4] Fetching tgnav sitemap.xml...');
  const sitemapRes = await fetch(SITEMAP_URL);
  if (!sitemapRes.ok) {
    throw new Error(`Failed to fetch sitemap: HTTP ${sitemapRes.status}`);
  }
  const sitemapXml = await sitemapRes.text();
  const allSlugs = [...sitemapXml.matchAll(/\/detail\/([^\/]+)\//g)].map(m => m[1]);
  const uniqueSlugs = [...new Set(allSlugs)];
  console.log(`[1/4] Found ${uniqueSlugs.length} unique detail pages in sitemap.`);

  const targetSlugs = limit > 0 ? uniqueSlugs.slice(0, limit) : uniqueSlugs;
  console.log(`[2/4] Harvesting ${targetSlugs.length} records via GitHub CDN stream...`);

  const startTime = Date.now();
  let completed = 0;

  const harvestedItems = await runConcurrentPool(targetSlugs, concurrency, async (slug) => {
    let html = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(`${DETAIL_BASE_URL}/${slug}/index.html`, {
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          html = await res.text();
          break;
        }
      } catch (e) {
        if (attempt === 2) return null;
      }
    }

    if (!html) return null;
    const parsed = parseDetailPage(html, slug);
    completed++;
    if (completed % 100 === 0 || completed === targetSlugs.length) {
      process.stdout.write(`  [Progress] ${completed}/${targetSlugs.length} items parsed (${((Date.now() - startTime) / 1000).toFixed(1)}s)...\n`);
    }
    return parsed;
  });

  const validItems = harvestedItems.filter(Boolean);
  console.log(`[2/4] Successfully harvested ${validItems.length} valid resources!`);

  // Step 3: Filter NSFW if requested
  const filteredItems = excludeNsfw ? validItems.filter(i => !i.is_nsfw) : validItems;
  const nsfwFilteredCount = validItems.length - filteredItems.length;
  if (excludeNsfw && nsfwFilteredCount > 0) {
    console.log(`[3/4] Filtered out ${nsfwFilteredCount} NSFW/Adult items according to safety policy.`);
  }

  // Step 4: Deduplicate and Merge with existing dataset
  console.log(`[4/4] Merging with existing ${TELEGRAM_FILE}...`);
  let existingData = [];
  if (fs.existsSync(TELEGRAM_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(TELEGRAM_FILE, 'utf-8'));
    } catch (e) {
      existingData = [];
    }
  }

  const existingMap = new Map();
  for (const item of existingData) {
    if (item.username) {
      existingMap.set(item.username.toLowerCase(), item);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;
  const mergedList = [...existingData];

  for (const newItem of filteredItems) {
    const key = newItem.username.toLowerCase();
    if (existingMap.has(key)) {
      const curr = existingMap.get(key);
      let changed = false;
      if (newItem.member_count && curr.member_count !== newItem.member_count) {
        curr.member_count = newItem.member_count;
        changed = true;
      }
      if ((!curr.description || curr.description.length < 15) && newItem.description) {
        curr.description = newItem.description;
        changed = true;
      }
      if ((!curr.avatar_url || curr.avatar_url.includes('telegram-default')) && newItem.avatar_url) {
        curr.avatar_url = newItem.avatar_url;
        changed = true;
      }
      if (changed) {
        curr.updated_at = new Date().toISOString().split('T')[0];
        updatedCount++;
      }
    } else {
      const toSave = { ...newItem };
      mergedList.push(toSave);
      existingMap.set(key, toSave);
      addedCount++;
    }
  }

  // Apply persistent editorial and AI overrides
  let overridesApplied = 0;
  if (fs.existsSync(AI_OVERRIDES_FILE)) {
    try {
      const overrides = JSON.parse(fs.readFileSync(AI_OVERRIDES_FILE, 'utf-8'));
      for (const item of mergedList) {
        const key = (item.username || item.id || '').toLowerCase().replace(/^tg-/, '');
        if (key && overrides[key]) {
          const ov = overrides[key];
          if (ov.title) item.title = ov.title;
          if (ov.subcategory) item.subcategory = ov.subcategory;
          if (typeof ov.is_nsfw === 'boolean') item.is_nsfw = ov.is_nsfw;
          if (typeof ov.is_alive === 'boolean') item.is_alive = ov.is_alive;
          if (ov.description) item.description = ov.description;
          if (Array.isArray(ov.tags) && ov.tags.length) item.tags = ov.tags;
          overridesApplied++;
        }
      }
      if (overridesApplied > 0) {
        console.log(`[Overrides] Applied ${overridesApplied} persistent AI/editorial override(s).`);
      }
    } catch (err) {
      console.warn(`[Overrides Warning] Failed to apply ai-overrides.json:`, err.message);
    }
  }

  console.log('\n======================================================');
  console.log('📊 INGESTION SUMMARY REPORT');
  console.log(`• Total Processed from TGNAV: ${validItems.length}`);
  console.log(`• NSFW Excluded: ${nsfwFilteredCount}`);
  console.log(`• Previously Existing Records: ${existingData.length}`);
  console.log(`• Newly Ingested Records: +${addedCount}`);
  console.log(`• Enriched/Updated Records: ${updatedCount}`);
  console.log(`• Final Total Telegram Records: ${mergedList.length}`);
  console.log('======================================================');

  if (write) {
    fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(mergedList, null, 2) + '\n', 'utf-8');
    console.log(`\n[Write] Successfully wrote ${mergedList.length} records to ${TELEGRAM_FILE}`);

    // Rebuild nav search index
    console.log('[Index] Rebuilding multi-dimensional navigation search index...');
    const indexRes = spawnSync('npm', ['run', 'nav:search:index'], {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    if (indexRes.status === 0) {
      console.log('[Index] ✅ Search index rebuilt successfully!');
    }
  } else {
    console.log('\n[Dry Run] No files modified. Run with --write to apply changes.');
  }

  return {
    harvestedCount: validItems.length,
    nsfwFilteredCount,
    addedCount,
    updatedCount,
    totalCount: mergedList.length
  };
}

// CLI Entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const isWrite = args.includes('--write');
  const excludeNsfw = args.includes('--exclude-nsfw');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;
  const concIdx = args.indexOf('--concurrency');
  const concurrency = concIdx !== -1 ? parseInt(args[concIdx + 1], 10) : 16;

  runIngestion({
    write: isWrite,
    excludeNsfw,
    limit,
    concurrency
  }).catch(err => {
    console.error('Fatal ingestion error:', err);
    process.exit(1);
  });
}
