import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCreator, mergeCreators, sendSuspensionAlert } from '../sync-creators.mjs';

test('normalizeCreator cleans screen_name and handles numeric defaults', () => {
  const input = {
    screen_name: '@alice_wonder',
    name: 'Alice',
    followers_count: '15000',
    verified: true,
    clicks_card: '10',
    clicks_timeline: '25'
  };

  const normalized = normalizeCreator(input);
  assert.ok(normalized);
  assert.equal(normalized.screen_name, 'alice_wonder');
  assert.equal(normalized.followers_count, 15000);
  assert.equal(normalized.verified, 1);
  assert.equal(normalized.clicks_card, 10);
  assert.equal(normalized.clicks_timeline, 25);
  assert.equal(normalized.total_clicks, 35);
  assert.equal(normalized.is_blocked, 0);
});

test('normalizeCreator returns null for empty or invalid input', () => {
  assert.equal(normalizeCreator(null), null);
  assert.equal(normalizeCreator({}), null);
  assert.equal(normalizeCreator({ screen_name: '   ' }), null);
});

test('mergeCreators adds new creators and preserves sorting by followers', () => {
  const existing = [
    { screen_name: 'bob', followers_count: 5000, name: 'Bob' },
    { screen_name: 'carol', followers_count: 12000, name: 'Carol' }
  ];

  const incoming = [
    { screen_name: 'dave', followers_count: 30000, name: 'Dave' }
  ];

  const result = mergeCreators(existing, incoming);
  assert.equal(result.totalCount, 3);
  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.unchangedCount, 0);

  // Sorting descending by followers_count
  assert.equal(result.merged[0].screen_name, 'dave');
  assert.equal(result.merged[1].screen_name, 'carol');
  assert.equal(result.merged[2].screen_name, 'bob');
});

test('mergeCreators updates profile information while preserving max clicks', () => {
  const existing = [
    { screen_name: 'bob', followers_count: 5000, name: 'Bob', total_clicks: 100 }
  ];

  const incoming = [
    { screen_name: 'bob', followers_count: 6500, name: 'Bob New', total_clicks: 40 }
  ];

  const result = mergeCreators(existing, incoming);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.addedCount, 0);
  assert.equal(result.merged[0].name, 'Bob New');
  assert.equal(result.merged[0].followers_count, 6500);
  // Total clicks should preserve the higher value (100)
  assert.equal(result.merged[0].total_clicks, 100);
});

test('mergeCreators identifies unchanged records cleanly', () => {
  const existing = [
    { screen_name: 'bob', followers_count: 5000, name: 'Bob', total_clicks: 50, verified: 1 }
  ];

  const incoming = [
    { screen_name: 'bob', followers_count: 5000, name: 'Bob', total_clicks: 50, verified: 1 }
  ];

  const result = mergeCreators(existing, incoming);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.addedCount, 0);
  assert.equal(result.unchangedCount, 1);
});

test('mergeCreators records mutation history entry on property changes', () => {
  const existing = [
    { screen_name: 'bob', followers_count: 5000, name: 'Bob', verified: 0 }
  ];

  const incoming = [
    { screen_name: 'bob', followers_count: 8000, name: 'Bob Pro', verified: 1 }
  ];

  const result = mergeCreators(existing, incoming);
  assert.equal(result.updatedCount, 1);
  const updated = result.merged[0];
  assert.ok(Array.isArray(updated.history));
  assert.equal(updated.history.length, 1);
  assert.equal(updated.history[0].type, '档案变动');
  assert.ok(updated.history[0].desc.includes('昵称变更'));
  assert.ok(updated.history[0].desc.includes('粉丝变动：+3,000'));
  assert.ok(updated.history[0].desc.includes('获得官方认证'));
});

test('mergeCreators tracks newlySuspended creators when status changes to suspended or deleted', () => {
  const existing = [
    { screen_name: 'active1', name: 'Active 1', is_suspended: 0 },
    { screen_name: 'active2', name: 'Active 2', is_suspended: 0 }
  ];

  const incoming = [
    { screen_name: 'active1', name: 'Active 1', is_suspended: 1 },
    { screen_name: 'active2', name: 'Active 2', is_suspended: 2 }
  ];

  const result = mergeCreators(existing, incoming);
  assert.ok(Array.isArray(result.newlySuspended));
  assert.equal(result.newlySuspended.length, 2);
  assert.equal(result.newlySuspended[0].screen_name, 'active1');
  assert.equal(result.newlySuspended[0].status, '封禁');
  assert.equal(result.newlySuspended[1].screen_name, 'active2');
  assert.equal(result.newlySuspended[1].status, '注销');
});

test('sendSuspensionAlert returns safely when webhookUrl is empty', async () => {
  const res = await sendSuspensionAlert('', [{ screen_name: 'test', name: 'Test', status: '封禁' }]);
  assert.equal(res.ok, false);
});

