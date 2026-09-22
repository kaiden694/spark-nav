import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();

export function cleanOrphanProcesses(options = {}) {
  const verbose = options.verbose ?? false;
  const results = {
    workerdKilled: false,
    orphanNodeKilled: 0,
    cleanedKvDirs: 0,
    platform: process.platform,
  };

  if (process.platform === 'win32') {
    // 1. Terminate orphan workerd.exe instances
    try {
      execSync('taskkill.exe /F /IM workerd.exe /T', { stdio: 'ignore' });
      results.workerdKilled = true;
      if (verbose) console.log('[PROCESS-GUARD] Terminated running workerd.exe process(es).');
    } catch {
      // taskkill returns non-zero if no process matches; expected when idle
    }

    // 2. Terminate orphan node.exe processes running wrangler pages dev or audit-kv
    try {
      const psScript = `
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
          Where-Object {
            $_.ProcessId -ne $PID -and
            $_.CommandLine -like '*wrangler*' -and
            ($_.CommandLine -like '*pages*dev*' -or $_.CommandLine -like '*audit-kv*')
          } |
          ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force
            $_.ProcessId
          }
      `.replace(/\r?\n\s*/g, ' ').trim();

      const output = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      if (output) {
        const killedPids = output.split(/\s+/).filter(Boolean);
        results.orphanNodeKilled = killedPids.length;
        if (verbose) console.log(`[PROCESS-GUARD] Terminated ${killedPids.length} orphan wrangler node process(es): ${killedPids.join(', ')}`);
      }
    } catch {
      // No matching processes or query failure
    }
  } else {
    // POSIX systems
    try {
      execSync('pkill -9 -f "workerd" 2>/dev/null || true', { stdio: 'ignore' });
      results.workerdKilled = true;
    } catch {}

    try {
      execSync('pkill -9 -f "wrangler pages dev" 2>/dev/null || true', { stdio: 'ignore' });
      results.orphanNodeKilled = 1;
    } catch {}
  }

  // 3. Clean stale unlocked audit-kv temp directories in .wrangler/audit-kv
  const auditKvDir = path.join(root, '.wrangler', 'audit-kv');
  if (fs.existsSync(auditKvDir)) {
    try {
      const entries = fs.readdirSync(auditKvDir);
      for (const entry of entries) {
        const entryPath = path.join(auditKvDir, entry);
        try {
          // Attempt removing directory; if locked by an active process, rmdirSync will fail safely
          fs.rmSync(entryPath, { recursive: true, force: true });
          results.cleanedKvDirs++;
        } catch {
          // Locked by active process or permission denied, skip safely
        }
      }
      if (verbose && results.cleanedKvDirs > 0) {
        console.log(`[PROCESS-GUARD] Removed ${results.cleanedKvDirs} stale audit-kv state folder(s).`);
      }
    } catch {
      // Directory listing failed, ignore
    }
  }

  return results;
}

// Standalone CLI execution
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('[PROCESS-GUARD] Scanning and cleaning orphan workerd and wrangler processes...');
  const res = cleanOrphanProcesses({ verbose: true });
  console.log('[PROCESS-GUARD] Finished cleanup:', JSON.stringify(res));
}
