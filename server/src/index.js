import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listApps } from './db.js';
import { attachUser } from './middleware.js';
import { attachAppProxyUpgrades, mountAppProxies } from './proxy.js';
import { sendBrandFile, sendFaviconIco } from './favicon.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import appsRouter from './routes/apps.js';
import toolsRouter from './routes/tools.js';
import brandRouter from './routes/brand.js';
import { startAllApps, stopAllApps } from './supervisor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Use ADMIN_PORT only — never inherit a child's PORT (3003/3004/…) onto the gateway.
const PORT = Number(process.env.ADMIN_PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
delete process.env.PORT;

const app = express();

app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'clipboard-read=*, clipboard-write=*');
  next();
});

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(attachUser);
app.get('/favicon.ico', sendFaviconIco);
app.get('/brand/:file', sendBrandFile);
app.use('/api/brand', brandRouter);
app.use('/api', express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'admin-panel' });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/apps', appsRouter);
app.use('/api/tools', toolsRouter);

const apps = listApps();
const appProxies = mountAppProxies(app, apps);

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api)(?!\/apps).*/, (req, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[admin] Gateway listening on http://${HOST}:${PORT}`);
  void startAllApps();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[admin] Порт ${PORT} уже занят. Закройте другой процесс AdminPanel или задайте ADMIN_PORT.`,
    );
    process.exit(1);
  }
  console.error('[admin] listen error:', err);
  process.exit(1);
});

attachAppProxyUpgrades(server, appProxies);

function shutdown(signal) {
  console.log(`[admin] ${signal}, shutting down...`);
  stopAllApps();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
