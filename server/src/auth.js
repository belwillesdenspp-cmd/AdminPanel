import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'admin_session';
const JWT_SECRET = process.env.JWT_SECRET || 'admin-panel-dev-secret-change-me';
const MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 hours

export function signSession(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '12h' },
  );
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
  });
}

export function readSessionToken(req) {
  return req.cookies?.[COOKIE_NAME] || null;
}

export { COOKIE_NAME };
