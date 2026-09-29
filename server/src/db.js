import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAllowedAppIcon } from './appIcons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'admin.db');
const appsConfigPath = path.join(__dirname, '..', '..', 'config', 'apps.json');
const appIconsDir = path.join(dataDir, 'app-icons');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(appIconsDir)) {
  fs.mkdirSync(appIconsDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'specialist')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    public_path TEXT NOT NULL,
    internal_host TEXT NOT NULL DEFAULT '127.0.0.1',
    internal_port INTEGER NOT NULL,
    health_path TEXT NOT NULL DEFAULT '/api/health',
    cwd TEXT NOT NULL,
    command TEXT NOT NULL DEFAULT 'npm',
    args_json TEXT NOT NULL DEFAULT '["start"]',
    sort_order INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS user_app_permissions (
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    PRIMARY KEY (user_id, app_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_app_prefs (
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, app_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_fusion_credentials (
    user_id INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('bmk', 'bvd')),
    cipher TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, source),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ui_prefs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function ensureColumn(table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('apps', 'icon', "icon TEXT NOT NULL DEFAULT ''");
ensureColumn('apps', 'icon_ext', "icon_ext TEXT NOT NULL DEFAULT ''");
ensureColumn('apps', 'icon_updated', 'icon_updated INTEGER NOT NULL DEFAULT 0');

const NOTIFY_DEFAULTS = {
  position: 'top-center',
  opacity: 0.92,
  hideSec: 20,
};

export function getNotifyPrefs() {
  const row = db.prepare(`SELECT value FROM ui_prefs WHERE key = 'notifications'`).get();
  if (!row?.value) return { ...NOTIFY_DEFAULTS };
  try {
    const parsed = JSON.parse(row.value);
    const position = ['top-center', 'top-right', 'bottom-right'].includes(parsed.position)
      ? parsed.position
      : NOTIFY_DEFAULTS.position;
    const opacity = Math.min(1, Math.max(0.55, Number(parsed.opacity) || NOTIFY_DEFAULTS.opacity));
    const hideSec = Math.min(120, Math.max(5, Number(parsed.hideSec) || NOTIFY_DEFAULTS.hideSec));
    return { position, opacity, hideSec };
  } catch {
    return { ...NOTIFY_DEFAULTS };
  }
}

export function saveNotifyPrefs(patch = {}) {
  const next = { ...getNotifyPrefs(), ...patch };
  const clean = getNotifyPrefs();
  const position = ['top-center', 'top-right', 'bottom-right'].includes(next.position)
    ? next.position
    : clean.position;
  const opacity = Math.min(1, Math.max(0.55, Number(next.opacity) || clean.opacity));
  const hideSec = Math.min(120, Math.max(5, Math.round(Number(next.hideSec) || clean.hideSec)));
  const value = JSON.stringify({ position, opacity, hideSec });
  db.prepare(
    `INSERT INTO ui_prefs (key, value) VALUES ('notifications', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(value);
  return { position, opacity, hideSec };
}

function syncAppsFromConfig() {
  if (!fs.existsSync(appsConfigPath)) {
    console.warn('[db] config/apps.json not found:', appsConfigPath);
    return;
  }

  const apps = JSON.parse(fs.readFileSync(appsConfigPath, 'utf8'));
  const upsert = db.prepare(`
    INSERT INTO apps (
      id, title, description, public_path, internal_host, internal_port,
      health_path, cwd, command, args_json, sort_order, enabled, icon
    ) VALUES (
      @id, @title, @description, @publicPath, @internalHost, @internalPort,
      @healthPath, @cwd, @command, @argsJson, @sortOrder, @enabled, @icon
    )
    ON CONFLICT(id) DO UPDATE SET
      public_path = excluded.public_path,
      internal_host = excluded.internal_host,
      internal_port = excluded.internal_port,
      health_path = excluded.health_path,
      cwd = excluded.cwd,
      command = excluded.command,
      args_json = excluded.args_json
  `);

  const tx = db.transaction((list) => {
    const keep = new Set(list.map((app) => app.id));
    for (const app of list) {
      upsert.run({
        id: app.id,
        title: app.title,
        description: app.description || '',
        publicPath: app.publicPath,
        internalHost: app.internalHost || '127.0.0.1',
        internalPort: app.internalPort,
        healthPath: app.healthPath || '/api/health',
        cwd: app.cwd,
        command: app.command || 'npm',
        argsJson: JSON.stringify(app.args || ['start']),
        sortOrder: app.sortOrder ?? 100,
        enabled: app.enabled === false ? 0 : 1,
        icon: isAllowedAppIcon(app.icon) ? app.icon : app.id,
      });
    }
    const stale = db.prepare('SELECT id FROM apps').all().filter((row) => !keep.has(row.id));
    const remove = db.prepare('DELETE FROM apps WHERE id = ?');
    for (const row of stale) {
      remove.run(row.id);
      console.log(`[db] удалено приложение из каталога: ${row.id}`);
    }
  });

  tx(apps);
  db.prepare(`UPDATE apps SET icon = id WHERE icon = ''`).run();
}

function seedAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(`
    INSERT INTO users (username, password_hash, display_name, role, is_active)
    VALUES (?, ?, ?, 'admin', 1)
  `).run(username, hash, 'Администратор');

  console.log(`[db] Создан администратор: ${username} / ${password}`);
}

syncAppsFromConfig();
seedAdmin();

export function listApps({ enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? 'SELECT * FROM apps WHERE enabled = 1 ORDER BY sort_order, title'
    : 'SELECT * FROM apps ORDER BY sort_order, title';
  return db.prepare(sql).all().map(mapApp);
}

export function getApp(id) {
  const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  return row ? mapApp(row) : null;
}

export function setAppEnabled(id, enabled) {
  db.prepare('UPDATE apps SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return getApp(id);
}

export function updateApp(id, patch) {
  const current = getApp(id);
  if (!current) return null;

  const title =
    patch.title !== undefined ? String(patch.title).trim() : current.title;
  const description =
    patch.description !== undefined
      ? String(patch.description).trim()
      : current.description;
  let icon = current.icon;
  if (patch.icon !== undefined) {
    const next = String(patch.icon || '').trim();
    icon = isAllowedAppIcon(next) ? next : current.id;
  }
  const sortOrder =
    patch.sortOrder !== undefined
      ? Math.max(0, Math.min(9999, Number(patch.sortOrder) || 0))
      : current.sortOrder;
  const enabled =
    patch.enabled === undefined ? (current.enabled ? 1 : 0) : patch.enabled ? 1 : 0;

  if (!title) {
    const err = new Error('Укажите название');
    err.status = 400;
    throw err;
  }
  if (title.length > 80) {
    const err = new Error('Название слишком длинное');
    err.status = 400;
    throw err;
  }
  if (description.length > 240) {
    const err = new Error('Описание слишком длинное');
    err.status = 400;
    throw err;
  }

  db.prepare(
    `UPDATE apps
     SET title = ?, description = ?, icon = ?, sort_order = ?, enabled = ?
     WHERE id = ?`,
  ).run(title, description, icon, sortOrder, enabled, id);
  return getApp(id);
}

export function readAppsCatalog() {
  if (!fs.existsSync(appsConfigPath)) return [];
  return JSON.parse(fs.readFileSync(appsConfigPath, 'utf8'));
}

export function restoreAppAppearance(id) {
  const catalog = readAppsCatalog();
  const def = catalog.find((app) => app.id === id);
  if (!def) {
    const err = new Error('В каталоге нет исходных значений');
    err.status = 404;
    throw err;
  }
  clearAppIconFile(id);
  db.prepare(
    `UPDATE apps
     SET title = ?, description = ?, icon = ?, icon_ext = '', icon_updated = 0
     WHERE id = ?`,
  ).run(def.title, def.description || '', isAllowedAppIcon(def.icon) ? def.icon : def.id, id);
  return getApp(id);
}

const ICON_EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export function saveAppIconFromDataUrl(id, dataUrl) {
  const match = String(dataUrl || '').match(
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/,
  );
  if (!match) {
    const err = new Error('Загрузите PNG, JPEG, WebP или GIF');
    err.status = 400;
    throw err;
  }
  const mime = match[1];
  const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length || buf.length > 400 * 1024) {
    const err = new Error('Файл значка больше 400 КБ');
    err.status = 400;
    throw err;
  }
  const ext = ICON_EXT_BY_MIME[mime];
  if (!ext) {
    const err = new Error('Неподдерживаемый формат значка');
    err.status = 400;
    throw err;
  }
  clearAppIconFile(id);
  fs.writeFileSync(path.join(appIconsDir, `${id}${ext}`), buf);
  db.prepare(
    `UPDATE apps SET icon_ext = ?, icon_updated = ? WHERE id = ?`,
  ).run(ext, Date.now(), id);
  return getApp(id);
}

export function clearAppIconFile(id) {
  const row = db.prepare('SELECT icon_ext FROM apps WHERE id = ?').get(id);
  if (row?.icon_ext) {
    const filePath = path.join(appIconsDir, `${id}${row.icon_ext}`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
  db.prepare(`UPDATE apps SET icon_ext = '', icon_updated = 0 WHERE id = ?`).run(id);
  return getApp(id);
}

export function getAppIconFile(id) {
  const row = db.prepare('SELECT icon_ext FROM apps WHERE id = ?').get(id);
  if (!row?.icon_ext) return null;
  const filePath = path.join(appIconsDir, `${id}${row.icon_ext}`);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, ext: row.icon_ext };
}

export function swapAppSort(id, direction) {
  const apps = listApps();
  const index = apps.findIndex((app) => app.id === id);
  if (index < 0) return null;
  const otherIndex = direction === 'up' ? index - 1 : index + 1;
  if (otherIndex < 0 || otherIndex >= apps.length) return getApp(id);
  const reordered = apps.slice();
  const [item] = reordered.splice(index, 1);
  reordered.splice(otherIndex, 0, item);
  const tx = db.transaction(() => {
    reordered.forEach((app, i) => {
      db.prepare('UPDATE apps SET sort_order = ? WHERE id = ?').run((i + 1) * 10, app.id);
    });
  });
  tx();
  return getApp(id);
}

export function getUserAppPrefsMap(userId) {
  const rows = db
    .prepare('SELECT app_id, pinned FROM user_app_prefs WHERE user_id = ?')
    .all(userId);
  const map = new Map();
  for (const row of rows) map.set(row.app_id, { pinned: Boolean(row.pinned) });
  return map;
}

export function setUserAppPinned(userId, appId, pinned) {
  db.prepare(
    `INSERT INTO user_app_prefs (user_id, app_id, pinned)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, app_id) DO UPDATE SET pinned = excluded.pinned`,
  ).run(userId, appId, pinned ? 1 : 0);
  return { pinned: Boolean(pinned) };
}

function mapApp(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    publicPath: row.public_path,
    internalHost: row.internal_host,
    internalPort: row.internal_port,
    healthPath: row.health_path,
    cwd: row.cwd,
    command: row.command,
    args: JSON.parse(row.args_json || '["start"]'),
    sortOrder: row.sort_order,
    enabled: Boolean(row.enabled),
    icon: row.icon || row.id,
    iconUrl: row.icon_ext
      ? `/api/apps/${row.id}/icon?v=${row.icon_updated || 0}`
      : null,
  };
}

export function findUserByUsername(username) {
  return db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function listUsers() {
  return db
    .prepare(
      `SELECT id, username, display_name, role, is_active, created_at, updated_at
       FROM users ORDER BY role, username`,
    )
    .all()
    .map(mapUser);
}

export function createUser({ username, password, displayName, role }) {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, is_active)
       VALUES (?, ?, ?, ?, 1)`,
    )
    .run(username, hash, displayName, role);
  return getUserPublic(info.lastInsertRowid);
}

export function updateUser(id, patch) {
  const current = findUserById(id);
  if (!current) return null;

  const displayName = patch.displayName ?? current.display_name;
  const role = patch.role ?? current.role;
  const isActive =
    patch.isActive === undefined ? current.is_active : patch.isActive ? 1 : 0;

  db.prepare(
    `UPDATE users
     SET display_name = ?, role = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(displayName, role, isActive, id);

  if (patch.password) {
    const hash = bcrypt.hashSync(patch.password, 10);
    db.prepare(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(hash, id);
  }

  return getUserPublic(id);
}

export function getUserPublic(id) {
  const row = findUserById(id);
  return row ? mapUser(row) : null;
}

export function countAdmins() {
  return db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c;
}

export function deleteUser(id) {
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return info.changes > 0;
}

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUserAppIds(userId) {
  return db
    .prepare('SELECT app_id FROM user_app_permissions WHERE user_id = ?')
    .all(userId)
    .map((r) => r.app_id);
}

export function setUserAppPermissions(userId, appIds) {
  const del = db.prepare('DELETE FROM user_app_permissions WHERE user_id = ?');
  const ins = db.prepare(
    'INSERT INTO user_app_permissions (user_id, app_id) VALUES (?, ?)',
  );
  const tx = db.transaction((ids) => {
    del.run(userId);
    for (const appId of ids) {
      ins.run(userId, appId);
    }
  });
  tx(appIds);
  return getUserAppIds(userId);
}

export function userHasAppAccess(user, appId) {
  if (!user || !user.is_active) return false;
  if (user.role === 'admin') return true;
  const row = db
    .prepare(
      'SELECT 1 AS ok FROM user_app_permissions WHERE user_id = ? AND app_id = ?',
    )
    .get(user.id, appId);
  return Boolean(row);
}

export function appsForUser(user) {
  // Include disabled apps so the catalog can show them as inactive.
  const apps = listApps({ enabledOnly: false });
  const allowed =
    user.role === 'admin' ? null : new Set(getUserAppIds(user.id));
  const visible = allowed ? apps.filter((a) => allowed.has(a.id)) : apps;
  const prefs = getUserAppPrefsMap(user.id);
  return visible
    .map((app) => ({
      ...app,
      pinned: Boolean(prefs.get(app.id)?.pinned),
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.title).localeCompare(String(b.title), 'ru');
    });
}

export function getFusionCredentialCipher(userId, source) {
  const row = db
    .prepare(
      'SELECT cipher FROM user_fusion_credentials WHERE user_id = ? AND source = ?',
    )
    .get(Number(userId), source);
  return row?.cipher || null;
}

export function upsertFusionCredentialCipher(userId, source, cipher) {
  db.prepare(
    `INSERT INTO user_fusion_credentials (user_id, source, cipher, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, source) DO UPDATE SET
       cipher = excluded.cipher,
       updated_at = datetime('now')`,
  ).run(Number(userId), source, cipher);
}

export function deleteFusionCredentialCipher(userId, source) {
  const info = db
    .prepare('DELETE FROM user_fusion_credentials WHERE user_id = ? AND source = ?')
    .run(Number(userId), source);
  return info.changes > 0;
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

export default db;
