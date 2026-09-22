import { chromium } from 'playwright-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:4321';

async function testGlowOnPage(page, urlPath, pageName) {
  console.log(`\n--- Testing cursor glow on ${pageName} (${urlPath}) ---`);
  await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: 'networkidle' });

  // 1. Test Hero Spotlight Card
  const heroCard = await page.$('#hero-spotlight-card');
  if (!heroCard) {
    throw new Error(`hero-spotlight-card not found on ${pageName}`);
  }
  const heroBox = await heroCard.boundingBox();
  console.log(`Hero box:`, heroBox);

  // Move mouse to offset (50, 40) inside hero card
  await page.mouse.move(heroBox.x + 50, heroBox.y + 40);
  await page.waitForTimeout(50);

  let heroMouseVars = await page.evaluate(() => {
    const el = document.getElementById('hero-spotlight-card');
    return {
      mouseX: el.style.getPropertyValue('--mouse-x'),
      mouseY: el.style.getPropertyValue('--mouse-y')
    };
  });
  console.log(`Hero Spotlight at (50, 40):`, heroMouseVars);
  if (!heroMouseVars.mouseX || !heroMouseVars.mouseY) {
    throw new Error(`Hero spotlight --mouse-x/--mouse-y not set on ${pageName}`);
  }

  // Move mouse to offset (120, 80) inside hero card
  await page.mouse.move(heroBox.x + 120, heroBox.y + 80);
  await page.waitForTimeout(50);

  heroMouseVars = await page.evaluate(() => {
    const el = document.getElementById('hero-spotlight-card');
    return {
      mouseX: el.style.getPropertyValue('--mouse-x'),
      mouseY: el.style.getPropertyValue('--mouse-y')
    };
  });
  console.log(`Hero Spotlight moved to (120, 80):`, heroMouseVars);

  // 2. Test First Resource Card (.nav-card)
  const firstCard = await page.$('.nav-card');
  if (!firstCard) {
    throw new Error(`No .nav-card found on ${pageName}`);
  }
  const cardBox = await firstCard.boundingBox();
  console.log(`First card box:`, cardBox);

  // Move mouse to offset (45, 35) inside first card
  await page.mouse.move(cardBox.x + 45, cardBox.y + 35);
  await page.waitForTimeout(50);

  let cardMouseVars = await page.evaluate(() => {
    const card = document.querySelector('.nav-card');
    return {
      mouseX: card.style.getPropertyValue('--mouse-x'),
      mouseY: card.style.getPropertyValue('--mouse-y'),
      accentRgb: card.style.getPropertyValue('--card-accent-rgb')
    };
  });
  console.log(`Nav Card at (45, 35):`, cardMouseVars);
  if (!cardMouseVars.mouseX || !cardMouseVars.mouseY) {
    throw new Error(`Nav card --mouse-x/--mouse-y not set on ${pageName}`);
  }

  // Move mouse to offset (150, 90) inside first card
  await page.mouse.move(cardBox.x + 150, cardBox.y + 90);
  await page.waitForTimeout(50);

  cardMouseVars = await page.evaluate(() => {
    const card = document.querySelector('.nav-card');
    return {
      mouseX: card.style.getPropertyValue('--mouse-x'),
      mouseY: card.style.getPropertyValue('--mouse-y')
    };
  });
  console.log(`Nav Card moved to (150, 90):`, cardMouseVars);

  console.log(`[PASS] Cursor glow successfully tracks pointer on ${pageName}!`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await testGlowOnPage(page, '/nav/telegram', 'Telegram Hub');
    await testGlowOnPage(page, '/nav/github', 'GitHub Hub');
    console.log('\n>>> ALL CURSOR GLOW TESTS PASSED! <<<');
  } catch (err) {
    console.error('Cursor glow test failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
