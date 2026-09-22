import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_FILE = path.join(ROOT_DIR, 'src/data/creators.json');
const BACKUP_FILE = path.join(ROOT_DIR, 'src/data/creators.backup.json');

/**
 * Clean and normalize a single creator record
 */
export function normalizeCreator(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const rawScreenName = String(raw.screen_name || raw.username || '').trim();
  const screen_name = rawScreenName.replace(/^@+/, '');
  if (!screen_name) return null;

  const id = String(raw.id || screen_name).trim();
  const name = String(raw.name || screen_name).trim();
  const followers_count = Math.max(0, Math.floor(Number(raw.followers_count) || 0));
  const description = String(raw.description || '').trim();
  const verified = raw.verified ? 1 : 0;
  const is_blocked = raw.is_blocked ? 1 : 0;
  const is_suspended = Math.max(0, Math.floor(Number(raw.is_suspended) || 0));

  const clicks_card = Math.max(0, Math.floor(Number(raw.clicks_card) || 0));
  const clicks_timeline = Math.max(0, Math.floor(Number(raw.clicks_timeline) || 0));
  const clicks_roulette = Math.max(0, Math.floor(Number(raw.clicks_roulette) || 0));
  const total_clicks = Math.max(
    0,
    Math.floor(Number(raw.total_clicks) || (clicks_card + clicks_timeline + clicks_roulette))
  );

  const nowIso = new Date().toISOString();
  const backed_up_at = raw.backed_up_at ? new Date(raw.backed_up_at).toISOString() : nowIso;
  const last_synced_at = nowIso;

  let avatar_url = String(raw.avatar_url || '').trim();
  let cover_url = String(raw.cover_url || '').trim();

  const history = Array.isArray(raw.history) ? raw.history.slice(0, 20) : [];

  return {
    id,
    screen_name,
    name,
    avatar_url,
    cover_url,
    followers_count,
    description,
    verified,
    backed_up_at,
    is_blocked,
    is_suspended,
    clicks_card,
    clicks_timeline,
    clicks_roulette,
    total_clicks,
    history,
    last_synced_at
  };
}

/**
 * Merge existing creators with incoming updates
 */
export function mergeCreators(existingList = [], incomingList = []) {
  const existingMap = new Map();
  for (const item of existingList) {
    const norm = normalizeCreator(item);
    if (norm) {
      existingMap.set(norm.screen_name.toLowerCase(), norm);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const newlySuspended = [];

  for (const raw of incomingList) {
    const incoming = normalizeCreator(raw);
    if (!incoming) continue;

    const key = incoming.screen_name.toLowerCase();
    const existing = existingMap.get(key);

    if (!existing) {
      existingMap.set(key, incoming);
      addedCount++;
    } else {
      let isDifferent = false;

      if (existing.name !== incoming.name ||
          existing.description !== incoming.description ||
          existing.followers_count !== incoming.followers_count ||
          existing.verified !== incoming.verified ||
          existing.is_suspended !== incoming.is_suspended ||
          (incoming.avatar_url && existing.avatar_url !== incoming.avatar_url) ||
          (incoming.cover_url && existing.cover_url !== incoming.cover_url)) {
        isDifferent = true;
      }

      const mergedClicks = Math.max(existing.total_clicks || 0, incoming.total_clicks || 0);
      if (mergedClicks !== existing.total_clicks) {
        isDifferent = true;
      }

      if (isDifferent) {
        const history = Array.isArray(existing.history) ? [...existing.history] : [];
        const changes = [];
        if (incoming.name && incoming.name !== existing.name) {
          changes.push(`昵称变更：${existing.name} → ${incoming.name}`);
        }
        if (incoming.followers_count && incoming.followers_count !== existing.followers_count) {
          const diff = incoming.followers_count - existing.followers_count;
          changes.push(`粉丝变动：${diff > 0 ? '+' : ''}${diff.toLocaleString()}`);
        }
        if (incoming.verified !== undefined && incoming.verified !== existing.verified) {
          changes.push(incoming.verified ? '获得官方认证' : '取消认证状态');
        }
        if (incoming.is_suspended !== undefined && incoming.is_suspended !== existing.is_suspended) {
          changes.push(incoming.is_suspended === 1 ? '账号被封禁' : (incoming.is_suspended === 2 ? '账号已注销' : '账号恢复正常'));
          if (incoming.is_suspended > 0) {
            newlySuspended.push({
              screen_name: incoming.screen_name,
              name: incoming.name || existing.name,
              status: incoming.is_suspended === 1 ? '封禁' : '注销'
            });
          }
        }
        if (changes.length > 0) {
          history.unshift({
            date: new Date().toISOString(),
            type: '档案变动',
            desc: changes.join('；')
          });
        }

        existingMap.set(key, {
          ...existing,
          name: incoming.name || existing.name,
          description: incoming.description !== undefined ? incoming.description : existing.description,
          followers_count: incoming.followers_count || existing.followers_count,
          verified: incoming.verified,
          is_suspended: incoming.is_suspended !== undefined ? incoming.is_suspended : existing.is_suspended,
          avatar_url: incoming.avatar_url || existing.avatar_url,
          cover_url: incoming.cover_url || existing.cover_url,
          total_clicks: mergedClicks,
          history: history.slice(0, 20),
          last_synced_at: new Date().toISOString()
        });
        updatedCount++;
      } else {
        unchangedCount++;
      }
    }
  }

  // Sort descending by followers_count
  const merged = Array.from(existingMap.values()).sort((a, b) => b.followers_count - a.followers_count);

  return {
    merged,
    addedCount,
    updatedCount,
    unchangedCount,
    newlySuspended,
    totalCount: merged.length
  };
}

export async function sendSuspensionAlert(webhookUrl, newlySuspended = []) {
  if (!webhookUrl || newlySuspended.length === 0) return { ok: false, reason: 'No webhook or empty list' };

  const message = {
    event: 'creator_suspension_surge',
    timestamp: new Date().toISOString(),
    count: newlySuspended.length,
    summary: `[女菩萨画廊告警] 检测到 ${newlySuspended.length} 位博主状态突变（封禁/注销）`,
    creators: newlySuspended.map(c => `@${c.screen_name} (${c.name}) [${c.status}]`)
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fetchRemoteJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'xiu-creator-sync/1.0',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const shouldRebuildSearch = args.includes('--rebuild-search');

  let filePath = null;
  let remoteUrl = null;
  let alertThreshold = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      filePath = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      remoteUrl = args[i + 1];
      i++;
    } else if (args[i] === '--alert-threshold' && args[i + 1]) {
      alertThreshold = parseInt(args[i + 1], 10) || 3;
      i++;
    }
  }

  console.log('[SYNC] Starting creators data sync...');

  let existingData = [];
  if (fs.existsSync(DATA_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log(`[SYNC] Loaded ${existingData.length} existing creators from ${DATA_FILE}`);
    } catch (e) {
      console.warn(`[SYNC] Warning: Failed to parse ${DATA_FILE}, starting fresh.`);
    }
  }

  let incomingData = [];
  if (filePath) {
    console.log(`[SYNC] Reading input from local file: ${filePath}`);
    if (!fs.existsSync(filePath)) {
      console.error(`[SYNC] Error: File not found at ${filePath}`);
      process.exit(1);
    }
    incomingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } else {
    const targetUrl = remoteUrl || process.env.CREATORS_ARCHIVE_URL || '';
    if (!targetUrl) {
      console.error(`[SYNC] Error: No input file or remote URL specified. Please provide --file <path> or --url <url> or set CREATORS_ARCHIVE_URL.`);
      process.exit(1);
    }
    console.log(`[SYNC] Fetching input from remote URL: ${targetUrl}`);
    try {
      const json = await fetchRemoteJson(targetUrl);
      incomingData = Array.isArray(json) ? json : (json.data || []);
      console.log(`[SYNC] Received ${incomingData.length} items from remote.`);
    } catch (err) {
      console.error(`[SYNC] Failed to fetch remote data:`, err.message);
      process.exit(1);
    }
  }

  const { merged, addedCount, updatedCount, unchangedCount, newlySuspended, totalCount } = mergeCreators(existingData, incomingData);

  console.log(`[SYNC] Results:`);
  console.log(`  - Total processed: ${incomingData.length}`);
  console.log(`  - Newly added:     ${addedCount}`);
  console.log(`  - Updated:         ${updatedCount}`);
  console.log(`  - Unchanged:       ${unchangedCount}`);
  console.log(`  - Newly lost:      ${newlySuspended ? newlySuspended.length : 0}`);
  console.log(`  - Final count:     ${totalCount}`);

  if (newlySuspended && newlySuspended.length >= alertThreshold) {
    console.warn(`[ALERT] Detected ${newlySuspended.length} newly suspended/deleted creators! (Threshold: ${alertThreshold})`);
    const webhookUrl = process.env.SYNC_ALERT_WEBHOOK;
    if (webhookUrl) {
      console.log(`[ALERT] Sending webhook notification to configured endpoint...`);
      const alertRes = await sendSuspensionAlert(webhookUrl, newlySuspended);
      console.log(`[ALERT] Notification dispatch result:`, alertRes);
    } else {
      console.log(`[ALERT] SYNC_ALERT_WEBHOOK not set; skipping remote dispatch.`);
    }
  }

  if (isDryRun) {
    console.log('[SYNC] --dry-run specified. No changes written to disk.');
    return;
  }

  // Backup existing data
  if (fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    console.log(`[SYNC] Created backup at ${BACKUP_FILE}`);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`[SYNC] Successfully wrote ${totalCount} creators to ${DATA_FILE}`);

  if (shouldRebuildSearch) {
    console.log('[SYNC] Triggering search index rebuild...');
    try {
      execSync('node src/scripts/build-search-index.mjs', { stdio: 'inherit', cwd: ROOT_DIR });
      console.log('[SYNC] Search index rebuilt successfully.');
    } catch (err) {
      console.error('[SYNC] Search index rebuild failed:', err.message);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[SYNC] Fatal error:', err);
    process.exit(1);
  });
}
