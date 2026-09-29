import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const MAX_HOSTS = 1024;
const PING_CONCURRENCY = 32;
const PING_TIMEOUT_MS = 400;

export function ipToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function intToIp(n) {
  const x = n >>> 0;
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

export function prefixToMask(prefix) {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToPrefix(mask) {
  const n = typeof mask === 'number' ? mask : ipToInt(mask);
  if (n == null) return null;
  const bits = n.toString(2);
  if (!/^1*0*$/.test(bits.padStart(32, '0'))) return null;
  return bits.split('1').length - 1;
}

export function isPrivateIpv4(ip) {
  const n = ipToInt(ip);
  if (n == null) return false;
  return (
    (n >= ipToInt('10.0.0.0') && n <= ipToInt('10.255.255.255')) ||
    (n >= ipToInt('172.16.0.0') && n <= ipToInt('172.31.255.255')) ||
    (n >= ipToInt('192.168.0.0') && n <= ipToInt('192.168.255.255')) ||
    (n >= ipToInt('169.254.0.0') && n <= ipToInt('169.254.255.255'))
  );
}

export function parseCidr(input) {
  const raw = String(input || '').trim().replace(/,/g, ' ');
  if (!raw) return { error: 'Укажите подсеть, например 192.168.1.0/24' };

  let address;
  let prefix;

  const spaced = raw.split(/\s+/);
  if (spaced.length === 2 && ipToInt(spaced[0]) != null && ipToInt(spaced[1]) != null) {
    address = spaced[0];
    prefix = maskToPrefix(spaced[1]);
    if (prefix == null) return { error: 'Неверная маска подсети' };
  } else {
    const m = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/);
    if (!m) return { error: 'Неверный формат. Используйте CIDR, например 192.168.1.0/24' };
    address = m[1];
    prefix = m[2] === undefined ? 24 : Number(m[2]);
  }

  const addrInt = ipToInt(address);
  if (addrInt == null) return { error: 'Некорректный IP-адрес' };
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 30) {
    return { error: 'Префикс должен быть от /16 до /30' };
  }

  const mask = prefixToMask(prefix);
  const network = addrInt & mask;
  const broadcast = network | (~mask >>> 0);
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const count = last >= first ? last - first + 1 : 0;

  if (count > MAX_HOSTS) {
    return {
      error: `Слишком большая подсеть (${count} адресов). Максимум ${MAX_HOSTS} — укажите /22 или более узкую маску.`,
    };
  }

  const networkIp = intToIp(network);
  if (!isPrivateIpv4(networkIp) && !isPrivateIpv4(address)) {
    return { error: 'Сканировать можно только частные сети (10/8, 172.16/12, 192.168/16)' };
  }

  const hosts = [];
  for (let n = first; n <= last; n += 1) hosts.push(intToIp(n));

  return {
    cidr: `${networkIp}/${prefix}`,
    network: networkIp,
    broadcast: intToIp(broadcast),
    prefix,
    hosts,
  };
}

export function listIpv4Interfaces() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const item of list || []) {
      if (item.internal || (item.family !== 'IPv4' && item.family !== 4)) continue;
      const addr = item.address;
      if (!ipToInt(addr) || addr.startsWith('127.')) continue;
      const prefix = maskToPrefix(item.netmask) ?? 24;
      const addrInt = ipToInt(addr);
      const network = intToIp(addrInt & prefixToMask(prefix));
      out.push({
        name,
        address: addr,
        netmask: item.netmask,
        cidr: `${network}/${prefix}`,
        mac: item.mac || '',
      });
    }
  }
  return out.sort((a, b) => a.cidr.localeCompare(b.cidr) || a.name.localeCompare(b.name));
}

async function pingHost(ip) {
  const args = IS_WIN
    ? ['-n', '1', '-w', String(PING_TIMEOUT_MS), ip]
    : ['-c', '1', '-W', '1', ip];
  const started = Date.now();
  try {
    const { stdout } = await execFileAsync('ping', args, {
      timeout: PING_TIMEOUT_MS + 1200,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    const text = String(stdout || '');
    const alive = /TTL=/i.test(text);
    const rttMatch = text.match(/[=<](\d+(?:[.,]\d+)?)\s*ms/i);
    const rttMs = rttMatch
      ? Number(String(rttMatch[1]).replace(',', '.'))
      : alive
        ? Date.now() - started
        : null;
    return { ip, alive, rttMs: Number.isFinite(rttMs) ? Math.round(rttMs) : null };
  } catch {
    return { ip, alive: false, rttMs: null };
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, items.length) || 1;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function readArpTable() {
  const map = new Map();
  try {
    const { stdout } = await execFileAsync('arp', ['-a'], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const m = line.match(
        /(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})/i,
      );
      if (!m) continue;
      const mac = m[2].toLowerCase().replace(/-/g, ':');
      if (mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff') continue;
      map.set(m[1], mac);
    }
  } catch {
    /* arp may be unavailable */
  }
  return map;
}

async function reverseName(ip) {
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 800);
      }),
    ]);
    return Array.isArray(names) && names[0] ? String(names[0]) : '';
  } catch {
    return '';
  }
}

let scanLock = false;

export async function scanSubnet(cidrInput) {
  if (scanLock) {
    const err = new Error('Сканирование уже выполняется, подождите');
    err.status = 409;
    throw err;
  }

  const parsed = parseCidr(cidrInput);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }

  scanLock = true;
  const startedAt = Date.now();
  try {
    const pingResults = await mapPool(parsed.hosts, PING_CONCURRENCY, pingHost);
    const arp = await readArpTable();
    const busyIps = pingResults
      .filter((row) => row.alive || arp.has(row.ip))
      .map((row) => row.ip);
    const names = await mapPool(busyIps, 12, reverseName);
    const nameByIp = new Map(busyIps.map((ip, i) => [ip, names[i] || '']));

    const hosts = pingResults.map((row) => {
      const mac = arp.get(row.ip) || '';
      const busy = row.alive || Boolean(mac);
      return {
        ip: row.ip,
        status: busy ? 'busy' : 'free',
        rttMs: row.rttMs,
        mac,
        hostname: nameByIp.get(row.ip) || '',
        self: false,
      };
    });

    const local = new Set(listIpv4Interfaces().map((item) => item.address));
    for (const host of hosts) {
      if (local.has(host.ip)) {
        host.self = true;
        host.status = 'busy';
      }
    }

    const busy = hosts.filter((h) => h.status === 'busy').length;
    const free = hosts.length - busy;
    return {
      ok: true,
      cidr: parsed.cidr,
      network: parsed.network,
      broadcast: parsed.broadcast,
      prefix: parsed.prefix,
      elapsedMs: Date.now() - startedAt,
      totals: { total: hosts.length, busy, free },
      hosts,
    };
  } finally {
    scanLock = false;
  }
}
