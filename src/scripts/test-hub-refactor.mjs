import { chromium } from 'playwright-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('[STEP 1] Navigating to http://127.0.0.1:8788/nav/category/tools.html');
  await page.goto('http://127.0.0.1:8788/nav/category/tools.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // 1. Verify Elevator is gone
  const elevatorBar = await page.$('.cat-elevator-bar');
  console.log('[CHECK 1] Elevator Bar exists:', !!elevatorBar);

  // 2. Verify Vertical Sidebar & Layout
  const verticalLayout = await page.$('.vertical-layout');
  const verticalSidebar = await page.$('.vertical-sidebar');
  const sidebarItems = await page.$$('.vertical-sidebar-item');
  console.log('[CHECK 2] Vertical Layout exists:', !!verticalLayout);
  console.log('[CHECK 3] Vertical Sidebar exists:', !!verticalSidebar);
  console.log('[CHECK 4] Sidebar Item count:', sidebarItems.length);

  // 3. Verify Card Grid Default View
  const cards = await page.$$('.nav-card');
  console.log('[CHECK 5] Initial Rendered Cards count:', cards.length);

  // 4. Test Light Mode Screenshot
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'C:/Users/admin/.gemini/antigravity/brain/dd299214-a7e8-4335-88bd-64eaf9933a9d/tools_hub_light.png', fullPage: false });

  // 5. Click a Subcategory (e.g. dev-system)
  console.log('[STEP 2] Clicking subcategory "dev-system" in sidebar');
  const devSystemBtn = await page.$('button[data-sub="dev-system"]');
  if (devSystemBtn) {
    await devSystemBtn.click();
    await page.waitForTimeout(400);
    const filteredCards = await page.$$('.nav-card');
    const filteredCountText = await page.$eval('#cat-filtered-count', el => el.textContent.trim());
    console.log('[CHECK 6] Filtered Cards count after clicking dev-system:', filteredCards.length);
    console.log('[CHECK 7] Status bar text count:', filteredCountText);
    await page.screenshot({ path: 'C:/Users/admin/.gemini/antigravity/brain/dd299214-a7e8-4335-88bd-64eaf9933a9d/tools_hub_subcat_filtered.png', fullPage: false });
  }

  // 6. Test OLED Mode Screenshot
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'oled');
    localStorage.setItem('theme', 'oled');
  });
  await page.waitForTimeout(400);
  // Click back to all
  const allBtn = await page.$('button[data-sub="all"]');
  if (allBtn) await allBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'C:/Users/admin/.gemini/antigravity/brain/dd299214-a7e8-4335-88bd-64eaf9933a9d/tools_hub_oled.png', fullPage: false });

  console.log('[SUCCESS] All checks completed.');
  await browser.close();
})();
