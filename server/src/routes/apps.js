import { Router } from 'express';
import path from 'node:path';
import {
  appsForUser,
  clearAppIconFile,
  getApp,
  getAppIconFile,
  listApps,
  restoreAppAppearance,
  saveAppIconFromDataUrl,
  setAppEnabled,
  setUserAppPinned,
  swapAppSort,
  updateApp,
  userHasAppAccess,
  getNotifyPrefs,
  saveNotifyPrefs,
} from '../db.js';
import { requireAdmin, requireAuth } from '../middleware.js';
import { getAppHealth, getRuntimeStatus } from '../supervisor.js';

const router = Router();

function publicApp(app) {
  return {
    id: app.id,
    title: app.title,
    description: app.description,
    publicPath: app.publicPath,
    enabled: app.enabled,
    icon: app.icon,
    iconUrl: app.iconUrl,
    sortOrder: app.sortOrder,
    pinned: Boolean(app.pinned),
  };
}

router.get('/', requireAuth, async (req, res) => {
  const apps = appsForUser(req.user);
  const withStatus = await Promise.all(
    apps.map(async (app) => {
      const runtime = getRuntimeStatus(app.id);
      const health = await getAppHealth(app);
      return {
        ...publicApp(app),
        online: health.ok,
        health,
        runtime,
      };
    }),
  );
  res.json({ apps: withStatus });
});

router.get('/all', requireAuth, requireAdmin, async (_req, res) => {
  const apps = listApps();
  const withStatus = await Promise.all(
    apps.map(async (app) => {
      const runtime = getRuntimeStatus(app.id);
      const health = await getAppHealth(app);
      return {
        ...app,
        online: health.ok,
        health,
        runtime,
      };
    }),
  );
  res.json({ apps: withStatus });
});

router.get('/:id/icon', requireAuth, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });
  if (!userHasAppAccess(req.user, app.id)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const file = getAppIconFile(app.id);
  if (!file) return res.status(404).json({ error: 'Значок не задан' });
  const mime =
    file.ext === '.png'
      ? 'image/png'
      : file.ext === '.jpg'
        ? 'image/jpeg'
        : file.ext === '.webp'
          ? 'image/webp'
          : 'image/gif';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.resolve(file.filePath));
});

router.post('/:id/icon', requireAuth, requireAdmin, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });
  try {
    const updated = saveAppIconFromDataUrl(app.id, req.body?.dataUrl);
    res.json({ app: updated });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Не удалось сохранить значок' });
  }
});

router.delete('/:id/icon', requireAuth, requireAdmin, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });
  res.json({ app: clearAppIconFile(app.id) });
});

router.post('/:id/restore', requireAuth, requireAdmin, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });
  try {
    res.json({ app: restoreAppAppearance(app.id) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Не удалось восстановить' });
  }
});

router.post('/:id/move', requireAuth, requireAdmin, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });
  const direction = req.body?.direction === 'up' ? 'up' : 'down';
  res.json({ app: swapAppSort(app.id, direction) });
});

router.patch('/:id/prefs', requireAuth, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });
  if (!userHasAppAccess(req.user, app.id)) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  if (req.body?.pinned === undefined) {
    return res.status(400).json({ error: 'Укажите pinned' });
  }
  const prefs = setUserAppPinned(req.user.id, app.id, Boolean(req.body.pinned));
  res.json({ prefs });
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });

  const hasAppearance =
    req.body?.title !== undefined ||
    req.body?.description !== undefined ||
    req.body?.icon !== undefined ||
    req.body?.sortOrder !== undefined ||
    req.body?.enabled !== undefined;

  if (!hasAppearance) {
    return res.status(400).json({ error: 'Укажите поля для изменения' });
  }

  try {
    if (
      req.body?.title === undefined &&
      req.body?.description === undefined &&
      req.body?.icon === undefined &&
      req.body?.sortOrder === undefined &&
      req.body?.enabled !== undefined
    ) {
      const updated = setAppEnabled(app.id, Boolean(req.body.enabled));
      return res.json({ app: updated });
    }
    const updated = updateApp(app.id, {
      title: req.body.title,
      description: req.body.description,
      icon: req.body.icon,
      sortOrder: req.body.sortOrder,
      enabled: req.body.enabled,
    });
    res.json({ app: updated });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Не удалось сохранить' });
  }
});

router.get('/notifications', requireAuth, (_req, res) => {
  res.json({ prefs: getNotifyPrefs() });
});

router.put('/notifications', requireAdmin, (req, res) => {
  res.json({ prefs: saveNotifyPrefs(req.body || {}) });
});

export default router;
