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

    // Verify Mouse Click does NOT trigger .is-keyboard-focused or black shortcut badge
    console.log('[7.5] Verifying mouse click on card does NOT show keyboard badge...');
    const testCard = await page.locator('.nav-card').first();
    await testCard.dispatchEvent('click');
    await page.waitForTimeout(200);
    const hasFocusAfterClick = await testCard.evaluate(el => el.classList.contains('is-keyboard-focused'));
    console.log(`[VERIFY 6.5] Mouse click card has .is-keyboard-focused: ${hasFocusAfterClick}`);
    if (hasFocusAfterClick) throw new Error('Mouse click on card should NOT add .is-keyboard-focused');

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

    // Step 8: Test Generating QR Code for Pairing
    console.log('[9] Testing QR code generation for pairing...');
    // Modal is already opened from step 7

    const btnShowQr = await page.locator('#btn-sync-show-qr');
    if ((await btnShowQr.count()) === 0) throw new Error('#btn-sync-show-qr must exist');
    await btnShowQr.click();
    await page.waitForTimeout(400);

    const qrOverlay = await page.locator('#nav-sync-qr-overlay');
    const qrOverlayVisible = await qrOverlay.evaluate(el => window.getComputedStyle(el).display !== 'none');
    console.log(`[VERIFY 10] QR Overlay visible: ${qrOverlayVisible}`);
    if (!qrOverlayVisible) throw new Error('QR Overlay failed to appear');

    // Wait for canvas to draw
    await page.waitForSelector('#nav-sync-qr-canvas', { state: 'visible' });
    const hasCanvasPixels = await page.evaluate(() => {
      const canvas = document.getElementById('nav-sync-qr-canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Check if there are non-transparent/non-white pixels drawn
      let darkPixels = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
        if (imgData.data[i] < 50 && imgData.data[i + 1] < 50 && imgData.data[i + 2] < 50) {
          darkPixels++;
        }
      }
      return darkPixels > 50;
    });
    console.log(`[VERIFY 11] QR Canvas has rendered QR modules: ${hasCanvasPixels}`);
    if (!hasCanvasPixels) throw new Error('QR Canvas failed to render valid QR code modules');

    // Close QR overlay
    await page.click('#btn-sync-qr-close');
    await page.waitForTimeout(200);

    // Close main sync modal
    await page.click('#nav-sync-close-btn');
    await page.waitForTimeout(200);

    // Step 9: Simulate Mobile Scanner Incoming Pairing Request
    console.log('[10] Simulating mobile scan with #sync-pair=... payload in URL...');
    const mockMobileWebDAV = {
      p: 'webdav',
      u: 'https://dav.jianguoyun.com/dav/',
      us: 'test-mobile@xiu.local',
      pw: 'mobile_secure_key_888',
      pt: '/my-favs.json',
      a: true
    };
    const b64 = Buffer.from(JSON.stringify(mockMobileWebDAV)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const mobilePage = await context.newPage();
    await mobilePage.goto(`http://127.0.0.1:${TEST_PORT}${targetPath}#sync-pair=${b64}`, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForTimeout(400);

    // Assert incoming modal is open
    const incomingModal = await mobilePage.locator('#nav-sync-incoming-modal');
    const incomingModalOpen = await incomingModal.evaluate(el => el.classList.contains('is-open'));
    console.log(`[VERIFY 12] Incoming pairing modal automatically opened: ${incomingModalOpen}`);
    if (!incomingModalOpen) throw new Error('Incoming pairing modal failed to trigger from URL hash');

    // Assert URL Hash was immediately wiped for security
    const currentUrl = mobilePage.url();
    const hashCleaned = !currentUrl.includes('#sync-pair=');
    console.log(`[VERIFY 13] Sensitive Hash wiped from URL bar immediately: ${hashCleaned} (currentUrl=${currentUrl})`);
    if (!hashCleaned) throw new Error('Sensitive pairing hash was not wiped from URL bar');

    // Verify account info rendered
    const incomingUser = await mobilePage.locator('#incoming-account-id').textContent();
    console.log(`[VERIFY 14] Incoming user identifier: "${incomingUser}"`);
    if (!incomingUser.includes('test-mobile@xiu.local')) throw new Error('Incoming account details mismatch');

    // Click confirm pairing
    console.log('[11] Confirming pairing on mobile page...');
    await mobilePage.click('#btn-incoming-confirm');
    await mobilePage.waitForTimeout(300);

    // Check LocalStorage on mobilePage
    const mobileSavedConfig = await mobilePage.evaluate(() => {
      const raw = localStorage.getItem('xiu_nav_cloud_sync_config');
      return raw ? JSON.parse(raw) : null;
    });
    console.log(`[VERIFY 15] Mobile LocalStorage received config:`, mobileSavedConfig ? {
      provider: mobileSavedConfig.provider,
      user: mobileSavedConfig.webdav?.user
    } : null);

    if (!mobileSavedConfig || mobileSavedConfig.webdav?.user !== 'test-mobile@xiu.local') {
      throw new Error('Config was not saved properly in mobile LocalStorage upon confirmation');
    }

    await mobilePage.close();

    // Step 12: Test expired QR scan rejection (> 5 minutes)
    console.log('[12] Simulating expired QR scan (> 5 minutes)...');
    const expiredPayload = {
      ...mockMobileWebDAV,
      ts: Date.now() - 360000 // 6 minutes ago
    };
    const expiredB64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const expiredPage = await context.newPage();
    await expiredPage.goto(`http://127.0.0.1:${TEST_PORT}${targetPath}#sync-pair=${expiredB64}`, { waitUntil: 'domcontentloaded' });
    await expiredPage.waitForTimeout(400);

    const expiredModal = await expiredPage.locator('#nav-sync-incoming-modal');
    const expiredModalOpen = await expiredModal.evaluate(el => el.classList.contains('is-open'));
    console.log(`[VERIFY 16] Expired pairing modal rejected & blocked: ${!expiredModalOpen}`);
    if (expiredModalOpen) throw new Error('Expired pairing payload should NOT open incoming confirmation modal');

    await expiredPage.close();

    console.log('\n================================================================');
    console.log('✅ ALL 16 CLOUD SYNC & QR PAIRING HEADLESS BROWSER VERIFICATIONS PASSED!');
    console.log('================================================================\n');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch((err) => {
  console.error('❌ Cloud Sync Verification Failed:', err);
  process.exit(1);
});
