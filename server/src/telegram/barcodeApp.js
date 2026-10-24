/** Остаток ШК в боте: одно сообщение на набор низких номиналов, ответ из кэша. */
import { registerCommand } from './registry.js';
import { noteTelegram, readAlertState, telegramSecrets, writeAlertState } from './settings.js';

export const BALANCE_BUTTON = 'Узнать остаток';

/** Кнопки снизу чата, не внутри сообщения. */
export const BALANCE_MARKUP = {
  keyboard: [[{ text: BALANCE_BUTTON }]],
  resize_keyboard: true,
  is_persistent: true,
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

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function qtyText(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function measuredItems(base) {
  return (base?.items || []).filter((item) => Number.isFinite(Number(item.free)) && Number.isFinite(Number(item.nominal)));
}

export function planAlerts(bases, threshold, prevBases = {}) {
  const proposed = { ...(prevBases || {}) };
  const committed = { ...(prevBases || {}) };
  const entered = [];
  const changes = [];
  const now = new Date().toISOString();
  for (const base of bases || []) {
    const id = String(base.id || '');
    if (!id) continue;
    const items = measuredItems(base);
    if (!items.length) continue;
    const alarm = items.some((item) => Number(item.free) < threshold);
    const qty = Math.min(...items.map((item) => Number(item.free)));
    const was = proposed[id]?.status === 'alarm' ? 'alarm' : 'ok';
    const status = alarm ? 'alarm' : 'ok';
    const row = { status, at: now, qty };
    proposed[id] = row;
    if (status === 'alarm' && was !== 'alarm') {
      entered.push(id);
      committed[id] = proposed[id] && was === 'alarm' ? row : { status: 'ok', at: prevBases?.[id]?.at || '', qty: prevBases?.[id]?.qty ?? null };
      changes.push({ id, title: base.title || id, from: was, to: status, qty });
    } else {
      committed[id] = row;
      if (status !== was) changes.push({ id, title: base.title || id, from: was, to: status, qty });
    }
  }
  return { entered, proposed, committed, changes };
}

function stockBlocks(bases, threshold) {
  const blocks = [];
  for (const base of bases || []) {
    const title = esc(base.title || base.id);
    const items = measuredItems(base);
    const lines = [`📦 <b>База ${title}:</b>`];
    if (!items.length) {
      lines.push(base.error ? `нет данных (${esc(base.error)})` : 'нет данных');
    } else {
      for (const item of items) {
        const free = Number(item.free);
        const low = free < threshold;
        const mark = low ? '🔴' : '🟢';
        const note = low ? `ниже нормы ${qtyText(threshold)}` : 'в норме';
        const count = low ? `<b>${qtyText(free)}</b>` : qtyText(free);
        lines.push(`${mark} Номинал ${esc(item.nominal)}: ${count} шт. (${note})`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

export function formatBalance(snap, threshold) {
  const body = stockBlocks(snap?.bases, threshold);
  const lines = ['📦 <b>Остаток штрихкодов</b>', '', body || 'Данных ещё нет.'];
  if (lowRows(snap?.bases, threshold).length) lines.push('', 'Требуется пополнение.');
  if (snap?.updatedAt) lines.push('', `🕒 Проверено: ${esc(when(snap.updatedAt))}`);
  return lines.join('\n');
}

export function formatAlert(snap, threshold) {
  const body = stockBlocks(snap?.bases, threshold);
  return [
    '🚨 <b>ВНИМАНИЕ! НИЗКИЙ ОСТАТОК ШТРИХКОДОВ</b> 🚨',
    'Требуется пополнение!',
    '',
    body,
    '',
    `🕒 Проверено: ${esc(when(snap?.updatedAt))}`,
  ].join('\n');
}

let busy = false;

export async function considerBarcodeAlert(snap, send) {
  if (busy) return { sent: false, reason: 'busy' };
  const settings = telegramSecrets();
  if (!settings.enabled || !settings.notifyEnabled || !settings.apps.barcode) return { sent: false };
  if (!settings.token || !settings.chatIds.length) return { sent: false };
  const plan = planAlerts(snap?.bases, settings.threshold, readAlertState().bases);
  if (!plan.entered.length) {
    writeAlertState(plan.proposed);
    for (const change of plan.changes) {
      noteTelegram({
        kind: 'state',
        ok: true,
        summary: `${change.title}: ${change.from === 'alarm' ? 'тревога' : 'норма'} → ${change.to === 'alarm' ? 'тревога' : 'норма'}, ${change.qty}`,
      });
    }
    return { sent: false };
  }
  busy = true;
  const summary = (snap?.bases || [])
    .map((base) => `${base.title || base.id}: ${plan.proposed[base.id]?.qty ?? '—'}`)
    .join(', ');
  try {
    const result = await send(
      formatAlert(snap, settings.threshold),
      { reply_markup: BALANCE_MARKUP, parse_mode: 'HTML' },
      { kind: 'alert', summary: `Отправлено уведомление. ${summary}` },
    );
    const ok = result.some((row) => row.ok);
    writeAlertState(ok ? plan.proposed : plan.committed);
    if (ok) {
      for (const change of plan.changes) {
        noteTelegram({
          kind: 'state',
          ok: true,
          summary: `${change.title}: ${change.from === 'alarm' ? 'тревога' : 'норма'} → ${change.to === 'alarm' ? 'тревога' : 'норма'}, ${change.qty}`,
        });
      }
    }
    return { sent: ok };
  } catch (err) {
    writeAlertState(plan.committed);
    noteTelegram({ kind: 'alert', ok: false, error: err.message, summary });
    return { sent: false };
  } finally {
    busy = false;
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
