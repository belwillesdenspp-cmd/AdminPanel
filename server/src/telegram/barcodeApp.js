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

function levelWas(prev, level) {
  const nested = prev?.[level];
  if (nested?.status === 'alarm' || nested?.status === 'ok') return nested.status;
  if (level === 'low' && (prev?.status === 'alarm' || prev?.status === 'ok')) return prev.status;
  return 'ok';
}

function levelStep(was, alarm, now, qty, prevLevel) {
  const status = alarm ? 'alarm' : 'ok';
  const row = { status, at: now, qty };
  const entered = status === 'alarm' && was !== 'alarm';
  const committed = entered
    ? { status: 'ok', at: prevLevel?.at || '', qty: prevLevel?.qty ?? null }
    : row;
  return { was, status, row, entered, committed };
}

export function planAlerts(bases, threshold, prevBases = {}) {
  const { min, mid } = limitsOf(threshold);
  const midOn = mid > min;
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
    const prev = prevBases?.[id];
    const qty = Math.min(...items.map((item) => Number(item.free)));
    const lowAlarm = items.some((item) => Number(item.free) < min);
    const midAlarm = midOn && items.some((item) => Number(item.free) < mid);
    const low = levelStep(levelWas(prev, 'low'), lowAlarm, now, qty, prev?.low || prev);
    const midStep = levelStep(levelWas(prev, 'mid'), midAlarm, now, qty, prev?.mid);
    proposed[id] = { low: low.row, mid: midStep.row };
    committed[id] = { low: low.committed, mid: midStep.committed };
    if (low.entered || midStep.entered) entered.push(id);
    for (const step of [
      ['low', low],
      ['mid', midStep],
    ]) {
      const [level, item] = step;
      if (item.status !== item.was) {
        changes.push({ id, title: base.title || id, level, from: item.was, to: item.status, qty });
      }
    }
  }
  return { entered, proposed, committed, changes };
}

function limitsOf(value) {
  if (typeof value === 'number') return { min: value, mid: value };
  const min = Number(value?.min);
  const mid = Number(value?.mid);
  return {
    min: Number.isFinite(min) ? min : 0,
    mid: Number.isFinite(mid) ? mid : (Number.isFinite(min) ? min : 0),
  };
}

function band(free, min, mid) {
  if (free < min) return { mark: '🔴', note: `ниже минимума ${qtyText(min)}`, warn: true };
  if (mid > min && free < mid) return { mark: '🟠', note: `ниже среднего ${qtyText(mid)}`, warn: true };
  return { mark: '🟢', note: 'в норме', warn: false };
}

function stockBlocks(bases, limits) {
  const { min, mid } = limitsOf(limits);
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
        const level = band(free, min, mid);
        const count = level.warn ? `<b>${qtyText(free)}</b>` : qtyText(free);
        lines.push(`${level.mark} Номинал ${esc(item.nominal)}: ${count} шт. (${level.note})`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function anyWarn(bases, limits) {
  const { min, mid } = limitsOf(limits);
  return (bases || []).some((base) => measuredItems(base).some((item) => band(Number(item.free), min, mid).warn));
}

function anyLow(bases, limits) {
  const { min } = limitsOf(limits);
  return (bases || []).some((base) => measuredItems(base).some((item) => Number(item.free) < min));
}

export function formatBalance(snap, threshold) {
  const body = stockBlocks(snap?.bases, threshold);
  const lines = ['📦 <b>Остаток штрихкодов</b>', '', body || 'Данных ещё нет.'];
  if (anyWarn(snap?.bases, threshold)) lines.push('', 'Требуется пополнение.');
  if (snap?.updatedAt) lines.push('', `🕒 Проверено: ${esc(when(snap.updatedAt))}`);
  return lines.join('\n');
}

export function formatAlert(snap, threshold) {
  const body = stockBlocks(snap?.bases, threshold);
  const title = anyLow(snap?.bases, threshold)
    ? '🚨 <b>ВНИМАНИЕ! НИЗКИЙ ОСТАТОК ШТРИХКОДОВ</b> 🚨'
    : '🟠 <b>ВНИМАНИЕ! ОСТАТОК НИЖЕ СРЕДНЕГО</b>';
  return [
    title,
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
  const limits = { min: settings.threshold, mid: settings.midThreshold };
  const plan = planAlerts(snap?.bases, limits, readAlertState().bases);
  if (!plan.entered.length) {
    writeAlertState(plan.proposed);
    for (const change of plan.changes) {
      noteTelegram({
        kind: 'state',
        ok: true,
        summary: `${change.title}, ${change.level === 'mid' ? 'средний' : 'минимум'}: ${change.from === 'alarm' ? 'тревога' : 'норма'} → ${change.to === 'alarm' ? 'тревога' : 'норма'}, ${change.qty}`,
      });
    }
    return { sent: false };
  }
  busy = true;
  const summary = (snap?.bases || [])
    .map((base) => `${base.title || base.id}: ${plan.proposed[base.id]?.low?.qty ?? '—'}`)
    .join(', ');
  try {
    const result = await send(
      formatAlert(snap, limits),
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
          summary: `${change.title}, ${change.level === 'mid' ? 'средний' : 'минимум'}: ${change.from === 'alarm' ? 'тревога' : 'норма'} → ${change.to === 'alarm' ? 'тревога' : 'норма'}, ${change.qty}`,
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
  return formatBalance(snapshot(), { min: settings.threshold, mid: settings.midThreshold });
}

export function registerBarcodeBot() {
  const handler = async () => balanceReply();
  registerCommand('balance', handler);
  registerCommand('status', handler);
}
