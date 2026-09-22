import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAutoHealthSync } from '../auto-health-sync.mjs';

test('auto-health-sync module exports runAutoHealthSync function', () => {
  assert.equal(typeof runAutoHealthSync, 'function');
});
