import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEST_PORT = 8812;

async function runTest() {
  console.log(`[1] Launching in-process native HTTP server on port ${TEST_PORT}...`);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };

  const server = http.createServer((req, res) => {
    let cleanUrl = req.url.split('?')[0];
    if (cleanUrl === '/') {
      cleanUrl = fs.existsSync(path.join(process.cwd(), 'dist', 'index.html')) ? '/index.html' : '/nav.html';
    }
    let filePath = path.join(process.cwd(), 'dist', cleanUrl);

    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  const hasEdge = fs.existsSync(EDGE_PATH);
  console.log(`[2] Server ready! Launching Headless browser (${hasEdge ? 'Microsoft Edge' : 'Chromium'})...`);

  const browser = await chromium.launch({
    ...(hasEdge ? { executablePath: EDGE_PATH } : {}),
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    const hasNavHtml = fs.existsSync(path.join(process.cwd(), 'dist', 'nav.html'));
    const targetUrl = `http://127.0.0.1:${TEST_PORT}${hasNavHtml ? '/nav.html' : '/'}`;
    console.log(`[3] Navigating to ${targetUrl} ...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Find the first static nav card on the page (outside the favorites section)
    const card = await page.waitForSelector('.nav-card:not(#sec-user-favorites .nav-card)');
    const cardHref = await card.getAttribute('href');
    console.log(`[4] Target card href is: ${cardHref}`);

    const pinBtn = await card.$('.nav-card-pin-btn');
    if (!pinBtn) throw new Error('Pin button not found on card');

    const pinBox = await pinBtn.boundingBox();
    console.log(`[5] Pin button rendered bounding box:`, pinBox);
    if (pinBox.width < 23 || pinBox.height < 23) {
      throw new Error(`Pin button too small: ${pinBox.width}x${pinBox.height}`);
    }

    // TEST 1: Center click on pin button
    console.log(`[TEST 1] Clicking center of pin button...`);
    await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
    await page.waitForTimeout(300);

    let currentUrl = page.url();
    if (currentUrl !== targetUrl) {
      throw new Error(`FAIL: Center click navigated away to ${currentUrl}!`);
    }
    let isPinned = await pinBtn.evaluate(el => el.classList.contains('is-pinned'));
    console.log(`[VERIFY 1] Pin status after center click: isPinned=${isPinned}, URL unchanged=${currentUrl === targetUrl}`);
    if (!isPinned) throw new Error('FAIL: Pin button was not pinned after center click');

    // TEST 2: Boundary click on pin button (1px from edge)
    console.log(`[TEST 2] Clicking 1px from pin button edge (boundary test)...`);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const freshBox2 = await pinBtn.boundingBox();
    console.log(`[TEST 2] Fresh pin button bounding box:`, freshBox2);
    await page.mouse.click(freshBox2.x + 1, freshBox2.y + 1);
    await page.waitForTimeout(300);

    currentUrl = page.url();
    if (currentUrl !== targetUrl) {
      throw new Error(`FAIL: Boundary click navigated away to ${currentUrl}!`);
    }
    isPinned = await pinBtn.evaluate(el => el.classList.contains('is-pinned'));
    console.log(`[VERIFY 2] Pin status after boundary click (toggled back): isPinned=${isPinned}, URL unchanged=${currentUrl === targetUrl}`);
    if (isPinned) throw new Error('FAIL: Pin button was not unpinned after boundary click');

    // TEST 3: Expanded hit-area click (3px outside the physical left border, hitting ::before)
    console.log(`[TEST 3] Clicking 3px outside physical left boundary (testing ::before hit expansion)...`);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const freshBox3 = await pinBtn.boundingBox();
    console.log(`[TEST 3] Fresh pin button bounding box:`, freshBox3);
    // Click 3px to the left of the button (inside the 5px ::before hit expansion)
    await page.mouse.click(freshBox3.x - 3, freshBox3.y + freshBox3.height / 2);
    await page.waitForTimeout(300);

    currentUrl = page.url();
    if (currentUrl !== targetUrl) {
      throw new Error(`FAIL: Hit-area expansion click navigated away to ${currentUrl}!`);
    }
    isPinned = await pinBtn.evaluate(el => el.classList.contains('is-pinned'));
    console.log(`[VERIFY 3] Pin status after ::before expanded hit click: isPinned=${isPinned}, URL unchanged=${currentUrl === targetUrl}`);
    if (!isPinned) throw new Error('FAIL: ::before expanded hit click did not pin the card');

    // TEST 4: Click inside .nav-card-actions-group gap
    console.log(`[TEST 4] Clicking in the gap between action buttons inside .nav-card-actions-group...`);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const actionsGroup = await card.$('.nav-card-actions-group');
    if (!actionsGroup) throw new Error('actionsGroup not found');
    const freshPinBox = await pinBtn.boundingBox();
    // Click between buttons
    await page.mouse.click(freshPinBox.x + freshPinBox.width + 2, freshPinBox.y + freshPinBox.height / 2);
    await page.waitForTimeout(300);

    currentUrl = page.url();
    const currentParsed = new URL(currentUrl);
    const targetParsed = new URL(targetUrl);
    if (currentParsed.origin !== targetParsed.origin || currentParsed.pathname !== targetParsed.pathname) {
      throw new Error(`FAIL: Gap click in actions-group navigated away to external target ${currentUrl}!`);
    }
    console.log(`[VERIFY 4] Actions group gap click intercepted cleanly: external navigation blocked, stayed on ${currentParsed.pathname} (hash=${currentParsed.hash})`);

    console.log('\n================================================================');
    console.log('✅ ALL PIN BUTTON HIT-AREA & ZERO-PENETRATION VERIFICATIONS PASSED!');
    console.log('================================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
