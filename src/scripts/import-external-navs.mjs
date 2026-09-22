#!/usr/bin/env node
/**
 * XIU Navigation - External Navigation Importer (Refined & Precision Filtered)
 * Ingests and normalizes resources from adzhp.cc and zoo.ink into local navigation datasets.
 * Features:
 * - URL normalization (strips &amp;, utm_*, referrer, aff, channel, tracking codes)
 * - Domain & title deduplication against all existing datasets
 * - High-precision category and subcategory mapping
 * - Title purification (removes typo obfuscation like '破jie', '【梯】', emoji artifacts)
 * - AI / heuristic one-sentence concise summary generation (35-55 chars)
 * - Strict local isolation (no remote deploy unless confirmed)
 *
 * Usage:
 *   node src/scripts/import-external-navs.mjs [--write] [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNavIndex } from './build-nav-search-index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const WEBSITES_FILE = path.join(ROOT_DIR, 'src/data/nav/websites.json');
const GITHUB_FILE = path.join(ROOT_DIR, 'src/data/nav/github.json');
const TELEGRAM_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram.json');

const ADZHP_HTML_PATH = 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\dd299214-a7e8-4335-88bd-64eaf9933a9d\\.system_generated\\steps\\12648\\content.md';
const ZOO_HTML_PATH = 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\dd299214-a7e8-4335-88bd-64eaf9933a9d\\.system_generated\\steps\\12644\\content.md';

const args = process.argv.slice(2);
const IS_WRITE = args.includes('--write');

// Blacklist for ads, spam, counterfeit merchandise, and gambling
const SPAM_REGEX = /高仿|潮鞋|潮牌|手表|服饰|男装|女装|鞋包|包包|莆田|复刻表|仿牌|代发|货源|借贷|贷款|发卡|博彩|棋牌|菠菜|兼职|网赚|赚钱|充值|点卡|代刷|挂机|外推|微信群|客源|引流|私信|优惠券|发布页|打赏/i;

// Filter out generic mainstream social / portals already universally known
const MAINSTREAM_SOCIAL = /^(?:新浪微博|知乎|百度贴吧|豆瓣|小红书|即刻|36氪|简书|煎蛋|虎扑社区|什么值得买社区|微信读书)$/i;

const BLACKLIST_DOMAINS = ['adzhp.cc', 'zyscj.com', 'linkqiu.com', 'docs.qq.com', 'link3.cc'];

function readJsonSafe(filePath, defaultVal = []) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {}
  return defaultVal;
}

function cleanUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let u = rawUrl.trim().replace(/&amp;/g, '&');
  try {
    // Strip hash tracking e.g. /#/?code=xxxx
    if (u.includes('#/?') || u.includes('#?')) {
      u = u.replace(/#(?:|\/)\?[^#]*/, '');
    }

    const parsed = new URL(u);
    const searchParams = new URLSearchParams(parsed.search);
    const toDelete = [];
    for (const key of searchParams.keys()) {
      const kLow = key.toLowerCase();
      if (
        kLow.startsWith('utm_') ||
        kLow.startsWith('amp;utm_') ||
        ['from', 'spm', 'ref', 'source', 'aida', 'fromuid', 'code', 'invite', 'channel', 'ad', 'referrer', 'referrer_s', 'aff', 'affiliate'].includes(kLow)
      ) {
        toDelete.push(key);
      }
      // Clean promotion search params like ?s=adzh0
      if (kLow === 's' && /adzh|aida/i.test(searchParams.get(key) || '')) {
        toDelete.push(key);
      }
    }
    toDelete.forEach(k => searchParams.delete(k));
    const qs = searchParams.toString();
    parsed.search = qs ? `?${qs}` : '';
    let result = parsed.toString();
    if (parsed.pathname !== '/' && result.endsWith('/')) {
      result = result.slice(0, -1);
    }
    return result;
  } catch (e) {
    return u.replace(/[?&](?:amp;)?utm_[^&]+/g, '').replace(/\/+$/, '');
  }
}

function normalizeTitle(rawTitle) {
  if (!rawTitle) return '';
  let t = rawTitle
    .replace(/&amp;/g, '&')
    .replace(/^[\s\uFE0F\u200B\u200C\u200D\u200E\u200F\u2600-\u26FF\u2700-\u27BF️⭐️⚡️]+/, '') // strip leading emoji / symbols
    .replace(/【[^】]*】/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\(仅查找\)/g, '')
    .replace(/-备份$/g, '')
    .replace(/[-_—]\s*(?:官方网站|官方平台|主页|最新地址|永久地址|免梯|备用|免费搜).*$/g, '')
    .trim();

  // Keyword fixes & typo restoration
  const replacements = [
    [/^chat-gpt/i, 'ChatGPT'],
    [/^caude/i, 'Claude'],
    [/^poe$/i, 'Poe'],
    [/^meta$/i, 'Meta AI'],
    [/吾爱破jie/i, '吾爱破解'],
    [/^️?AI生成PPT/i, 'AIPPT'],
    [/^免翻NanoBanana中文站/i, '蕉图AI (NanoBanana)'],
    [/^免翻GPT-image-2/i, '卡图AI (KatuAI)'],
    [/^555-看电影/i, '555电影'],
    [/^Songin AI\s*-\s*颂音AI/i, 'Songin AI (颂音)'],
    [/^MyFreeMp3-tool/i, 'MyFreeMp3'],
    [/^雪落影视\(修罗影视\)/i, '雪落影视'],
    [/^两个BT（4K\)/i, '两个BT']
  ];

  for (const [regex, rep] of replacements) {
    if (regex.test(t)) {
      t = t.replace(regex, rep);
    }
  }

  return t.trim();
}

function generateSlug(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const hostPart = parsed.hostname.replace(/^(www\.|pan\.)/, '').replace(/[^a-zA-Z0-9]/g, '-');
    const pathPart = parsed.pathname.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 15);
    return `${hostPart}-${pathPart}`.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  } catch (e) {
    return Math.random().toString(36).slice(2, 10);
  }
}

// High-precision taxonomy classifier (11 subcategories)
function mapTaxonomy(sourceCat, title, desc, url) {
  const text = `${sourceCat} ${title} ${desc} ${url}`.toLowerCase();

  // 1. AI Chat & Foundation Models
  if (
    /chatgpt|claude|deepseek|kimi|豆包|通义千问|文心一言|讯飞星火|阶跃|minimax|grok|poe|meta\s*ai|baichuan|清言|qwen|chat\s*glm/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'ai-chat', tags: ['AI对话', '大模型', '智能助手'] };
  }

  // 2. AI Creative & Generative Tools
  if (
    /aippt|秘塔|卡图|nanobanana|katuai|suno|songin|midjourney|sora|生成ppt|生图|生视频|音频生成|ai搜索|ai绘/i.test(text) ||
    (/(?:^|[^a-z])ai(?=[^a-z]|ppt|bot|tool|chat|code|search|$)|人工智能/i.test(text) && !/看剧ai/i.test(text))
  ) {
    return { category: 'tools', subcategory: 'ai-tools', tags: ['AI生成', '智能工具', '效率神器'] };
  }

  // 3. TvBox & Media Players (Checked before general video to accurately bucket boxes)
  if (
    /tvbox|盒子|播放器|空壳|多源接口|安卓电视|易看|橘汁|默影视|星落|avbox|粉猪|小柠檬|追剧达人|小柿子|资源猫|优可|天际视频/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'media-tvbox', tags: ['TvBox', '电视播放器', '多源接口'] };
  }

  // 4. Music & Audio
  if (
    sourceCat.includes('音乐动听') ||
    /音乐|听歌|音频|mp3|电台|有声|myfreemp3|昔枫|zz123|音微|放屁音乐|acg漫音|下歌吧/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'media-audio', tags: ['在线音乐', '音频电台', '无损试听'] };
  }

  // 5. ACG, Anime & Manga
  if (
    sourceCat.includes('阅读漫画') ||
    /漫画|动漫|追番|番剧|二次元|弹幕|acg|manga|anime|拷贝漫画|包子漫画|age动漫|auvfun|omofun|蜜柑计划|nyaa|bangumi|萌娘百科/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'acg-media', tags: ['二次元', '动漫追番', '在线漫画'] };
  }

  // 6. Video & Streaming
  if (
    sourceCat.includes('视频直播') ||
    /555|大米星球|看剧|电影|影视|视频|直播|短剧|饭搭子|雪落|厂长|注视|两个bt|云朵|永乐|猴影|麦田|布布|搜片|麒麟|西瓜影院|4k影视|观影|sotvla/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'media-video', tags: ['影音播放', '影视检索', '多媒体'] };
  }

  // 6. Cloud Disk & Magnet Search
  if (
    sourceCat.includes('资源搜索') ||
    /网盘|磁力|盘搜|pansearch|小鸟搜索|易搜|小云搜索|爱盘搜|盘友圈|夸夸盘|皮卡搜|咔帕|橘子盘|大力盘|凌风云|搜索资源|搜盘/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'cloud-search', tags: ['网盘搜索', '磁力检索', '资源聚合'] };
  }

  // 7. Books, Reading & Comics
  if (
    sourceCat.includes('阅读漫画') ||
    /漫画|小说|阅读|书籍|z-library|安娜的档案|搜书|找书|苦瓜书盘|知轩藏书|书伴|好读|pdf\s*drive|书葵|读书小站|飞库/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'books-reading', tags: ['电子书', '书籍阅读', '数字图书馆'] };
  }

  // 8. Education & Public Courses
  if (
    sourceCat.includes('学习教育') ||
    /大学|公开课|在线课堂|课程|自学|网易云课堂|mooc|coursera|edx|学堂在线|爱课程|超星|我要自学网|高考/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'study-courses', tags: ['在线学习', '名校公开课', '知识提升'] };
  }

  // 9. PPT Templates & Design Material
  if (
    sourceCat.includes('办公素材') ||
    /ppt|简历|模板|素材|设计|图表|cad|hippter|officeplus|优品ppt|锐普|第一ppt|51ppt|pptfans/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'office-design', tags: ['办公素材', 'PPT模板', '效率设计'] };
  }

  // 10. Digital Life & Tech News
  if (/少数派|topbook|数字生活|极客资讯/i.test(text)) {
    return { category: 'tools', subcategory: 'digital-life', tags: ['数字生活', '前沿资讯', '优质体验'] };
  }

  // 11. Dev Tools, Systems & Geeks
  if (
    sourceCat.includes('软件游戏') ||
    /吾爱破解|423down|果核剥壳|小众软件|异星软件|开发|编程|代码|github|git|api|linux|运维|docker|系统pe|pe工具|app热|腾龙工作室|小刀娱乐|鸭先知|懒得勤快|a姐|枫音/i.test(text)
  ) {
    return { category: 'tools', subcategory: 'dev-system', tags: ['开发者工具', '技术资源', '系统工具'] };
  }

  return { category: 'tools', subcategory: 'dev-system', tags: ['实用工具', '精选站点'] };
}

// Generate concise 35-55 char geek-curated summary
function synthesizeDescription(title, desc, taxonomy, source) {
  let cleanDesc = (desc || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleanDesc && cleanDesc.length >= 25 && cleanDesc.length <= 60) {
    if (!/[。！？!?.]$/.test(cleanDesc)) cleanDesc += '。';
    return cleanDesc;
  }

  if (taxonomy.subcategory === 'ai-chat') {
    return `${title} 提供顶尖大语言模型与多模态对话交互能力，支持高阶推理、代码编写与多场景生产力辅助。`;
  }
  if (taxonomy.subcategory === 'ai-tools') {
    return `${title} 专注前沿 AI 创意与智能自动化生成，提供高效的内容创作、多维搜索与专业生产力支持。`;
  }
  if (taxonomy.subcategory === 'media-tvbox') {
    return `${title} 是一款高度可定制的多源电视与多媒体播放工具，支持多端接口配置与高清流畅视听。`;
  }
  if (taxonomy.subcategory === 'media-audio') {
    return `${title} 汇聚海量高品质音乐与音频资源，支持便捷的在线视听、榜单浏览与流畅无损播放。`;
  }
  if (taxonomy.subcategory === 'media-video') {
    return `${title} 汇聚全网优质影视剧集与多媒体资源，提供流畅高清的在线音视频播放与流媒体检索体验。`;
  }
  if (taxonomy.subcategory === 'acg-media') {
    return `${title} 汇聚海量优质二次元动漫新番、在线漫画与同好交流资源，提供极致沉浸的视听与阅读体验。`;
  }
  if (taxonomy.subcategory === 'cloud-search') {
    return `${title} 汇聚主流网盘与多维度资源索引，支持跨平台极速检索影视、电子书、应用与学习资料。`;
  }
  if (taxonomy.subcategory === 'books-reading') {
    return `${title} 聚合海量正版与精选电子书、数字图书资源，提供舒适沉浸的跨设备排版阅读体验。`;
  }
  if (taxonomy.subcategory === 'study-courses') {
    return `${title} 聚合国内外名校优质公开课与系统化在线学习体系，助力专业知识提升与终身技能精进。`;
  }
  if (taxonomy.subcategory === 'office-design') {
    return `${title} 汇聚高质量精选演示文档设计素材与实用办公模板，全面提升日常汇报与演示效率。`;
  }
  if (taxonomy.subcategory === 'digital-life') {
    return `${title} 关注数字生活、实用软硬件评测与高效工作流探索，助力打造兼具美感与效率的生活方式。`;
  }

  return `${title} 面向极客与开发者群体，提供前沿技术框架、软件分享、安全工具链与高效实用资源。`;
}

async function runImporter() {
  console.log('====================================================');
  console.log('🚀 XIU Navigation - External Navigation Importer (Refined)');
  console.log(`• Mode: ${IS_WRITE ? 'WRITE TO LOCAL DATASETS' : 'DRY-RUN (Preview only)'}`);
  console.log('====================================================\n');

  // 1. Build Global Existing Deduplication Set
  const existingWebsites = readJsonSafe(WEBSITES_FILE);
  const existingGithub = readJsonSafe(GITHUB_FILE);
  const existingTelegram = readJsonSafe(TELEGRAM_FILE);

  const existingUrlSet = new Set();
  const existingTitleSet = new Set();

  function registerExisting(list) {
    for (const item of list) {
      if (item.url) {
        const c = cleanUrl(item.url);
        existingUrlSet.add(c);
        try {
          const u = new URL(c);
          existingUrlSet.add(u.hostname);
          existingUrlSet.add(u.origin);
        } catch (e) {}
      }
      if (item.title) {
        existingTitleSet.add(normalizeTitle(item.title).toLowerCase());
      }
    }
  }

  registerExisting(existingWebsites);
  registerExisting(existingGithub);
  registerExisting(existingTelegram);

  console.log(`[Deduplication] Initialized with ${existingUrlSet.size} URL/Host tokens and ${existingTitleSet.size} titles.`);

  const candidateItems = [];

  // ==================== PART 1: Parse ADZHP.CC ====================
  if (fs.existsSync(ADZHP_HTML_PATH)) {
    const adzhpHtml = fs.readFileSync(ADZHP_HTML_PATH, 'utf-8');
    const sections = adzhpHtml.split(/<h4[^>]*class="[^"]*text-gray[^"]*"[^>]*>/i);

    for (let s = 1; s < sections.length; s++) {
      const sectionContent = sections[s];
      const catName = (sectionContent.match(/([\s\S]*?)<\/h4>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
      if (catName.includes('友情链接')) continue;

      const cardParts = sectionContent.split('class="url-card');
      for (let c = 1; c < cardParts.length; c++) {
        const chunk = cardParts[c].slice(0, 2500);
        const dataUrlM = chunk.match(/data-url=["']([^"']+)["']/i);
        const hrefM = chunk.match(/href=["']([^"']+)["']/i);
        let targetUrl = (dataUrlM?.[1] || hrefM?.[1] || '').trim();

        const strongM = chunk.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i) ||
                       chunk.match(/class="url-detail[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        let title = (strongM?.[1] || '').replace(/<[^>]+>/g, '').trim();

        const descM = chunk.match(/<p[^>]*class="[^"]*(?:overflowClip|line-clamp|text-muted)[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
        let desc = (descM?.[1] || '').replace(/<[^>]+>/g, '').trim();

        const iconM = chunk.match(/data-src=["']([^"']+)["']/i) || chunk.match(/src=["']([^"']+)["']/i);
        let icon = iconM ? iconM[1] : '';
        if (icon.includes('favicon.png') || !icon.startsWith('http')) icon = '';

        if (!title || !targetUrl) continue;
        targetUrl = cleanUrl(targetUrl);
        title = normalizeTitle(title);

        // Filter spam & ads
        if (SPAM_REGEX.test(title) || SPAM_REGEX.test(desc) || SPAM_REGEX.test(targetUrl)) {
          continue;
        }

        // Filter generic mainstream social portals
        if (MAINSTREAM_SOCIAL.test(title)) {
          continue;
        }

        // Filter internal jump / aggregation domains / third-party redirection platforms
        if (BLACKLIST_DOMAINS.some(d => targetUrl.includes(d))) {
          continue;
        }

        candidateItems.push({
          source: 'adzhp.cc',
          sourceCategory: catName,
          title,
          url: targetUrl,
          rawDescription: desc,
          icon
        });
      }
    }
  }

  // ==================== PART 2: Parse ZOO.INK ====================
  if (fs.existsSync(ZOO_HTML_PATH)) {
    const zooHtml = fs.readFileSync(ZOO_HTML_PATH, 'utf-8');
    const zooCards = zooHtml.split('class="zoo-soft-item');

    const downloadMap = new Map();
    const linkRegex = /<a[^>]*class="[^"]*download-count[^"]*"[^>]*data-soft-id=["'](\d+)["'][^>]*href=["']([^"']+)["']/gi;
    let lm;
    while ((lm = linkRegex.exec(zooHtml)) !== null) {
      const sId = lm[1];
      const linkUrl = lm[2];
      if (!downloadMap.has(sId)) {
        downloadMap.set(sId, linkUrl);
      }
    }

    for (let i = 1; i < zooCards.length; i++) {
      const chunk = zooCards[i].slice(0, 2000);
      const titleM = chunk.match(/class="zoo-soft-title"[^>]*>([\s\S]*?)<\/div>/i);
      const title = normalizeTitle(titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '');

      const descM = chunk.match(/class="zoo-soft-intro"[^>]*>([\s\S]*?)<\/div>/i);
      const desc = descM ? descM[1].replace(/<[^>]+>/g, '').trim() : '';

      const idM = chunk.match(/data-soft-id=["'](\d+)["']/i);
      const sId = idM ? idM[1] : '';

      const iconM = chunk.match(/data-src=["']([^"']+)["']/i);
      const icon = iconM ? iconM[1] : '';

      const tagMatches = chunk.match(/<span><i class="icon[^"]*"><\/i>([^<]+)<\/span>/gi) || [];
      const tags = tagMatches.map(t => t.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

      let targetUrl = downloadMap.get(sId) || '';
      if (!targetUrl && sId) {
        targetUrl = `https://zoo.ink/?p=${sId}`;
      }

      if (!title || !targetUrl) continue;

      if (SPAM_REGEX.test(title) || SPAM_REGEX.test(desc)) continue;

      // Select top-tier utilities: TvBox, Readers, Media Players, Network Tools
      const isHighDemand = /tvbox|影视|看剧|视频|阅读|漫画|小说|播放器|工具|代理|音乐|车载|云盘/i.test(`${title} ${desc}`);
      if (!isHighDemand) continue;

      candidateItems.push({
        source: 'zoo.ink',
        sourceCategory: '软件工具',
        title,
        url: cleanUrl(targetUrl),
        rawDescription: desc,
        icon,
        extraTags: tags
      });
    }
  }

  console.log(`[Extracted] Found total ${candidateItems.length} candidate items from both sources.`);

  // ==================== PART 3: Deduplicate & Clean ====================
  const newIngestedItems = [];
  const nowDate = new Date().toISOString().split('T')[0];

  let skippedDupUrl = 0;
  let skippedDupTitle = 0;

  for (const cand of candidateItems) {
    const cUrl = cand.url;
    const cTitleLower = cand.title.toLowerCase();

    let host = '';
    try { host = new URL(cUrl).hostname; } catch (e) {}

    if (existingUrlSet.has(cUrl) || (host && existingUrlSet.has(host))) {
      skippedDupUrl++;
      continue;
    }
    if (existingTitleSet.has(cTitleLower)) {
      skippedDupTitle++;
      continue;
    }

    existingUrlSet.add(cUrl);
    if (host) existingUrlSet.add(host);
    existingTitleSet.add(cTitleLower);

    const taxonomy = mapTaxonomy(cand.sourceCategory, cand.title, cand.rawDescription, cand.url);
    const finalDesc = synthesizeDescription(cand.title, cand.rawDescription, taxonomy, cand.source);
    const allTags = Array.from(new Set([...taxonomy.tags, ...(cand.extraTags || [])])).slice(0, 5);

    const slug = generateSlug(cand.url);
    const itemRecord = {
      id: `site-${slug}-${Math.random().toString(36).slice(2, 6)}`,
      title: cand.title,
      url: cand.url,
      description: finalDesc,
      icon: cand.icon || '/favicon.ico',
      category: taxonomy.category,
      subcategory: taxonomy.subcategory,
      tags: allTags,
      pricing: 'free',
      is_featured: false,
      created_at: nowDate
    };

    newIngestedItems.push(itemRecord);
  }

  console.log(`[Deduplication Summary]`);
  console.log(`• Skipped by URL/Domain collision: ${skippedDupUrl}`);
  console.log(`• Skipped by Title collision: ${skippedDupTitle}`);
  console.log(`• Final high-quality clean items to import: ${newIngestedItems.length}`);

  const subcatStats = {};
  for (const item of newIngestedItems) {
    subcatStats[item.subcategory] = (subcatStats[item.subcategory] || 0) + 1;
  }
  console.log(`• Subcategory breakdown:`, subcatStats);

  console.log('\n--- SAMPLE INGESTED ITEMS (Top 10) ---');
  newIngestedItems.slice(0, 10).forEach((it, idx) => {
    console.log(`${idx + 1}. [${it.title}] (${it.subcategory})`);
    console.log(`   URL: ${it.url}`);
    console.log(`   Desc: ${it.description}`);
    console.log(`   Tags: ${it.tags.join(', ')}`);
  });

  if (IS_WRITE) {
    const updatedWebsites = [...existingWebsites, ...newIngestedItems];
    fs.writeFileSync(WEBSITES_FILE, JSON.stringify(updatedWebsites, null, 2), 'utf-8');
    console.log(`\n[SUCCESS] Successfully written ${newIngestedItems.length} new items to ${WEBSITES_FILE}. Total: ${updatedWebsites.length}`);

    console.log('\n[Index Rebuild] Rebuilding local search indexes...');
    await buildNavIndex();
    console.log('[SUCCESS] Local search indexes rebuilt successfully.');
  } else {
    console.log('\n[NOTICE] Dry-run mode completed. Re-run with --write to commit changes to local datasets.');
  }
}

runImporter().catch(console.error);
