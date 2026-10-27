/** Настройки бота в ui_prefs. Токен и секрет webhook только шифром. */
import crypto from 'node:crypto';
import { readUiPref, writeUiPref } from '../db.js';

const KEY = 'telegram_bot';
const LOG_KEY = 'telegram_log';
const STATE_KEY = 'telegram_barcode_state';
const OFFSET_KEY = 'telegram_offset';

const DEFAULTS = {
  enabled: false,
  notifyEnabled: true,
  transport: 'poll',
  chatIds: [],
  threshold: 5000,
  midThreshold: 5000,
  apps: { barcode: true },
};

function masterKey() {
  const secret =
    process.env.FUSION_CREDENTIALS_KEY ||
    process.env.JWT_SECRET ||
    'admin-panel-dev-secret-change-me';
  return crypto.scryptSync(String(secret), 'adminpanel-telegram-bot-v1', 32);
}

function encrypt(value) {
  const text = String(value || '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from('telegram-bot', 'utf8'));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decrypt(packed) {
  const parts = String(packed || '').split('.');
  if (parts.length !== 3) return '';
  try {
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
    decipher.setAAD(Buffer.from('telegram-bot', 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function clampQty(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10000000, Math.max(0, Math.trunc(n)));
}

function parseChatIds(value) {
  const raw = Array.isArray(value) ? value.join('\n') : String(value || '');
  const ids = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const text = part.trim();
    if (!/^-?\d{1,20}$/.test(text)) continue;
    if (!ids.includes(text)) ids.push(text);
  }
  return ids.slice(0, 20);
}

function loadRow() {
  try {
    const parsed = JSON.parse(readUiPref(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function telegramSecrets() {
  const row = loadRow();
  return {
    ...publicTelegram(row),
    token: decrypt(row.token),
    webhookSecret: decrypt(row.webhookSecret),
  };
}

export function publicTelegram(row = loadRow()) {
  const transport = row.transport === 'webhook' ? 'webhook' : 'poll';
  return {
    enabled: Boolean(row.enabled),
    notifyEnabled: row.notifyEnabled !== false,
    transport,
    chatIds: parseChatIds(row.chatIds),
    threshold: clampQty(row.threshold, DEFAULTS.threshold),
    midThreshold: clampQty(
      row.midThreshold == null ? row.threshold : row.midThreshold,
      DEFAULTS.midThreshold,
    ),
    apps: { barcode: row.apps?.barcode !== false },
    tokenSet: Boolean(decrypt(row.token)),
    webhookSecretSet: Boolean(decrypt(row.webhookSecret)),
  };
}

export function saveTelegramSettings(patch = {}) {
  const row = loadRow();
  let token = decrypt(row.token);
  let webhookSecret = decrypt(row.webhookSecret);
  if (patch.clearToken) token = '';
  else if (typeof patch.token === 'string' && patch.token.trim()) token = patch.token.trim().slice(0, 200);
  if (patch.clearWebhookSecret) webhookSecret = '';
  else if (typeof patch.webhookSecret === 'string' && patch.webhookSecret.trim()) {
    webhookSecret = patch.webhookSecret.trim().slice(0, 200);
  }
  const next = {
    enabled: patch.enabled != null ? Boolean(patch.enabled) : Boolean(row.enabled),
    notifyEnabled: patch.notifyEnabled != null ? Boolean(patch.notifyEnabled) : row.notifyEnabled !== false,
    transport: patch.transport === 'webhook' ? 'webhook' : patch.transport === 'poll' ? 'poll' : (row.transport === 'webhook' ? 'webhook' : 'poll'),
    chatIds: patch.chatIds != null ? parseChatIds(patch.chatIds) : parseChatIds(row.chatIds),
    threshold: patch.threshold != null
      ? clampQty(patch.threshold, 0)
      : clampQty(row.threshold, DEFAULTS.threshold),
    midThreshold: patch.midThreshold != null
      ? clampQty(patch.midThreshold, 0)
      : clampQty(row.midThreshold == null ? row.threshold : row.midThreshold, DEFAULTS.midThreshold),
    apps: {
      barcode: patch.apps?.barcode != null ? Boolean(patch.apps.barcode) : row.apps?.barcode !== false,
    },
    token: encrypt(token),
    webhookSecret: encrypt(webhookSecret),
  };
  if (next.transport === 'webhook' && !webhookSecret) {
    const err = new Error('Для webhook укажите секрет. Его же нужно передать в setWebhook');
    err.status = 400;
    throw err;
  }
  writeUiPref(KEY, JSON.stringify(next));
  return publicTelegram(next);
}

function emptyBaseState() {
  return { status: 'ok', at: '', qty: null };
}

export function readAlertState() {
  try {
    const parsed = JSON.parse(readUiPref(STATE_KEY) || '{}');
    const bases = parsed?.bases && typeof parsed.bases === 'object' ? parsed.bases : {};
    return { bases };
  } catch {
    return { bases: {} };
  }
}

export function writeAlertState(bases) {
  writeUiPref(STATE_KEY, JSON.stringify({ bases: bases && typeof bases === 'object' ? bases : {} }));
}

export function getAlertState(baseId) {
  const row = readAlertState().bases[String(baseId || '')];
  if (!row || (row.status !== 'alarm' && row.status !== 'ok')) return emptyBaseState();
  return {
    status: row.status,
    at: String(row.at || ''),
    qty: Number.isFinite(Number(row.qty)) ? Number(row.qty) : null,
  };
}

export function setAlertState(baseId, status, qty = null) {
  const id = String(baseId || '');
  const bases = { ...readAlertState().bases };
  bases[id] = {
    status: status === 'alarm' ? 'alarm' : 'ok',
    at: new Date().toISOString(),
    qty: Number.isFinite(Number(qty)) ? Number(qty) : null,
  };
  writeAlertState(bases);
  return bases[id];
}

export function readUpdateOffset() {
  const n = Number(readUiPref(OFFSET_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function writeUpdateOffset(offset) {
  writeUiPref(OFFSET_KEY, String(Number(offset) || 0));
}

export function noteTelegram(entry) {
  let rows = [];
  try {
    const parsed = JSON.parse(readUiPref(LOG_KEY) || '[]');
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    rows = [];
  }
  rows.push({
    at: new Date().toISOString(),
    kind: String(entry.kind || '').slice(0, 40),
    chatId: String(entry.chatId || '').slice(0, 24),
    ok: Boolean(entry.ok),
    error: String(entry.error || '').slice(0, 180),
    summary: String(entry.summary || '').slice(0, 180),
  });
  writeUiPref(LOG_KEY, JSON.stringify(rows.slice(-40)));
}
