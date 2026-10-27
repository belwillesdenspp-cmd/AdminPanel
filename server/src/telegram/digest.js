/** Сводка дашборда GLPI: один запрос за период, текст уже собран моделью дашборда. */
import { getApp } from '../db.js';

const WAIT_TEXT = '⏳ Собираю данные и формирую сводку, пожалуйста, подождите...';
const EMPTY_TEXT = 'За выбранный период заявок не найдено';
const FAIL_TEXT = '❌ Не удалось получить сводку. Попробуйте позже';

export const SUMMARY_BUTTON = '📊 Получить сводку';

export function periodKeyboard() {
  return {
    inline_keyboard: [[
      { text: '📅 Сегодня', callback_data: 'digest:today' },
      { text: '📅 Вчера', callback_data: 'digest:yesterday' },
    ]],
  };
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clip(value, max) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

export function formatDigestMessage(data) {
  if (!data || data.ok === false) return FAIL_TEXT;
  if (data.empty) return EMPTY_TEXT;
  const date = esc(data.date || '');
  const sppName = esc(data.spp?.name || '');
  const sppTitle = sppName ? `${sppName} (только сектор ${sppName})` : 'Сектор';
  const body = [
    `📊 <b>СВОДКА ЗА ${date}</b>`,
    ...(data.fallback ? ['<i>Нейросеть не ответила, ниже разбор по правилам дашборда.</i>', ''] : []),
    '',
    '🏢 <b>ОБЩИЙ (Все сектора УИТ)</b>',
    clip(esc(data.general?.text), 1400) || 'Нет текста сводки.',
    `• Новых заявок: ${Number(data.general?.fresh) || 0}`,
    `• В работе: ${Number(data.general?.work) || 0}`,
    '',
    '--------------------------------',
    `🎯 <b>${sppTitle}</b>`,
    clip(esc(data.spp?.text), 1100) || (sppName ? `Заявок ${sppName} за период нет.` : 'Заявок сектора за период нет.'),
    `• Новых заявок: ${Number(data.spp?.fresh) || 0}`,
    `• В работе: ${Number(data.spp?.work) || 0}`,
  ].join('\n');
  return body.length > 4000 ? `${body.slice(0, 3999)}…` : body;
}

export function digestPeriod(data) {
  return data === 'digest:yesterday' ? 'yesterday' : data === 'digest:today' ? 'today' : '';
}

function gatewaySecret() {
  return process.env.GLPI_GATEWAY_SECRET || process.env.GATEWAY_SECRET || 'glpi-gateway-dev-secret-change-me';
}

export async function fetchDigest(period) {
  const app = getApp('glpi');
  const port = Number(app?.internalPort);
  if (!port) {
    const err = new Error('GLPI не настроен');
    err.status = 502;
    throw err;
  }
  const host = app.internalHost || '127.0.0.1';
  const res = await fetch(`http://${host}:${port}/api/telegram/digest?period=${period}`, {
    headers: { 'X-Glpi-Gateway-Secret': gatewaySecret() },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const err = new Error('Сводка недоступна');
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export { WAIT_TEXT, EMPTY_TEXT, FAIL_TEXT };
