import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import { listIpv4Interfaces, scanSubnet } from '../tools/ip.js';
import { checkItemCards, clearFusionLogin, getFusionLoginStatus, saveFusionLogin } from '../tools/cardCheck.js';

let buildFolderOpenerInstallerBat = () => {
  const err = new Error('Модуль установки протокола папок недоступен');
  err.status = 500;
  throw err;
};

try {
  const mod = await import('../tools/folderOpener.js');
  if (typeof mod.buildFolderOpenerInstallerBat === 'function') {
    buildFolderOpenerInstallerBat = mod.buildFolderOpenerInstallerBat;
  }
} catch (err) {
  console.error('[admin] Не загружен folderOpener.js — шлюз стартует без /api/tools/folder-opener:', err.message);
}

const router = Router();

router.use(requireAuth);

export const TOOLS = [
  {
    id: 'ip-scan',
    title: 'Сканер свободных IP',
    description:
      'Проверяет подсеть по ping и ARP и показывает свободные и занятые адреса.',
    path: '/extras/ip-scan',
  },
  {
    id: 'card-check',
    title: 'Проверка карточки товара',
    description:
      'По штрихкоду в выбранной базе Fusion (БМК или БВД) смотрит признаки и говорит, куда назначать: НСИ или ценообразование.',
    path: '/extras/card-check',
  },
];

router.get('/', (_req, res) => {
  res.json({ tools: TOOLS });
});

router.get('/folder-opener', (_req, res) => {
  try {
    const bat = buildFolderOpenerInstallerBat();
    res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Install-AdminPanel-FolderOpener.bat"',
    );
    res.send(bat);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Не удалось собрать установщик' });
  }
});

router.get('/interfaces', (_req, res) => {
  res.json({ interfaces: listIpv4Interfaces() });
});

router.post('/ip-scan', async (req, res) => {
  try {
    const cidr = req.body?.cidr || req.body?.network;
    const result = await scanSubnet(cidr);
    res.json(result);
  } catch (err) {
    const status = Number(err.status) || 500;
    res.status(status).json({ error: err.message || 'Не удалось просканировать подсеть' });
  }
});

router.post('/card-check', async (req, res) => {
  try {
    const result = await checkItemCards(
      req.body?.barcodes ?? req.body?.barcode ?? req.body?.text,
      req.body?.source,
      {
        userId: req.user.id,
        fusionUsername: req.body?.fusionUsername,
        fusionPassword: req.body?.fusionPassword,
        saveCredentials: Boolean(req.body?.saveCredentials),
      },
    );
    res.json(result);
  } catch (err) {
    const status = Number(err.status) || 500;
    res.status(status).json({ error: err.message || 'Не удалось проверить карточки' });
  }
});

router.get('/card-check/fusion', (req, res) => {
  try {
    res.json(getFusionLoginStatus(req.user.id, req.query?.source));
  } catch (err) {
    const status = Number(err.status) || 500;
    res.status(status).json({ error: err.message || 'Не удалось прочитать сохранённый вход Fusion' });
  }
});

router.put('/card-check/fusion', async (req, res) => {
  try {
    const result = await saveFusionLogin(
      req.user.id,
      req.body?.source,
      req.body?.username ?? req.body?.fusionUsername,
      req.body?.password ?? req.body?.fusionPassword,
    );
    res.json(result);
  } catch (err) {
    const status = Number(err.status) || 500;
    res.status(status).json({ error: err.message || 'Не удалось сохранить вход Fusion' });
  }
});

router.delete('/card-check/fusion', (req, res) => {
  try {
    res.json(clearFusionLogin(req.user.id, req.query?.source ?? req.body?.source));
  } catch (err) {
    const status = Number(err.status) || 500;
    res.status(status).json({ error: err.message || 'Не удалось удалить вход Fusion' });
  }
});

export default router;
