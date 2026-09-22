import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cleanOrphanProcesses } from '../clean-orphan-processes.mjs';

test('cleanOrphanProcesses executes safely and returns metrics', () => {
  const result = cleanOrphanProcesses({ verbose: false });
  assert.ok(result, 'Result should be an object');
  assert.equal(typeof result.workerdKilled, 'boolean');
  assert.equal(typeof result.orphanNodeKilled, 'number');
  assert.equal(typeof result.cleanedKvDirs, 'number');
  assert.equal(typeof result.platform, 'string');
});

test('cleanOrphanProcesses purges temporary audit-kv directory', () => {
  const root = process.cwd();
  const testKvDir = path.join(root, '.wrangler', 'audit-kv', 'test-temp-cleanup-fixture');
  fs.mkdirSync(testKvDir, { recursive: true });
  fs.writeFileSync(path.join(testKvDir, 'sample.db'), 'temp-data');
  assert.ok(fs.existsSync(testKvDir), 'Fixture directory must exist before cleanup');

  const result = cleanOrphanProcesses({ verbose: false });
  assert.ok(result.cleanedKvDirs >= 1, 'Should have cleaned at least 1 directory');
  assert.equal(fs.existsSync(testKvDir), false, 'Fixture directory should be deleted');
});
