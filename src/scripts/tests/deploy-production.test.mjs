import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const LOCK_FILE = path.join(LOGS_DIR, 'deploy.lock');

test('deploy-production module exports runProductionDeploy and triggerProductionDeploy', async () => {
  const mod = await import('../deploy-production.mjs');
  assert.equal(typeof mod.runProductionDeploy, 'function');
  assert.equal(typeof mod.triggerProductionDeploy, 'function');
});

test('deploy lock mechanism prevents duplicate runs and handles queueing', async () => {
  // Ensure test lock file
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

  const fakeLock = {
    pid: 999999,
    timestamp: Date.now(),
    reason: 'Test Runner',
    queued: false
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(fakeLock, null, 2), 'utf-8');

  // Triggering production deploy should notice active lock and queue
  const { runProductionDeploy } = await import('../deploy-production.mjs');
  const res = await runProductionDeploy({ reason: 'Subsequent test', notify: false });

  assert.equal(res.queued, true);

  // Check that lock file now has queued=true
  const updatedLock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
  assert.equal(updatedLock.queued, true);
  assert.equal(updatedLock.lastQueuedReason, 'Subsequent test');

  // Clean up lock file
  fs.unlinkSync(LOCK_FILE);
});
