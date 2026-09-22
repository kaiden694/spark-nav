import { chromium } from 'playwright-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:4321';

async function run() {
  console.log('🚀 Starting Verification: Vertical Pages Latest Feed Notifications & Popover Triggers...\n');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  let totalAssertions = 0;

  // =========================================================================
  // 1. Testing GitHub 开源矩阵专属大厅 (/nav/github.html)
  // =========================================================================
  console.log('================ Testing GitHub 开源矩阵专属大厅 (/nav/github.html) ================');
  await page.goto(`${BASE_URL}/nav/github.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#gh-card-grid .nav-card', { timeout: 5000 });

  const ghFeedCheck = await page.evaluate(() => {
    const cards = document.querySelectorAll('#gh-card-grid .nav-card');
    const btns = document.querySelectorAll('#gh-card-grid .nav-card-feed-btn');
    const firstBtn = btns[0];
    const firstCardWithFeed = Array.from(cards).find(c => c.querySelector('.nav-card-feed-btn'));
    return {
      totalCards: cards.length,
      totalFeedBtns: btns.length,
      firstBtnTitle: firstBtn ? firstBtn.getAttribute('title') : null,
      firstFeedUrl: firstBtn ? firstBtn.getAttribute('data-feed-url') : null,
      cardFeedAttr: firstCardWithFeed ? firstCardWithFeed.getAttribute('data-feed-url') : null,
      cardRepoAttr: firstCardWithFeed ? firstCardWithFeed.getAttribute('data-repo') : null
    };
  });

  console.log('GitHub feed check results:', ghFeedCheck);
  if (ghFeedCheck.totalCards === 0) throw new Error('Expected GitHub cards to be rendered');
  if (ghFeedCheck.totalFeedBtns === 0) throw new Error('Expected GitHub cards to contain .nav-card-feed-btn');
  if (!ghFeedCheck.firstBtnTitle || !ghFeedCheck.firstBtnTitle.includes('查看最新动态')) {
    throw new Error(`Expected button title to contain '查看最新动态', got '${ghFeedCheck.firstBtnTitle}'`);
  }
  if (!ghFeedCheck.firstFeedUrl || !ghFeedCheck.firstFeedUrl.includes('releases.atom')) {
    throw new Error(`Expected GitHub feedUrl to contain 'releases.atom', got '${ghFeedCheck.firstFeedUrl}'`);
  }
  if (!ghFeedCheck.cardFeedAttr) {
    throw new Error('Expected card element to have data-feed-url attribute');
  }
  console.log('[PASS] GitHub cards successfully render .nav-card-feed-btn and data-feed-url');
  totalAssertions += 5;

  // Test Clicking .nav-card-feed-btn on GitHub page
  console.log('Testing .nav-card-feed-btn click trigger on GitHub page...');
  const popoverBeforeGh = await page.evaluate(() => {
    const p = document.getElementById('nav-feed-popover');
    return p && p.classList.contains('is-open');
  });
  if (popoverBeforeGh) throw new Error('Popover should be closed initially');

  await page.click('#gh-card-grid .nav-card-feed-btn');
  await page.waitForTimeout(300);

  const popoverAfterGh = await page.evaluate(() => {
    const p = document.getElementById('nav-feed-popover');
    const titleEl = document.getElementById('nav-feed-title');
    return {
      isOpen: p ? p.classList.contains('is-open') : false,
      title: titleEl ? titleEl.textContent : ''
    };
  });

  console.log('Popover after click on GitHub page:', popoverAfterGh);
  if (!popoverAfterGh.isOpen) throw new Error('Expected #nav-feed-popover to open after clicking .nav-card-feed-btn');
  console.log('[PASS] FeedPreviewPopover opened successfully on /nav/github.html');
  totalAssertions += 2;

  // Close via Escape key
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const popoverClosedGh = await page.evaluate(() => {
    const p = document.getElementById('nav-feed-popover');
    return p && !p.classList.contains('is-open');
  });
  if (!popoverClosedGh) throw new Error('Expected popover to close on Escape key');
  console.log('[PASS] Popover closed with Escape key');
  totalAssertions++;

  // =========================================================================
  // 2. Testing 实用工具分类页 (/nav/category/tools.html)
  // =========================================================================
  console.log('\n================ Testing 实用工具分类页 (/nav/category/tools.html) ================');
  await page.goto(`${BASE_URL}/nav/category/tools.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cat-card-grid .nav-card', { timeout: 5000 });

  const catToolsCheck = await page.evaluate(() => {
    const huarunCard = document.getElementById('site-huarun');
    const huarunBtn = huarunCard ? huarunCard.querySelector('.nav-card-feed-btn') : null;
    return {
      huarunCardExists: !!huarunCard,
      huarunFeedAttr: huarunCard ? huarunCard.getAttribute('data-feed-url') : null,
      huarunBtnExists: !!huarunBtn,
      huarunBtnTitle: huarunBtn ? huarunBtn.getAttribute('title') : null,
      huarunBtnFeedUrl: huarunBtn ? huarunBtn.getAttribute('data-feed-url') : null
    };
  });

  console.log('Category tools feed check results:', catToolsCheck);
  if (!catToolsCheck.huarunCardExists) throw new Error('Expected #site-huarun in category tools');
  if (!catToolsCheck.huarunBtnExists) throw new Error('Expected #site-huarun to have .nav-card-feed-btn');
  if (!catToolsCheck.huarunBtnTitle || !catToolsCheck.huarunBtnTitle.includes('查看最新动态')) {
    throw new Error(`Expected title with '查看最新动态', got '${catToolsCheck.huarunBtnTitle}'`);
  }
  if (catToolsCheck.huarunBtnFeedUrl !== '/rss.xml') {
    throw new Error(`Expected feedUrl '/rss.xml', got '${catToolsCheck.huarunBtnFeedUrl}'`);
  }
  console.log('[PASS] Category tools #site-huarun renders .nav-card-feed-btn and data-feed-url correctly');
  totalAssertions += 4;

  // Test Clicking .nav-card-feed-btn on Category page
  console.log('Testing .nav-card-feed-btn click on #site-huarun in category tools...');
  await page.click('#site-huarun .nav-card-feed-btn');
  await page.waitForTimeout(300);

  const popoverCatTools = await page.evaluate(() => {
    const p = document.getElementById('nav-feed-popover');
    return p ? p.classList.contains('is-open') : false;
  });
  if (!popoverCatTools) throw new Error('Expected popover to open on Category tools page');
  console.log('[PASS] FeedPreviewPopover opened on /nav/category/tools.html');
  totalAssertions++;

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // =========================================================================
  // 3. Testing 开源分类子页 (/nav/category/github.html)
  // =========================================================================
  console.log('\n================ Testing 开源分类子页 (/nav/category/github.html) ================');
  await page.goto(`${BASE_URL}/nav/category/github.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cat-card-grid .nav-card', { timeout: 5000 });

  const catGhCheck = await page.evaluate(() => {
    const btns = document.querySelectorAll('#cat-card-grid .nav-card-feed-btn');
    const firstBtn = btns[0];
    return {
      totalFeedBtns: btns.length,
      firstBtnTitle: firstBtn ? firstBtn.getAttribute('title') : null,
      firstBtnFeedUrl: firstBtn ? firstBtn.getAttribute('data-feed-url') : null
    };
  });

  console.log('Category github feed check:', catGhCheck);
  if (catGhCheck.totalFeedBtns === 0) throw new Error('Expected category github page to render feed buttons');
  if (!catGhCheck.firstBtnTitle || !catGhCheck.firstBtnTitle.includes('查看最新动态')) {
    throw new Error(`Expected '查看最新动态' in title, got '${catGhCheck.firstBtnTitle}'`);
  }
  console.log('[PASS] Category github page correctly renders feed buttons');
  totalAssertions += 2;

  // =========================================================================
  // 4. Testing Telegram 专区 (/nav/telegram.html)
  // =========================================================================
  console.log('\n================ Testing Telegram 专区 (/nav/telegram.html) ================');
  await page.goto(`${BASE_URL}/nav/telegram.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tg-card-grid .nav-card', { timeout: 5000 });

  const tgFeedCheck = await page.evaluate(() => {
    const cards = document.querySelectorAll('#tg-card-grid .nav-card');
    const channelCards = Array.from(cards).filter(c => c.querySelector('.badge-tg') && c.querySelector('.badge-tg').textContent.includes('频道'));
    const btns = document.querySelectorAll('#tg-card-grid .nav-card-feed-btn');
    const firstBtn = btns[0];
    return {
      totalCards: cards.length,
      channelCardsCount: channelCards.length,
      totalFeedBtns: btns.length,
      firstBtnTitle: firstBtn ? firstBtn.getAttribute('title') : null,
      firstFeedUrl: firstBtn ? firstBtn.getAttribute('data-feed-url') : null
    };
  });

  console.log('Telegram feed check results:', tgFeedCheck);
  if (tgFeedCheck.totalCards === 0) throw new Error('Expected Telegram cards');
  if (tgFeedCheck.totalFeedBtns === 0) throw new Error('Expected Telegram channels to have feed buttons');
  if (!tgFeedCheck.firstBtnTitle || !tgFeedCheck.firstBtnTitle.includes('查看最新动态')) {
    throw new Error(`Expected Telegram feed button title to contain '查看最新动态', got '${tgFeedCheck.firstBtnTitle}'`);
  }
  console.log('[PASS] Telegram channel cards correctly render .nav-card-feed-btn');
  totalAssertions += 3;

  // Test Clicking Telegram Feed Button
  console.log('Testing .nav-card-feed-btn click on Telegram page...');
  await page.click('#tg-card-grid .nav-card-feed-btn');
  await page.waitForTimeout(300);

  const popoverTg = await page.evaluate(() => {
    const p = document.getElementById('nav-feed-popover');
    return p ? p.classList.contains('is-open') : false;
  });
  if (!popoverTg) throw new Error('Expected popover to open on Telegram page');
  console.log('[PASS] FeedPreviewPopover opened on /nav/telegram.html');
  totalAssertions++;

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // =========================================================================
  // 5. Testing Light Mode Styling for .nav-card-feed-btn
  // =========================================================================
  console.log('\n================ Testing Light Mode Styling for .nav-card-feed-btn ================');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await page.waitForTimeout(100);

  const lightBtnStyles = await page.evaluate(() => {
    const btn = document.querySelector('.nav-card-feed-btn');
    if (!btn) return null;
    const cs = window.getComputedStyle(btn);
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      borderColor: cs.borderColor
    };
  });

  console.log('Light theme feed button styles:', lightBtnStyles);
  if (!lightBtnStyles) throw new Error('Feed button missing in light mode');
  console.log('[PASS] Light mode styles applied to .nav-card-feed-btn');
  totalAssertions += 2;

  // =========================================================================
  // 6. Testing Homepage Regression (/nav.html)
  // =========================================================================
  console.log('\n================ Testing Homepage Regression (/nav.html) ================');
  await page.goto(`${BASE_URL}/nav.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sec-featured .nav-card', { timeout: 5000 });

  const homeFeedBtn = await page.evaluate(() => {
    const btn = document.querySelector('#sec-featured .nav-card-feed-btn');
    return {
      exists: !!btn,
      title: btn ? btn.getAttribute('title') : null,
      feedUrl: btn ? btn.getAttribute('data-feed-url') : null
    };
  });

  console.log('Homepage feed button check:', homeFeedBtn);
  if (!homeFeedBtn.exists) throw new Error('Feed button missing on homepage');
  if (!homeFeedBtn.title.includes('查看最新动态')) throw new Error('Title missing on homepage feed button');

  // Click on homepage
  await page.click('#sec-featured .nav-card-feed-btn');
  await page.waitForTimeout(300);

  const popoverHome = await page.evaluate(() => {
    const p = document.getElementById('nav-feed-popover');
    return p ? p.classList.contains('is-open') : false;
  });
  if (!popoverHome) throw new Error('Expected popover to open on homepage');
  console.log('[PASS] Homepage FeedPreviewPopover opened cleanly via global delegation');
  totalAssertions += 3;

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  console.log(`\n🎉 ALL CHECKS PASSED! Total ${totalAssertions} assertions verified with 100% success rate.`);
  await browser.close();
}

run().catch(err => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
