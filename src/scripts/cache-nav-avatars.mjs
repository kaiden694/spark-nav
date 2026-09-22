#!/usr/bin/env node
/**
 * Navigation Asset Offline Caching Pipeline
 * Caches remote avatars and favicons into local static directory (`public/assets/images/nav/avatars/`)
 * to eliminate external CDN dependency, improve page load performance, and ensure offline resilience.
 *
 * Usage:
 *   node src/scripts/cache-nav-avatars.mjs [--write] [--dry-run] [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const GITHUB_FILE = path.join(ROOT_DIR, 'src/data/nav/github.json');
const TELEGRAM_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram.json');
const WEBSITES_FILE = path.join(ROOT_DIR, 'src/data/nav/websites.json');
const CACHE_DIR = path.join(ROOT_DIR, 'public/assets/images/nav/avatars');

const args = process.argv.slice(2);
const isWriteMode = args.includes('--write');
const isForce = args.includes('--force');
const isDryRun = args.includes('--dry-run') || !isWriteMode;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadAsset(url, destPath) {
  if (fs.existsSync(destPath) && !isForce) {
    const stats = fs.statSync(destPath);
    if (stats.size > 0) {
      return { status: 'EXISTS', bytes: stats.size };
    }
  }

  if (isDryRun) {
    return { status: 'DRY_RUN_PENDING', url };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) XIU-Asset-Sync/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    if (!res.ok) {
      return { status: 'FAILED', error: `HTTP_${res.status}` };
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      return { status: 'FAILED', error: 'EMPTY_BODY' };
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer);
    return { status: 'DOWNLOADED', bytes: buffer.length };
  } catch (err) {
    return { status: 'FAILED', error: err.message };
  }
}

async function runAssetCache() {
  console.log('===========================================================');
  console.log(`🖼️  NAVIGATION ASSET OFFLINE CACHE PIPELINE`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN (Read Only)' : 'WRITE (Live Download & Mutation)'}`);
  console.log(`Target Dir: ${CACHE_DIR}`);
  console.log('===========================================================\n');

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  let totalProcessed = 0;
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 1. Process GitHub Avatars
  if (fs.existsSync(GITHUB_FILE)) {
    console.log('[1/3] Processing GitHub Avatars...');
    const ghList = JSON.parse(fs.readFileSync(GITHUB_FILE, 'utf-8'));
    let ghMutated = false;

    for (let i = 0; i < ghList.length; i++) {
      const item = ghList[i];
      const owner = item.owner || (item.repo ? item.repo.split('/')[0] : '');
      if (!owner) continue;

      const remoteUrl = `https://github.com/${owner}.png?size=96`;
      const fileName = `github-${owner.toLowerCase()}.png`;
      const destPath = path.join(CACHE_DIR, fileName);
      const localPublicUrl = `/assets/images/nav/avatars/${fileName}`;

      process.stdout.write(`  [${i + 1}/${ghList.length}] @${owner}... `);
      const result = await downloadAsset(remoteUrl, destPath);

      if (result.status === 'EXISTS') {
        console.log(`CACHED (${result.bytes} B)`);
        skippedCount++;
        if (item.avatar_url !== localPublicUrl) {
          item.avatar_url = localPublicUrl;
          ghMutated = true;
        }
      } else if (result.status === 'DOWNLOADED') {
        console.log(`DOWNLOADED (${result.bytes} B)`);
        downloadedCount++;
        item.avatar_url = localPublicUrl;
        ghMutated = true;
      } else if (result.status === 'DRY_RUN_PENDING') {
        console.log(`WOULD_DOWNLOAD -> ${fileName}`);
        downloadedCount++;
      } else {
        console.log(`FAILED (${result.error})`);
        failedCount++;
      }

      totalProcessed++;
      await sleep(100);
    }

    if (isWriteMode && ghMutated) {
      fs.writeFileSync(GITHUB_FILE, JSON.stringify(ghList, null, 2) + '\n', 'utf-8');
      console.log(`[GitHub] Updated dataset with local avatar paths.`);
    }
  }

  // 2. Process Telegram Avatars
  if (fs.existsSync(TELEGRAM_FILE)) {
    console.log('\n[2/3] Processing Telegram Channel / Bot Avatars...');
    const tgList = JSON.parse(fs.readFileSync(TELEGRAM_FILE, 'utf-8'));
    let tgMutated = false;

    for (let i = 0; i < tgList.length; i++) {
      const item = tgList[i];
      if (!item.avatar_url || !item.avatar_url.startsWith('http')) continue;

      const uname = (item.username || item.id).toLowerCase();
      let ext = '.png';
      if (item.avatar_url.endsWith('.ico')) ext = '.ico';
      else if (item.avatar_url.endsWith('.jpg') || item.avatar_url.endsWith('.jpeg')) ext = '.jpg';
      else if (item.avatar_url.endsWith('.webp')) ext = '.webp';

      const fileName = `tg-${uname}${ext}`;
      const destPath = path.join(CACHE_DIR, fileName);
      const localPublicUrl = `/assets/images/nav/avatars/${fileName}`;

      process.stdout.write(`  [${i + 1}/${tgList.length}] @${uname}... `);
      const result = await downloadAsset(item.avatar_url, destPath);

      if (result.status === 'EXISTS') {
        console.log(`CACHED (${result.bytes} B)`);
        skippedCount++;
        if (item.avatar_url !== localPublicUrl) {
          item.avatar_url = localPublicUrl;
          tgMutated = true;
        }
      } else if (result.status === 'DOWNLOADED') {
        console.log(`DOWNLOADED (${result.bytes} B)`);
        downloadedCount++;
        item.avatar_url = localPublicUrl;
        tgMutated = true;
      } else if (result.status === 'DRY_RUN_PENDING') {
        console.log(`WOULD_DOWNLOAD -> ${fileName}`);
        downloadedCount++;
      } else {
        console.log(`FAILED (${result.error})`);
        failedCount++;
      }

      totalProcessed++;
      await sleep(100);
    }

    if (isWriteMode && tgMutated) {
      fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(tgList, null, 2) + '\n', 'utf-8');
      console.log(`[Telegram] Updated dataset with local avatar paths.`);
    }
  }

  // 3. Process Websites Favicons
  if (fs.existsSync(WEBSITES_FILE)) {
    console.log('\n[3/3] Processing Website Favicons...');
    const siteList = JSON.parse(fs.readFileSync(WEBSITES_FILE, 'utf-8'));
    let siteMutated = false;

    for (let i = 0; i < siteList.length; i++) {
      const item = siteList[i];
      if (!item.icon || !item.icon.startsWith('http')) continue;

      let ext = '.ico';
      if (item.icon.endsWith('.png')) ext = '.png';
      else if (item.icon.endsWith('.svg')) ext = '.svg';
      else if (item.icon.endsWith('.webp')) ext = '.webp';

      const fileName = `site-${item.id.toLowerCase()}${ext}`;
      const destPath = path.join(CACHE_DIR, fileName);
      const localPublicUrl = `/assets/images/nav/avatars/${fileName}`;

      process.stdout.write(`  [${i + 1}/${siteList.length}] ${item.title}... `);
      const result = await downloadAsset(item.icon, destPath);

      if (result.status === 'EXISTS') {
        console.log(`CACHED (${result.bytes} B)`);
        skippedCount++;
        if (item.icon !== localPublicUrl) {
          item.icon = localPublicUrl;
          siteMutated = true;
        }
      } else if (result.status === 'DOWNLOADED') {
        console.log(`DOWNLOADED (${result.bytes} B)`);
        downloadedCount++;
        item.icon = localPublicUrl;
        siteMutated = true;
      } else if (result.status === 'DRY_RUN_PENDING') {
        console.log(`WOULD_DOWNLOAD -> ${fileName}`);
        downloadedCount++;
      } else {
        console.log(`FAILED (${result.error})`);
        failedCount++;
      }

      totalProcessed++;
      await sleep(100);
    }

    if (isWriteMode && siteMutated) {
      fs.writeFileSync(WEBSITES_FILE, JSON.stringify(siteList, null, 2) + '\n', 'utf-8');
      console.log(`[Websites] Updated dataset with local favicon paths.`);
    }
  }

  // Synchronize nav search index if write mode
  if (isWriteMode && (downloadedCount > 0 || skippedCount > 0)) {
    console.log('\n[Rebuild] Synchronizing nav search index...');
    spawnSync('node', ['src/scripts/build-nav-search-index.mjs'], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: 'inherit'
    });
  }

  console.log('\n===========================================================');
  console.log(`🎉 CACHE COMPLETE: ${totalProcessed} checked, ${downloadedCount} downloaded, ${skippedCount} cached, ${failedCount} failed.`);
  console.log('===========================================================');
}

runAssetCache();
