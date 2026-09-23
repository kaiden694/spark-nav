import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');

test('CardQuickPreviewPopover component integrity & architecture', () => {
  const compPath = path.join(ROOT_DIR, 'src/components/nav/CardQuickPreviewPopover.astro');
  assert.ok(fs.existsSync(compPath), 'CardQuickPreviewPopover.astro must exist');

  const content = fs.readFileSync(compPath, 'utf8');
  assert.ok(content.includes('id="nav-quick-preview-popover"'), 'Must contain popover root container');
  assert.ok(content.includes('DEBOUNCE_MS'), 'Must define hover debounce timing to prevent UI flicker');
  assert.ok(content.includes('CLOSE_DELAY_MS'), 'Must define close delay timing for smooth cursor transition');
  assert.ok(content.includes('repositionPopover'), 'Must implement smart collision-free positioning');
  assert.ok(content.includes('window.innerWidth'), 'Positioning algorithm must check window viewport boundaries');
  assert.ok(content.includes('window.innerHeight'), 'Positioning algorithm must check window height boundaries');
  assert.ok(content.includes('qp-mirrors-section'), 'Must support fast mirror routing display');
  assert.ok(content.includes('qp-metrics'), 'Must support dynamic metrics grid for GitHub/TG/Web');
  assert.ok(content.includes('Escape'), 'Must support Escape key to instantly dismiss popover');
});

test('NavLayout mounts CardQuickPreviewPopover & network resilience watchers', () => {
  const layoutPath = path.join(ROOT_DIR, 'src/layouts/NavLayout.astro');
  const content = fs.readFileSync(layoutPath, 'utf8');

  assert.ok(
    content.includes("import CardQuickPreviewPopover from '../components/nav/CardQuickPreviewPopover.astro';"),
    'NavLayout must import CardQuickPreviewPopover'
  );
  assert.ok(
    content.includes('<CardQuickPreviewPopover />'),
    'NavLayout must render <CardQuickPreviewPopover />'
  );
  assert.ok(
    content.includes("window.addEventListener('offline'"),
    'NavLayout must listen for offline events'
  );
  assert.ok(
    content.includes("window.addEventListener('online'"),
    'NavLayout must listen for online reconnection events'
  );
});

test('PWA manifest.json compliance & shortcuts integration', () => {
  const manifestPath = path.join(ROOT_DIR, 'public/manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.name && manifest.name.length > 0, 'manifest must have a valid name');
  assert.ok(manifest.short_name, 'manifest must have short_name');
  assert.equal(manifest.display, 'standalone', 'display mode must be standalone for PWA installability');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must specify icons');
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2, 'manifest must provide PWA app shortcuts');
});

test('Service Worker sw.js implements Stale-While-Revalidate and vertical hub caching', () => {
  const swPath = path.join(ROOT_DIR, 'public/sw.js');
  assert.ok(fs.existsSync(swPath), 'public/sw.js must exist');

  const content = fs.readFileSync(swPath, 'utf8');
  assert.ok(content.includes('PRECACHE_URLS'), 'sw.js must define PRECACHE_URLS');
  assert.ok(content.includes('/nav-search-index.json'), 'sw.js must precache nav-search-index.json');
  assert.ok(content.includes('/category/tools.html'), 'sw.js must precache vertical tools subroute');
  assert.ok(content.includes('Stale-While-Revalidate'), 'sw.js must implement SWR pattern for instant search response');
  assert.ok(content.includes('event.waitUntil(fetchPromise)'), 'sw.js SWR pattern must revalidate asynchronously in background');
});
