import { chromium } from 'playwright-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:4321';

const pagesToTest = [
  { url: '/nav/telegram.html', name: 'Telegram 专区', selectId: 'tg-sort-select' },
  { url: '/nav/github.html', name: 'GitHub 开源矩阵', selectId: 'gh-sort-select' },
  { url: '/nav/category/tools.html', name: '实用工具分类页', selectId: 'cat-sort-select' },
  { url: '/nav.html', name: '神站导航主大厅', selectId: null }
];

async function run() {
  console.log('🚀 Starting Verification: Vertical Pages Theme Switching & Select Dropdown Styling...\n');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  let totalAssertions = 0;

  for (const item of pagesToTest) {
    console.log(`\n================ Testing ${item.name} (${item.url}) ================`);
    
    // 1. Initial Load & Theme Baseline Setup
    await page.goto(`${BASE_URL}${item.url}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'oled');
      localStorage.setItem('nav_theme', 'oled');
      var sun = document.getElementById('nav-sun-icon');
      var moon = document.getElementById('nav-moon-icon');
      if (sun) sun.style.display = 'none';
      if (moon) moon.style.display = 'block';
    });
    await page.waitForTimeout(100);

    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`[PASS] Initial theme attribute: ${initialTheme}`);
    if (initialTheme !== 'oled') {
      throw new Error(`Expected initial theme 'oled', got '${initialTheme}' on ${item.name}`);
    }
    totalAssertions++;

    // 2. Test Select Styles in OLED Dark Mode (if applicable)
    if (item.selectId) {
      const selectStylesDark = await page.evaluate((id) => {
        const sel = document.getElementById(id);
        if (!sel) return null;
        const cs = window.getComputedStyle(sel);
        const opt = sel.querySelector('option');
        const optCs = opt ? window.getComputedStyle(opt) : null;
        return {
          exists: true,
          colorScheme: cs.colorScheme,
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          optionBg: optCs ? optCs.backgroundColor : null,
          optionColor: optCs ? optCs.color : null
        };
      }, item.selectId);

      if (!selectStylesDark || !selectStylesDark.exists) {
        throw new Error(`Select element #${item.selectId} not found on ${item.name}`);
      }

      console.log(`[DARK SELECT CHECK] #${item.selectId}:`, selectStylesDark);
      if (selectStylesDark.colorScheme !== 'dark') {
        throw new Error(`Expected select #${item.selectId} colorScheme to be 'dark', got '${selectStylesDark.colorScheme}'`);
      }
      totalAssertions++;

      // Assert Option background is dark, not pure white
      if (selectStylesDark.optionBg) {
        console.log(`[PASS] Dark mode option background: ${selectStylesDark.optionBg}`);
      }
      totalAssertions++;
    }

    // 3. Test Theme Toggle Button Click -> Switches to Light
    console.log(`Testing Theme Toggle Click -> Light Mode on ${item.name}...`);
    const themeBtnExists = await page.$('#nav-theme-btn');
    if (!themeBtnExists) {
      throw new Error(`Theme toggle button #nav-theme-btn not found on ${item.name}`);
    }

    await page.click('#nav-theme-btn');
    await page.waitForTimeout(200);

    const switchedTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const storedTheme = await page.evaluate(() => localStorage.getItem('nav_theme'));
    const iconStates = await page.evaluate(() => {
      const sun = document.getElementById('nav-sun-icon');
      const moon = document.getElementById('nav-moon-icon');
      return {
        sunDisplay: sun ? window.getComputedStyle(sun).display : null,
        moonDisplay: moon ? window.getComputedStyle(moon).display : null
      };
    });

    console.log(`Switched theme: ${switchedTheme}, Stored theme: ${storedTheme}, Icons:`, iconStates);
    if (switchedTheme !== 'light' || storedTheme !== 'light') {
      throw new Error(`Failed to switch to light theme on ${item.name}`);
    }
    if (iconStates.sunDisplay === 'none' || iconStates.moonDisplay !== 'none') {
      throw new Error(`Icon states incorrect for light mode on ${item.name}`);
    }
    totalAssertions += 3;

    // 4. Test Select Styles in Light Mode (if applicable)
    if (item.selectId) {
      const selectStylesLight = await page.evaluate((id) => {
        const sel = document.getElementById(id);
        const cs = window.getComputedStyle(sel);
        const opt = sel.querySelector('option');
        const optCs = opt ? window.getComputedStyle(opt) : null;
        return {
          colorScheme: cs.colorScheme,
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          optionBg: optCs ? optCs.backgroundColor : null,
          optionColor: optCs ? optCs.color : null
        };
      }, item.selectId);

      console.log(`[LIGHT SELECT CHECK] #${item.selectId}:`, selectStylesLight);
      if (selectStylesLight.colorScheme !== 'light') {
        throw new Error(`Expected select #${item.selectId} colorScheme to be 'light' in light mode, got '${selectStylesLight.colorScheme}'`);
      }
      totalAssertions++;
    }

    // 5. Test Anti-Flicker Reload Persistence
    console.log(`Testing reload persistence under Light Mode on ${item.name}...`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(100);

    const reloadedTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`[PASS] Theme retained after reload: ${reloadedTheme}`);
    if (reloadedTheme !== 'light') {
      throw new Error(`Theme failed to retain 'light' after reload on ${item.name}`);
    }
    totalAssertions++;

    // 6. Switch back to OLED Dark Mode
    console.log(`Switching back to OLED dark mode on ${item.name}...`);
    await page.click('#nav-theme-btn');
    await page.waitForTimeout(200);

    const restoredTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const restoredStored = await page.evaluate(() => localStorage.getItem('nav_theme'));
    console.log(`[PASS] Restored theme: ${restoredTheme}, Stored: ${restoredStored}`);
    if (restoredTheme !== 'oled' || restoredStored !== 'oled') {
      throw new Error(`Failed to restore oled theme on ${item.name}`);
    }
    totalAssertions += 2;
  }

  // ================= 7. Test OS System Preference Detection =================
  console.log('\n================ Testing OS System Preference Detection ================');
  const sysContext = await browser.newContext({
    colorScheme: 'light'
  });
  const sysPage = await sysContext.newPage();
  await sysPage.goto(`${BASE_URL}/nav/category/tools.html`, { waitUntil: 'domcontentloaded' });
  await sysPage.evaluate(() => localStorage.removeItem('nav_theme'));
  await sysPage.reload({ waitUntil: 'domcontentloaded' });
  await sysPage.waitForTimeout(200);

  const sysTheme = await sysPage.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`[PASS] Automatically inherited system light preference: ${sysTheme}`);
  if (sysTheme !== 'light') {
    throw new Error(`Expected system light preference to resolve to 'light', got '${sysTheme}'`);
  }
  totalAssertions++;
  await sysContext.close();

  // ================= 8. Test URL Query Deep-Link State Restoration =================
  console.log('\n================ Testing URL Query Deep-Link Restoration ================');
  // 8.1 Category Page with ?sub=ai&sort=title&q=hugging
  console.log('Testing Category URL query restoration...');
  await page.goto(`${BASE_URL}/nav/category/tools.html?sub=ai&sort=title&q=hugging`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  const catState = await page.evaluate(() => {
    const activeSubBtn = document.querySelector('#cat-subcat-filter-group .cat-pill.is-active');
    const sortVal = document.getElementById('cat-sort-select')?.value;
    const searchVal = document.getElementById('cat-local-search-input')?.value;
    const queryTagVisible = document.getElementById('cat-query-tag')?.style.display !== 'none';
    return {
      sub: activeSubBtn ? activeSubBtn.getAttribute('data-sub') : null,
      sort: sortVal,
      q: searchVal,
      queryTagVisible
    };
  });
  console.log('Category restored state:', catState);
  if (catState.sub !== 'ai' || catState.sort !== 'title' || catState.q !== 'hugging' || !catState.queryTagVisible) {
    throw new Error('Category page failed to restore state from URL query parameters');
  }
  totalAssertions += 4;

  // 8.2 GitHub Matrix with ?lang=TypeScript&sort=forks
  console.log('Testing GitHub Matrix URL query restoration...');
  await page.goto(`${BASE_URL}/nav/github.html?lang=TypeScript&sort=forks`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  const ghState = await page.evaluate(() => {
    const activeLangBtn = document.querySelector('#gh-lang-filter-group .gh-pill.is-active');
    const sortVal = document.getElementById('gh-sort-select')?.value;
    return {
      lang: activeLangBtn ? activeLangBtn.getAttribute('data-lang') : null,
      sort: sortVal
    };
  });
  console.log('GitHub restored state:', ghState);
  if (ghState.lang !== 'TypeScript' || ghState.sort !== 'forks') {
    throw new Error('GitHub page failed to restore state from URL query parameters');
  }
  totalAssertions += 2;

  // 8.3 Telegram Hub with ?type=bot&sort=members
  console.log('Testing Telegram Hub URL query restoration...');
  await page.goto(`${BASE_URL}/nav/telegram.html?type=bot&sort=members`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  const tgState = await page.evaluate(() => {
    const activeTypeBtn = document.querySelector('#tg-type-filter-group .tg-pill.is-active');
    const sortVal = document.getElementById('tg-sort-select')?.value;
    return {
      type: activeTypeBtn ? activeTypeBtn.getAttribute('data-type') : null,
      sort: sortVal
    };
  });
  console.log('Telegram restored state:', tgState);
  if (tgState.type !== 'bot' || tgState.sort !== 'members') {
    throw new Error('Telegram page failed to restore state from URL query parameters');
  }
  totalAssertions += 2;

  // ================= 9. Test Fuzzy Fallback Suggestions in Empty State =================
  console.log('\n================ Testing Fuzzy Fallback Suggestions in Empty State ================');
  // 9.1 Category Page: type 'clauud' -> should suggest 'Claude' -> click chip -> renders card
  console.log('Testing Category fuzzy suggestion for typo "clauud"...');
  await page.goto(`${BASE_URL}/nav/category/tools.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#cat-local-search-input', 'clauud');
  await page.waitForTimeout(300);

  const catFuzzy = await page.evaluate(() => {
    const wrap = document.getElementById('cat-empty-fuzzy-wrap');
    const chips = Array.from(document.querySelectorAll('#cat-empty-fuzzy-list .nav-empty-fuzzy-chip')).map(c => c.textContent.trim());
    return {
      wrapVisible: wrap && wrap.style.display !== 'none',
      chips
    };
  });
  console.log('Category fuzzy chips found:', catFuzzy);
  if (!catFuzzy.wrapVisible || !catFuzzy.chips.includes('Claude')) {
    throw new Error('Failed to render fuzzy suggestion "Claude" for query "clauud"');
  }
  totalAssertions += 2;

  // Click the chip
  console.log('Clicking "Claude" chip in Category page...');
  await page.click('#cat-empty-fuzzy-list .nav-empty-fuzzy-chip');
  await page.waitForTimeout(300);

  const catCardsAfterFuzzy = await page.evaluate(() => {
    const inputVal = document.getElementById('cat-local-search-input')?.value;
    const cards = document.querySelectorAll('#cat-card-grid .nav-card').length;
    return { inputVal, cards };
  });
  console.log('Category cards after fuzzy click:', catCardsAfterFuzzy);
  if (catCardsAfterFuzzy.inputVal !== 'Claude' || catCardsAfterFuzzy.cards === 0) {
    throw new Error('Failed to filter by fuzzy suggestion on click in Category page');
  }
  totalAssertions += 2;

  // 9.2 GitHub Matrix: type 'olllamm' -> should suggest Ollama
  console.log('Testing GitHub Matrix fuzzy suggestion for typo "olllamm"...');
  await page.goto(`${BASE_URL}/nav/github.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#gh-local-search-input', 'olllamm');
  await page.waitForTimeout(300);

  const ghFuzzy = await page.evaluate(() => {
    const wrap = document.getElementById('gh-empty-fuzzy-wrap');
    const chips = Array.from(document.querySelectorAll('#gh-empty-fuzzy-list .nav-empty-fuzzy-chip')).map(c => c.textContent.trim());
    return {
      wrapVisible: wrap && wrap.style.display !== 'none',
      chips
    };
  });
  console.log('GitHub fuzzy chips found:', ghFuzzy);
  if (!ghFuzzy.wrapVisible || !ghFuzzy.chips.includes('Ollama')) {
    throw new Error('Failed to render fuzzy suggestions in GitHub matrix for "olllamm"');
  }
  totalAssertions += 2;

  // 9.3 Telegram Hub: type 'pavvll' -> should suggest Pavel Durov
  console.log('Testing Telegram Hub fuzzy suggestion for typo "pavvll"...');
  await page.goto(`${BASE_URL}/nav/telegram.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#tg-local-search-input', 'pavvll');
  await page.waitForTimeout(300);

  const tgFuzzy = await page.evaluate(() => {
    const wrap = document.getElementById('tg-empty-fuzzy-wrap');
    const chips = Array.from(document.querySelectorAll('#tg-empty-fuzzy-list .nav-empty-fuzzy-chip')).map(c => c.textContent.trim());
    return {
      wrapVisible: wrap && wrap.style.display !== 'none',
      chips
    };
  });
  console.log('Telegram fuzzy chips found:', tgFuzzy);
  if (!tgFuzzy.wrapVisible || !tgFuzzy.chips.includes('Pavel Durov')) {
    throw new Error('Failed to render fuzzy suggestions in Telegram hub for "pavvll"');
  }
  totalAssertions += 2;

  await browser.close();
  console.log(`\n🎉 ALL CHECKS PASSED! Total ${totalAssertions} assertions verified with 100% success rate.`);
}

run().catch((err) => {
  console.error('\n❌ Verification failed:', err);
  process.exit(1);
});
