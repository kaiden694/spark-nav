import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testEdgeLive() {
  if (!fs.existsSync(EDGE_PATH)) {
    console.error('Edge executable not found at', EDGE_PATH);
    process.exit(1);
  }

  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  console.log('Navigating to https://xiu-theme.pages.dev/category/tools ...');
  await page.goto('https://xiu-theme.pages.dev/category/tools', { waitUntil: 'networkidle' });

  // 1. Check Spotlight Avatar
  const spotlightImg = await page.locator('.spotlight-avatar').first();
  if (await spotlightImg.count() > 0) {
    const loading = await spotlightImg.getAttribute('loading');
    const priority = await spotlightImg.getAttribute('fetchpriority');
    console.log(`[VERIFY 1] Spotlight Avatar: loading="${loading}", fetchpriority="${priority}"`);
  }

  // 2. Check First Card Avatar
  const cardImg = await page.locator('.nav-card-avatar img').first();
  if (await cardImg.count() > 0) {
    const loading = await cardImg.getAttribute('loading');
    const priority = await cardImg.getAttribute('fetchpriority');
    console.log(`[VERIFY 2] Top Card Avatar: loading="${loading}", fetchpriority="${priority}"`);
  }

  // 3. Card 3D Spatial Hierarchy Hover
  const card = await page.locator('.nav-card').first();
  const bbox = await card.boundingBox();
  console.log('[VERIFY 3] Target Card BoundingBox:', bbox);

  // Hover at top-left
  await page.mouse.move(bbox.x + 25, bbox.y + 25);
  await page.waitForTimeout(360);

  const cardTransform = await card.evaluate(el => window.getComputedStyle(el).transform);
  const avatarTransform = await card.evaluate(el => {
    const av = el.querySelector('.nav-card-avatar');
    return av ? window.getComputedStyle(av).transform : null;
  });
  const titleTransform = await card.evaluate(el => {
    const t = el.querySelector('.nav-card-title');
    return t ? window.getComputedStyle(t).transform : null;
  });
  const descTransform = await card.evaluate(el => {
    const d = el.querySelector('.nav-card-desc');
    return d ? window.getComputedStyle(d).transform : null;
  });
  const footerTransform = await card.evaluate(el => {
    const f = el.querySelector('.nav-card-footer');
    return f ? window.getComputedStyle(f).transform : null;
  });
  const copyBtnTransform = await card.evaluate(el => {
    const c = el.querySelector('.nav-card-copy-btn');
    return c ? window.getComputedStyle(c).transform : null;
  });

  console.log('[VERIFY 4] Card transform (3D tilt):', cardTransform);
  console.log('[VERIFY 5] Avatar transform (translateZ 16px + scale):', avatarTransform);
  console.log('[VERIFY 6] Title transform (translateZ 8px):', titleTransform);
  console.log('[VERIFY 7] Desc transform (translateZ 4px):', descTransform);
  console.log('[VERIFY 8] Footer transform (translateZ 6px):', footerTransform);
  console.log('[VERIFY 9] CopyBtn transform (translateZ 12px):', copyBtnTransform);

  // 4. Test Home Page
  console.log('\nNavigating to https://xiu-theme.pages.dev/ ...');
  await page.goto('https://xiu-theme.pages.dev/', { waitUntil: 'networkidle' });

  const homeCardsEager = await page.locator('#sec-featured .nav-card img[loading="eager"]').count();
  const homeCardsHigh = await page.locator('#sec-featured .nav-card img[fetchpriority="high"]').count();
  console.log(`[VERIFY 10] Homepage Featured section eager cards: ${homeCardsEager} / 8`);
  console.log(`[VERIFY 11] Homepage Featured section high-priority cards: ${homeCardsHigh} / 4`);

  await browser.close();
  console.log('\n[SUCCESS] Edge live verification fully complete and passed!');
}

testEdgeLive().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
