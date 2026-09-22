import fs from 'node:fs';
import sharp from 'sharp';

export async function inspectRuntimePage(page) {
  return page.evaluate(() => ({
    ready: document.readyState,
    bodyTextLength: document.body.innerText.trim().length,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    emptyImageNodes: [...document.images].filter(image => !image.getAttribute('src') && !image.getAttribute('srcset') && !image.getAttribute('data-original')).length,
    failedImages: [...document.images].filter(image =>
      (image.getAttribute('src') || image.getAttribute('srcset') || image.getAttribute('data-original')) && (!image.complete || !image.naturalWidth)
    ).map(image => image.currentSrc || image.src),
  }));
}

// Diagnostics only: these inputs never replace, mask or approve screenshot pixels.
export async function captureVisualInputs(page) {
  return page.evaluate(() => {
    const text = element => element?.textContent.replace(/\s+/g, ' ').trim() || '';
    const selectors = ['.header', '.nav', '.article-header', '.article-content', '.most-comment-posts', '.widget_postlist', '.karbar'];
    return {
      title: document.title,
      activeNavigation: [...document.querySelectorAll('.nav .current-menu-item > a, .nav .current-menu-parent > a')].map(text),
      articleHeader: text(document.querySelector('.article-header')),
      recommendations: [...document.querySelectorAll('.widget_postlist')].map(widget => ({
        title: text(widget.querySelector('.widget-title')),
        items: [...widget.querySelectorAll('.items-01 > li')].map(item => ({ text: text(item), href: item.querySelector('a')?.getAttribute('href') })),
      })),
      rankings: [...document.querySelectorAll('.most-comment-posts li')].map(text),
      counters: [...document.querySelectorAll('.view-count, .like-count, .comment-count')].map(element => ({
        className: element.className, slug: element.closest('[data-slug]')?.getAttribute('data-slug'), value: text(element),
      })),
      activeSlides: [...document.querySelectorAll('.swiper-slide-active')].map(element => ({ text: text(element), image: element.querySelector('img')?.getAttribute('src') })),
      fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
      icons: [...document.querySelectorAll('.site-icon, .tbfa')].slice(0, 16).map(element => ({
        codePoints: [...element.textContent].map(character => character.codePointAt(0).toString(16)),
        fontFamily: getComputedStyle(element).fontFamily,
      })),
      regions: selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { selector, x, y, width, height };
      })),
    };
  });
}

export async function compareScreenshots(actualFile, baselineFile, diffFile) {
  if (!fs.existsSync(baselineFile)) return { baselineAvailable: false, passed: false, reason: 'Matching baseline is absent.' };
  const [actual, baseline] = await Promise.all([actualFile, baselineFile].map(file => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  const width = Math.min(actual.info.width, baseline.info.width);
  const height = Math.min(actual.info.height, baseline.info.height);
  const diff = Buffer.alloc(width * height * 4);
  let changedPixels = 0;
  let absoluteDifference = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = (y * actual.info.width + x) * 4;
      const b = (y * baseline.info.width + x) * 4;
      const d = (y * width + x) * 4;
      let maximum = 0;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(actual.data[a + channel] - baseline.data[b + channel]);
        maximum = Math.max(maximum, delta);
        absoluteDifference += delta;
      }
      if (maximum > 16) changedPixels++;
      diff[d] = maximum > 16 ? 255 : Math.round(baseline.data[b] * 0.25);
      diff[d + 1] = maximum > 16 ? 0 : Math.round(baseline.data[b + 1] * 0.25);
      diff[d + 2] = maximum > 16 ? 255 : Math.round(baseline.data[b + 2] * 0.25);
      diff[d + 3] = 255;
    }
  }
  await sharp(diff, { raw: { width, height, channels: 4 } }).png().toFile(diffFile);
  const dimensionsMatch = actual.info.width === baseline.info.width && actual.info.height === baseline.info.height;
  return {
    baselineAvailable: true, passed: dimensionsMatch && changedPixels === 0,
    algorithm: 'Top-left RGBA comparison of viewport screenshots; threshold 16 per channel; identical dimensions and zero changed pixels required.',
    actualDimensions: { width: actual.info.width, height: actual.info.height },
    baselineDimensions: { width: baseline.info.width, height: baseline.info.height },
    dimensionsMatch, changedPixels, comparedPixels: width * height,
    changedPixelRatio: changedPixels / (width * height),
    meanAbsoluteChannelDifference: absoluteDifference / (width * height * 4),
    baseline: baselineFile, diff: diffFile,
  };
}

export function imagesHaveSettled() {
  return [...document.images].every(image => {
    const original = image.getAttribute('data-original');
    const originalSrcset = image.getAttribute('data-original-srcset');
    const preloadStarted = window.jQuery?.(image).data('_lazyload_loadStarted') === true;
    if (preloadStarted && original && image.src !== new URL(original, document.baseURI).href) return false;
    if (preloadStarted && originalSrcset && image.getAttribute('srcset') !== originalSrcset) return false;
    return !(image.getAttribute('src') || image.getAttribute('srcset') || original)
      || (image.complete && image.naturalWidth > 0);
  });
}

export async function settlePage(page, pendingApiRequests) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const step = Math.max(240, Math.floor(innerHeight * 0.75));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise(resolve => setTimeout(resolve, 350));
    scrollTo(0, 0);
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  });
  await page.waitForFunction(() => !document.querySelector('#post-commentlist[aria-busy="true"]'));
  const deadline = Date.now() + 15000;
  while (pendingApiRequests?.size) {
    if (Date.now() > deadline) throw new Error('Local API requests did not settle: ' + [...pendingApiRequests].map(request => request.url()).join(', '));
    await page.waitForTimeout(50);
  }
  // Traversal enqueues jQuery fades. Wait for the real queue instead of capturing
  // a half-hidden toolbox after an arbitrary 300ms delay.
  await page.waitForFunction(() => {
    const $ = window.jQuery;
    const toolboxSettled = !$ || (!$('.karbar-totop').is(':animated') && ($('.karbar-totop').queue('fx') || []).length === 0);
    return scrollY === 0 && toolboxSettled && !document.querySelector('.count-up-active');
  }, undefined, { timeout: 15000 });
  // main.js:8 marks _lazyload_loadStarted before its detached preloader finishes.
  // A loaded placeholder is therefore not proof that the final source is ready.
  // Observe that handoff too, without triggering lazy events or rewriting src.
  await page.waitForFunction(imagesHaveSettled, undefined, { timeout: 15000 });
  await page.evaluate(() => Promise.all([...document.images].filter(image => image.naturalWidth > 0).map(image => image.decode())));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
