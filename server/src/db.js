import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'admin.db');
const appsConfigPath = path.join(__dirname, '..', '..', 'config', 'apps.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
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
`);

function syncAppsFromConfig() {
  if (!fs.existsSync(appsConfigPath)) {
    console.warn('[db] config/apps.json not found:', appsConfigPath);
    return;
  }

  const apps = JSON.parse(fs.readFileSync(appsConfigPath, 'utf8'));
  const upsert = db.prepare(`
    INSERT INTO apps (
      id, title, description, public_path, internal_host, internal_port,
      health_path, cwd, command, args_json, sort_order, enabled
    ) VALUES (
      @id, @title, @description, @publicPath, @internalHost, @internalPort,
      @healthPath, @cwd, @command, @argsJson, @sortOrder, @enabled
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      public_path = excluded.public_path,
      internal_host = excluded.internal_host,
      internal_port = excluded.internal_port,
      health_path = excluded.health_path,
      cwd = excluded.cwd,
      command = excluded.command,
      args_json = excluded.args_json,
      sort_order = excluded.sort_order,
      enabled = excluded.enabled
  `);

  const tx = db.transaction((list) => {
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
      });
    }
  });

  tx(apps);
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
  if (user.role === 'admin') return apps;
  const allowed = new Set(getUserAppIds(user.id));
  return apps.filter((a) => allowed.has(a.id));
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

export default db;
