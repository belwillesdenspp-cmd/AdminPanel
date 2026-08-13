import { Router } from 'express';
import {
  countAdmins,
  createUser,
  deleteUser,
  findUserById,
  findUserByUsername,
  getApp,
  getUserAppIds,
  getUserPublic,
  listApps,
  listUsers,
  setUserAppPermissions,
  updateUser,
} from '../db.js';
import { requireAdmin, requireAuth } from '../middleware.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/', (_req, res) => {
  const users = listUsers().map((u) => ({
    ...u,
    appIds: u.role === 'admin' ? listApps().map((a) => a.id) : getUserAppIds(u.id),
  }));
  res.json({ users });
});

router.post('/', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.displayName || '').trim() || username;
  const role = req.body?.role === 'admin' ? 'admin' : 'specialist';
  const appIds = Array.isArray(req.body?.appIds) ? req.body.appIds.map(String) : [];

  if (!username || username.length < 2) {
    return res.status(400).json({ error: 'Логин слишком короткий' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
  }
  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
  }

  for (const appId of appIds) {
    if (!getApp(appId)) {
      return res.status(400).json({ error: `Неизвестное приложение: ${appId}` });
    }
  }

  const user = createUser({ username, password, displayName, role });
  if (role === 'specialist') {
    setUserAppPermissions(user.id, appIds);
  }

  res.status(201).json({
    user: {
      ...user,
      appIds: role === 'admin' ? listApps().map((a) => a.id) : getUserAppIds(user.id),
    },
  });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!findUserById(id)) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (req.user.id === id && req.body?.isActive === false) {
    return res.status(400).json({ error: 'Нельзя отключить собственную учётную запись' });
  }
  if (req.user.id === id && req.body?.role && req.body.role !== 'admin') {
    return res.status(400).json({ error: 'Нельзя снять с себя роль администратора' });
  }

  const patch = {};
  if (req.body?.displayName !== undefined) {
    patch.displayName = String(req.body.displayName).trim();
  }
  if (req.body?.role !== undefined) {
    patch.role = req.body.role === 'admin' ? 'admin' : 'specialist';
  }
  if (req.body?.isActive !== undefined) {
    patch.isActive = Boolean(req.body.isActive);
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 4) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
    }
    patch.password = String(req.body.password);
  }

  const user = updateUser(id, patch);

  if (Array.isArray(req.body?.appIds)) {
    const appIds = req.body.appIds.map(String);
    for (const appId of appIds) {
      if (!getApp(appId)) {
        return res.status(400).json({ error: `Неизвестное приложение: ${appId}` });
      }
    }
    if (user.role === 'specialist') {
      setUserAppPermissions(id, appIds);
    }
  }

  const fresh = getUserPublic(id);
  res.json({
    user: {
      ...fresh,
      appIds:
        fresh.role === 'admin' ? listApps().map((a) => a.id) : getUserAppIds(id),
    },
  });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = findUserById(id);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  if (req.user.id === id) {
    return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись' });
  }

  if (user.role === 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
  }

  deleteUser(id);
  res.json({ ok: true });
});

export default router;
