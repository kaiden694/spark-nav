import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPinyinSearchText, extractTitlePinyinMeta, buildNavIndex } from '../build-nav-search-index.mjs';

test('extractPinyinSearchText - generates full pinyin, joined pinyin and initials', () => {
  const result = extractPinyinSearchText('破解软件');
  assert.ok(result.length > 0, 'Should return non-empty pinyin text');
  assert.ok(result.includes('po jie ruan jian'), 'Should include spaced pinyin');
  assert.ok(result.includes('pojieruanjian'), 'Should include joined pinyin');
  assert.ok(result.includes('pjrj'), 'Should include pinyin initials');
});

test('extractTitlePinyinMeta - extracts pure title initials and full pinyin', () => {
  const meta = extractTitlePinyinMeta('破解软件中文频道');
  assert.equal(meta.py_init, 'pjrjzwpd');
  assert.equal(meta.py_full, 'pojieruanjianzhongwenpindao');

  const meta2 = extractTitlePinyinMeta('Open WebUI 助手');
  assert.equal(meta2.py_init, 'zs');
  assert.equal(meta2.py_full, 'zhushou');

  const empty = extractTitlePinyinMeta('English Title Only');
  assert.equal(empty.py_init, '');
  assert.equal(empty.py_full, '');
});

test('extractPinyinSearchText - handles mixed English and Chinese strings', () => {
  const result = extractPinyinSearchText('开源 AI 助手');
  assert.ok(result.length > 0);
  assert.ok(result.includes('kai yuan'), 'Should convert Chinese characters');
  assert.ok(result.includes('zhu shou'), 'Should convert second Chinese word');
  assert.ok(result.includes('kyzs'), 'Should extract Chinese initials');
});

test('extractPinyinSearchText - gracefully handles non-Chinese or empty input', () => {
  assert.equal(extractPinyinSearchText(''), '');
  assert.equal(extractPinyinSearchText(null), '');
  assert.equal(extractPinyinSearchText(undefined), '');
  assert.equal(extractPinyinSearchText('Telegram Bot API 2026'), '');
  assert.equal(extractPinyinSearchText('1234567890'), '');
});

test('buildNavIndex - indexes entries with pinyin tokens and required fields', () => {
  const index = buildNavIndex();
  assert.ok(Array.isArray(index), 'Index should be an array');
  assert.ok(index.length > 0, 'Index should have items');

  const sample = index.find(item => item.title && /[\u4e00-\u9fa5]/.test(item.title));
  assert.ok(sample, 'Should find at least one Chinese item in index');
  assert.ok(sample.search_text, 'Item must have search_text field');
  assert.ok(sample.hasOwnProperty('is_alive'), 'Item must have is_alive property');
  assert.ok(typeof sample.is_alive === 'boolean', 'is_alive should be boolean');
  assert.ok(sample.hasOwnProperty('py_init'), 'Item must have py_init field');
  assert.ok(sample.hasOwnProperty('py_full'), 'Item must have py_full field');
  assert.ok(sample.hasOwnProperty('is_nsfw') || sample.item_type !== 'telegram', 'Telegram items must have is_nsfw');
});

test('highlightText - prevents DOM corruption and respects token length ordering', () => {
  function highlightText(text, queryTokens) {
    if (!text) return '';
    function escapeHtml(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    const safeText = escapeHtml(text);
    if (!queryTokens || !queryTokens.length) return safeText;

    const validTokens = queryTokens
      .filter(Boolean)
      .map(t => t.trim())
      .filter(t => t.length > 0);
    if (!validTokens.length) return safeText;

    const uniqueTokens = Array.from(new Set(validTokens)).sort((a, b) => b.length - a.length);
    const patternStr = uniqueTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    try {
      const reg = new RegExp('(' + patternStr + ')', 'gi');
      return safeText.replace(reg, '<span class="cmd-highlight">$1</span>');
    } catch (e) {
      return safeText;
    }
  }

  // Case 1: Search token containing 'span' or 'cmd' should NOT corrupt injected HTML
  const res1 = highlightText('This is a span element in cmd palette', ['span', 'cmd']);
  assert.equal(res1, 'This is a <span class="cmd-highlight">span</span> element in <span class="cmd-highlight">cmd</span> palette');
  // Must NOT produce nested corruptions like class="<span..."
  assert.ok(!res1.includes('class="<span'), 'Must not corrupt internal class attribute');

  // Case 2: Sub-token should not preemptively split longer token
  const res2 = highlightText('clash verge configuration', ['cla', 'clash']);
  assert.equal(res2, '<span class="cmd-highlight">clash</span> verge configuration');

  // Case 3: Special regex chars
  const res3 = highlightText('C++ & C# resources (v2.0)', ['C++', 'v2.0']);
  assert.equal(res3, '<span class="cmd-highlight">C++</span> &amp; C# resources (<span class="cmd-highlight">v2.0</span>)');
});

test('search scoring hierarchy - tags and pinyin provide stratified boost', () => {
  function scoreToken(item, token) {
    let score = 0;
    if (item.title_lower === token) {
      score += 100;
    } else if (item.title_lower.startsWith(token)) {
      score += 50;
    } else if (item.py_init && item.py_init === token) {
      score += 90;
    } else if (item.py_full && item.py_full === token) {
      score += 90;
    } else if (item.py_init && item.py_init.startsWith(token)) {
      score += 45;
    } else if (item.py_full && item.py_full.startsWith(token)) {
      score += 45;
    } else if (item.title_lower.indexOf(token) !== -1) {
      score += 25;
    } else if (item.py_init && item.py_init.indexOf(token) !== -1) {
      score += 20;
    } else if (item.py_full && item.py_full.indexOf(token) !== -1) {
      score += 20;
    } else if (item.tags_lower && item.tags_lower.indexOf(token) !== -1) {
      score += 35;
    } else if (item.url_lower && item.url_lower.indexOf(token) !== -1) {
      score += 25;
    } else {
      score += 8;
    }
    return score;
  }

  const item1 = {
    title_lower: '破解软件资源库',
    py_init: 'pjrjzyk',
    py_full: 'pojieruanjianziyuanku',
    tags_lower: ['apk', '工具'],
    url_lower: 'https://t.me/pjapk'
  };

  // 'pj' matches py_init prefix (+45)
  assert.equal(scoreToken(item1, 'pj'), 45);
  // 'apk' matches tag exactly (+35)
  assert.equal(scoreToken(item1, 'apk'), 35);
  // 'pjapk' matches url (+25)
  assert.equal(scoreToken(item1, 'pjapk'), 25);
  // Description fallback (+8)
  assert.equal(scoreToken(item1, 'nonexistent'), 8);
});

test('nav-search-index.json integrity - contains websites, github, telegram, creators', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const indexPath = path.join(process.cwd(), 'public', 'nav-search-index.json');
  assert.ok(fs.existsSync(indexPath), 'public/nav-search-index.json must exist');

  const content = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  assert.ok(Array.isArray(content), 'Nav search index must be an array');
  assert.ok(content.length >= 1000, `Nav search index should contain >= 1000 items, got ${content.length}`);

  // Test field integrity on nav items
  const navSample = content[0];
  assert.ok(navSample.id && navSample.id.length > 0, 'Nav items must have a non-empty ID');
  assert.ok(navSample.title, 'Nav items must have title');
  assert.ok(navSample.url, 'Nav items must have url');
  assert.ok(navSample.item_type, 'Nav items must specify item_type');
  assert.ok(navSample.hasOwnProperty('py_init'), 'Nav items must have py_init');
  assert.ok(navSample.hasOwnProperty('py_full'), 'Nav items must have py_full');

  // Verify pinyin presence on Chinese nav item
  const chineseNav = content.find(item => /[\u4e00-\u9fa5]/.test(item.title));
  assert.ok(chineseNav, 'Must contain Chinese navigation items');
  assert.ok(chineseNav.py_init && chineseNav.py_init.length > 0, 'Chinese nav must have py_init');
  assert.ok(chineseNav.py_full && chineseNav.py_full.length > 0, 'Chinese nav must have py_full');
});
