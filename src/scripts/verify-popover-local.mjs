import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEST_PORT = 8799;

async function runTest() {
  if (!fs.existsSync(EDGE_PATH)) {
    console.error('Edge executable not found at', EDGE_PATH);
    process.exit(1);
  }

  // 1. Launch Preview Server on 8799
  console.log(`[1] Launching local preview server on port ${TEST_PORT}...`);
  const serverProcess = spawn('node', ['preview.mjs'], {
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'ignore'
  });

  // Wait for server ready
  await new Promise((resolve) => {
    const check = () => {
      http.get(`http://127.0.0.1:${TEST_PORT}/nav.html`, (res) => {
        if (res.statusCode === 200) resolve();
        else setTimeout(check, 150);
      }).on('error', () => setTimeout(check, 150));
    };
    check();
  });
  console.log('[2] Server ready! Launching Headless Edge browser...');

  const browser = await chromium.launch({
    executablePath: EDGE_PATH,
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    console.log(`[3] Navigating to http://127.0.0.1:${TEST_PORT}/nav/category/tools.html ...`);
    await page.goto(`http://127.0.0.1:${TEST_PORT}/nav/category/tools.html`, { waitUntil: 'networkidle' });

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
    console.log('[4] Hovering over card, waiting 500ms for debounce...');
    await page.waitForTimeout(700);

    // Assert Popover is open
    const isOpen = await popover.evaluate(el => el.classList.contains('is-open'));
    const isVisible = await popover.isVisible();
    const computedOpacity = await popover.evaluate(el => window.getComputedStyle(el).opacity);
    const popoverBox = await popover.boundingBox();
    console.log(`[VERIFY 3] Popover Open State: isOpen=${isOpen}, isVisible=${isVisible}, opacity=${computedOpacity}`);
    console.log(`[VERIFY 4] Popover BoundingBox:`, popoverBox);

    if (!isOpen || parseFloat(computedOpacity) < 0.95) {
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

    console.log('>>> ALL VERIFICATION CHECKS PASSED PERFECTLY! <<<');
  } finally {
    await browser.close();
    serverProcess.kill('SIGTERM');
  }
}

runTest().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
