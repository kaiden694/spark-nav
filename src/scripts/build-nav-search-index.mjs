import fs from 'node:fs';
import path from 'node:path';
import tinyPinyinModule from 'tiny-pinyin';

const pinyinObj = tinyPinyinModule && (tinyPinyinModule.default || tinyPinyinModule);

export function extractPinyinSearchText(text) {
  if (!text || typeof text !== 'string') return '';
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
  if (!chineseChars || !chineseChars.length) return '';
  if (!pinyinObj || typeof pinyinObj.convertToPinyin !== 'function') return '';
  try {
    const pinyinSpaced = pinyinObj.convertToPinyin(chineseChars.join(''), ' ', true).toLowerCase();
    const words = pinyinSpaced.split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    const joined = words.join('');
    const initials = words.map(w => w[0]).join('');
    return `${pinyinSpaced} ${joined} ${initials}`.trim();
  } catch (e) {
    return '';
  }
}

export function extractTitlePinyinMeta(title) {
  if (!title || typeof title !== 'string') return { py_init: '', py_full: '' };
  const chineseChars = title.match(/[\u4e00-\u9fa5]/g);
  if (!chineseChars || !chineseChars.length) return { py_init: '', py_full: '' };
  if (!pinyinObj || typeof pinyinObj.convertToPinyin !== 'function') return { py_init: '', py_full: '' };
  try {
    const pinyinSpaced = pinyinObj.convertToPinyin(chineseChars.join(''), ' ', true).toLowerCase();
    const words = pinyinSpaced.split(/\s+/).filter(Boolean);
    if (!words.length) return { py_init: '', py_full: '' };
    return {
      py_init: words.map(w => w[0]).join(''),
      py_full: words.join('')
    };
  } catch (e) {
    return { py_init: '', py_full: '' };
  }
}

const root = process.cwd();
const navDataDir = path.join(root, 'src', 'data', 'nav');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

function formatStat(item) {
  if (item.stars) {
    const s = item.stars;
    return '⭐ ' + (s >= 1000 ? (s / 1000).toFixed(1) + 'K' : s);
  }
  if (item.member_count) {
    const m = item.member_count;
    return '👥 ' + (m >= 1000 ? (m / 1000).toFixed(1) + 'K' : m);
  }
  if (item.followers_count) {
    const f = item.followers_count;
    return '🔥 ' + (f >= 1000 ? (f / 1000).toFixed(1) + 'K' : f);
  }
  return '';
}

export function buildNavIndex() {
  console.log('================ GENERATING NAV SEARCH INDEX ================');
  const index = [];

  // 1. Websites
  const webPath = path.join(navDataDir, 'websites.json');
  if (fs.existsSync(webPath)) {
    const webs = JSON.parse(fs.readFileSync(webPath, 'utf-8'));
    for (const w of webs) {
      const titlePy = extractTitlePinyinMeta(w.title);
      index.push({
        id: w.id,
        title: w.title,
        description: w.description || '',
        url: w.url,
        item_type: 'website',
        category: w.category || 'tools',
        subcategory: w.subcategory || '',
        tags: w.tags || [],
        icon: w.icon || '',
        stat: formatStat(w),
        py_init: titlePy.py_init,
        py_full: titlePy.py_full,
        is_alive: w.is_alive !== false,
        mirror_urls: w.mirror_urls || [],
        feed_url: w.feed_url || '',
        search_text: `${w.title} ${w.description || ''} ${(w.tags || []).join(' ')} ${w.url} ${extractPinyinSearchText(`${w.title} ${(w.tags || []).join(' ')}`)}`.toLowerCase().trim()
      });
    }
    console.log(`[Indexed Websites] ${webs.length} items`);
  }

  // 2. GitHub
  const ghPath = path.join(navDataDir, 'github.json');
  if (fs.existsSync(ghPath)) {
    const ghs = JSON.parse(fs.readFileSync(ghPath, 'utf-8'));
    for (const g of ghs) {
      const titlePy = extractTitlePinyinMeta(g.title);
      index.push({
        id: g.id,
        title: g.title,
        description: g.description || '',
        url: g.url,
        item_type: 'github',
        category: 'github',
        subcategory: g.subcategory || '',
        tags: g.tags || [],
        language: g.language || '',
        icon: g.avatar_url || (g.owner ? `https://github.com/${g.owner}.png?size=96` : ''),
        stat: formatStat(g),
        py_init: titlePy.py_init,
        py_full: titlePy.py_full,
        is_alive: g.is_alive !== false,
        mirror_urls: g.mirror_urls || [],
        feed_url: g.feed_url || (g.repo ? `https://github.com/${g.repo}/releases.atom` : ''),
        search_text: `${g.title} ${g.repo || ''} ${g.description || ''} ${(g.tags || []).join(' ')} ${g.language || ''} ${extractPinyinSearchText(`${g.title} ${(g.tags || []).join(' ')}`)}`.toLowerCase().trim()
      });
    }
    console.log(`[Indexed GitHub] ${ghs.length} items`);
  }

  // 3. Telegram
  const tgPath = path.join(navDataDir, 'telegram.json');
  if (fs.existsSync(tgPath)) {
    const tgs = JSON.parse(fs.readFileSync(tgPath, 'utf-8'));
    for (const t of tgs) {
      const titlePy = extractTitlePinyinMeta(t.title || t.username);
      index.push({
        id: t.id,
        title: t.title || t.username,
        description: t.description || '',
        url: t.url,
        item_type: 'telegram',
        tg_type: t.type || 'channel',
        category: 'telegram',
        subcategory: t.subcategory || '',
        tags: t.tags || [],
        icon: t.avatar_url || '',
        stat: formatStat(t),
        py_init: titlePy.py_init,
        py_full: titlePy.py_full,
        is_nsfw: Boolean(t.is_nsfw || t.subcategory === 'nsfw'),
        is_alive: t.is_alive !== false,
        mirror_urls: t.mirror_urls || [],
        feed_url: t.feed_url || '',
        search_text: `${t.title} ${t.username} ${t.description || ''} ${(t.tags || []).join(' ')} ${t.type || ''} ${extractPinyinSearchText(`${t.title || ''} ${(t.tags || []).join(' ')}`)}`.toLowerCase().trim()
      });
    }
    console.log(`[Indexed Telegram] ${tgs.length} items`);
  }

  // 4. Creators
  const crPath = path.join(navDataDir, 'creators.json');
  if (fs.existsSync(crPath)) {
    const crs = JSON.parse(fs.readFileSync(crPath, 'utf-8'));
    for (const c of crs) {
      const titlePy = extractTitlePinyinMeta(c.title || c.screen_name);
      index.push({
        id: c.id,
        title: c.title || c.screen_name,
        description: c.description || '',
        url: c.url,
        item_type: 'creator',
        platform: c.platform || 'x',
        category: 'creators',
        subcategory: c.subcategory || '',
        tags: c.tags || [],
        icon: c.avatar_url || '',
        stat: formatStat(c),
        py_init: titlePy.py_init,
        py_full: titlePy.py_full,
        is_alive: c.is_alive !== false,
        feed_url: c.feed_url || '',
        mirror_urls: c.mirror_urls || [],
        search_text: `${c.title} ${c.screen_name || ''} ${c.description || ''} ${(c.tags || []).join(' ')} ${extractPinyinSearchText(`${c.title || ''} ${(c.tags || []).join(' ')}`)}`.toLowerCase().trim()
      });
    }
    console.log(`[Indexed Creators] ${crs.length} items`);
  }

  const jsonStr = JSON.stringify(index);

  if (fs.existsSync(publicDir)) {
    const pubTarget = path.join(publicDir, 'nav-search-index.json');
    fs.writeFileSync(pubTarget, jsonStr, 'utf-8');
    console.log(`[SYNCED] ${pubTarget} (${jsonStr.length} bytes, ${index.length} items)`);
  }

  if (fs.existsSync(distDir)) {
    const distTarget = path.join(distDir, 'nav-search-index.json');
    fs.writeFileSync(distTarget, jsonStr, 'utf-8');
    console.log(`[SYNCED] ${distTarget}`);
  }

  console.log(`[SUCCESS] Total ${index.length} nav items indexed.\n`);
  return index;
}

if (process.argv[1] && process.argv[1].endsWith('build-nav-search-index.mjs')) {
  buildNavIndex();
}
