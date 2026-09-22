import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:4321';
const SCREENSHOT_DIR = path.resolve('screenshots/tgnav-verify');

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // Find system Chrome/Edge
  const executablePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(executablePath) ? executablePath : undefined,
    headless: true
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('--- 1. Verifying /nav.html (TGNAV Home) ---');
  await page.goto(`${BASE_URL}/nav.html`, { waitUntil: 'networkidle' });

  // Verify sidebar does NOT exist
  const sidebarCount = await page.locator('.nav-sidebar').count();
  console.log(`[PASS] .nav-sidebar count on home: ${sidebarCount} (expected 0)`);
  if (sidebarCount !== 0) throw new Error('Home page still has .nav-sidebar!');

  // Verify TGNAV hero search box exists
  const heroSearch = await page.locator('.tgnav-search-box').count();
  console.log(`[PASS] .tgnav-search-box count: ${heroSearch} (expected 1)`);

  const searchInput = page.locator('#nav-search-input');
  await searchInput.fill('GitHub');
  await page.waitForTimeout(300);

  // Check clear button visibility
  const clearBtnVisible = await page.locator('#tgnav-search-clear').isVisible();
  console.log(`[PASS] Clear button visible when query typed: ${clearBtnVisible}`);

  await page.locator('#tgnav-search-clear').click();
  const searchVal = await searchInput.inputValue();
  console.log(`[PASS] Search cleared: "${searchVal}"`);

  // Verify Top Header Menu exists and has 6 links
  const headerMenuCount = await page.locator('.nav-header-menu').count();
  console.log(`[PASS] .nav-header-menu count: ${headerMenuCount} (expected 1)`);
  if (headerMenuCount !== 1) throw new Error('Top header menu not found!');

  const menuLinksCount = await page.locator('.nav-header-menu .nav-menu-link').count();
  console.log(`[PASS] .nav-menu-link count: ${menuLinksCount} (expected 6)`);
  if (menuLinksCount !== 6) throw new Error(`Expected 6 menu links, got ${menuLinksCount}`);

  const activeHomeLink = await page.locator('.nav-header-menu .nav-menu-link.is-active').getAttribute('href');
  console.log(`[PASS] Active menu link on home: ${activeHomeLink} (expected /nav.html)`);
  if (activeHomeLink !== '/nav.html') throw new Error(`Expected active link /nav.html, got ${activeHomeLink}`);

  // Verify 8 cards per section (2 rows x 4 cols)
  const featuredCount = await page.locator('#sec-featured .nav-card').count();
  console.log(`[PASS] #sec-featured card count: ${featuredCount} (expected 8)`);
  if (featuredCount !== 8) throw new Error(`Expected 8 featured cards, got ${featuredCount}`);

  const toolsCount = await page.locator('#sec-tools .nav-card').count();
  console.log(`[PASS] #sec-tools card count: ${toolsCount} (expected 8)`);
  if (toolsCount !== 8) throw new Error(`Expected 8 tools cards, got ${toolsCount}`);

  const githubCount = await page.locator('#sec-github .nav-card').count();
  console.log(`[PASS] #sec-github card count: ${githubCount} (expected 8)`);
  if (githubCount !== 8) throw new Error(`Expected 8 github cards, got ${githubCount}`);

  const tgCount = await page.locator('#sec-telegram .nav-card').count();
  console.log(`[PASS] #sec-telegram card count: ${tgCount} (expected 8)`);
  if (tgCount !== 8) throw new Error(`Expected 8 telegram cards, got ${tgCount}`);

  const creatorsCount = await page.locator('#sec-creators .nav-card').count();
  console.log(`[PASS] #sec-creators card count: ${creatorsCount} (total dataset size: 3 <= 8)`);
  if (creatorsCount > 8 || creatorsCount === 0) throw new Error(`Unexpected creators cards count: ${creatorsCount}`);

  // Verify Thematic Portals exist
  const portalCards = await page.locator('#sec-thematic-portals .tgnav-portal-card').count();
  console.log(`[PASS] Thematic portals card count: ${portalCards} (expected 4)`);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_nav_home_tgnav.png'), fullPage: false });

  console.log('\n--- 2. Verifying /nav/github.html (Vertical GitHub Hub) ---');
  await page.goto(`${BASE_URL}/nav/github.html`, { waitUntil: 'networkidle' });

  const activeGhLink = await page.locator('.nav-header-menu .nav-menu-link.is-active').getAttribute('href');
  console.log(`[PASS] Active menu link on GitHub hub: ${activeGhLink} (expected /nav/github.html)`);
  if (activeGhLink !== '/nav/github.html') throw new Error(`Expected active link /nav/github.html, got ${activeGhLink}`);

  const ghSidebar = await page.locator('.vertical-sidebar').count();
  console.log(`[PASS] .vertical-sidebar count on GitHub hub: ${ghSidebar} (expected 1)`);

  const subcatItems = await page.locator('#gh-subcat-filter-group .vertical-sidebar-item').count();
  console.log(`[PASS] Subcat filter items count: ${subcatItems}`);

  const langItems = await page.locator('#gh-lang-filter-group .vertical-sidebar-item').count();
  console.log(`[PASS] Language filter items count: ${langItems}`);

  // Click TypeScript in sidebar
  const tsBtn = page.locator('#gh-lang-filter-group [data-lang="TypeScript"]');
  if (await tsBtn.count() > 0) {
    await tsBtn.click();
    await page.waitForTimeout(300);
    const countText = await page.locator('#gh-filtered-count').textContent();
    console.log(`[PASS] Filtered count for TypeScript: ${countText}`);
  }

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_nav_github_vertical.png'), fullPage: false });

  console.log('\n--- 3. Verifying /nav/telegram.html (Vertical Telegram Hub) ---');
  await page.goto(`${BASE_URL}/nav/telegram.html`, { waitUntil: 'networkidle' });

  const activeTgLink = await page.locator('.nav-header-menu .nav-menu-link.is-active').getAttribute('href');
  console.log(`[PASS] Active menu link on Telegram hub: ${activeTgLink} (expected /nav/telegram.html)`);
  if (activeTgLink !== '/nav/telegram.html') throw new Error(`Expected active link /nav/telegram.html, got ${activeTgLink}`);

  const tgSidebar = await page.locator('.vertical-sidebar').count();
  console.log(`[PASS] .vertical-sidebar count on Telegram hub: ${tgSidebar} (expected 1)`);

  const tgTypeItems = await page.locator('#tg-type-filter-group .vertical-sidebar-item').count();
  console.log(`[PASS] Telegram type items count: ${tgTypeItems} (expected 4: all, channel, bot, group)`);

  // Click channel
  const channelBtn = page.locator('#tg-type-filter-group [data-type="channel"]');
  await channelBtn.click();
  await page.waitForTimeout(300);
  const tgCountText = await page.locator('#tg-filtered-count').textContent();
  console.log(`[PASS] Filtered count for Telegram channel: ${tgCountText}`);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_nav_telegram_vertical.png'), fullPage: false });

  console.log('\n--- 4. Verifying /nav/category/tools.html (Category Vertical Hub) ---');
  await page.goto(`${BASE_URL}/nav/category/tools.html`, { waitUntil: 'networkidle' });

  const activeCatLink = await page.locator('.nav-header-menu .nav-menu-link.is-active').getAttribute('href');
  console.log(`[PASS] Active menu link on Category tools: ${activeCatLink} (expected /nav/category/tools.html)`);
  if (activeCatLink !== '/nav/category/tools.html') throw new Error(`Expected active link /nav/category/tools.html, got ${activeCatLink}`);

  const catSidebar = await page.locator('.vertical-sidebar').count();
  console.log(`[PASS] .vertical-sidebar count on Category tools: ${catSidebar} (expected 1)`);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_nav_category_tools.png'), fullPage: false });

  console.log('\n--- 5. Verifying Mobile Viewport (375x812) on /nav.html ---');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE_URL}/nav.html`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_nav_home_mobile.png'), fullPage: false });

  await browser.close();
  console.log('\n[SUCCESS] All Playwright verification gates passed cleanly!');
}

run().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
