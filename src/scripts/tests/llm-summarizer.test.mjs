import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanSummary,
  buildUserPrompt,
  summarizeWithLLM
} from '../llm-summarizer.mjs';

test('cleanSummary trims quotes, prefixes and ensures closing punctuation', () => {
  assert.equal(
    cleanSummary('“核心特色：新一代全能大模型开发套件”'),
    '新一代全能大模型开发套件。'
  );
  assert.equal(
    cleanSummary('推荐理由: 极简极速的本地文档检索工具。'),
    '极简极速的本地文档检索工具。'
  );
  assert.equal(
    cleanSummary('`简单好用的网页转 Markdown 工具`'),
    '简单好用的网页转 Markdown 工具。'
  );
});

test('buildUserPrompt builds structured extraction prompt', () => {
  const prompt = buildUserPrompt({
    title: 'Linux DO',
    url: 'https://linux.do/',
    rawDescription: '新一代极客开源技术论坛',
    htmlSnippet: '欢迎来到 LINUX DO 社区'
  });

  assert.match(prompt, /Linux DO/);
  assert.match(prompt, /https:\/\/linux\.do\//);
  assert.match(prompt, /新一代极客开源技术论坛/);
  assert.match(prompt, /35-55 字/);
});

test('summarizeWithLLM gracefully degrades to fallback when no API keys are provided', async () => {
  // Clear env vars temporarily
  const origGemini = process.env.GEMINI_API_KEY;
  const origGoogle = process.env.GOOGLE_API_KEY;
  const origLlm = process.env.LLM_API_KEY;
  const origOllama = process.env.OLLAMA_HOST;

  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.OLLAMA_HOST;

  try {
    const res = await summarizeWithLLM({
      title: 'v0.dev',
      url: 'https://v0.dev',
      rawDescription: 'Vercel 出品的生成式 UI 交互平台'
    });

    assert.equal(res.provider, 'fallback');
    assert.equal(res.ok, false);
    assert.match(res.summary, /生成式 UI 交互平台/);
  } finally {
    if (origGemini) process.env.GEMINI_API_KEY = origGemini;
    if (origGoogle) process.env.GOOGLE_API_KEY = origGoogle;
    if (origLlm) process.env.LLM_API_KEY = origLlm;
    if (origOllama) process.env.OLLAMA_HOST = origOllama;
  }
});

test('cleanSummary supports allowEnglish option and preserves informative English descriptions', () => {
  // Without allowEnglish: pure English is rejected as LLM hallucination
  assert.equal(cleanSummary('Invidious is an alternative front-end to YouTube'), '');
  // With allowEnglish: valid English description is preserved and punctuated
  assert.equal(
    cleanSummary('Invidious is an alternative front-end to YouTube', true),
    'Invidious is an alternative front-end to YouTube。'
  );
});

test('buildUserPrompt includes GitHub metadata topics and language', () => {
  const prompt = buildUserPrompt({
    title: 'invidious',
    url: 'https://github.com/iv-org/invidious',
    category: 'github',
    language: 'Crystal',
    stars: 24561,
    topics: ['privacy', 'video', 'youtube'],
    rawDescription: 'Invidious is an alternative front-end to YouTube'
  });

  assert.match(prompt, /GitHub 开源项目/);
  assert.match(prompt, /编程语言：Crystal/);
  assert.match(prompt, /关注星标：★24561/);
  assert.match(prompt, /核心标签 \(Topics\)：privacy, video, youtube/);
  assert.match(prompt, /必须说明它是干什么用的、核心用途与解决痛点/);
});

test('summarizeWithLLM preserves English raw description when falling back without API keys', async () => {
  const origGemini = process.env.GEMINI_API_KEY;
  const origGoogle = process.env.GOOGLE_API_KEY;
  const origLlm = process.env.LLM_API_KEY;
  const origOllama = process.env.OLLAMA_HOST;

  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.OLLAMA_HOST;

  try {
    const res = await summarizeWithLLM({
      title: 'invidious',
      url: 'https://github.com/iv-org/invidious',
      rawDescription: 'Invidious is an alternative front-end to YouTube'
    });

    assert.equal(res.provider, 'fallback');
    assert.equal(res.ok, false);
    assert.match(res.summary, /alternative front-end to YouTube/);
    assert.ok(!res.summary.includes('官方平台与实用网络资源'));
  } finally {
    if (origGemini) process.env.GEMINI_API_KEY = origGemini;
    if (origGoogle) process.env.GOOGLE_API_KEY = origGoogle;
    if (origLlm) process.env.LLM_API_KEY = origLlm;
    if (origOllama) process.env.OLLAMA_HOST = origOllama;
  }
});

