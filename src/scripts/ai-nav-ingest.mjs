#!/usr/bin/env node
/**
 * XIU Theme · AI-Powered Navigation Link Ingestion Pipeline
 * Automatically fetches metadata, extracts OpenGraph, and normalizes into nav dataset.
 *
 * Usage:
 *   node src/scripts/ai-nav-ingest.mjs <URL> [--dry-run] [--category <cat>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const NAV_DATA_DIR = path.join(ROOT_DIR, 'src/data/nav');

const args = process.argv.slice(2);
const targetUrl = args.find(a => a.startsWith('http://') || a.startsWith('https://'));
const isDryRun = args.includes('--dry-run');

if (!targetUrl) {
  console.log(`
Usage:
  node src/scripts/ai-nav-ingest.mjs <URL> [--dry-run]

Example:
  node src/scripts/ai-nav-ingest.mjs https://github.com/chen08209/FlClash
  node src/scripts/ai-nav-ingest.mjs https://t.me/huarunying
  node src/scripts/ai-nav-ingest.mjs https://v0.dev
`);
  process.exit(0);
}

function detectUrlType(urlStr) {
  const url = new URL(urlStr);
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;

  if (host.includes('github.com')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { type: 'github', owner: parts[0], repo: `${parts[0]}/${parts[1]}` };
    }
  }
  if (host.includes('t.me') || host.includes('telegram.me')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      const username = parts[0].replace(/^s\//, '');
      return { type: 'telegram', username };
    }
  }
  if (host.includes('x.com') || host.includes('twitter.com')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1) {
      return { type: 'creator', platform: 'x', handle: `@${parts[0]}` };
    }
  }
  if (host.includes('youtube.com')) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 1 && (parts[0].startsWith('@') || parts[0] === 'c' || parts[0] === 'channel')) {
      return { type: 'creator', platform: 'youtube', handle: parts[parts.length - 1] };
    }
  }

  return { type: 'website' };
}

async function fetchPageMetadata(urlStr) {
  console.log(`[Ingest] Fetching page: ${urlStr} ...`);
  const res = await fetch(urlStr, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  const html = await res.text();

  // Extract Title
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  // Extract Meta Description
  let description = '';
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
                    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) description = descMatch[1].trim();

  // Extract Favicon
  let icon = '';
  const iconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i);
  if (iconMatch) {
    const rawIcon = iconMatch[1];
    if (rawIcon.startsWith('http')) icon = rawIcon;
    else {
      const origin = new URL(urlStr).origin;
      icon = rawIcon.startsWith('/') ? `${origin}${rawIcon}` : `${origin}/${rawIcon}`;
    }
  } else {
    icon = `https://unavatar.io/${encodeURIComponent(urlStr)}`;
  }

  return { title, description, icon };
}

async function refineWithAI(meta, rawType) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[Ingest AI] No API key detected. Using rule-based normalization.');
    return {
      title: meta.title.split(/[-_|]/)[0].trim() || '新收藏站点',
      description: meta.description.slice(0, 120) || '精选推荐工具或资源。',
      tags: ['精选', rawType.type]
    };
  }

  try {
    console.log('[Ingest AI] Asking LLM for structured refinement...');
    // Generic simple OpenAI / Gemini compatible completion
    const endpoint = process.env.GEMINI_API_KEY
      ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
      : 'https://api.openai.com/v1/chat/completions';

    const promptText = `你是一个导航站编辑。分析以下网页元信息，输出纯JSON格式，包含:
1. "title": 精炼名称（不超过 15 字，去除冗余后缀）
2. "description": 核心亮点中文简述（40-80 字）
3. "tags": 2到3个标签构成的字符串数组
信息:
URL: ${targetUrl}
Raw Title: ${meta.title}
Raw Desc: ${meta.description}`;

    let jsonResult;
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText + '\n必须输出标准 JSON，无 markdown' }] }]
        })
      });
      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      jsonResult = JSON.parse(cleanJson);
    }

    return {
      title: jsonResult?.title || meta.title.split(/[-_|]/)[0].trim(),
      description: jsonResult?.description || meta.description.slice(0, 120),
      tags: jsonResult?.tags || ['精选', rawType.type]
    };
  } catch (err) {
    console.warn('[Ingest AI] LLM call failed, fallback to raw:', err.message);
    return {
      title: meta.title.split(/[-_|]/)[0].trim() || '新收藏站点',
      description: meta.description.slice(0, 120) || '精选推荐工具或资源。',
      tags: ['精选', rawType.type]
    };
  }
}

async function main() {
  const urlMeta = detectUrlType(targetUrl);
  console.log(`[Ingest] Detected category type: ${urlMeta.type}`);

  let pageMeta = { title: '', description: '', icon: '' };
  try {
    pageMeta = await fetchPageMetadata(targetUrl);
  } catch (e) {
    console.warn('[Ingest] Direct page fetch failed, using fallback URL:', e.message);
  }

  const refined = await refineWithAI(pageMeta, urlMeta);

  const now = new Date().toISOString().split('T')[0];
  const slug = targetUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30);

  let targetJsonFile = '';
  let record = null;

  if (urlMeta.type === 'github') {
    targetJsonFile = path.join(NAV_DATA_DIR, 'github.json');
    let ghStars = 0;
    let ghForks = 0;
    let ghLang = 'Unknown';
    let ghTopics = [];
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${urlMeta.owner}/${urlMeta.repo.split('/')[1] || urlMeta.repo}`, {
        headers: { 'User-Agent': 'XIU-Nav-Ingest/1.0' },
        signal: AbortSignal.timeout(6000)
      });
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        ghStars = ghData.stargazers_count || 0;
        ghForks = ghData.forks_count || 0;
        ghLang = ghData.language || 'Unknown';
        if (Array.isArray(ghData.topics)) ghTopics = ghData.topics;
      }
    } catch (e) {}

    const mergedTags = Array.from(new Set([...(refined.tags || []), ...ghTopics.slice(0, 3)])).filter(Boolean);
    record = {
      id: `gh-${slug}`,
      repo: urlMeta.repo,
      owner: urlMeta.owner,
      name: urlMeta.repo.split('/')[1] || urlMeta.repo,
      title: refined.title,
      url: targetUrl,
      description: refined.description,
      language: ghLang,
      stars: ghStars,
      forks: ghForks,
      category: 'github',
      subcategory: 'devtools',
      tags: mergedTags.length ? mergedTags : ['开源项目', 'GitHub'],
      is_featured: false,
      created_at: now,
      avatar_url: pageMeta.icon || `https://github.com/${urlMeta.owner}.png`
    };
  } else if (urlMeta.type === 'telegram') {
    targetJsonFile = path.join(NAV_DATA_DIR, 'telegram.json');
    record = {
      id: `tg-${urlMeta.username}`,
      username: urlMeta.username,
      title: refined.title,
      url: targetUrl,
      description: refined.description,
      type: urlMeta.username.toLowerCase().endsWith('bot') ? 'bot' : 'channel',
      member_count: 0,
      avatar_url: pageMeta.icon,
      category: 'telegram',
      subcategory: 'channels',
      tags: refined.tags,
      is_featured: false,
      created_at: now
    };
  } else if (urlMeta.type === 'creator') {
    targetJsonFile = path.join(NAV_DATA_DIR, 'creators.json');
    record = {
      id: `creator-${slug}`,
      platform: urlMeta.platform,
      handle: urlMeta.handle,
      name: refined.title,
      url: targetUrl,
      description: refined.description,
      avatar_url: pageMeta.icon,
      category: 'creators',
      subcategory: 'tech',
      tags: refined.tags,
      is_featured: false,
      created_at: now
    };
  } else {
    targetJsonFile = path.join(NAV_DATA_DIR, 'websites.json');
    record = {
      id: `site-${slug}`,
      title: refined.title,
      url: targetUrl,
      description: refined.description,
      icon: pageMeta.icon,
      category: 'tools',
      subcategory: 'efficiency',
      tags: refined.tags,
      pricing: 'free',
      is_featured: false,
      created_at: now
    };
  }

  console.log('\n=== Ingestion Result ===');
  console.log(JSON.stringify(record, null, 2));

  if (isDryRun) {
    console.log('\n[Dry Run] No file changes were made.');
    return;
  }

  if (fs.existsSync(targetJsonFile)) {
    const list = JSON.parse(fs.readFileSync(targetJsonFile, 'utf-8'));
    // Deduplicate by URL
    const existingIndex = list.findIndex(item => item.url === targetUrl);
    if (existingIndex >= 0) {
      console.log(`[Ingest] Entry already exists at index ${existingIndex}, updating...`);
      list[existingIndex] = { ...list[existingIndex], ...record };
    } else {
      list.push(record);
      console.log(`[Ingest] Appended new record to ${path.basename(targetJsonFile)}.`);
    }
    fs.writeFileSync(targetJsonFile, JSON.stringify(list, null, 2) + '\n', 'utf-8');
  }

  console.log('\n[Ingest Success] Record saved to dataset.');
}

main().catch(err => {
  console.error('[Ingest Error]', err);
  process.exit(1);
});
