/** Остаток ШК в боте: одно сообщение на набор низких номиналов, ответ из кэша. */
import { registerCommand } from './registry.js';
import { readAlertState, telegramSecrets, writeAlertState } from './settings.js';

export const BALANCE_MARKUP = {
  inline_keyboard: [[{ text: 'Узнать остаток', callback_data: 'barcode:balance' }]],
};

export function lowRows(bases, threshold) {
  const rows = [];
  for (const base of bases || []) {
    const title = String(base.title || base.id || '');
    for (const item of base.items || []) {
      const free = Number(item.free);
      const nominal = Number(item.nominal);
      if (!Number.isFinite(free) || !Number.isFinite(nominal)) continue;
      if (free < threshold) rows.push({ title, nominal, free });
    }
  }
  rows.sort((a, b) => a.title.localeCompare(b.title, 'ru') || a.nominal - b.nominal);
  return rows;
}

export function lowFingerprint(rows) {
  return rows.map((row) => `${row.title}:${row.nominal}:${row.free}`).join('|');
}

function when(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', hour12: false });
}

export function formatBalance(snap, threshold) {
  const lines = ['Текущий остаток штрихкодов'];
  const bases = snap?.bases || [];
  if (!bases.some((base) => (base.items || []).length)) {
    lines.push('Данных ещё нет. Дождитесь опроса мониторинга.');
  }
  for (const base of bases) {
    const items = base.items || [];
    if (!items.length) {
      lines.push(`${base.title}: нет данных${base.error ? ` (${base.error})` : ''}`);
      continue;
    }
    const parts = items.map((item) => `${item.nominal} — ${item.free}`);
    lines.push(`${base.title}: ${parts.join('; ')}`);
  }
  lines.push(`Порог: ${threshold}`);
  const low = lowRows(bases, threshold);
  if (low.length) {
    lines.push(`⚠️ Ниже порога: ${low.map((row) => `${row.title} ${row.nominal} (${row.free})`).join(', ')}`);
    lines.push('Требуется пополнение.');
  }
  if (snap?.updatedAt) lines.push(`Проверено: ${when(snap.updatedAt)}`);
  return lines.join('\n');
}

export function formatAlert(snap, threshold, rows) {
  const lines = ['⚠️ Низкий остаток штрихкодов'];
  for (const row of rows) {
    lines.push(`${row.title}, номинал ${row.nominal}: ${row.free}`);
  }
  lines.push(`Порог: ${threshold}`);
  lines.push(`Проверено: ${when(snap?.updatedAt)}`);
  lines.push('Требуется пополнение.');
  return lines.join('\n');
}

let inflight = '';

export async function considerBarcodeAlert(snap, send) {
  const settings = telegramSecrets();
  if (!settings.enabled || !settings.notifyEnabled || !settings.apps.barcode) return { sent: false };
  if (!settings.token || !settings.chatIds.length) return { sent: false };
  const rows = lowRows(snap?.bases, settings.threshold);
  const fingerprint = lowFingerprint(rows);
  if (!fingerprint) {
    if (readAlertState().fingerprint) writeAlertState('');
    return { sent: false };
  }
  if (fingerprint === readAlertState().fingerprint || inflight === fingerprint) return { sent: false };
  inflight = fingerprint;
  try {
    const text = formatAlert(snap, settings.threshold, rows);
    const result = await send(text, { reply_markup: BALANCE_MARKUP }, { kind: 'alert', summary: fingerprint });
    if (result.some((row) => row.ok)) writeAlertState(fingerprint);
    return { sent: result.some((row) => row.ok) };
  } finally {
    if (inflight === fingerprint) inflight = '';
  }
}

export async function balanceReply() {
  const settings = telegramSecrets();
  if (!settings.apps.barcode) return 'Мониторинг остатка штрихкодов в боте выключен.';
  const { snapshot } = await import('../barcodeMonitor.js');
  return formatBalance(snapshot(), settings.threshold);
}

export function registerBarcodeBot() {
  const handler = async () => balanceReply();
  registerCommand('balance', handler);
  registerCommand('status', handler);
}
