import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { listApps } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

/** @type {Map<string, { proc: import('child_process').ChildProcess, startedAt: number, exitCode: number|null, logs: string[] }>} */
const children = new Map();

const SUPERVISOR_ENABLED = process.env.SUPERVISOR !== '0';

function resolveCwd(cwd) {
  return path.isAbsolute(cwd) ? cwd : path.resolve(rootDir, cwd);
}

function appendLog(entry, line) {
  entry.logs.push(line);
  if (entry.logs.length > 200) entry.logs.shift();
}

export function getRuntimeStatus(appId) {
  const entry = children.get(appId);
  if (!entry) {
    return { running: false, pid: null, startedAt: null, exitCode: null };
  }
  return {
    running: entry.proc.exitCode === null && !entry.proc.killed,
    pid: entry.proc.pid ?? null,
    startedAt: entry.startedAt,
    exitCode: entry.exitCode,
  };
}

export async function getAppHealth(app) {
  const url = `http://${app.internalHost}:${app.internalPort}${app.healthPath}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err.message || 'unreachable' };
  }
}

export function startApp(app) {
  if (!SUPERVISOR_ENABLED) {
    console.log(`[supervisor] skipped (SUPERVISOR=0): ${app.id}`);
    return;
  }
  if (!app.enabled) {
    console.log(`[supervisor] disabled in config: ${app.id}`);
    return;
  }

  const existing = children.get(app.id);
  if (existing && existing.proc.exitCode === null && !existing.proc.killed) {
    console.log(`[supervisor] already running: ${app.id}`);
    return;
  }

  const cwd = resolveCwd(app.cwd);
  const env = {
    ...process.env,
    HOST: app.internalHost,
    PORT: String(app.internalPort),
    BASE_PATH: app.publicPath,
  };

  console.log(`[supervisor] starting ${app.id}: ${app.command} ${app.args.join(' ')} (cwd=${cwd})`);

  const proc = spawn(app.command, app.args, {
    cwd,
    env,
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry = {
    proc,
    startedAt: Date.now(),
    exitCode: null,
    logs: [],
  };
  children.set(app.id, entry);

  proc.stdout?.on('data', (buf) => {
    const text = buf.toString();
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      appendLog(entry, line);
      console.log(`[${app.id}] ${line}`);
    }
  });
  proc.stderr?.on('data', (buf) => {
    const text = buf.toString();
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      appendLog(entry, line);
      console.error(`[${app.id}] ${line}`);
    }
  });
  proc.on('exit', (code, signal) => {
    entry.exitCode = code;
    console.log(`[supervisor] ${app.id} exited code=${code} signal=${signal}`);
  });
  proc.on('error', (err) => {
    appendLog(entry, `spawn error: ${err.message}`);
    console.error(`[supervisor] ${app.id} spawn error:`, err.message);
  });
}

export function startAllApps() {
  const apps = listApps({ enabledOnly: true });
  for (const app of apps) {
    startApp(app);
  }
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      shell: true,
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
}

export function stopAllApps() {
  for (const [id, entry] of children.entries()) {
    if (entry.proc.exitCode === null && !entry.proc.killed) {
      console.log(`[supervisor] stopping ${id} (pid=${entry.proc.pid})`);
      killProcessTree(entry.proc.pid);
    }
  }
  children.clear();
}

export function getChildLogs(appId) {
  return children.get(appId)?.logs ?? [];
}
