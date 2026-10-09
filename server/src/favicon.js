import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'data', 'favicon');
const defaultSvg = path.join(__dirname, '..', '..', 'client', 'public', 'favicon.svg');
const activityLog = path.resolve(__dirname, '..', '..', '..', 'GLPI', 'server', 'data', 'activity.jsonl');

const MAX_BYTES = 2 * 1024 * 1024;
const EXTS = ['.ico', '.png', '.svg', '.gif', '.webp'];
const MIME = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

let cache = null;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function emptyMeta() {
  return { v: 0, icon: null, dark: null, updatedAt: null, updatedBy: null };
}

function loadMeta() {
  if (cache) return cache;
  try {
    cache = { ...emptyMeta(), ...JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) };
  } catch {
    cache = emptyMeta();
  }
  if (cache.icon && !fs.existsSync(slotPath('icon', cache.icon.ext))) cache.icon = null;
  if (cache.dark && !fs.existsSync(slotPath('icon-dark', cache.dark.ext))) cache.dark = null;
  return cache;
}

function slotPath(slot, ext) {
  return path.join(dir, `${slot}${ext}`);
}

function writeMeta(meta) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'meta.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(meta));
  const dest = path.join(dir, 'meta.json');
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(tmp, dest);
  cache = meta;
}

function clearSlot(slot) {
  for (const ext of EXTS) {
    const file = slotPath(slot, ext);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function writeSlot(slot, ext, buf) {
  fs.mkdirSync(dir, { recursive: true });
  clearSlot(slot);
  const dest = slotPath(slot, ext);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

function kb(n) {
  if (n < 1024) return `${n} Б`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

function safeName(name) {
  const base = path.basename(String(name || 'icon')).replace(/[^\w.\- ()\u0400-\u04FF]+/g, '_').slice(0, 80);
  return base || 'icon';
}

function extFromName(name) {
  const m = /\.(ico|png|svg|gif|webp)$/i.exec(String(name || ''));
  return m ? `.${m[1].toLowerCase()}` : '';
}

function detect(buf) {
  if (!buf || buf.length < 8 || buf.length > MAX_BYTES) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: '.png', mime: MIME['.png'] };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { ext: '.gif', mime: MIME['.gif'] };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: '.webp', mime: MIME['.webp'] };
  }
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.length >= 22) {
    return { ext: '.ico', mime: MIME['.ico'] };
  }
  const text = buf.toString('utf8');
  if (text.includes('\0')) return null;
  if (!/<svg[\s>]/i.test(text)) return null;
  if (/<\?php|<html|<!doctype|<script|javascript:|<foreignObject|<iframe|<embed|<object|data:\s*text\/html|on[a-z]+\s*=/i.test(text)) {
    return null;
  }
  return { ext: '.svg', mime: MIME['.svg'] };
}

const MIME_EXT = {
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

export function decodeFavicon(dataUrl, fileName) {
  const match = /^data:([^,]*),([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || '').trim());
  if (!match) throw fail(400, 'Не удалось прочитать файл');
  const parts = match[1].toLowerCase().split(';').map((part) => part.trim()).filter(Boolean);
  if (!parts.includes('base64')) throw fail(400, 'Не удалось прочитать файл');
  const rawMime = parts[0] === 'base64' ? '' : parts[0];
  const loose = !rawMime || rawMime === 'application/octet-stream' || rawMime === 'text/plain' || rawMime === 'text/xml';
  const declared = MIME_EXT[rawMime] || '';
  if (rawMime && !loose && !declared) throw fail(400, 'Неверный формат. Допустимы ICO, PNG, SVG, GIF и WebP.');
  let buf;
  try {
    buf = Buffer.from(match[2], 'base64');
  } catch {
    throw fail(400, 'Не удалось прочитать файл');
  }
  if (!buf.length) throw fail(400, 'Файл пустой');
  if (buf.length > MAX_BYTES) throw fail(400, 'Файл больше 2 МБ');
  const kind = detect(buf);
  if (!kind) throw fail(400, 'Неверный формат. Допустимы ICO, PNG, SVG, GIF и WebP.');
  const named = extFromName(fileName);
  if (named && named !== kind.ext) throw fail(400, 'Расширение не совпадает с содержимым файла');
  if (declared && declared !== kind.ext) throw fail(400, 'Тип файла не совпадает с содержимым');
  return { ...kind, buf, name: safeName(fileName), bytes: buf.length };
}

function hrefFor(slot, info, v) {
  if (!info) return null;
  const name = slot === 'dark' ? 'icon-dark' : 'icon';
  return `/brand/${name}${info.ext}?v=${v}`;
}

export function faviconPublic(user) {
  const meta = loadMeta();
  const custom = Boolean(meta.icon);
  const body = {
    v: custom ? meta.v : 0,
    custom,
    href: custom ? hrefFor('icon', meta.icon, meta.v) : '/favicon.svg',
    type: custom ? meta.icon.mime : 'image/svg+xml',
    darkHref: meta.dark ? hrefFor('dark', meta.dark, meta.v) : null,
    darkType: meta.dark ? meta.dark.mime : null,
  };
  if (user?.role === 'admin') {
    body.updatedAt = meta.updatedAt;
    body.updatedBy = meta.updatedBy;
    body.iconName = meta.icon?.name || null;
    body.darkName = meta.dark?.name || null;
  }
  return body;
}

export function manifestBody() {
  const icon = faviconPublic(null);
  return {
    name: 'AdminPanel',
    short_name: 'AdminPanel',
    start_url: '/',
    display: 'standalone',
    icons: [{ src: icon.href, sizes: 'any', type: icon.type, purpose: 'any' }],
  };
}

function logChange(user, message, meta) {
  const entry = {
    at: new Date().toISOString(),
    type: 'favicon',
    level: 'info',
    ticketId: 0,
    actor: user?.display_name || user?.username || 'admin',
    message: String(message).slice(0, 500),
    meta,
  };
  try {
    fs.mkdirSync(path.dirname(activityLog), { recursive: true });
    fs.appendFileSync(activityLog, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.error('[admin] favicon log:', err.message);
  }
}

export function saveFavicon(user, body) {
  const icon = body?.iconDataUrl ? decodeFavicon(body.iconDataUrl, body.iconName) : null;
  const dark = body?.darkDataUrl ? decodeFavicon(body.darkDataUrl, body.darkName) : null;
  const clearDark = Boolean(body?.clearDark) && !dark;
  if (!icon && !dark && !clearDark) throw fail(400, 'Нет изменений');

  const prev = loadMeta();
  const next = {
    ...prev,
    v: Date.now(),
    updatedAt: new Date().toISOString(),
    updatedBy: user?.display_name || user?.username || 'admin',
  };
  if (icon) {
    writeSlot('icon', icon.ext, icon.buf);
    next.icon = { ext: icon.ext, mime: icon.mime, bytes: icon.bytes, name: icon.name };
  }
  if (dark) {
    writeSlot('icon-dark', dark.ext, dark.buf);
    next.dark = { ext: dark.ext, mime: dark.mime, bytes: dark.bytes, name: dark.name };
  } else if (clearDark) {
    clearSlot('icon-dark');
    next.dark = null;
  }
  writeMeta(next);

  const parts = [];
  if (icon) parts.push(`загружен ${icon.name} (${icon.mime}, ${kb(icon.bytes)})`);
  if (dark) parts.push(`тёмная тема: ${dark.name} (${dark.mime}, ${kb(dark.bytes)})`);
  if (clearDark && prev.dark) parts.push('тёмная тема убрана');
  logChange(user, `Иконка AdminPanel: ${parts.join('; ')}`, {
    action: 'upload',
    ext: next.icon?.ext || '',
    dark: Boolean(next.dark),
  });
  return faviconPublic(user);
}

export function resetFavicon(user) {
  const prev = loadMeta();
  if (!prev.icon && !prev.dark) return faviconPublic(user);
  clearSlot('icon');
  clearSlot('icon-dark');
  const metaPath = path.join(dir, 'meta.json');
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  cache = emptyMeta();
  logChange(user, 'Иконка AdminPanel: сброс к стандартной', { action: 'reset' });
  return faviconPublic(user);
}

function sendFile(res, file, mime, queryV, svg) {
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', queryV ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  if (svg) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(path.resolve(file));
}

export function sendBrandFile(req, res) {
  const name = String(req.params.file || '');
  if (!/^icon(-dark)?\.(ico|png|svg|gif|webp)$/.test(name)) return res.status(404).end();
  const file = path.resolve(dir, name);
  if (!file.startsWith(path.resolve(dir))) return res.status(404).end();
  if (!fs.existsSync(file)) return res.status(404).end();
  const ext = path.extname(name);
  sendFile(res, file, MIME[ext], req.query.v, ext === '.svg');
}

export function sendFaviconIco(req, res) {
  const meta = loadMeta();
  if (meta.icon) {
    const file = slotPath('icon', meta.icon.ext);
    if (fs.existsSync(file)) return sendFile(res, file, meta.icon.mime, '', meta.icon.ext === '.svg');
  }
  if (!fs.existsSync(defaultSvg)) return res.status(404).end();
  sendFile(res, defaultSvg, 'image/svg+xml', '', true);
}
