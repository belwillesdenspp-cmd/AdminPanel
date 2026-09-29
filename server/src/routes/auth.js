import { Router } from 'express';
import {
  findUserByUsername,
  getUserPublic,
  verifyPassword,
  appsForUser,
  getUserAppIds,
} from '../db.js';
import {
  clearSessionCookie,
  setSessionCookie,
  signSession,
} from '../auth.js';
import { requireAuth } from '../middleware.js';

const router = Router();

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }

  const user = findUserByUsername(username);
  if (!user || !user.is_active || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = signSession(user);
  setSessionCookie(res, token);

  const publicUser = getUserPublic(user.id);
  res.json({
    user: publicUser,
    appIds: user.role === 'admin' ? null : getUserAppIds(user.id),
  });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const publicUser = getUserPublic(req.user.id);
  res.json({
    user: publicUser,
    appIds: req.user.role === 'admin' ? null : getUserAppIds(req.user.id),
    apps: appsForUser(req.user).map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      publicPath: a.publicPath,
      enabled: a.enabled,
      icon: a.icon,
      iconUrl: a.iconUrl,
      sortOrder: a.sortOrder,
      pinned: Boolean(a.pinned),
    })),
  });
});

export default router;
