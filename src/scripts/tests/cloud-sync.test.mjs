import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  smartMergeFavorites,
  buildGistPayload,
  buildWebDAVTargetUrl,
  validateSyncConfig
} from '../../utils/cloud-sync.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');

test('smartMergeFavorites: handles empty or invalid inputs', () => {
  assert.deepEqual(smartMergeFavorites([], []), []);
  assert.deepEqual(smartMergeFavorites(null, undefined), []);
});

test('smartMergeFavorites: unions disjoint sets cleanly', () => {
  const local = [
    { id: 'item-1', title: 'Local 1', url: 'https://1.com', pinnedAt: 100 }
  ];
  const cloud = [
    { id: 'item-2', title: 'Cloud 2', url: 'https://2.com', pinnedAt: 200 }
  ];

  const merged = smartMergeFavorites(local, cloud);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'item-2', 'Highest pinnedAt item must come first');
  assert.equal(merged[1].id, 'item-1');
});

test('smartMergeFavorites: arbitrates conflicts by pinnedAt timestamp', () => {
  // Case A: Cloud is newer
  const localOlder = [
    { id: 'item-1', title: 'Title Old', url: 'https://old.com', pinnedAt: 1000 }
  ];
  const cloudNewer = [
    { id: 'item-1', title: 'Title New', url: 'https://new.com', pinnedAt: 2000 }
  ];
  const resA = smartMergeFavorites(localOlder, cloudNewer);
  assert.equal(resA.length, 1);
  assert.equal(resA[0].title, 'Title New');
  assert.equal(resA[0].pinnedAt, 2000);

  // Case B: Local is newer
  const localNewer = [
    { id: 'item-1', title: 'Title Local New', url: 'https://local.com', pinnedAt: 3000 }
  ];
  const cloudOlder = [
    { id: 'item-1', title: 'Title Cloud Old', url: 'https://cloud.com', pinnedAt: 1500 }
  ];
  const resB = smartMergeFavorites(localNewer, cloudOlder);
  assert.equal(resB.length, 1);
  assert.equal(resB[0].title, 'Title Local New');
  assert.equal(resB[0].pinnedAt, 3000);
});

test('smartMergeFavorites: preserves extra metadata on merge', () => {
  const local = [
    { id: 'item-1', title: 'Item 1', pinnedAt: 100, localCustomProp: 'localVal' }
  ];
  const cloud = [
    { id: 'item-1', title: 'Item 1 Updated', pinnedAt: 200, cloudCustomProp: 'cloudVal' }
  ];

  const merged = smartMergeFavorites(local, cloud);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Item 1 Updated');
  assert.equal(merged[0].localCustomProp, 'localVal');
  assert.equal(merged[0].cloudCustomProp, 'cloudVal');
});

test('buildGistPayload: builds valid private Gist payload', () => {
  const items = [{ id: 'site-a', title: 'Site A' }];
  const payload = buildGistPayload(items, 'Custom Backup', false);

  assert.equal(payload.description, 'Custom Backup');
  assert.equal(payload.public, false);
  assert.ok(payload.files['xiu-nav-favorites.json'], 'Must define xiu-nav-favorites.json');
  
  const content = JSON.parse(payload.files['xiu-nav-favorites.json'].content);
  assert.deepEqual(content, items);
});

test('buildWebDAVTargetUrl: handles trailing and leading slashes properly', () => {
  const url1 = buildWebDAVTargetUrl('https://dav.jianguoyun.com/dav/', '/xiu-nav/favorites.json');
  assert.equal(url1, 'https://dav.jianguoyun.com/dav/xiu-nav/favorites.json');

  const url2 = buildWebDAVTargetUrl('https://dav.example.com///', 'custom/path.json');
  assert.equal(url2, 'https://dav.example.com/custom/path.json');

  assert.throws(() => buildWebDAVTargetUrl(''), /baseUrl is required/);
});

test('validateSyncConfig: validates Gist and WebDAV configurations correctly', () => {
  // Gist validation
  assert.equal(validateSyncConfig({ provider: 'gist', gist: { token: '' } }).valid, false);
  assert.equal(validateSyncConfig({ provider: 'gist', gist: { token: 'ghp_abc123' } }).valid, true);

  // WebDAV validation
  assert.equal(validateSyncConfig({ provider: 'webdav', webdav: { url: '', user: 'u', pass: 'p' } }).valid, false);
  assert.equal(validateSyncConfig({ provider: 'webdav', webdav: { url: 'https://dav.com', user: '', pass: 'p' } }).valid, false);
  assert.equal(validateSyncConfig({ provider: 'webdav', webdav: { url: 'https://dav.com', user: 'u', pass: 'p' } }).valid, true);

  // Unknown provider
  assert.equal(validateSyncConfig({ provider: 'invalid' }).valid, false);
});

test('FavoritesCloudSyncModal component architecture integrity', () => {
  const compPath = path.join(ROOT_DIR, 'src/components/nav/FavoritesCloudSyncModal.astro');
  assert.ok(fs.existsSync(compPath), 'FavoritesCloudSyncModal.astro must exist');

  const content = fs.readFileSync(compPath, 'utf8');
  assert.ok(content.includes('id="nav-cloud-sync-modal"'), 'Must contain modal root');
  assert.ok(content.includes('tab-btn-gist'), 'Must support GitHub Gist tab');
  assert.ok(content.includes('tab-btn-webdav'), 'Must support WebDAV tab');
  assert.ok(content.includes('btn-sync-pull'), 'Must provide Cloud Pull action');
  assert.ok(content.includes('btn-sync-push'), 'Must provide Cloud Push action');
  assert.ok(content.includes('btn-sync-merge'), 'Must provide Smart Merge action');
  assert.ok(content.includes('triggerAutoSync'), 'Must implement debounce auto sync');
  assert.ok(content.includes('window.openNavCloudSyncModal'), 'Must expose window.openNavCloudSyncModal');
  assert.ok(content.includes('window.closeNavCloudSyncModal'), 'Must expose window.closeNavCloudSyncModal');
});

test('NavLayout properly imports and renders FavoritesCloudSyncModal', () => {
  const layoutPath = path.join(ROOT_DIR, 'src/layouts/NavLayout.astro');
  const content = fs.readFileSync(layoutPath, 'utf8');

  assert.ok(
    content.includes("import FavoritesCloudSyncModal from '../components/nav/FavoritesCloudSyncModal.astro';"),
    'NavLayout must import FavoritesCloudSyncModal'
  );
  assert.ok(
    content.includes('<FavoritesCloudSyncModal />'),
    'NavLayout must render <FavoritesCloudSyncModal />'
  );
});

test('Home page and NavFloatingToolbar integrate Cloud Sync triggers', () => {
  const isOss = !fs.existsSync(path.join(ROOT_DIR, 'src/pages/nav.astro'));
  const homePath = isOss
    ? path.join(ROOT_DIR, 'src/pages/index.astro')
    : path.join(ROOT_DIR, 'src/pages/nav.astro');
  const homeContent = fs.readFileSync(homePath, 'utf8');

  assert.ok(homeContent.includes('id="btn-cloud-sync-favorites"'), 'Home page must have cloud sync button in favorites header');
  assert.ok(homeContent.includes('window.openNavCloudSyncModal()'), 'Home page must bind click to window.openNavCloudSyncModal()');

  const toolbarPath = path.join(ROOT_DIR, 'src/components/nav/NavFloatingToolbar.astro');
  const toolbarContent = fs.readFileSync(toolbarPath, 'utf8');

  assert.ok(toolbarContent.includes('id="nav-float-sync-btn"'), 'NavFloatingToolbar must have floating sync button');
  assert.ok(toolbarContent.includes('window.openNavCloudSyncModal()'), 'NavFloatingToolbar must trigger window.openNavCloudSyncModal()');
});

