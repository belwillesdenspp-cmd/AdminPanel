import { createProxyMiddleware } from 'http-proxy-middleware';
import { COOKIE_NAME, verifySessionToken } from './auth.js';
import { findUserById, getApp, userHasAppAccess } from './db.js';
import { requireAppAccessFor } from './middleware.js';

function gatewaySecretFor(appId) {
  if (appId === 'torcy') {
    return process.env.TORCY_GATEWAY_SECRET || 'torcy-gateway-dev-secret-change-me';
  }
  if (appId === 'compusers') {
    return (
      process.env.COMPUSERS_GATEWAY_SECRET ||
      'compusers-gateway-dev-secret-change-me'
    );
  }
  if (appId === 'tmc') {
    return process.env.TMC_GATEWAY_SECRET || 'tmc-gateway-dev-secret-change-me';
  }
  if (appId === 'citrix') {
    return (
      process.env.CITRIX_GATEWAY_SECRET ||
      'citrix-gateway-dev-secret-change-me'
    );
  }
  if (appId === 'glpi') {
    return process.env.GLPI_GATEWAY_SECRET || 'glpi-gateway-dev-secret-change-me';
  }
  if (appId === 'equipment') {
    return (
      process.env.EQUIPMENT_GATEWAY_SECRET ||
      'equipment-gateway-dev-secret-change-me'
    );
  }
  return process.env.ADMIN_GATEWAY_SECRET || '';
}

function gatewaySecretHeaderName(appId) {
  if (appId === 'compusers') return 'X-CompUsers-Gateway-Secret';
  if (appId === 'torcy') return 'X-Torcy-Gateway-Secret';
  if (appId === 'tmc') return 'X-Tmc-Gateway-Secret';
  if (appId === 'citrix') return 'X-Citrix-Gateway-Secret';
  if (appId === 'glpi') return 'X-Glpi-Gateway-Secret';
  if (appId === 'equipment') return 'X-Equipment-Gateway-Secret';
  return 'X-Admin-Gateway-Secret';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function userFromUpgrade(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload?.sub) return null;
  const user = findUserById(payload.sub);
  if (!user || !user.is_active) return null;
  return user;
}

function applyGatewayHeaders(proxyReq, user, appId) {
  if (user) {
    proxyReq.setHeader('X-Admin-User-Id', String(user.id));
    proxyReq.setHeader('X-Admin-Username', user.username);
    proxyReq.setHeader(
      'X-Admin-Display-Name',
      encodeURIComponent(user.display_name || ''),
    );
    proxyReq.setHeader('X-Admin-Role', user.role);
  }
  const secret = gatewaySecretFor(appId);
  if (secret) {
    proxyReq.setHeader(gatewaySecretHeaderName(appId), secret);
    // Torcy historically accepted only this header name.
    if (appId === 'torcy') {
      proxyReq.setHeader('X-Torcy-Gateway-Secret', secret);
    }
  }
}

export function mountAppProxies(expressApp, apps) {
  const entries = [];

  for (const app of apps) {
    const target = `http://${app.internalHost}:${app.internalPort}`;
    const prefix = app.publicPath.replace(/\/$/, '');

    const proxy = createProxyMiddleware({
      target,
      changeOrigin: true,
      // Do NOT enable HPM auto-upgrade here. Upgrades are handled only in
      // attachAppProxyUpgrades (auth + path strip). Having both breaks VNC/SSH.
      ws: false,
      on: {
        error(err, _req, res) {
          console.error(`[proxy:${app.id}]`, err.message);
          if (res && !res.headersSent && typeof res.writeHead === 'function') {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({ error: `Приложение «${app.title}» недоступно` }),
            );
          }
        },
        proxyReq(proxyReq, req) {
          applyGatewayHeaders(proxyReq, req.user, app.id);
        },
      },
    });

    expressApp.use(prefix, requireAppAccessFor(app.id), proxy);
    entries.push({ app, prefix, proxy });
    console.log(`[proxy] ${prefix} -> ${target}`);
  }

  return entries;
}

/** Wire WebSocket upgrades for embedded apps (auth + path strip). */
export function attachAppProxyUpgrades(server, entries) {
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const entry = entries.find(
      ({ prefix }) => url === prefix || url.startsWith(`${prefix}/`),
    );
    if (!entry) return;

    const user = userFromUpgrade(req);
    const appRow = getApp(entry.app.id);
    if (
      !user ||
      !appRow ||
      !appRow.enabled ||
      !userHasAppAccess(user, entry.app.id)
    ) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // Inject identity + gateway secret for child apps (WS has no Express middleware).
    req.headers['x-admin-user-id'] = String(user.id);
    req.headers['x-admin-username'] = user.username;
    req.headers['x-admin-display-name'] = encodeURIComponent(user.display_name || '');
    req.headers['x-admin-role'] = user.role;
    const secret = gatewaySecretFor(entry.app.id);
    if (secret) {
      const header = gatewaySecretHeaderName(entry.app.id).toLowerCase();
      req.headers[header] = secret;
      if (entry.app.id === 'torcy') {
        req.headers['x-torcy-gateway-secret'] = secret;
      }
    }

    req.url = url.slice(entry.prefix.length) || '/';
    entry.proxy.upgrade(req, socket, head);
  });
}
