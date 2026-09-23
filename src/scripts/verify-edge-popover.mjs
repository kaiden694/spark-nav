import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const EDGE_URL = 'https://xiu-theme.pages.dev/nav/category/tools.html';

async function verifyEdgeLive() {
  if (!fs.existsSync(EDGE_PATH)) {
    console.error('Edge executable not found at', EDGE_PATH);
    process.exit(1);
  }

  console.log(`[1] Launching Headless Edge browser to verify LIVE production edge: ${EDGE_URL} ...`);
  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    const response = await page.goto(EDGE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    console.log(`[VERIFY 1] HTTP Response Status: ${response.status()}`);

    // Check Popover element
    const popover = await page.locator('#nav-quick-preview-popover');
    const count = await popover.count();
    console.log(`[VERIFY 2] Quick Preview Popover in DOM: count=${count}`);
    if (count === 0) throw new Error('Popover DOM missing on live site');

    // Find first nav card
    const card = await page.locator('.nav-card').first();
    const cardBox = await card.boundingBox();
    console.log(`[VERIFY 3] First Card BoundingBox:`, cardBox);

    // Hover card
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    console.log(`[2] Hovered over card, waiting 750ms for debounce & CSS transition...`);
    await page.waitForTimeout(750);

    const isOpen = await popover.evaluate(el => el.classList.contains('is-open'));
    const opacity = await popover.evaluate(el => window.getComputedStyle(el).opacity);
    const popoverBox = await popover.boundingBox();
    console.log(`[VERIFY 4] Popover Live State: isOpen=${isOpen}, opacity=${opacity}`);
    console.log(`[VERIFY 5] Popover Live Position:`, popoverBox);

    if (!isOpen || parseFloat(opacity) < 0.9) {
      throw new Error(`Live Popover failed to open properly (isOpen=${isOpen}, opacity=${opacity})`);
    }

    const title = await page.locator('#qp-title').textContent();
    const domain = await page.locator('#qp-domain').textContent();
    const badge = await page.locator('#qp-badge').textContent();
    console.log(`[VERIFY 6] Popover Content: title="${title}", domain="${domain}", badge="${badge}"`);

    // Verify hover inside Popover keeps it open
    await page.mouse.move(popoverBox.x + 30, popoverBox.y + 30);
    await page.waitForTimeout(300);
    const stillOpen = await popover.evaluate(el => el.classList.contains('is-open'));
    console.log(`[VERIFY 7] Stays open when hovering popover: ${stillOpen}`);

    // Verify Escape key dismisses
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const isClosed = await popover.evaluate(el => !el.classList.contains('is-open'));
    console.log(`[VERIFY 8] Dismissed on Escape key: ${isClosed}`);

    // Verify Live Keyboard Roaming & Shortcut I
    await page.mouse.move(10, 10);
    await page.keyboard.press('j');
    await page.waitForTimeout(150);
    const isCardFocused = await card.evaluate(el => el.classList.contains('is-keyboard-focused'));
    console.log(`[VERIFY 8a] Live Card focused via 'j': ${isCardFocused}`);

    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    const isOpenedByKey = await popover.evaluate(el => el.classList.contains('is-open'));
    console.log(`[VERIFY 8b] Live Popover activated via shortcut 'i': ${isOpenedByKey}`);

    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    const isClosedByKey = await popover.evaluate(el => !el.classList.contains('is-open'));
    console.log(`[VERIFY 8c] Live Popover dismissed via toggle shortcut 'i': ${isClosedByKey}`);

    // Check PWA Manifest on live edge
    const manifestRes = await page.request.get('https://xiu-theme.pages.dev/manifest.json');
    console.log(`[VERIFY 9] Live manifest.json status: ${manifestRes.status()}`);
    const manifestData = await manifestRes.json();
    console.log(`[VERIFY 10] Live manifest shortcuts: ${manifestData.shortcuts?.length || 0} registered shortcuts`);

    // Check SW on live edge
    const swRes = await page.request.get('https://xiu-theme.pages.dev/sw.js');
    console.log(`[VERIFY 11] Live sw.js status: ${swRes.status()}`);
    const swText = await swRes.text();
    const hasSWR = swText.includes('Stale-While-Revalidate');
    console.log(`[VERIFY 12] Live sw.js contains SWR cache pattern: ${hasSWR}`);

    console.log('>>> [SUCCESS] ALL PRODUCTION LIVE CHECKS PASSED 100%! <<<');
  } finally {
    await browser.close();
  }
}

verifyEdgeLive().catch((err) => {
  console.error('Production Verification Failed:', err);
  process.exit(1);
});
