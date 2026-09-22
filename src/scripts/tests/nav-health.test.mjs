import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoHealResource, runConcurrentPool, probeWebsite, probeGithubRepo } from '../audit-nav-health.mjs';

test('autoHealResource returns false when mirror is not alive or missing', () => {
  const item = { id: 'test-1', url: 'https://example.com', mirror_urls: ['https://mirror.com'] };
  assert.equal(autoHealResource(item, null), false);
  assert.equal(autoHealResource(item, { mirrorAlive: false }), false);
  assert.equal(autoHealResource(item, { mirrorAlive: true, activeMirror: null }), false);
  assert.equal(autoHealResource(item, { mirrorAlive: true, activeMirror: 'https://example.com' }), false);
});

test('autoHealResource successfully promotes active mirror and demotes dead primary', () => {
  const item = {
    id: 'site-test',
    title: 'Test Service',
    url: 'https://primary.example.com',
    mirror_urls: ['https://mirror1.example.com', 'https://mirror2.example.com'],
    is_alive: false
  };

  const probeRes = {
    alive: false,
    mirrorAlive: true,
    activeMirror: 'https://mirror1.example.com',
    reason: 'PRIMARY_FAIL (404) | MIRROR_OK (https://mirror1.example.com)'
  };

  const healed = autoHealResource(item, probeRes);
  assert.equal(healed, true);
  assert.equal(item.url, 'https://mirror1.example.com');
  assert.deepEqual(item.mirror_urls, ['https://mirror2.example.com', 'https://primary.example.com']);
  assert.equal(item.is_alive, true);
  assert.equal(item.auto_healed, true);
  assert.equal(item.last_healed_from, 'https://primary.example.com');
  assert.ok(item.healed_at);
});

test('runConcurrentPool processes tasks with bounded parallelism preserving array order', async () => {
  const items = [10, 20, 30, 40, 50];
  let activeConcurrent = 0;
  let maxConcurrentSeen = 0;

  const results = await runConcurrentPool(items, 2, async (val) => {
    activeConcurrent++;
    if (activeConcurrent > maxConcurrentSeen) maxConcurrentSeen = activeConcurrent;
    await new Promise(r => setTimeout(r, 10));
    activeConcurrent--;
    return val * 2;
  });

  assert.deepEqual(results, [20, 40, 60, 80, 100]);
  assert.ok(maxConcurrentSeen <= 2, `Expected max concurrency <= 2, observed ${maxConcurrentSeen}`);
});

test('probeWebsite identifies alive site with mocked fetch', async () => {
  const mockFetch = async () => ({
    status: 200,
    ok: true
  });

  const item = { id: 'site-ok', url: 'https://healthy.org' };
  const res = await probeWebsite(item, { fetch: mockFetch });
  assert.equal(res.alive, true);
  assert.equal(res.status, 200);
});

test('probeWebsite identifies primary failure and finds active mirror', async () => {
  const mockFetch = async (url) => {
    if (url === 'https://dead.org') {
      return { status: 404, ok: false };
    }
    if (url === 'https://live-mirror.org') {
      return { status: 200, ok: true };
    }
    return { status: 500, ok: false };
  };

  const item = {
    id: 'site-fallback',
    url: 'https://dead.org',
    mirror_urls: ['https://live-mirror.org']
  };

  const res = await probeWebsite(item, { fetch: mockFetch });
  assert.equal(res.alive, false);
  assert.equal(res.mirrorAlive, true);
  assert.equal(res.activeMirror, 'https://live-mirror.org');
});

test('probeGithubRepo extracts stars and forks with mocked API response', async () => {
  const mockFetch = async () => ({
    status: 200,
    ok: true,
    json: async () => ({
      stargazers_count: 12500,
      forks_count: 980,
      description: 'Modern CLI tool',
      language: 'Rust',
      pushed_at: '2026-09-17T08:00:00Z',
      archived: false,
      disabled: false
    })
  });

  const item = { id: 'gh-tool', repo: 'owner/tool', stars: 10000, forks: 800 };
  const res = await probeGithubRepo(item, { fetch: mockFetch });
  assert.equal(res.alive, true);
  assert.equal(res.stars, 12500);
  assert.equal(res.forks, 980);
  assert.equal(res.pushed_at, '2026-09-17');
});
