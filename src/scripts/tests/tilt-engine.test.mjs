import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');

test('TiltEngine component integrity and safety guards', () => {
  const compPath = path.join(ROOT_DIR, 'src/components/nav/TiltEngine.astro');
  assert.ok(fs.existsSync(compPath), 'TiltEngine.astro must exist');
  
  const content = fs.readFileSync(compPath, 'utf8');
  assert.ok(content.includes('requestAnimationFrame'), 'TiltEngine must use requestAnimationFrame for throttling');
  assert.ok(content.includes('cancelAnimationFrame'), 'TiltEngine must clean up pending animation frames');
  assert.ok(content.includes('prefers-reduced-motion: reduce'), 'TiltEngine must guard against reduced motion');
  assert.ok(content.includes("pointerType === 'touch'"), 'TiltEngine must ignore touch pointer events');
  assert.ok(content.includes('willChange'), 'TiltEngine must elevate elements to GPU layer via willChange');
  assert.ok(content.includes('window.attach3DTilt = attach3DTilt'), 'TiltEngine must export attach3DTilt on window');
  assert.ok(content.includes('window.init3DTilt = init3DTilt'), 'TiltEngine must export init3DTilt on window');
});

test('NavLayout mounts TiltEngine component in <head> before <slot />', () => {
  const layoutPath = path.join(ROOT_DIR, 'src/layouts/NavLayout.astro');
  const content = fs.readFileSync(layoutPath, 'utf8');
  assert.ok(content.includes("import TiltEngine from '../components/nav/TiltEngine.astro';"), 'NavLayout must import TiltEngine');
  assert.ok(content.includes('<TiltEngine />'), 'NavLayout must render <TiltEngine />');

  const engineIdx = content.indexOf('<TiltEngine />');
  const headEndIdx = content.lastIndexOf('</head>');
  const slotIdx = content.indexOf('<slot />');
  assert.ok(engineIdx > 0, 'TiltEngine must exist');
  assert.ok(engineIdx < headEndIdx, 'TiltEngine must be placed inside <head> before </head>');
  assert.ok(engineIdx < slotIdx, 'TiltEngine must be placed before <slot />');
});

test('Navigation entry pages delegate to global attach3DTilt', () => {
  const pages = [
    'src/pages/index.astro',
    'src/pages/github.astro',
    'src/pages/telegram.astro',
    'src/pages/category/[category].astro'
  ];

  for (const p of pages) {
    const filePath = path.join(ROOT_DIR, p);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(
      content.includes('var attach3DTilt = window.attach3DTilt ||'),
      `${p} must delegate attach3DTilt to global window.attach3DTilt`
    );
  }
});

test('Website fallback icon asset exists and has valid SVG', () => {
  const svgPath = path.join(ROOT_DIR, 'public/assets/images/nav/default-web.svg');
  assert.ok(fs.existsSync(svgPath), 'default-web.svg must exist');
  const content = fs.readFileSync(svgPath, 'utf8');
  assert.ok(content.includes('<svg') && content.includes('</svg>'), 'default-web.svg must be a valid SVG document');
});

test('GitHub Actions health check workflow supports websites-only target', () => {
  const ymlPath = path.join(ROOT_DIR, '.github/workflows/nav-health-check.yml');
  const content = fs.readFileSync(ymlPath, 'utf8');
  assert.ok(content.includes('- websites-only'), 'Workflow options must include websites-only');
  assert.ok(content.includes('--websites-only'), 'Workflow step must dispatch --websites-only flag');
});

test('Critical path LCP preloading: index and vertical hubs prioritize first-screen images', () => {
  // 1. Homepage featured section
  const indexPath = path.join(ROOT_DIR, 'src/pages/index.astro');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  assert.ok(indexContent.includes('loading="eager"'), 'index.astro homeFeatured must use eager loading');
  assert.ok(indexContent.includes('fetchpriority={idx < 4 ? "high" : "auto"}'), 'index.astro must prioritize first 4 card avatars');

  // 2. Hub pages renderCard & Spotlight
  const hubPages = [
    'src/pages/category/[category].astro',
    'src/pages/github.astro',
    'src/pages/telegram.astro'
  ];

  for (const p of hubPages) {
    const hubContent = fs.readFileSync(path.join(ROOT_DIR, p), 'utf8');
    assert.ok(hubContent.includes('function renderCard(item, index)'), `${p} renderCard must accept index argument`);
    assert.ok(hubContent.includes('isEager = (typeof index === \'number\' && index < 12)'), `${p} must mark top 12 cards as eager`);
    assert.ok(hubContent.includes('fetchpriority="high"'), `${p} spotlight must specify high fetchpriority`);
  }
});

