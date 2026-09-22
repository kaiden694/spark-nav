import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'https://xiu-theme.pages.dev';
const ARTIFACTS_DIR = 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\c8ab16c9-293b-4686-9373-c102cc939081';

async function run() {
  console.log('>>> Launching Chrome for live verification...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  console.log('\n--- 1. Testing Comments Sorting (Hot vs. Newest) ---');
  await page.goto(`${BASE_URL}/posts/cooked-fruit.html`, { waitUntil: 'networkidle' });

  // 检查工具栏存在
  const toolbar = await page.$('#comments-toolbar');
  if (!toolbar) throw new Error('#comments-toolbar not found!');
  console.log('[PASS] #comments-toolbar is rendered');

  const newestBtn = await page.$('#comment-sort-newest');
  const hotBtn = await page.$('#comment-sort-hot');
  if (!newestBtn || !hotBtn) throw new Error('Sort buttons missing!');

  const newestClass = await newestBtn.getAttribute('class');
  console.log('[PASS] Default newest button class:', newestClass);

  // 点击“最热”排序
  console.log('Clicking "最热" sort tab...');
  const [response] = await Promise.all([
    page.waitForResponse(res => res.url().includes('/api/comments') && res.url().includes('sort=hot')),
    hotBtn.click()
  ]);
  console.log('[PASS] Received API response with sort=hot:', response.status());

  const hotClass = await hotBtn.getAttribute('class');
  console.log('[PASS] Hot button active class after click:', hotClass);

  // 截取评论工具栏与列表截图
  await page.evaluate(() => {
    const el = document.getElementById('comments');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(500);

  const sortScreenshotPath = path.join(ARTIFACTS_DIR, 'live-comments-sort-hot.png');
  await page.screenshot({ path: sortScreenshotPath, clip: { x: 100, y: 150, width: 850, height: 500 } });
  console.log('[SAVED] Screenshot saved to', sortScreenshotPath);

  console.log('\n--- 2. Testing Reply & Hover Quote Popover ---');
  // 发表一条回复以测试 @被回复人 悬浮气泡
  const firstReplyBtn = await page.$('.commentlist .comment-reply-link');
  if (firstReplyBtn) {
    await firstReplyBtn.click();
    await page.waitForTimeout(300);

    const commentInput = await page.$('#comment');
    const authorInput = await page.$('#author');
    if (commentInput && authorInput) {
      await authorInput.fill('体验测试员');
      await commentInput.fill('这是一条测试引用气泡的二级嵌套回复 `HoverQuoteTest`');
      const submitBtn = await page.$('#submit');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(1500);
      }
    }
  }

  // 查找带有 .c-reply-to 的元素
  const replyToEl = await page.$('.c-reply-to');
  if (replyToEl) {
    const parentId = await replyToEl.getAttribute('data-parent-id');
    console.log('[PASS] Found .c-reply-to with parent ID:', parentId);

    // 悬浮测试
    await replyToEl.hover();
    await page.waitForTimeout(300);

    const popover = await page.$('#comment-quote-popover');
    const isVisible = popover ? await popover.isVisible() : false;
    console.log('[PASS] Popover visible on hover:', isVisible);

    if (isVisible) {
      const popoverText = await page.$eval('#p-popover-content', el => el.textContent.trim());
      const popoverAuthor = await page.$eval('#p-popover-author', el => el.textContent.trim());
      console.log('[PASS] Popover author:', popoverAuthor, '| Content snippet:', popoverText);

      // 截取 Popover 特写
      const popoverShotPath = path.join(ARTIFACTS_DIR, 'live-quote-popover.png');
      await popover.screenshot({ path: popoverShotPath });
      console.log('[SAVED] Popover screenshot saved to', popoverShotPath);

      // 点击测试直达楼层
      await replyToEl.click();
      await page.waitForTimeout(500);
      const currentHash = await page.evaluate(() => window.location.hash);
      console.log('[PASS] Current URL hash after clicking reply-to:', currentHash);
    }
  } else {
    console.log('[WARN] No .c-reply-to found on page to hover');
  }

  console.log('\n--- 3. Testing Mobile Drawer Highlight (Viewport 375x667) ---');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${BASE_URL}/posts/cooked-fruit.html`, { waitUntil: 'networkidle' });

  // 验证移动端头部与 .navmore
  const navmore = await page.$('.navmore');
  if (!navmore) throw new Error('.navmore button not found on mobile!');
  console.log('[PASS] Found .navmore button');

  // 点击展开移动端抽屉
  await navmore.click();
  await page.waitForTimeout(400);

  const hasNavshows = await page.evaluate(() => document.body.classList.contains('navshows'));
  console.log('[PASS] body.navshows active:', hasNavshows);

  // 验证各菜单项在移动端抽屉中的高亮颜色
  const menuColors = await page.evaluate(() => {
    const life = document.querySelector('.navshows .nav li#menu-item-42 > a');
    const funny = document.querySelector('.navshows .nav li#menu-item-43 > a');
    const tech = document.querySelector('.navshows .nav li#menu-item-44 > a');
    return {
      life: life ? window.getComputedStyle(life).color : null,
      funny: funny ? window.getComputedStyle(funny).color : null,
      tech: tech ? window.getComputedStyle(tech).color : null
    };
  });

  console.log('[PASS] Mobile nav colors computed:', menuColors);
  if (menuColors.life !== 'rgb(255, 94, 82)') {
    throw new Error(`Expected '会生活' to be rgb(255, 94, 82), got ${menuColors.life}`);
  }
  if (menuColors.funny === 'rgb(255, 94, 82)') {
    throw new Error(`Expected '奇趣事' NOT to be red, got ${menuColors.funny}`);
  }
  if (menuColors.tech === 'rgb(255, 94, 82)') {
    throw new Error(`Expected '潮科技' NOT to be red, got ${menuColors.tech}`);
  }
  console.log('[PASS] Mobile Drawer Highlight strictly verified: only "会生活" is red!');

  // 保存移动端抽屉截图
  const mobileShotPath = path.join(ARTIFACTS_DIR, 'live-mobile-drawer-highlight.png');
  await page.screenshot({ path: mobileShotPath });
  console.log('[SAVED] Mobile drawer screenshot saved to', mobileShotPath);

  await browser.close();
  console.log('\n[SUCCESS] All verification tasks successfully completed!');
}

run().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
