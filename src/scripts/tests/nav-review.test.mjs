import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectUrlType } from '../nav-review.mjs';

test('detectUrlType recognizes GitHub repository URLs', () => {
  const meta = detectUrlType('https://github.com/astral-sh/uv');
  assert.equal(meta.type, 'github');
  assert.equal(meta.owner, 'astral-sh');
  assert.equal(meta.repo, 'astral-sh/uv');
});

test('detectUrlType recognizes Telegram channel and bot URLs', () => {
  const meta1 = detectUrlType('https://t.me/huarunying');
  assert.equal(meta1.type, 'telegram');
  assert.equal(meta1.username, 'huarunying');

  const meta2 = detectUrlType('https://t.me/xiunav_bot');
  assert.equal(meta2.type, 'telegram');
  assert.equal(meta2.username, 'xiunav_bot');
});

test('detectUrlType recognizes general website URLs', () => {
  const meta = detectUrlType('https://openwebui.com');
  assert.equal(meta.type, 'website');
});

test('inferSubcategory infers correct subcategories across all main categories', async () => {
  const { inferSubcategory } = await import('../nav-review.mjs');

  // Tools
  assert.equal(inferSubcategory('tools', { title: 'Dify AI Agent', description: '智能大模型编排' }), 'ai');
  assert.equal(inferSubcategory('tools', { title: 'Docker Dashboard', description: 'Linux 容器运维平台' }), 'dev');
  assert.equal(inferSubcategory('tools', { title: 'VideoDownloader', description: '高清影视视频下载' }), 'media');
  assert.equal(inferSubcategory('tools', { title: 'Notion Helper', description: '日程管理笔记' }), 'efficiency');

  // GitHub
  assert.equal(inferSubcategory('github', { title: 'Mihomo Party', description: '基于 Clash 内核的代理客户端' }), 'proxy-clients');
  assert.equal(inferSubcategory('github', { title: 'Ollama Web', description: '本地 LLM 大模型交互' }), 'ai-models');
  assert.equal(inferSubcategory('github', { title: 'ripgrep', description: 'Fast line-oriented search tool' }), 'devtools');

  // Telegram
  assert.equal(inferSubcategory('telegram', { title: 'Group Guard Bot', description: '群管验证机器人' }), 'management');
  assert.equal(inferSubcategory('telegram', { title: 'Movie Stream', description: '高清电影资源解析' }), 'media');
  assert.equal(inferSubcategory('telegram', { title: 'Dev Geek', description: '极客编程交流社群' }), 'ai-dev');
  assert.equal(inferSubcategory('telegram', { title: 'FinNews', description: '全球金融快讯行情' }), 'news');
  assert.equal(inferSubcategory('telegram', { title: 'VPS Share', description: '海外主机网络节点交流' }), 'network');

  // Creators
  assert.equal(inferSubcategory('creators', { title: 'AI Pioneer', description: '大模型算法研究' }), 'tech');
  assert.equal(inferSubcategory('creators', { title: 'Fullstack Dev', description: '独立全栈开发者' }), 'dev');

  // Featured
  assert.equal(inferSubcategory('featured', { title: 'LINUX DO', description: '极客开源技术论坛与社区' }), 'community');
});

test('cacheFaviconLocally returns local paths immediately without network request', async () => {
  const { cacheFaviconLocally } = await import('../nav-review.mjs');
  const local = await cacheFaviconLocally('/assets/images/nav/avatars/site-local.png', 'site-local');
  assert.equal(local, '/assets/images/nav/avatars/site-local.png');

  const fallback = await cacheFaviconLocally(null, 'empty');
  assert.equal(fallback, '/favicon.ico');
});

test('github.json dataset integrity - all repos must contain valid stars, forks, subcategory and tags', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ghPath = path.resolve(__dirname, '../../data/nav/github.json');
  const repos = JSON.parse(fs.readFileSync(ghPath, 'utf-8'));

  assert.ok(Array.isArray(repos) && repos.length >= 20, 'github.json must contain at least 20 repositories');
  for (const r of repos) {
    assert.ok(r.id && r.id.startsWith('gh-'), `Repo ${r.repo} must have valid gh- ID`);
    assert.ok(r.repo && r.repo.includes('/'), `Repo ${r.repo} must have owner/name`);
    assert.ok(r.url && r.url.startsWith('https://github.com/'), `Repo ${r.repo} must have valid URL`);
    assert.equal(typeof r.stars, 'number', `Repo ${r.repo} stars must be number`);
    assert.ok(r.stars >= 0, `Repo ${r.repo} stars must be non-negative`);
    assert.equal(typeof r.forks, 'number', `Repo ${r.repo} forks must be number`);
    assert.ok(r.forks >= 0, `Repo ${r.repo} forks must be non-negative`);
    assert.equal(r.category, 'github', `Repo ${r.repo} category must be github`);
    assert.ok(['proxy-clients', 'ai-models', 'devtools'].includes(r.subcategory), `Repo ${r.repo} subcategory must be standard`);
    assert.ok(Array.isArray(r.tags) && r.tags.length > 0, `Repo ${r.repo} must have tags`);
  }
});
