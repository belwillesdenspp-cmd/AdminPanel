import express, { Router } from 'express';
import { faviconPublic, manifestBody, resetFavicon, saveFavicon } from '../favicon.js';
import { requireAdmin } from '../middleware.js';

const router = Router();

router.get('/favicon', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(faviconPublic(req.user));
});

router.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.json(manifestBody());
});

router.post('/favicon', requireAdmin, express.json({ limit: '8mb' }), (req, res) => {
  try {
    res.json(saveFavicon(req.user, req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Не удалось сохранить иконку' });
  }
});

router.delete('/favicon', requireAdmin, (req, res) => {
  try {
    res.json(resetFavicon(req.user));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Не удалось сбросить иконку' });
  }
});

export default router;
