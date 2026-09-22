import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VALID_TG_SUBCATEGORIES,
  buildClassifyUserPrompt,
  parseAndValidateClassificationJson,
  createFallbackClassification,
  classifyAndSummarizeWithLLM
} from '../llm-summarizer.mjs';

test('VALID_TG_SUBCATEGORIES defines the exact 8 allowed taxonomy keys', () => {
  assert.deepEqual(VALID_TG_SUBCATEGORIES, [
    'tools',
    'dev',
    'news',
    'network',
    'media',
    'finance',
    'community',
    'nsfw'
  ]);
});

test('buildClassifyUserPrompt builds comprehensive prompt with channel/group/bot metadata', () => {
  const channelPrompt = buildClassifyUserPrompt({
    title: '破解软件资源库',
    username: 'pjapk',
    rawDescription: '专注搜集实用安卓破解软件与老司机玩机工具。',
    type: 'channel',
    currentCategory: '实用工具',
    currentSubcategory: 'tools'
  });

  assert.match(channelPrompt, /pjapk/);
  assert.match(channelPrompt, /频道 \(Channel\)/);
  assert.match(channelPrompt, /破解软件资源库/);
  assert.match(channelPrompt, /纯 JSON 对象/);

  const botPrompt = buildClassifyUserPrompt({
    title: '智能搜券Bot',
    username: 'coupon_bot',
    rawDescription: '全自动优惠券查询机器人。',
    type: 'bot'
  });
  assert.match(botPrompt, /机器人 \(Bot\)/);
});

test('parseAndValidateClassificationJson parses clean JSON payload correctly', () => {
  const jsonStr = JSON.stringify({
    subcategory: 'tools',
    is_nsfw: false,
    summary: '精选实用安卓破解软件、Mod APK 与极客玩机工具聚合平台。',
    tags: ['实用软件', '安卓破解', '极客工具']
  });

  const res = parseAndValidateClassificationJson(jsonStr);
  assert.equal(res.subcategory, 'tools');
  assert.equal(res.is_nsfw, false);
  assert.equal(res.summary, '精选实用安卓破解软件、Mod APK 与极客玩机工具聚合平台。');
  assert.deepEqual(res.tags, ['实用软件', '安卓破解', '极客工具']);
});

test('parseAndValidateClassificationJson strips Markdown codeblock fences', () => {
  const rawWithFences = `\`\`\`json
{
  "subcategory": "dev",
  "is_nsfw": false,
  "summary": "开源技术与全栈系统架构深度研讨社区。",
  "tags": ["编程开发", "极客技术"]
}
\`\`\``;

  const res = parseAndValidateClassificationJson(rawWithFences);
  assert.equal(res.subcategory, 'dev');
  assert.equal(res.is_nsfw, false);
  assert.equal(res.summary, '开源技术与全栈系统架构深度研讨社区。');
  assert.deepEqual(res.tags, ['编程开发', '极客技术']);
});

test('parseAndValidateClassificationJson extracts JSON from surrounding conversational text', () => {
  const rawWithChatter = `经过仔细分析，该频道的分类判定结果如下所示：
{
  "subcategory": "network",
  "is_nsfw": false,
  "summary": "优质 VPS 测评、网络代理客户端配置与线路监控分享平台。",
  "tags": ["节点网络", "主机网络"]
}
希望这个分类对技术导航站有所帮助！`;

  const res = parseAndValidateClassificationJson(rawWithChatter);
  assert.equal(res.subcategory, 'network');
  assert.equal(res.is_nsfw, false);
  assert.match(res.summary, /优质 VPS 测评/);
});

test('parseAndValidateClassificationJson normalizes synonym subcategories', () => {
  const rawSynonyms = [
    { in: 'tool', expected: 'tools' },
    { in: 'code', expected: 'dev' },
    { in: 'vpn', expected: 'network' },
    { in: 'anime', expected: 'media' },
    { in: 'crypto', expected: 'finance' },
    { in: 'porn', expected: 'nsfw' }
  ];

  for (const item of rawSynonyms) {
    const raw = JSON.stringify({
      subcategory: item.in,
      is_nsfw: item.in === 'porn',
      summary: '测试标准化分类映射能力。',
      tags: ['测试']
    });
    const res = parseAndValidateClassificationJson(raw);
    assert.equal(res.subcategory, item.expected);
  }
});

test('parseAndValidateClassificationJson strictly defends software tools against false NSFW', () => {
  // Scenario: An LLM erroneously marked pjapk as NSFW due to colloquial phrase "福利软件"
  const falsePositiveJson = JSON.stringify({
    subcategory: 'nsfw',
    is_nsfw: true,
    summary: '收集全网老司机福利软件、安卓破解 APK 与玩机工具。',
    tags: ['福利软件', '安卓破解']
  });

  const fallbackContext = {
    title: '破解软件资源库',
    username: 'pjapk',
    rawDescription: '专注搜集实用安卓破解软件与老司机玩机工具，去广告纯净版。'
  };

  const res = parseAndValidateClassificationJson(falsePositiveJson, fallbackContext);
  assert.equal(res.subcategory, 'tools');
  assert.equal(res.is_nsfw, false);
});

test('parseAndValidateClassificationJson correctly identifies actual adult content', () => {
  const adultJson = JSON.stringify({
    subcategory: 'nsfw',
    is_nsfw: true,
    summary: '汇聚海量成人情色影视、无码写真与深夜视觉艺术资源。',
    tags: ['成人内容', 'NSFW', '18+']
  });

  const fallbackContext = {
    title: '深夜福利情色社',
    rawDescription: '精选 AV 影视、情色无码写真与本子资源。'
  };

  const res = parseAndValidateClassificationJson(adultJson, fallbackContext);
  assert.equal(res.subcategory, 'nsfw');
  assert.equal(res.is_nsfw, true);
});

test('parseAndValidateClassificationJson falls back safely on malformed JSON', () => {
  const malformed = `[Invalid JSON string here...`;
  const fallbackContext = {
    title: '在花科技圈',
    username: 'zaihuapd',
    rawDescription: '探讨前沿互联网与开源科技动态。群规：禁止黄赌毒与NSFW内容。',
    type: 'group',
    currentSubcategory: 'dev'
  };

  const res = parseAndValidateClassificationJson(malformed, fallbackContext);
  assert.equal(res.subcategory, 'dev');
  assert.equal(res.is_nsfw, false);
  assert.match(res.summary, /探讨前沿互联网与开源科技动态/);
});

test('classifyAndSummarizeWithLLM gracefully degrades to fallback when no API keys are provided', async () => {
  const origGemini = process.env.GEMINI_API_KEY;
  const origGoogle = process.env.GOOGLE_API_KEY;
  const origLlm = process.env.LLM_API_KEY;
  const origOllama = process.env.OLLAMA_HOST;

  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.OLLAMA_HOST;

  try {
    const res = await classifyAndSummarizeWithLLM({
      title: '破解软件资源库',
      username: 'pjapk',
      rawDescription: '专注搜集实用安卓破解软件与老司机玩机工具。',
      type: 'channel',
      currentCategory: '实用软件'
    });

    assert.equal(res.provider, 'fallback');
    assert.equal(res.ok, false);
    assert.equal(res.subcategory, 'tools');
    assert.equal(res.is_nsfw, false);
    assert.match(res.summary, /破解软件/);
  } finally {
    if (origGemini) process.env.GEMINI_API_KEY = origGemini;
    if (origGoogle) process.env.GOOGLE_API_KEY = origGoogle;
    if (origLlm) process.env.LLM_API_KEY = origLlm;
    if (origOllama) process.env.OLLAMA_HOST = origOllama;
  }
});

test('parseAndValidateClassificationJson handles multilingual descriptions and dual-language tags', () => {
  const multilingualJson = JSON.stringify({
    subcategory: 'news',
    is_nsfw: false,
    summary: 'Telegram 官方新闻发布频道，第一时间获取产品重大功能更新与官方技术公告。',
    tags: ['Telegram官方', 'Official', 'News']
  });

  const fallbackContext = {
    title: 'Telegram News',
    username: 'telegram',
    rawDescription: 'Official Telegram news and major updates for all platforms.'
  };

  const res = parseAndValidateClassificationJson(multilingualJson, fallbackContext);
  assert.equal(res.subcategory, 'news');
  assert.equal(res.is_nsfw, false);
  assert.match(res.summary, /Telegram 官方新闻发布频道/);
  assert.deepEqual(res.tags, ['Telegram官方', 'Official', 'News']);
});

test('parseAndValidateClassificationJson accepts technical English tags up to 20 chars', () => {
  const technicalJson = JSON.stringify({
    subcategory: 'tools',
    is_nsfw: false,
    summary: '高可用 Telegram Bot API 交互开发工具箱与微服务接口封装库。',
    tags: ['Bot-Developer', 'Microservices', 'API-Tools']
  });

  const res = parseAndValidateClassificationJson(technicalJson);
  assert.equal(res.subcategory, 'tools');
  assert.equal(res.is_nsfw, false);
  assert.deepEqual(res.tags, ['Bot-Developer', 'Microservices', 'API-Tools']);
});

