import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function parseWindowsNetstat(stdout, port) {
  const pids = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[1] || '';
    const pid = Number(parts[parts.length - 1]);
    const colon = local.lastIndexOf(':');
    if (colon < 0) continue;
    const localPort = Number(local.slice(colon + 1).replace(']', ''));
    if (localPort === port && Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
}

async function pidsListeningOnPort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n <= 0) return [];

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], {
        windowsHide: true,
        encoding: 'utf8',
      });
      return parseWindowsNetstat(stdout, n);
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-iTCP:' + n, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    });
    return stdout
      .split(/\s+/)
      .map((s) => Number(s))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function killPidTree(pid) {
  if (!pid || pid === process.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
    }).catch(() => {});
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }
  return Promise.resolve();
}

export async function waitPortFree(port, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pids = await pidsListeningOnPort(port);
    if (!pids.length) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return (await pidsListeningOnPort(port)).length === 0;
}

/** Kill whoever is listening on the child app port so a restart does not hit EADDRINUSE. */
export async function reclaimPort(port) {
  const pids = (await pidsListeningOnPort(port)).filter((pid) => pid !== process.pid);
  if (!pids.length) return { killed: [] };
  console.log(`[ports] reclaim :${port} pids=${pids.join(',')}`);
  await Promise.all(pids.map((pid) => killPidTree(pid)));
  await waitPortFree(port);
  return { killed: pids };
}
