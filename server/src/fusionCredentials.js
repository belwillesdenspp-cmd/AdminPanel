import crypto from 'node:crypto';
import {
  deleteFusionCredentialCipher,
  getFusionCredentialCipher,
  upsertFusionCredentialCipher,
} from './db.js';

const KEY_SALT = 'adminpanel-fusion-creds-v1';
const SOURCES = new Set(['bmk', 'bvd']);

function masterKey() {
  const secret =
    process.env.FUSION_CREDENTIALS_KEY ||
    process.env.JWT_SECRET ||
    'admin-panel-dev-secret-change-me';
  return crypto.scryptSync(String(secret), KEY_SALT, 32);
}

function aad(userId, source) {
  return Buffer.from(`fusion-cred:${Number(userId)}:${source}`, 'utf8');
}

function encryptBlob(userId, source, payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(aad(userId, source));
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(encoded), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptBlob(userId, source, packed) {
  const parts = String(packed || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
    decipher.setAAD(aad(userId, source));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const data = JSON.parse(plain);
    const username = String(data?.username || '').trim();
    const password = String(data?.password || '');
    if (!username || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

export function assertFusionSource(source) {
  const id = String(source || '').trim().toLowerCase();
  if (!SOURCES.has(id)) {
    const err = new Error('Укажите базу: БМК или БВД');
    err.status = 400;
    throw err;
  }
  return id;
}

export function readFusionCredentials(userId, source) {
  if (!userId) return null;
  const sourceId = assertFusionSource(source);
  const cipher = getFusionCredentialCipher(userId, sourceId);
  if (!cipher) return null;
  return decryptBlob(userId, sourceId, cipher);
}

export function fusionCredentialStatus(userId, source) {
  const creds = readFusionCredentials(userId, source);
  if (!creds) return { saved: false, username: null, source: assertFusionSource(source) };
  return { saved: true, username: creds.username, source: assertFusionSource(source) };
}

export function writeFusionCredentials(userId, source, username, password) {
  if (!userId) {
    const err = new Error('Требуется авторизация');
    err.status = 401;
    throw err;
  }
  const sourceId = assertFusionSource(source);
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) {
    const err = new Error('Укажите логин и пароль Fusion');
    err.status = 400;
    throw err;
  }
  const cipher = encryptBlob(userId, sourceId, { username: user, password: pass });
  upsertFusionCredentialCipher(userId, sourceId, cipher);
  return { saved: true, username: user, source: sourceId };
}

export function removeFusionCredentials(userId, source) {
  if (!userId) return false;
  const sourceId = assertFusionSource(source);
  return deleteFusionCredentialCipher(userId, sourceId);
}
