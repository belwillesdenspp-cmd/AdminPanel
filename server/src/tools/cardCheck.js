import {
  fusionCredentialStatus,
  readFusionCredentials,
  removeFusionCredentials,
  writeFusionCredentials,
} from '../fusionCredentials.js';

const ITEM_CARD_PATH = '/exec?action=Item.getItemCard&barcode=';

export const FUSION_SOURCES = [
  {
    id: 'bmk',
    label: 'БМК',
    base: (process.env.FUSION_BMK_URL || 'http://172.16.2.52:8080').replace(/\/+$/, ''),
  },
  {
    id: 'bvd',
    label: 'БВД',
    base: (process.env.FUSION_BVD_URL || 'http://172.16.0.164:8080').replace(/\/+$/, ''),
  },
];

export function resolveSource(input) {
  const raw = String(input || '').trim().toLowerCase();
  const source = FUSION_SOURCES.find((item) => item.id === raw);
  if (!source) {
    const err = new Error('Укажите базу: БМК или БВД');
    err.status = 400;
    throw err;
  }
  return source;
}

const MAX_BARCODES = 50;
const FETCH_TIMEOUT_MS = 10000;
const FETCH_CONCURRENCY = 4;
const API_DENIED_RE = /нет доступа к api/i;

const fusionSessions = new Map();

function sessionKey(userId, sourceId) {
  return `${Number(userId)}:${sourceId}`;
}

function readSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function storeCookies(jar, res) {
  for (const raw of readSetCookies(res)) {
    const match = String(raw).match(/^([^=]+)=([^;]*)/);
    if (match) jar.set(match[1], match[2]);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function isLoginPage(html) {
  const text = String(html || '');
  return text.includes('name="loginForm"') || text.includes('id="login-form"');
}

async function formLogin(base, username, password) {
  const jar = new Map();
  const home = await fetch(`${base}/`, { redirect: 'follow' });
  storeCookies(jar, home);

  const login = await fetch(`${base}/login_check`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      username,
      password,
      submit: 'Sign in',
    }),
  });
  storeCookies(jar, login);

  const check = await fetch(`${base}/main`, {
    redirect: 'follow',
    headers: { Cookie: cookieHeader(jar) },
  });
  storeCookies(jar, check);
  const html = await check.text();
  if (isLoginPage(html)) {
    const err = new Error('Неверный логин или пароль Fusion');
    err.status = 401;
    throw err;
  }
  return cookieHeader(jar);
}

async function ensureFusionSession(source, cacheKey, credentials) {
  if (fusionSessions.get(cacheKey)?.cookie) return fusionSessions.get(cacheKey);
  if (!credentials) return null;
  const cookie = await formLogin(source.base, credentials.username, credentials.password);
  const session = { cookie, at: Date.now() };
  fusionSessions.set(cacheKey, session);
  return session;
}

export function getFusionLoginStatus(userId, sourceId) {
  const source = resolveSource(sourceId);
  return {
    ...fusionCredentialStatus(userId, source.id),
    sourceLabel: source.label,
  };
}

export async function saveFusionLogin(userId, sourceId, username, password) {
  if (!userId) {
    const err = new Error('Требуется авторизация');
    err.status = 401;
    throw err;
  }
  const source = resolveSource(sourceId);
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) {
    const saved = readFusionCredentials(userId, source.id);
    if (saved && user && !pass) {
      await formLogin(source.base, saved.username, saved.password);
      writeFusionCredentials(userId, source.id, user, saved.password);
      dropSession(sessionKey(userId, source.id));
      return { saved: true, username: user, source: source.id, sourceLabel: source.label };
    }
    const err = new Error('Укажите логин и пароль Fusion');
    err.status = 400;
    throw err;
  }
  const cookie = await formLogin(source.base, user, pass);
  writeFusionCredentials(userId, source.id, user, pass);
  fusionSessions.set(sessionKey(userId, source.id), { cookie, at: Date.now() });
  return { saved: true, username: user, source: source.id, sourceLabel: source.label };
}

export function clearFusionLogin(userId, sourceId) {
  const source = resolveSource(sourceId);
  dropSession(sessionKey(userId, source.id));
  const removed = removeFusionCredentials(userId, source.id);
  return { saved: false, username: null, source: source.id, sourceLabel: source.label, removed };
}

function dropSession(cacheKey) {
  fusionSessions.delete(cacheKey);
}

export function parseBarcodes(input) {
  const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
  const tokens = raw.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  const invalid = [];

  for (const token of tokens) {
    const digits = token.replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 18) {
      invalid.push(token);
      continue;
    }
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
    if (out.length >= MAX_BARCODES) break;
  }

  return {
    barcodes: out,
    invalid,
    truncated: tokens.filter((token) => token.replace(/\D/g, '').length >= 4).length > MAX_BARCODES,
    max: MAX_BARCODES,
  };
}

export function flagOn(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null || value === '') return false;
  const n = Number(value);
  if (Number.isFinite(n)) return n === 1;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'да';
}

export function assignDestination({ found, inactive, entered, processed, sourceLabel }) {
  const where = sourceLabel ? ` Fusion ${sourceLabel}` : ' Fusion';
  if (!found) {
    return {
      destination: 'nsi',
      destinationLabel: 'НСИ',
      reason: `Карточка не найдена в${where}. При сомнениях — НСИ.`,
      doubt: true,
    };
  }

  if (inactive) {
    return {
      destination: 'nsi',
      destinationLabel: 'НСИ',
      reason: 'Заблокирована (неактивен). Признак «введена» недействителен. Нужно введение карточки.',
      doubt: false,
    };
  }

  if (entered && !processed) {
    return {
      destination: 'pricing',
      destinationLabel: 'Ценообразование',
      reason: 'Введена и не обработана. Требуется обработка экономистами.',
      doubt: false,
    };
  }

  if (!entered && !processed) {
    return {
      destination: 'nsi',
      destinationLabel: 'НСИ',
      reason: 'Не введена и не обработана. Нужно введение карточки.',
      doubt: false,
    };
  }

  return {
    destination: 'nsi',
    destinationLabel: 'НСИ',
    reason:
      entered && processed
        ? 'Карточка введена и обработана. Нестандартное сочетание для заявки на активацию — при сомнениях НСИ.'
        : 'Нестандартное сочетание признаков. При сомнениях — НСИ.',
    doubt: true,
  };
}

async function fetchItemCard(barcode, source, session) {
  const url = `${source.base}${ITEM_CARD_PATH}${encodeURIComponent(barcode)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  if (session?.cookie) headers.Cookie = session.cookie;

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers,
    });
    const text = await res.text();
    if (res.status === 404) {
      return { ok: false, error: 'Карточка не найдена' };
    }
    if (!res.ok) {
      return { ok: false, error: `Fusion HTTP ${res.status}` };
    }
    if (!String(text || '').trim()) {
      return { ok: false, error: 'Пустой ответ Fusion' };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: 'Fusion вернул не JSON' };
    }

    if (typeof data === 'string') {
      const message = data.trim() || 'Карточка не найдена';
      return { ok: false, error: message };
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'Карточка не найдена' };
    }
    if (data.error) {
      return { ok: false, error: String(data.error) };
    }
    if (!data.id && !data.idBarcode && !data.guid && !data.name) {
      return { ok: false, error: 'Карточка не найдена' };
    }
    return { ok: true, data };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Таймаут запроса к Fusion' };
    }
    return { ok: false, error: err.message || 'Ошибка запроса к Fusion' };
  } finally {
    clearTimeout(timer);
  }
}

function mapNetwork(barcode, source, fetchResult) {
  if (!fetchResult.ok) {
    const missing = /не найден/i.test(fetchResult.error || '');
    const apiDenied = API_DENIED_RE.test(fetchResult.error || '');
    const assignment = missing
      ? assignDestination({ found: false, sourceLabel: source.label })
      : {
          destination: 'nsi',
          destinationLabel: 'НСИ',
          reason: apiDenied
            ? `Fusion ${source.label} требует вход (как в браузере Gippo). ${fetchResult.error}.`
            : `${fetchResult.error}. При сомнениях — НСИ.`,
          doubt: true,
        };
    return {
      source: source.id,
      sourceLabel: source.label,
      found: false,
      status: missing ? 'missing' : 'error',
      error: fetchResult.error,
      id: null,
      guid: null,
      name: null,
      nameItemGroup: null,
      flags: { entered: false, processed: false, inactive: false },
      allBarcodes: barcode,
      ...assignment,
    };
  }

  const data = fetchResult.data;
  const entered = flagOn(data.entered);
  const processed = flagOn(data.processed);
  const inactive = flagOn(data.inactive);
  const assignment = assignDestination({
    found: true,
    inactive,
    entered,
    processed,
    sourceLabel: source.label,
  });

  return {
    source: source.id,
    sourceLabel: source.label,
    found: true,
    status: 'ok',
    error: null,
    id: data.id != null ? String(data.id) : null,
    guid: data.guid || null,
    name: data.name || data.nameLabel || null,
    nameItemGroup: data.nameItemGroup || null,
    flags: { entered, processed, inactive },
    allBarcodes: data.allBarcodes || barcode,
    ...assignment,
  };
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function checkItemCards(input, sourceId, options = {}) {
  const parsed = parseBarcodes(input);
  if (!parsed.barcodes.length) {
    const err = new Error(
      parsed.invalid.length
        ? 'Не найдено ни одного корректного штрихкода (ожидаются 4–18 цифр)'
        : 'Укажите один или несколько штрихкодов',
    );
    err.status = 400;
    throw err;
  }

  const source = resolveSource(sourceId);
  if (!options.userId) {
    const err = new Error('Требуется авторизация');
    err.status = 401;
    throw err;
  }
  const cacheKey = sessionKey(options.userId, source.id);
  const typedUser = String(options.fusionUsername || '').trim();
  const typedPass = String(options.fusionPassword || '');
  const stored = readFusionCredentials(options.userId, source.id);
  const creds = typedPass
    ? { username: typedUser || stored?.username, password: typedPass }
    : stored;
  if (creds && !creds.username) {
    const err = new Error('Укажите логин Fusion');
    err.status = 400;
    throw err;
  }
  try {
    await ensureFusionSession(source, cacheKey, creds);
  } catch (err) {
    if (typedPass) throw err;
  }

  if (options.saveCredentials && typedPass && creds?.username) {
    writeFusionCredentials(options.userId, source.id, creds.username, creds.password);
  }

  const started = Date.now();
  let session = fusionSessions.get(cacheKey) || null;
  const items = await mapPool(parsed.barcodes, FETCH_CONCURRENCY, async (barcode) => {
    let fetched = await fetchItemCard(barcode, source, session);
    if (API_DENIED_RE.test(fetched.error || '') && session) {
      dropSession(cacheKey);
      session = null;
      fetched = await fetchItemCard(barcode, source, null);
    }
    return { barcode, ...mapNetwork(barcode, source, fetched) };
  });

  const totals = {
    total: items.length,
    nsi: items.filter((item) => item.destination === 'nsi').length,
    pricing: items.filter((item) => item.destination === 'pricing').length,
    missing: items.filter((item) => item.status === 'missing').length,
    error: items.filter((item) => item.status === 'error').length,
  };
  const authRequired = items.some((item) => API_DENIED_RE.test(item.error || ''));
  const login = fusionCredentialStatus(options.userId, source.id);

  return {
    ok: true,
    source: source.id,
    sourceLabel: source.label,
    authRequired,
    savedLogin: login.saved,
    savedUsername: login.username,
    elapsedMs: Date.now() - started,
    truncated: parsed.truncated,
    max: parsed.max,
    invalid: parsed.invalid.slice(0, 20),
    totals,
    items,
  };
}
