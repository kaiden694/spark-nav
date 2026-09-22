import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSubmission,
  parseReport,
  fetchAndSummarizeMetadata,
  ADMIN_CHAT_ID
} from '../telegram-bot-daemon.mjs';
import {
  normalizeCategory
} from '../nav-review.mjs';

test('parseSubmission parses standard multi-line submission format', () => {
  const text = `【站点收录申请】
• 站点名称：Open WebUI
• 访问地址：https://openwebui.com
• 建议分类：实用工具
• 推荐理由：强大的离线大模型交互 UI
• 申请联系：@dev_lead`;

  const parsed = parseSubmission(text);
  assert.equal(parsed.title, 'Open WebUI');
  assert.equal(parsed.url, 'https://openwebui.com');
  assert.equal(parsed.category, '实用工具');
  assert.equal(parsed.desc, '强大的离线大模型交互 UI');
  assert.equal(parsed.contact, '@dev_lead');
});

test('parseSubmission handles single-line /submit command', () => {
  const text = '/submit https://github.com/chen08209/FlClash FlClash代理客户端';
  const parsed = parseSubmission(text);
  assert.equal(parsed.url, 'https://github.com/chen08209/FlClash');
  assert.equal(parsed.title, 'FlClash代理客户端');
});

test('parseReport parses standard multi-line report format', () => {
  const text = `【站点失效/纠错反馈】
• 目标站点：https://broken-test-target.org
• 异常类型：无法访问 / 死链
• 详细说明：域名已过期解析失败`;

  const parsed = parseReport(text);
  assert.equal(parsed.target, 'https://broken-test-target.org');
  assert.equal(parsed.issueType, '无法访问 / 死链');
  assert.equal(parsed.details, '域名已过期解析失败');
});

test('normalizeCategory correctly aligns category names to navigation taxonomy', () => {
  // Direct label/keyword matching
  assert.equal(normalizeCategory('常用精选').label, '🌟 常用精选');
  assert.equal(normalizeCategory('featured').id, 'featured');
  assert.equal(normalizeCategory('实用工具').label, '🛠️ 实用工具');
  assert.equal(normalizeCategory('tools').id, 'tools');
  assert.equal(normalizeCategory('开源矩阵').label, '💻 开源矩阵');
  assert.equal(normalizeCategory('github').id, 'github');
  assert.equal(normalizeCategory('电报生态').label, '✈️ 电报生态');
  assert.equal(normalizeCategory('telegram').id, 'telegram');
  assert.equal(normalizeCategory('优质博主').label, '👤 优质博主');
  assert.equal(normalizeCategory('creators').id, 'creators');

  // Automatic domain heuristic mapping
  assert.equal(normalizeCategory('', 'https://github.com/astral-sh/uv').label, '💻 开源矩阵');
  assert.equal(normalizeCategory('', 'https://t.me/xiunav_channel').label, '✈️ 电报生态');
  assert.equal(normalizeCategory('', 'https://x.com/karpathy').label, '👤 优质博主');
  assert.equal(normalizeCategory('', 'https://unknown-tool.io').label, '🛠️ 实用工具');
});

test('fetchAndSummarizeMetadata extracts known heuristic profile for anti-crawler domains', async () => {
  const meta = await fetchAndSummarizeMetadata('https://linux.do/');
  assert.equal(meta.title, 'LINUX DO');
  assert.equal(meta.categoryKey, 'featured');
  assert.match(meta.description, /极客|开源|技术|社区|Linux/);
  assert.match(meta.icon, /linux\.do/);
});

test('fetchAndSummarizeMetadata correctly detects github repository category and details', async () => {
  const meta = await fetchAndSummarizeMetadata('https://github.com/chen08209/FlClash');
  assert.equal(meta.categoryKey, 'github');
  assert.match(meta.title, /FlClash/i);
  assert.ok(meta.description.length > 0);
  assert.ok(meta.subcategory, 'GitHub repo should have inferred subcategory');
  assert.ok(Array.isArray(meta.tags) && meta.tags.length > 0, 'GitHub repo should have expanded tags');
  assert.equal(typeof meta.forks, 'number', 'GitHub repo should return forks as number');
});

test('fetchAndSummarizeMetadata handles telegram channel domain detection', async () => {
  const meta = await fetchAndSummarizeMetadata('https://t.me/s/durov');
  assert.equal(meta.categoryKey, 'telegram');
  assert.ok(meta.title.length > 0);
  assert.ok(meta.description.length > 0);
});

test('fetchAndSummarizeMetadata gracefully degrades on network or protocol error', async () => {
  const meta = await fetchAndSummarizeMetadata('http://invalid-subdomain-that-does-not-exist-at-all-12345.xyz');
  assert.equal(meta.probe.ok, false);
  assert.ok(meta.title.length > 0);
  assert.ok(meta.description.length > 0);
});

test('ADMIN_CHAT_ID is initialized with valid admin identifier', () => {
  assert.ok(ADMIN_CHAT_ID, 'ADMIN_CHAT_ID must be defined');
  assert.equal(typeof ADMIN_CHAT_ID, 'string');
  assert.ok(ADMIN_CHAT_ID.length > 0);
});

test('callback query action prefix parsing rules', () => {
  const testSubData = 'app:sub_123456';
  assert.equal(testSubData.startsWith('app:'), true);
  assert.equal(testSubData.slice(4), 'sub_123456');

  const testRejData = 'rej:sub_123456';
  assert.equal(testRejData.startsWith('rej:'), true);
  assert.equal(testRejData.slice(4), 'sub_123456');

  const testRepOk = 'rep_ok:rep_7890';
  assert.equal(testRepOk.startsWith('rep_ok:'), true);
  assert.equal(testRepOk.slice(7), 'rep_7890');

  const testRepIgn = 'rep_ign:rep_7890';
  assert.equal(testRepIgn.startsWith('rep_ign:'), true);
  assert.equal(testRepIgn.slice(8), 'rep_7890');

  const testChgCat = 'chg_cat:sub_123';
  assert.equal(testChgCat.startsWith('chg_cat:'), true);
  assert.equal(testChgCat.slice(8), 'sub_123');

  const testBackCat = 'back_cat:sub_123';
  assert.equal(testBackCat.startsWith('back_cat:'), true);
  assert.equal(testBackCat.slice(9), 'sub_123');

  const testSetCat = 'set_cat:sub_123:tools';
  assert.equal(testSetCat.startsWith('set_cat:'), true);
  const parts = testSetCat.split(':');
  assert.equal(parts[1], 'sub_123');
  assert.equal(parts[2], 'tools');
});

test('getAdminSubmissionKeyboard returns valid 2-row inline keyboard', async () => {
  const { getAdminSubmissionKeyboard } = await import('../telegram-bot-daemon.mjs');
  const kb = getAdminSubmissionKeyboard('sub_test123');
  assert.ok(kb.inline_keyboard);
  assert.equal(kb.inline_keyboard.length, 2);
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'app:sub_test123');
  assert.equal(kb.inline_keyboard[0][1].callback_data, 'rej:sub_test123');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'reroll:sub_test123');
  assert.equal(kb.inline_keyboard[1][1].callback_data, 'chg_cat:sub_test123');
});

test('getCategorySelectionKeyboard provides 5 categories and back button', async () => {
  const { getCategorySelectionKeyboard } = await import('../telegram-bot-daemon.mjs');
  const kb = getCategorySelectionKeyboard('sub_test123');
  assert.ok(kb.inline_keyboard);
  assert.equal(kb.inline_keyboard.length, 4);

  // Flatten callbacks
  const allCallbacks = kb.inline_keyboard.flat().map(b => b.callback_data);
  assert.ok(allCallbacks.includes('set_cat:sub_test123:featured'));
  assert.ok(allCallbacks.includes('set_cat:sub_test123:tools'));
  assert.ok(allCallbacks.includes('set_cat:sub_test123:github'));
  assert.ok(allCallbacks.includes('set_cat:sub_test123:telegram'));
  assert.ok(allCallbacks.includes('set_cat:sub_test123:creators'));
  assert.ok(allCallbacks.includes('back_cat:sub_test123'));
});

test('ai-overrides.json exists and preserves pjapk refined fields', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const overridesPath = path.resolve(process.cwd(), 'src/data/nav/ai-overrides.json');
  assert.ok(fs.existsSync(overridesPath), 'ai-overrides.json must exist');

  const content = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'));
  assert.ok(content.pjapk, 'pjapk must be in ai-overrides.json');
  assert.equal(content.pjapk.subcategory, 'tools');
  assert.equal(content.pjapk.is_nsfw, false);
  assert.ok(content.pjapk.description.includes('破解'));
  assert.ok(Array.isArray(content.pjapk.tags));
});

test('normalizeSubcategoryInput normalizes fuzzy category keywords and canonical codes', async () => {
  const { normalizeSubcategoryInput } = await import('../telegram-bot-daemon.mjs');
  assert.equal(normalizeSubcategoryInput('tools'), 'tools');
  assert.equal(normalizeSubcategoryInput('实用软件'), 'tools');
  assert.equal(normalizeSubcategoryInput('代码开发'), 'dev');
  assert.equal(normalizeSubcategoryInput('vpn代理'), 'network');
  assert.equal(normalizeSubcategoryInput('影视大全'), 'media');
  assert.equal(normalizeSubcategoryInput('新闻动态'), 'news');
  assert.equal(normalizeSubcategoryInput('综合讨论'), 'community');
  assert.equal(normalizeSubcategoryInput('成人18+'), 'nsfw');
  assert.equal(normalizeSubcategoryInput('invalid_random_category'), null);
});

test('reclassifyTelegramResource safely validates input and rejects non-existent targets', async () => {
  const { reclassifyTelegramResource } = await import('../telegram-bot-daemon.mjs');
  const emptyRes = reclassifyTelegramResource('', 'tools');
  assert.equal(emptyRes.success, false);

  const invalidCat = reclassifyTelegramResource('pjapk', 'non_existent_category');
  assert.equal(invalidCat.success, false);

  const notFound = reclassifyTelegramResource('this_channel_should_definitely_not_exist_999999', 'tools');
  assert.equal(notFound.success, false);
});

