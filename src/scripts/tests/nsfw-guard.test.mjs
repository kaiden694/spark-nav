import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * NSFW 模式过滤与脱敏业务逻辑模拟
 * @param {Array} items
 * @param {'blur'|'show'|'hide'} mode
 * @param {string} [subcat]
 * @param {string} [query]
 */
export function filterNsfwItems(items, mode = 'blur', subcat = 'all', query = '') {
  const q = query.trim().toLowerCase();
  return items.filter(item => {
    const isNsfw = Boolean(item.is_nsfw || (item.tags && item.tags.includes('NSFW')) || item.subcategory === 'nsfw');
    
    // 如果是彻底隐藏模式，直接剔除所有 NSFW 项
    if (mode === 'hide' && isNsfw) {
      return false;
    }

    // 分类匹配
    const matchSub = (subcat === 'all' || item.subcategory === subcat);
    if (!matchSub) return false;

    // 关键词匹配
    if (q) {
      const text = `${item.title || ''} ${item.username || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
      if (!text.includes(q)) return false;
    }

    return true;
  });
}

/**
 * 敏感字段脱敏工具
 */
export function sanitizeNsfwDisplay(item, mode = 'blur') {
  const isNsfw = Boolean(item.is_nsfw || (item.tags && item.tags.includes('NSFW')) || item.subcategory === 'nsfw');
  if (!isNsfw || mode === 'show') {
    return {
      masked: false,
      title: item.title,
      description: item.description,
      badge: isNsfw ? '🔞 18+' : null
    };
  }

  // mode === 'blur'
  return {
    masked: true,
    title: item.title, // 保持标题便于检索，但卡片层应用 blur 滤镜
    description: '此内容已启用隐私防窥保护，点击卡片解锁查看...',
    badge: '🔞 18+'
  };
}

test('NSFW Guard - hide mode should completely eliminate NSFW items', () => {
  const sample = [
    { id: '1', title: 'Python 交流群', is_nsfw: false, subcategory: 'tech' },
    { id: '2', title: '成人写真社群', is_nsfw: true, subcategory: 'nsfw', tags: ['NSFW'] },
    { id: '3', title: 'Telegram 官方中文', is_nsfw: false, subcategory: 'official' }
  ];

  const resultHide = filterNsfwItems(sample, 'hide', 'all');
  assert.equal(resultHide.length, 2);
  assert.equal(resultHide.some(x => x.is_nsfw), false);

  const resultShow = filterNsfwItems(sample, 'show', 'all');
  assert.equal(resultShow.length, 3);

  const resultBlur = filterNsfwItems(sample, 'blur', 'all');
  assert.equal(resultBlur.length, 3);
});

test('NSFW Guard - subcategory matching under different modes', () => {
  const sample = [
    { id: '1', title: 'Python 交流群', is_nsfw: false, subcategory: 'tech' },
    { id: '2', title: '成人写真社群', is_nsfw: true, subcategory: 'nsfw', tags: ['NSFW'] }
  ];

  // 在 hide 模式下请求 nsfw 分类，应返回空数组
  const resHideNsfw = filterNsfwItems(sample, 'hide', 'nsfw');
  assert.equal(resHideNsfw.length, 0);

  // 在 blur 模式下请求 nsfw 分类，返回该条目
  const resBlurNsfw = filterNsfwItems(sample, 'blur', 'nsfw');
  assert.equal(resBlurNsfw.length, 1);
  assert.equal(resBlurNsfw[0].id, '2');
});

test('NSFW Guard - sanitize display text in blur vs show mode', () => {
  const item = {
    id: '2',
    title: '成人写真社群',
    description: '极高品质每日更新写真图集',
    is_nsfw: true,
    tags: ['NSFW', '18+']
  };

  const blurDisplay = sanitizeNsfwDisplay(item, 'blur');
  assert.equal(blurDisplay.masked, true);
  assert.equal(blurDisplay.badge, '🔞 18+');
  assert.match(blurDisplay.description, /隐私防窥保护/);

  const showDisplay = sanitizeNsfwDisplay(item, 'show');
  assert.equal(showDisplay.masked, false);
  assert.equal(showDisplay.description, '极高品质每日更新写真图集');
});
