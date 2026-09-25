import { chromium } from 'playwright-core';
import { findBrowser } from './lib/pages-runtime.mjs';

async function main() {
  console.log('🚀 Starting Navigation Favorites Persistence E2E Test...');
  const browserPath = findBrowser();
  console.log(`Using browser at: ${browserPath}`);

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox']
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    // 1. Wait for dev server readiness
    const maxRetries = 25;
    let ready = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch('http://localhost:4321/nav.html');
        if (res.ok) {
          ready = true;
          break;
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 600));
      }
    }
    if (!ready) {
      throw new Error('Dev server at http://localhost:4321/nav.html is not reachable.');
    }

    // 2. Visit nav home page
    await page.goto('http://localhost:4321/nav.html', { waitUntil: 'networkidle' });
    console.log('✓ Page loaded: /nav.html');

    // Clear any leftover favorites from previous tests
    await page.evaluate(() => {
      localStorage.removeItem('xiu_nav_user_favorites');
      if (typeof window.clearNavFavorites === 'function') window.clearNavFavorites();
    });
    await page.reload({ waitUntil: 'networkidle' });

    // 2. Verify initial state (no favorites)
    const initialDisplay = await page.$eval('#sec-user-favorites', el => window.getComputedStyle(el).display);
    console.log(`[Check 1] Initial favorites section display: ${initialDisplay}`);
    if (initialDisplay !== 'none') {
      throw new Error(`Expected favorites section to be hidden initially, got: ${initialDisplay}`);
    }

    // 3. Find first card pin button and click it
    const firstPinBtn = await page.waitForSelector('.nav-card-pin-btn');
    const cardId = await firstPinBtn.getAttribute('data-id');
    console.log(`Found card to pin: ID = ${cardId}`);

    await firstPinBtn.click();
    await page.waitForTimeout(300);

    // 4. Verify favorites section is now visible and contains item
    const afterPinDisplay = await page.$eval('#sec-user-favorites', el => window.getComputedStyle(el).display);
    const favCount = await page.$$eval('#nav-favorites-grid .nav-card', els => els.length);
    const isPinnedClass = await firstPinBtn.evaluate(el => el.classList.contains('is-pinned'));
    console.log(`[Check 2] After pin - Section display: ${afterPinDisplay}, Count: ${favCount}, isPinnedClass: ${isPinnedClass}`);

    if (afterPinDisplay === 'none' || favCount !== 1 || !isPinnedClass) {
      throw new Error(`Failed to pin card properly: display=${afterPinDisplay}, count=${favCount}, isPinned=${isPinnedClass}`);
    }

    const lsData = await page.evaluate(() => localStorage.getItem('xiu_nav_user_favorites'));
    console.log(`[Check 3] LocalStorage state: ${lsData}`);
    if (!lsData || !lsData.includes(cardId)) {
      throw new Error(`LocalStorage does not contain cardId ${cardId}`);
    }

    // 5. CRITICAL TEST: Refresh page (F5)
    console.log('🔄 Reloading page (simulating F5 browser refresh)...');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // 6. Check that favorites section SURVIVES the refresh!
    const reloadedDisplay = await page.$eval('#sec-user-favorites', el => window.getComputedStyle(el).display);
    const reloadedCount = await page.$$eval('#nav-favorites-grid .nav-card', els => els.length);
    const reloadedCardId = await page.$eval('#nav-favorites-grid .nav-card', el => el.id);
    const mainCardPinBtnClass = await page.$eval(`.nav-card-pin-btn[data-id="${cardId}"]`, el => el.classList.contains('is-pinned'));

    console.log(`[Check 4] AFTER REFRESH - Section display: ${reloadedDisplay}, Count: ${reloadedCount}, Card ID: ${reloadedCardId}, Main pin class: ${mainCardPinBtnClass}`);

    if (reloadedDisplay === 'none') {
      throw new Error('FAILED: Favorites section became hidden after page refresh!');
    }
    if (reloadedCount !== 1) {
      throw new Error(`FAILED: Expected 1 favorite card after refresh, found: ${reloadedCount}`);
    }
    if (!mainCardPinBtnClass) {
      throw new Error('FAILED: Pin button lost is-pinned class after refresh!');
    }

    // 7. Test category and github pages for pin state synchronization
    console.log('🔄 Navigating to /nav/github.html to verify cross-page pin synchronization...');
    await page.goto('http://localhost:4321/nav/github.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const githubStoreReady = await page.evaluate(() => typeof window.getNavFavorites === 'function');
    const githubFavCount = await page.evaluate(() => window.getNavFavorites().length);
    console.log(`[Check 5] /nav/github.html - Store available: ${githubStoreReady}, Favorites count: ${githubFavCount}`);
    if (!githubStoreReady || githubFavCount !== 1) {
      throw new Error(`Store not properly initialized on /nav/github.html`);
    }

    // 8. Unpin and verify cleanup
    console.log('🔄 Returning to /nav.html to test unpinning...');
    await page.goto('http://localhost:4321/nav.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const unpinBtn = await page.waitForSelector(`#nav-favorites-grid .nav-card-pin-btn[data-id="${cardId}"]`);
    await unpinBtn.click();
    await page.waitForTimeout(300);

    const finalDisplay = await page.$eval('#sec-user-favorites', el => window.getComputedStyle(el).display);
    const finalLs = await page.evaluate(() => localStorage.getItem('xiu_nav_user_favorites'));
    console.log(`[Check 6] After unpin - Section display: ${finalDisplay}, LocalStorage: ${finalLs}`);

    if (finalDisplay !== 'none') {
      throw new Error(`Expected favorites section to hide after unpinning, got display: ${finalDisplay}`);
    }

    // 9. Reload again to verify clean state
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const afterReloadCleanDisplay = await page.$eval('#sec-user-favorites', el => window.getComputedStyle(el).display);
    console.log(`[Check 7] Final reload display: ${afterReloadCleanDisplay}`);
    if (afterReloadCleanDisplay !== 'none') {
      throw new Error('Favorites section should remain hidden after refresh when empty');
    }

    // 10. Robustness Test: Edge & Gap Clicking to verify ZERO Link Navigation
    console.log('🛡️ Testing edge-click, gap-click, and mouseup drift protection...');
    const testCard = await page.waitForSelector('.nav-card:not(#sec-user-favorites .nav-card)');
    const testPinBtn = await testCard.$('.nav-card-pin-btn');
    const initialUrl = page.url();

    // 10a. Click at top-left edge of the pin button (1px from boundary)
    const pinBox = await testPinBtn.boundingBox();
    if (pinBox) {
      await page.mouse.click(pinBox.x + 1, pinBox.y + 1);
      await page.waitForTimeout(200);
      if (page.url() !== initialUrl) {
        throw new Error(`Edge-click caused navigation away to ${page.url()}!`);
      }

      // 10b. Mouse down inside button, mouseup 4px outside button (simulating active shrink / drift)
      await page.mouse.move(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(pinBox.x + pinBox.width + 4, pinBox.y + pinBox.height / 2);
      await page.mouse.up();
      await page.waitForTimeout(200);
      if (page.url() !== initialUrl) {
        throw new Error(`Drift mouseup caused navigation away to ${page.url()}!`);
      }
    }

    // 10c. Click on the actions-group directly (in the gap between buttons)
    const actionsGroup = await testCard.$('.nav-card-actions-group');
    if (actionsGroup) {
      const groupBox = await actionsGroup.boundingBox();
      if (groupBox) {
        await page.mouse.click(groupBox.x + groupBox.width / 2, groupBox.y + groupBox.height / 2);
        await page.waitForTimeout(200);
        if (page.url() !== initialUrl) {
          throw new Error(`Actions group gap-click caused navigation away to ${page.url()}!`);
        }
      }
    }
    console.log('✓ Zero Link Navigation confirmed: all edge, drift, and gap clicks safely intercepted!');

    console.log('\n🎉 ALL FAVORITES PERSISTENCE & HIT-SHIELD TESTS PASSED 100%!');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
