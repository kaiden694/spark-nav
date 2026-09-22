#!/usr/bin/env node
/**
 * XIU Theme · Navigation Dynamic Metrics Sync Engine
 * Synchronizes GitHub stars/forks and Telegram subscriber counts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const GITHUB_FILE = path.join(ROOT_DIR, 'src/data/nav/github.json');
const TELEGRAM_FILE = path.join(ROOT_DIR, 'src/data/nav/telegram.json');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

async function syncGithubRepos() {
  if (!fs.existsSync(GITHUB_FILE)) {
    console.log('[Sync] No github.json found. Skipping.');
    return;
  }

  const repos = JSON.parse(fs.readFileSync(GITHUB_FILE, 'utf-8'));
  console.log(`[Sync GitHub] Found ${repos.length} repositories to check...`);

  let updatedCount = 0;
  for (const item of repos) {
    if (!item.repo) continue;
    try {
      const headers = {
        'User-Agent': 'XIU-Nav-Sync-Bot/1.0',
        'Accept': 'application/vnd.github.v3+json'
      };
      if (GITHUB_TOKEN) {
        headers['Authorization'] = `token ${GITHUB_TOKEN}`;
      }

      const res = await fetch(`https://api.github.com/repos/${item.repo}`, { headers });
      if (!res.ok) {
        console.warn(`[Sync GitHub] Failed to fetch ${item.repo}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const oldStars = item.stars;
      item.stars = data.stargazers_count ?? item.stars;
      item.forks = data.forks_count ?? item.forks;
      item.language = data.language ?? item.language;
      item.description = item.description || data.description;
      if (data.pushed_at) {
        item.last_commit = data.pushed_at.split('T')[0];
      }
      item.updated_at = new Date().toISOString().split('T')[0];

      if (oldStars !== item.stars) {
        console.log(`[Sync GitHub] ${item.repo}: stars ${oldStars} -> ${item.stars}`);
        updatedCount++;
      }
    } catch (err) {
      console.warn(`[Sync GitHub] Error updating ${item.repo}:`, err.message);
    }
  }

  fs.writeFileSync(GITHUB_FILE, JSON.stringify(repos, null, 2) + '\n', 'utf-8');
  console.log(`[Sync GitHub] Completed. ${updatedCount} repos updated.`);
}

async function syncTelegramEntities() {
  if (!fs.existsSync(TELEGRAM_FILE)) {
    console.log('[Sync] No telegram.json found. Skipping.');
    return;
  }

  const entities = JSON.parse(fs.readFileSync(TELEGRAM_FILE, 'utf-8'));
  console.log(`[Sync Telegram] Found ${entities.length} entities to check...`);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  let updatedCount = 0;
  for (const item of entities) {
    if (!item.username) continue;
    const cleanUsername = item.username.replace(/^@/, '');
    try {
      let html = '';
      if (item.type === 'bot') {
        // Bots: fetch standard t.me landing page
        const res = await fetch(`https://t.me/${cleanUsername}`, { headers, redirect: 'follow' });
        if (res.ok) {
          html = await res.text();
        }
      } else {
        // Channels & Groups: fetch public web preview first
        let res = await fetch(`https://t.me/s/${cleanUsername}`, { headers, redirect: 'manual' });
        if (res.status === 200) {
          html = await res.text();
        } else {
          // Fallback to standard t.me page
          res = await fetch(`https://t.me/${cleanUsername}`, { headers, redirect: 'follow' });
          if (res.ok) {
            html = await res.text();
          }
        }
      }

      if (!html) {
        continue;
      }

      // Extract subscriber/member count from .tgme_page_extra
      const extraMatch = html.match(/<div class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/i);
      if (extraMatch && extraMatch[1]) {
        const text = extraMatch[1].trim();
        const numMatch = text.match(/([\d\s.,]+)\s*([KkMm]?)\s*(subscribers|members)/i);
        if (numMatch) {
          let rawNum = parseFloat(numMatch[1].replace(/\s/g, '').replace(',', '.'));
          const unit = (numMatch[2] || '').toUpperCase();
          if (unit === 'K') rawNum *= 1000;
          if (unit === 'M') rawNum *= 1000000;
          const count = Math.floor(rawNum);
          if (count > 0 && item.member_count !== count) {
            console.log(`[Sync Telegram] @${item.username}: members ${item.member_count ?? 0} -> ${count}`);
            item.member_count = count;
            updatedCount++;
          }
        }
      }

      // Extract avatar image URL if missing or placeholder
      if (!item.avatar_url || item.avatar_url.includes('default-avatar')) {
        const avatarMatch = html.match(/<img class="tgme_page_photo_image"[^>]*src="([^"]+)"/i);
        if (avatarMatch && avatarMatch[1]) {
          item.avatar_url = avatarMatch[1];
          updatedCount++;
        }
      }

      item.updated_at = new Date().toISOString().split('T')[0];
      await new Promise(r => setTimeout(r, 120));
    } catch (err) {
      console.warn(`[Sync Telegram] Error updating @${item.username}:`, err.message);
    }
  }

  fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(entities, null, 2) + '\n', 'utf-8');
  console.log(`[Sync Telegram] Completed. ${updatedCount} properties updated.`);
}

async function main() {
  console.log('=== Starting Navigation Metrics Sync ===');
  await syncGithubRepos();
  await syncTelegramEntities();
  console.log('=== Navigation Metrics Sync Finished ===');
}

main().catch(err => {
  console.error('[Sync Error]', err);
  process.exit(1);
});
