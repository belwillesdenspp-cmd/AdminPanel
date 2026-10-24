/** Остаток свободных ШК Fusion. Секреты в ui_prefs только шифром. */
import crypto from 'node:crypto';
import { readUiPref, writeUiPref } from './db.js';
import { onBarcodeRefreshed } from './telegram/bot.js';

const SETTINGS_KEY = 'barcode_monitor';
const CACHE_KEY = 'barcode_monitor_cache';
const ACTION = 'Markdown.getStickerBarcodeMonitor';
const TIMEOUT_MS = 15000;
const SOURCES = ['bvd', 'bmk'];

const SEED = {
  bvd: { url: 'http://172.16.0.164:8080', username: '' },
  bmk: { url: 'http://172.16.2.52:8080', username: '' },
  refreshEnabled: true,
  refreshSec: 60,
  threshold: 5000,
  colorBvd: '#E37B0A',
  colorBmk: '#2E7D32',
};

let timer = null;
let refreshing = null;

function masterKey() {
  const secret =
    process.env.FUSION_CREDENTIALS_KEY ||
    process.env.JWT_SECRET ||
    'admin-panel-dev-secret-change-me';
  return crypto.scryptSync(String(secret), 'adminpanel-barcode-monitor-v1', 32);
}

function encryptSecrets(secrets) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from('barcode-monitor', 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(secrets), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSecrets(packed) {
  const empty = { bvd: { apiKey: '', password: '' }, bmk: { apiKey: '', password: '' } };
  const parts = String(packed || '').split('.');
  if (parts.length !== 3) return empty;
  try {
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
    decipher.setAAD(Buffer.from('barcode-monitor', 'utf8'));
    decipher.setAuthTag(tag);
    const plain = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
    for (const id of SOURCES) {
      empty[id].apiKey = String(plain?.[id]?.apiKey || '');
      empty[id].password = String(plain?.[id]?.password || '');
    }
    return empty;
  } catch {
    return empty;
  }
}

function hexColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(text) ? text : fallback;
}

function cleanUrl(value) {
  const text = String(value || '').trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    const err = new Error('Адрес портала должен быть http или https');
    err.status = 400;
    throw err;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error('Адрес портала должен быть http или https');
    err.status = 400;
    throw err;
  }
  if (url.username || url.password) {
    const err = new Error('Логин и пароль укажите в отдельных полях, не в адресе');
    err.status = 400;
    throw err;
  }
  return url.origin;
}

function loadRaw() {
  const text = readUiPref(SETTINGS_KEY);
  if (!text) {
    const row = { ...SEED, bvd: { ...SEED.bvd }, bmk: { ...SEED.bmk }, secret: '' };
    writeUiPref(SETTINGS_KEY, JSON.stringify(row));
    return row;
  }
  try {
    const parsed = JSON.parse(text);
    return {
      bvd: { url: parsed?.bvd?.url || SEED.bvd.url, username: String(parsed?.bvd?.username || '') },
      bmk: { url: parsed?.bmk?.url || SEED.bmk.url, username: String(parsed?.bmk?.username || '') },
      refreshEnabled: parsed?.refreshEnabled !== false,
      refreshSec: Number(parsed?.refreshSec) || SEED.refreshSec,
      threshold: Number.isFinite(Number(parsed?.threshold)) ? Number(parsed.threshold) : SEED.threshold,
      colorBvd: hexColor(parsed?.colorBvd, SEED.colorBvd),
      colorBmk: hexColor(parsed?.colorBmk, SEED.colorBmk),
      secret: String(parsed?.secret || ''),
    };
  } catch {
    return { ...SEED, bvd: { ...SEED.bvd }, bmk: { ...SEED.bmk }, secret: '' };
  }
}

function publicView(raw, secrets) {
  const view = {
    refreshEnabled: Boolean(raw.refreshEnabled),
    refreshSec: Math.min(3600, Math.max(30, Number(raw.refreshSec) || 60)),
    threshold: Math.min(10000000, Math.max(0, Number(raw.threshold) || 0)),
    colorBvd: raw.colorBvd,
    colorBmk: raw.colorBmk,
  };
  for (const id of SOURCES) {
    view[id] = {
      url: raw[id].url,
      username: raw[id].username,
      apiKeySet: Boolean(secrets[id].apiKey),
      passwordSet: Boolean(secrets[id].password),
    };
  }
  return view;
}

export function barcodeSettings() {
  const raw = loadRaw();
  return publicView(raw, decryptSecrets(raw.secret));
}

export function saveBarcodeSettings(patch = {}) {
  const raw = loadRaw();
  const secrets = decryptSecrets(raw.secret);
  const next = {
    bvd: { url: raw.bvd.url, username: raw.bvd.username },
    bmk: { url: raw.bmk.url, username: raw.bmk.username },
    refreshEnabled: raw.refreshEnabled,
    refreshSec: raw.refreshSec,
    threshold: raw.threshold,
    colorBvd: raw.colorBvd,
    colorBmk: raw.colorBmk,
  };
  for (const id of SOURCES) {
    const body = patch[id] || {};
    if (body.url != null) next[id].url = cleanUrl(body.url);
    if (body.username != null) next[id].username = String(body.username || '').trim().slice(0, 120);
    if (body.clearApiKey) secrets[id].apiKey = '';
    else if (typeof body.apiKey === 'string' && body.apiKey !== '') secrets[id].apiKey = body.apiKey.slice(0, 400);
    if (body.clearPassword) secrets[id].password = '';
    else if (typeof body.password === 'string' && body.password !== '') secrets[id].password = body.password.slice(0, 400);
  }
  if (patch.refreshEnabled != null) next.refreshEnabled = Boolean(patch.refreshEnabled);
  if (patch.refreshSec != null) next.refreshSec = Math.min(3600, Math.max(30, Number(patch.refreshSec) || 60));
  if (patch.threshold != null) next.threshold = Math.min(10000000, Math.max(0, Number(patch.threshold) || 0));
  if (patch.colorBvd != null) next.colorBvd = hexColor(patch.colorBvd, SEED.colorBvd);
  if (patch.colorBmk != null) next.colorBmk = hexColor(patch.colorBmk, SEED.colorBmk);
  writeUiPref(SETTINGS_KEY, JSON.stringify({ ...next, secret: encryptSecrets(secrets) }));
  reschedule();
  return publicView(next, secrets);
}

function readCache() {
  try {
    const parsed = JSON.parse(readUiPref(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseItems(body) {
  if (!Array.isArray(body)) {
    const err = new Error('Портал вернул не список номиналов');
    err.status = 502;
    throw err;
  }
  return body.map((row) => ({
    nominal: Number(row?.nominal),
    free: Number(row?.free),
    used: Number(row?.used),
    total: Number(row?.total),
    percentFree: Number(row?.percentFree),
  })).filter((row) => Number.isFinite(row.nominal) && Number.isFinite(row.free));
}

async function fetchSource(id, raw, secrets) {
  const base = raw[id].url;
  const url = new URL('/exec', base);
  url.searchParams.set('action', ACTION);
  const headers = { Accept: 'application/json' };
  const password = secrets[id].password;
  const username = raw[id].username;
  const apiKey = secrets[id].apiKey;
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(`Портал ответил ${res.status}`);
    err.status = 502;
    throw err;
  }
  const items = parseItems(await res.json());
  if (!items.length) {
    const err = new Error('В ответе нет номиналов');
    err.status = 502;
    throw err;
  }
  return items;
}

export async function refreshBarcodeMonitor(only) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const raw = loadRaw();
    const secrets = decryptSecrets(raw.secret);
    const prev = readCache();
    const targets = only ? [only] : SOURCES;
    const next = { ...prev, at: new Date().toISOString() };
    await Promise.all(targets.map(async (id) => {
      try {
        const items = await fetchSource(id, raw, secrets);
        next[id] = { ok: true, error: '', at: next.at, items };
      } catch (err) {
        const previous = prev[id] && Array.isArray(prev[id].items) ? prev[id].items : [];
        next[id] = {
          ok: false,
          error: err.message || 'Не удалось получить остаток',
          at: previous.length ? prev[id].at : '',
          items: previous,
        };
      }
    }));
    writeUiPref(CACHE_KEY, JSON.stringify(next));
    const snap = snapshot();
    void onBarcodeRefreshed(snap);
    return snap;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

export function snapshot() {
  const cache = readCache();
  const settings = barcodeSettings();
  return {
    settings,
    updatedAt: cache.at || '',
    bases: SOURCES.map((id) => ({
      id,
      title: id === 'bvd' ? 'БВД' : 'БМК',
      color: id === 'bvd' ? settings.colorBvd : settings.colorBmk,
      ok: cache[id]?.ok !== false,
      error: cache[id]?.error || '',
      at: cache[id]?.at || '',
      items: Array.isArray(cache[id]?.items) ? cache[id].items : [],
    })),
  };
}

export async function testBarcodePortal(source) {
  const id = String(source || '').toLowerCase();
  if (!SOURCES.includes(id)) {
    const err = new Error('Укажите базу: БМК или БВД');
    err.status = 400;
    throw err;
  }
  const raw = loadRaw();
  const secrets = decryptSecrets(raw.secret);
  const items = await fetchSource(id, raw, secrets);
  return { ok: true, count: items.length };
}

function reschedule() {
  if (timer) clearInterval(timer);
  timer = null;
  const settings = barcodeSettings();
  if (!settings.refreshEnabled) return;
  timer = setInterval(() => {
    refreshBarcodeMonitor().catch(() => {});
  }, settings.refreshSec * 1000);
  timer.unref?.();
}

export function startBarcodeMonitor() {
  reschedule();
  refreshBarcodeMonitor().catch(() => {});
}

export function stopBarcodeMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}
