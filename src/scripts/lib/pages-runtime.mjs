import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cleanOrphanProcesses } from '../clean-orphan-processes.mjs';

const require = createRequire(import.meta.url);
const root = process.cwd();
const wranglerPackage = require.resolve('wrangler/package.json');
const wranglerBin = path.join(path.dirname(wranglerPackage), 'bin', 'wrangler.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createEvidenceDir(name) {
  const base = process.env.AUDIT_EVIDENCE_DIR || path.join(root, '_migration_baseline', 'P2-runtime-2026-09-11');
  const directory = path.resolve(base, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
    String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome or Edge executable not found (set CHROME_PATH).');
  return executable;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function spawnWrangler(args, logFile) {
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(process.execPath, [wranglerBin, ...args], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const done = new Promise((resolve, reject) => {
    child.once('error', error => { log.end(); reject(error); });
    child.once('close', (code, signal) => log.end(() => resolve({ code, signal })));
  });
  return { child, done };
}

export async function runWrangler(args, logFile) {
  const { done } = spawnWrangler(args, logFile);
  const result = await done;
  if (result.code !== 0) throw new Error(`Wrangler exited ${result.code}. See ${logFile}`);
  return result;
}

export async function startPagesRuntime({ evidence, bindings = {}, persistPath, port } = {}) {
  if (!evidence) throw new Error('An evidence directory is required.');
  cleanOrphanProcesses();
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Run npm run build before verification.');
  // Workerd appends long SQLite filenames. Deep evidence directories can exceed
  // Windows path limits and silently force the API into its memory fallback.
  // Keep state isolated but short; retain its exact location in runtime.json.
  const state = path.resolve(persistPath || path.join(root, '.wrangler', 'audit-kv', randomUUID()));
  fs.mkdirSync(state, { recursive: true });
  const listenPort = port || await freePort();
  const baseURL = `http://127.0.0.1:${listenPort}`;
  const args = [
    'pages', 'dev', dist, '--ip', '127.0.0.1', '--port', String(listenPort),
    '--inspector-port', '0', '--persist-to', state,
    '--show-interactive-dev-session=false', '--log-level', 'info',
    ...Object.entries(bindings).flatMap(([key, value]) => ['--binding', `${key}=${value}`]),
  ];
  const { child, done } = spawnWrangler(args, path.join(evidence, 'wrangler.log'));
  let exited = false;
  let spawnError;
  done.then(() => { exited = true; }, error => { exited = true; spawnError = error; });
  async function close() {
    if (exited) return;
    if (process.platform === 'win32') {
      // Only terminate the process tree that this invocation owns.
      await new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', resolve);
        killer.once('exit', resolve);
      });
      cleanOrphanProcesses();
    } else {
      child.kill('SIGTERM');
      cleanOrphanProcesses();
    }
    await Promise.race([done, sleep(5000)]);
  }
  try {
    const deadline = Date.now() + 45000;
    let ready = false;
    let fallbackResponses = 0;
    let lastProbe;
    while (Date.now() < deadline) {
      if (exited) throw spawnError || new Error('Wrangler exited before readiness; inspect wrangler.log.');
      try {
        const response = await fetch(`${baseURL}/api/views?slug=3d-printed-motorcycle&inc=false`, { signal: AbortSignal.timeout(1500) });
        const body = await response.json();
        lastProbe = { status: response.status, storage: body.storage, circuitBreaker: body.circuitBreaker, middlewarePresent: response.headers.has('X-RateLimit-Policy') };
        // A static server, mock response or unbound memory fallback cannot pass.
        if (response.ok && body.ok && body.storage === 'kv' && response.headers.has('X-RateLimit-Policy')) {
          ready = true;
          break;
        }
        if (response.ok && body.storage && body.storage !== 'kv') fallbackResponses++;
      } catch (error) { lastProbe = { error: error.message }; }
      // Do not hammer a broken runtime into its abuse limiter while checking it.
      if (fallbackResponses >= 3) break;
      await sleep(1000);
    }
    fs.writeFileSync(path.join(evidence, 'readiness.json'), JSON.stringify({ ready, baseURL, persistPath: state, persistPathLength: state.length, fallbackResponses, lastProbe }, null, 2));
    if (!ready) throw new Error(`Pages Functions with VIEWS_KV did not become ready; last probe=${JSON.stringify(lastProbe)}. Inspect readiness.json and wrangler.log.`);
    const metadata = {
      runtime: 'wrangler pages dev',
      version: JSON.parse(fs.readFileSync(wranglerPackage, 'utf8')).version,
      mode: 'local', baseURL, persistPath: state,
      functionsDirectory: path.join(root, 'functions'),
      kvBinding: 'VIEWS_KV (wrangler.toml)',
      args: args.map(arg => arg.startsWith('ADMIN_TOKEN=') ? 'ADMIN_TOKEN=[local-test-value]' : arg),
    };
    fs.writeFileSync(path.join(evidence, 'runtime.json'), JSON.stringify(metadata, null, 2));
    return {
      ...metadata, close,
      async seedKV(entries) {
        const file = path.join(evidence, `kv-fixture-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify(entries.map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })), null, 2));
        await runWrangler(['kv', 'bulk', 'put', file, '--binding', 'VIEWS_KV', '--local', '--persist-to', state], path.join(evidence, 'kv-fixtures.log'));
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
