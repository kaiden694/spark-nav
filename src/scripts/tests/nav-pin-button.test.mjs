import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();

test('nav.css: .nav-card-pin-btn has expanded hit area, 24px size and no active shrinkage', () => {
  const cssPath = path.join(ROOT_DIR, 'src/styles/nav.css');
  const css = fs.readFileSync(cssPath, 'utf8').replace(/\r\n/g, '\n');

  // 1. 24px base size
  assert.ok(css.includes('.nav-card-pin-btn {'), 'Must define .nav-card-pin-btn');
  assert.ok(css.includes('width: 24px;'), 'Must have width: 24px');
  assert.ok(css.includes('height: 24px;'), 'Must have height: 24px');

  // 2. Invisible hit area expansion
  assert.ok(css.includes('.nav-card-pin-btn::before'), 'Must define .nav-card-pin-btn::before hit area expansion');
  assert.ok(css.includes('top: -8px;'), 'Hit area must expand top by at least 8px');

  // 3. No scale(0.95) shrink on active
  assert.ok(!css.includes('.nav-card-pin-btn:active {\n  transform: scale(0.95);'), 'Must not shrink on active');
  assert.ok(!css.includes('.nav-card-copy-btn:active {\n  transform: translateZ(8px) scale(0.95);'), 'Copy button must not shrink on active');

  // 4. SVG pointer-events none
  assert.ok(css.includes('pointer-events: none;'), 'Pin SVG must have pointer-events: none');
  assert.ok(css.includes('.nav-card-pin-btn svg'), 'Pin SVG rule must be defined');

  // 5. Actions group 3D layering & touch action
  assert.ok(css.includes('.nav-card-actions-group {'), 'Must define .nav-card-actions-group');
  assert.ok(css.includes('transform: translateZ(12px);'), 'Actions group must be elevated in 3D');
  assert.ok(css.includes('touch-action: manipulation;'), 'Must have touch-action: manipulation');
});

test('NavCoreStore.astro: implements executeNavCardPin and capture-phase action shield', () => {
  const storePath = path.join(ROOT_DIR, 'src/components/nav/NavCoreStore.astro');
  const store = fs.readFileSync(storePath, 'utf8');

  // 1. Universal executor
  assert.ok(store.includes('window.executeNavCardPin = function(targetEl)'), 'Must expose window.executeNavCardPin');

  // 2. Action shield in capture phase
  assert.ok(store.includes('initNavActionProtection'), 'Must initialize nav action protection');
  assert.ok(store.includes("document.addEventListener('click', function(e) {"), 'Must listen to click');
  assert.ok(store.includes('}, true); // CAPTURE: Priority interception before native <a> link navigation'), 'Click listener must be in capture phase');

  // 3. Prevent outer card navigation
  assert.ok(store.includes('e.preventDefault();'), 'Must prevent default navigation on action buttons');
  assert.ok(store.includes('e.stopPropagation();'), 'Must stop propagation on action buttons');
  assert.ok(store.includes('findNearestActionButton'), 'Must support nearest action button detection in actions-group gap');
});

test('TiltEngine.astro: stabilizes 3D tilt when hovering action buttons cluster', () => {
  const enginePath = path.join(ROOT_DIR, 'src/components/nav/TiltEngine.astro');
  const engine = fs.readFileSync(enginePath, 'utf8');

  assert.ok(engine.includes('.nav-card-actions-group'), 'TiltEngine must inspect .nav-card-actions-group');
  assert.ok(engine.includes('.nav-card-pin-btn'), 'TiltEngine must inspect .nav-card-pin-btn');
  assert.ok(engine.includes('return;'), 'Must freeze tilt coordinates when over action buttons');
});

test('CardActionSheet.astro: ignores touch events on action buttons and group', () => {
  const sheetPath = path.join(ROOT_DIR, 'src/components/nav/CardActionSheet.astro');
  const sheet = fs.readFileSync(sheetPath, 'utf8');

  assert.ok(sheet.includes('.nav-card-pin-btn'), 'CardActionSheet must exclude .nav-card-pin-btn from long press');
  assert.ok(sheet.includes('.nav-card-actions-group'), 'CardActionSheet must exclude .nav-card-actions-group from long press');
});
