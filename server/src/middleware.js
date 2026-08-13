import { findUserById, getApp, userHasAppAccess } from './db.js';
import { readSessionToken, verifySessionToken } from './auth.js';

export function attachUser(req, _res, next) {
  const token = readSessionToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  const payload = verifySessionToken(token);
  if (!payload?.sub) {
    req.user = null;
    return next();
  }

  const user = findUserById(payload.sub);
  if (!user || !user.is_active) {
    req.user = null;
    return next();
  }

  req.user = user;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  next();
}

export function requireAppAccessFor(appId) {
  return (req, res, next) => {
    if (!req.user) {
      const wantsHtml = Boolean(req.accepts('html'));
      const looksLikeAssetOrApi =
        req.path.includes('.') ||
        req.path.includes('/api/') ||
        req.originalUrl.includes('/api/') ||
        req.originalUrl.includes('/uploads/');
      if (wantsHtml && !looksLikeAssetOrApi) {
        return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      }
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const app = getApp(appId);
    if (!app) {
      return res.status(404).json({ error: 'Приложение не найдено' });
    }
    if (!app.enabled) {
      return res.status(403).json({ error: 'Приложение отключено' });
    }
    if (!userHasAppAccess(req.user, appId)) {
      return res.status(403).json({ error: 'Нет доступа к приложению' });
    }

    next();
  };
}
