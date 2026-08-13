import { Router } from 'express';
import { appsForUser, getApp, listApps, setAppEnabled } from '../db.js';
import { requireAdmin, requireAuth } from '../middleware.js';
import { getAppHealth, getRuntimeStatus } from '../supervisor.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const apps = appsForUser(req.user);
  const withStatus = await Promise.all(
    apps.map(async (app) => {
      const runtime = getRuntimeStatus(app.id);
      const health = await getAppHealth(app);
      return {
        id: app.id,
        title: app.title,
        description: app.description,
        publicPath: app.publicPath,
        enabled: app.enabled,
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

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const app = getApp(req.params.id);
  if (!app) return res.status(404).json({ error: 'Приложение не найдено' });

  if (req.body?.enabled === undefined) {
    return res.status(400).json({ error: 'Укажите enabled' });
  }

  const updated = setAppEnabled(app.id, Boolean(req.body.enabled));
  res.json({ app: updated });
});

export default router;
