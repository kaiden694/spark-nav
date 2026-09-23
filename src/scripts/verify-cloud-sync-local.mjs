import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEST_PORT = 8809;

async function runTest() {
  console.log(`[1] Launching in-process native HTTP server for dist on port ${TEST_PORT}...`);
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
    const isOss = fs.existsSync(path.resolve('dist/category/tools.html')) && !fs.existsSync(path.resolve('dist/nav.html'));
    const targetPath = isOss ? '/index.html' : '/nav.html';
    console.log(`[3] Navigating to http://127.0.0.1:${TEST_PORT}${targetPath} ...`);
    await page.goto(`http://127.0.0.1:${TEST_PORT}${targetPath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#nav-cloud-sync-modal', { state: 'attached', timeout: 5000 });

    // Step 1: Ensure Cloud Sync Modal exists in DOM
    const modal = await page.locator('#nav-cloud-sync-modal');
    const modalCount = await modal.count();
    console.log(`[VERIFY 1] Cloud Sync Modal element in DOM: count=${modalCount}`);
    if (modalCount === 0) throw new Error('Cloud Sync Modal element missing from layout');

    const initialDisplay = await modal.evaluate(el => window.getComputedStyle(el).display);
    console.log(`[VERIFY 2] Initial modal display: "${initialDisplay}"`);
    if (initialDisplay !== 'none') throw new Error('Modal should be hidden initially');

    // Step 2: Trigger modal from Floating Toolbar
    console.log('[4] Clicking #nav-float-sync-btn on floating toolbar...');
    const floatSyncBtn = await page.locator('#nav-float-sync-btn');
    if ((await floatSyncBtn.count()) === 0) throw new Error('#nav-float-sync-btn missing from toolbar');
    await floatSyncBtn.click();
    await page.waitForTimeout(300);

    const isOpen = await modal.evaluate(el => el.classList.contains('is-open'));
    const computedOpacity = await modal.evaluate(el => window.getComputedStyle(el).opacity);
    console.log(`[VERIFY 3] Modal opened state: isOpen=${isOpen}, opacity=${computedOpacity}`);
    if (!isOpen || parseFloat(computedOpacity) < 0.9) throw new Error('Modal failed to open via floating button');

    // Step 3: Provider Tab Switching
    console.log('[5] Testing Provider Tab switching to WebDAV...');
    const tabWebdav = await page.locator('#tab-btn-webdav');
    await tabWebdav.click();
    await page.waitForTimeout(100);

    const panelWebdavDisplay = await page.locator('#panel-webdav').evaluate(el => window.getComputedStyle(el).display);
    const panelGistDisplay = await page.locator('#panel-gist').evaluate(el => window.getComputedStyle(el).display);
    console.log(`[VERIFY 4] Tab switch: WebDAV panel display=${panelWebdavDisplay}, Gist panel display=${panelGistDisplay}`);
    if (panelWebdavDisplay === 'none' || panelGistDisplay !== 'none') {
      throw new Error('WebDAV tab switch failed');
    }

    // Step 4: Switch back to Gist & fill test token
    console.log('[6] Switching back to Gist tab and filling test credentials...');
    const tabGist = await page.locator('#tab-btn-gist');
    await tabGist.click();
    await page.waitForTimeout(100);

    await page.fill('#sync-gist-token', 'ghp_testToken1234567890abcdef');
    await page.fill('#sync-gist-id', 'gist_id_mock_9999');

    // Trigger input blur to save
    await page.click('#tab-btn-gist');
    await page.waitForTimeout(100);

    // Step 5: Test Escape key dismiss
    console.log('[7] Pressing Escape to dismiss modal...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);

    const isClosedAfterEsc = await modal.evaluate(el => !el.classList.contains('is-open'));
    console.log(`[VERIFY 5] Modal dismissed via Escape: isClosed=${isClosedAfterEsc}`);
    if (!isClosedAfterEsc) throw new Error('Modal did not dismiss on Escape key');

    // Step 6: Test LocalStorage Persistence
    const savedConfig = await page.evaluate(() => {
      const raw = localStorage.getItem('xiu_nav_cloud_sync_config');
      return raw ? JSON.parse(raw) : null;
    });
    console.log(`[VERIFY 6] Persisted config in LocalStorage:`, savedConfig ? {
      provider: savedConfig.provider,
      hasToken: Boolean(savedConfig.gist?.token),
      gistId: savedConfig.gist?.gistId
    } : null);

    if (!savedConfig || savedConfig.gist?.gistId !== 'gist_id_mock_9999') {
      throw new Error('Config was not saved properly in LocalStorage');
    }

    // Step 7: Pin a card and test Favorites Section header trigger
    console.log('[8] Pinning first card to reveal favorites section...');
    const pinBtn = await page.locator('.nav-card-pin-btn').first();
    await pinBtn.click();
    await page.waitForTimeout(200);

    const favSection = await page.locator('#sec-user-favorites');
    const favSectionVisible = await favSection.evaluate(el => window.getComputedStyle(el).display !== 'none');
    console.log(`[VERIFY 7] Favorites section visibility: ${favSectionVisible}`);
    if (!favSectionVisible) throw new Error('Favorites section should be visible after pin');

    const favHeaderSyncBtn = await page.locator('#btn-cloud-sync-favorites');
    const favSyncBtnExists = (await favHeaderSyncBtn.count()) > 0;
    console.log(`[VERIFY 8] Favorites header Cloud Sync button exists: ${favSyncBtnExists}`);
    if (!favSyncBtnExists) throw new Error('#btn-cloud-sync-favorites missing from header');

    await favHeaderSyncBtn.click();
    await page.waitForTimeout(300);

    const reOpened = await modal.evaluate(el => el.classList.contains('is-open'));
    const tokenVal = await page.locator('#sync-gist-token').inputValue();
    console.log(`[VERIFY 9] Re-opened via favorites header: reOpened=${reOpened}, tokenRestored=${tokenVal === 'ghp_testToken1234567890abcdef'}`);
    if (!reOpened || tokenVal !== 'ghp_testToken1234567890abcdef') {
      throw new Error('Re-opening via favorites header failed or did not restore input value');
    }

    // Close via close button
    await page.click('#nav-sync-close-btn');
    await page.waitForTimeout(350);

    console.log('\n========================================================');
    console.log('✅ ALL CLOUD SYNC HEADLESS BROWSER VERIFICATIONS PASSED!');
    console.log('========================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('❌ Cloud Sync Verification Failed:', err);
  process.exit(1);
});
