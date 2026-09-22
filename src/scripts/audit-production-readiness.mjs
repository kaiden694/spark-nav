import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const distDir = path.resolve(projectRoot, 'dist');

if (!fs.existsSync(distDir)) {
  console.error('[ERROR] dist directory does not exist! Run npm run build first.');
  process.exit(1);
}

function getAllHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      getAllHtmlFiles(fullPath, fileList);
    } else if (file.endsWith('.html')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const htmlFiles = getAllHtmlFiles(distDir);
console.log(`[AUDIT] Found ${htmlFiles.length} HTML files to inspect in dist/`);

let totalAssetsChecked = 0;
let totalLinksChecked = 0;
const errors = [];
const warnings = [];

// Regular expressions to extract attributes
const assetRegexes = [
  /<link[^>]+href=["']([^"']+)["']/gi,
  /<script[^>]+src=["']([^"']+)["']/gi,
  /<img[^>]+src=["']([^"']+)["']/gi,
  /<img[^>]+data-original=["']([^"']+)["']/gi,
  /<source[^>]+srcset=["']([^"']+)["']/gi,
  /<video[^>]+src=["']([^"']+)["']/gi,
];

const hrefRegex = /<a[^>]+href=["']([^"']+)["']/gi;
const robotsRegex = /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i;

for (const htmlFile of htmlFiles) {
  const relPath = path.relative(distDir, htmlFile).replace(/\\/g, '/');
  const content = fs.readFileSync(htmlFile, 'utf8');

  // 1. Verify robots meta
  const robotsMatch = robotsRegex.exec(content);
  if (robotsMatch) {
    const robotsContent = robotsMatch[1].toLowerCase();
    if (robotsContent.includes('noindex') && !relPath.includes('404')) {
      warnings.push(`[SEO Warning] ${relPath} contains noindex: "${robotsMatch[1]}"`);
    }
  }

  // 2. Extract and check asset references
  for (const reg of assetRegexes) {
    let match;
    reg.lastIndex = 0;
    while ((match = reg.exec(content)) !== null) {
      let src = match[1].trim();
      if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
        continue;
      }

      totalAssetsChecked++;

      // Check for relative asset path defect
      if (src.startsWith('assets/')) {
        errors.push(`[Relative Asset Path Defect] In ${relPath}: "${src}" should be "/${src}"`);
      }

      // Skip canonical link tags that point to HTML pages
      if (src.endsWith('.html') || src === '/' || match[0].includes('rel="canonical"')) {
        continue;
      }

      // Resolve file on disk
      let diskPath;
      if (src.startsWith('/')) {
        diskPath = path.join(distDir, src.slice(1));
      } else {
        diskPath = path.resolve(path.dirname(htmlFile), src);
      }

      // Strip query or hash and decode URI
      diskPath = decodeURIComponent(diskPath.split('?')[0].split('#')[0]);

      if (!fs.existsSync(diskPath)) {
        errors.push(`[Missing Asset 404] In ${relPath}: "${src}" does not exist at ${diskPath}`);
      }
    }
  }

  // 3. Extract and check internal page links (strip script blocks to avoid false positives on dynamic template strings)
  const markupForLinks = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  let aMatch;
  hrefRegex.lastIndex = 0;
  while ((aMatch = hrefRegex.exec(markupForLinks)) !== null) {
    let href = aMatch[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//') || href.startsWith('mailto:')) {
      continue;
    }

    totalLinksChecked++;

    // Strip hash and query
    const cleanHref = href.split('?')[0].split('#')[0];
    if (!cleanHref) continue;

    let targetDiskPath;
    if (cleanHref.startsWith('/')) {
      if (cleanHref === '/') {
        targetDiskPath = path.join(distDir, 'index.html');
      } else if (cleanHref.endsWith('.html')) {
        targetDiskPath = path.join(distDir, cleanHref.slice(1));
      } else {
        targetDiskPath = path.join(distDir, cleanHref.slice(1) + '.html');
      }
    } else {
      targetDiskPath = path.resolve(path.dirname(htmlFile), cleanHref);
    }

    // URL decode for chinese tag paths
    targetDiskPath = decodeURIComponent(targetDiskPath);

    if (!fs.existsSync(targetDiskPath)) {
      errors.push(`[Broken Link 404] In ${relPath}: target "${href}" does not exist at ${targetDiskPath}`);
    }
  }
}

// Audit SEO & Search Index Artifacts
console.log(`[AUDIT] Verifying SEO feeds and search index artifacts in dist/...`);

const sitemapPath = path.join(distDir, 'sitemap.xml');
if (!fs.existsSync(sitemapPath) || fs.statSync(sitemapPath).size === 0) {
  errors.push(`[Missing SEO Artifact] dist/sitemap.xml does not exist or is empty.`);
} else {
  const sitemapContent = fs.readFileSync(sitemapPath, 'utf-8');
  if (!sitemapContent.includes('<urlset') || !sitemapContent.includes('</urlset>')) {
    errors.push(`[Invalid SEO Artifact] dist/sitemap.xml does not contain valid XML urlset.`);
  }
}

const rssPath = path.join(distDir, 'rss.xml');
if (!fs.existsSync(rssPath) || fs.statSync(rssPath).size === 0) {
  errors.push(`[Missing SEO Artifact] dist/rss.xml does not exist or is empty.`);
} else {
  const rssContent = fs.readFileSync(rssPath, 'utf-8');
  if (!rssContent.includes('<rss') || !rssContent.includes('</rss>')) {
    errors.push(`[Invalid SEO Artifact] dist/rss.xml does not contain valid XML rss.`);
  }
}

const searchIndexPath = path.join(distDir, 'search-index.json');
if (!fs.existsSync(searchIndexPath) || fs.statSync(searchIndexPath).size === 0) {
  errors.push(`[Missing Search Index] dist/search-index.json does not exist or is empty.`);
} else {
  try {
    const parsedIndex = JSON.parse(fs.readFileSync(searchIndexPath, 'utf-8'));
    if (!Array.isArray(parsedIndex) || parsedIndex.length < 13) {
      errors.push(`[Invalid Search Index] dist/search-index.json contains fewer than 13 posts.`);
    }
  } catch (err) {
    errors.push(`[Corrupted Search Index] dist/search-index.json is not valid JSON: ${err.message}`);
  }
}

const robotsPath = path.join(distDir, 'robots.txt');
if (!fs.existsSync(robotsPath)) {
  errors.push(`[Missing SEO Artifact] dist/robots.txt does not exist.`);
}

console.log(`\n================ PRODUCTION READINESS AUDIT REPORT ================`);
console.log(`Scanned HTML Files    : ${htmlFiles.length}`);
console.log(`Verified Asset Tags   : ${totalAssetsChecked}`);
console.log(`Verified Links        : ${totalLinksChecked}`);
console.log(`Verified SEO Feeds    : sitemap.xml, rss.xml, search-index.json, robots.txt`);
console.log(`Total Errors (404/Bad): ${errors.length}`);
console.log(`Total Warnings        : ${warnings.length}`);

if (warnings.length > 0) {
  console.log(`\n[WARNINGS] (${warnings.length}):`);
  warnings.forEach(w => console.log('  ' + w));
}

if (errors.length > 0) {
  console.error(`\n[ERRORS FOUND] (${errors.length}):`);
  errors.slice(0, 20).forEach(e => console.error('  ' + e));
  if (errors.length > 20) {
    console.error(`  ... and ${errors.length - 20} more errors.`);
  }
  process.exit(1);
} else {
  console.log(`\n[SUCCESS] Production Readiness Audit Passed! 0 Broken Assets, 0 Broken Links.`);
  process.exit(0);
}
