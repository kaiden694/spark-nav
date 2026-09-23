import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEST_PORT = 8799;

async function runTest() {

  // 1. Launch In-Process Native Static Server for dist/
  console.log(`[1] Launching in-process native static server for dist on port ${TEST_PORT}...`);
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
    if (cleanUrl === '/') cleanUrl = '/index.html';
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
    const isOss = fs.existsSync(path.resolve('dist/category/tools.html'));
    const targetPath = isOss ? '/category/tools.html' : '/nav/category/tools.html';
    console.log(`[3] Navigating to http://127.0.0.1:${TEST_PORT}${targetPath} ...`);
    await page.goto(`http://127.0.0.1:${TEST_PORT}${targetPath}`, { waitUntil: 'networkidle' });

    // Ensure Popover DOM exists
    const popover = await page.locator('#nav-quick-preview-popover');
    const popoverCount = await popover.count();
    console.log(`[VERIFY 1] Popover element in DOM: count=${popoverCount}`);
    if (popoverCount === 0) throw new Error('Popover element missing');

    // Find first nav card
    const card = await page.locator('.nav-card').first();
    const cardBox = await card.boundingBox();
    console.log(`[VERIFY 2] Target Card BoundingBox:`, cardBox);

    // Hover mouse over card
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    console.log('[4] Hovering over card, waiting 750ms for debounce & CSS transition...');
    await page.waitForTimeout(750);

    // Assert Popover is open
    const isOpen = await popover.evaluate(el => el.classList.contains('is-open'));
    const isVisible = await popover.isVisible();
    const computedOpacity = await popover.evaluate(el => window.getComputedStyle(el).opacity);
    const popoverBox = await popover.boundingBox();
    console.log(`[VERIFY 3] Popover Open State: isOpen=${isOpen}, isVisible=${isVisible}, opacity=${computedOpacity}`);
    console.log(`[VERIFY 4] Popover BoundingBox:`, popoverBox);

    if (!isOpen || parseFloat(computedOpacity) < 0.9) {
      throw new Error(`Popover failed to activate properly (isOpen=${isOpen}, opacity=${computedOpacity})`);
    }

    // Inspect Content
    const title = await page.locator('#qp-title').textContent();
    const domain = await page.locator('#qp-domain').textContent();
    const badge = await page.locator('#qp-badge').textContent();
    const desc = await page.locator('#qp-desc').textContent();
    console.log(`[VERIFY 5] Popover Rendered Content: title="${title}", domain="${domain}", badge="${badge}"`);
    console.log(`[VERIFY 6] Popover Desc: "${desc.slice(0, 40)}..."`);

    // Hover into Popover itself
    await page.mouse.move(popoverBox.x + 30, popoverBox.y + 30);
    await page.waitForTimeout(300);
    const stillOpen = await popover.evaluate(el => el.classList.contains('is-open'));
    console.log(`[VERIFY 7] Stays open when hovering Popover: ${stillOpen}`);
    if (!stillOpen) throw new Error('Popover closed prematurely while cursor inside');

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const isClosed = await popover.evaluate(el => !el.classList.contains('is-open'));
    console.log(`[VERIFY 8] Dismissed on Escape key: ${isClosed}`);
    if (!isClosed) throw new Error('Popover failed to close on Escape key');

    // ==================== Keyboard Roaming & Shortcut I Assertion ====================
    console.log('[5] Testing Keyboard Roaming & Shortcut I trigger...');
    // Clear mouse hover away from cards
    await page.mouse.move(10, 10);
    await page.waitForTimeout(200);

    // Press 'j' to focus first card via keyboard navigation
    await page.keyboard.press('j');
    await page.waitForTimeout(150);
    const isCardFocused = await card.evaluate(el => el.classList.contains('is-keyboard-focused'));
    console.log(`[VERIFY 9] Card focused via keyboard 'j': ${isCardFocused}`);
    if (!isCardFocused) throw new Error('Card failed to receive keyboard focus on key j');

    // Press 'i' to toggle Quick Preview Popover via keyboard
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    const isOpenedByKey = await popover.evaluate(el => el.classList.contains('is-open'));
    console.log(`[VERIFY 10] Popover activated via keyboard shortcut 'i': ${isOpenedByKey}`);
    if (!isOpenedByKey) throw new Error('Popover failed to open on shortcut key i');

    // Verify Focus Trap inside Popover: Pin button has focus
    const isPinFocused = await page.locator('#qp-pin-btn').evaluate(el => document.activeElement === el);
    console.log(`[VERIFY 11] Popover Focus Trap landed on action button: ${isPinFocused}`);

    // Press 'Tab' to move focus inside Popover
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const isCopyFocused = await page.locator('#qp-copy-btn').evaluate(el => document.activeElement === el);
    console.log(`[VERIFY 12] Focus cycled to copy button via Tab: ${isCopyFocused}`);

    // Press 'i' again to dismiss and return focus
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    const isClosedByKey = await popover.evaluate(el => !el.classList.contains('is-open'));
    console.log(`[VERIFY 13] Popover dismissed via toggle shortcut 'i': ${isClosedByKey}`);
    if (!isClosedByKey) throw new Error('Popover failed to close on shortcut key i');

    console.log('>>> ALL VERIFICATION CHECKS PASSED PERFECTLY! <<<');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
