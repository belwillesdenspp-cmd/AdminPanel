/** Опрос или webhook. Чужой чат остаток не получает. */
import { telegramCall, telegramCallRetry } from './api.js';
import { BALANCE_BUTTON, BALANCE_MARKUP, considerBarcodeAlert, registerBarcodeBot, balanceReply } from './barcodeApp.js';
import { SUMMARY_BUTTON, WAIT_TEXT, digestPeriod, fetchDigest, formatDigestMessage, periodKeyboard } from './digest.js';
import { commandHandler, commandNames } from './registry.js';
import {
  noteTelegram,
  readUpdateOffset,
  telegramSecrets,
  writeUpdateOffset,
} from './settings.js';

registerBarcodeBot();

const digestBusy = new Set();

async function removeMessage(token, chatId, messageId) {
  if (!messageId) return;
  try {
    await telegramCall(token, 'deleteMessage', { chat_id: chatId, message_id: messageId });
  } catch {
    /* сообщение уже ушло — сводку всё равно отправим */
  }
}

async function runDigest(token, chatId, period, pickerId) {
  const key = `${chatId}:${period}`;
  if (digestBusy.has(key)) return;
  digestBusy.add(key);
  let waitId = 0;
  try {
    await removeMessage(token, chatId, pickerId);
    const wait = await telegramCallRetry(token, 'sendMessage', {
      chat_id: chatId,
      text: WAIT_TEXT,
      reply_markup: BALANCE_MARKUP,
    });
    waitId = wait?.message_id || 0;
    let text = '❌ Не удалось получить сводку. Попробуйте позже';
    try {
      text = formatDigestMessage(await fetchDigest(period));
    } catch (err) {
      noteTelegram({ kind: 'digest', chatId, ok: false, error: err.message, summary: period });
    }
    await removeMessage(token, chatId, waitId);
    waitId = 0;
    await telegramCallRetry(token, 'sendMessage', {
      chat_id: chatId,
      text: String(text).slice(0, 4000),
      parse_mode: 'HTML',
      reply_markup: BALANCE_MARKUP,
    }, { timeoutMs: 15000 });
    noteTelegram({ kind: 'digest', chatId, ok: true, summary: period });
  } catch (err) {
    await removeMessage(token, chatId, waitId);
    noteTelegram({ kind: 'digest', chatId, ok: false, error: err.message, summary: period });
  } finally {
    digestBusy.delete(key);
  }
}

let running = false;
let pollAbort = null;
let loopPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function allowed(chatId) {
  return telegramSecrets().chatIds.includes(String(chatId));
}

export async function sendToChats(text, extra = {}, log = {}) {
  const settings = telegramSecrets();
  if (!settings.token) {
    const err = new Error('Токен бота не задан');
    err.status = 400;
    throw err;
  }
  if (!settings.chatIds.length) {
    const err = new Error('Укажите chat id');
    err.status = 400;
    throw err;
  }
  const results = [];
  for (const chatId of settings.chatIds) {
    try {
      await telegramCallRetry(settings.token, 'sendMessage', {
        chat_id: chatId,
        text: String(text || '').slice(0, 3500),
        ...extra,
      });
      results.push({ chatId, ok: true });
      noteTelegram({ kind: log.kind || 'send', chatId, ok: true, summary: log.summary || '' });
    } catch (err) {
      results.push({ chatId, ok: false, error: err.message });
      noteTelegram({ kind: log.kind || 'send', chatId, ok: false, error: err.message, summary: log.summary || '' });
    }
  }
  return results;
}

async function reply(token, chatId, text, extra) {
  await telegramCallRetry(token, 'sendMessage', {
    chat_id: chatId,
    text: String(text || '').slice(0, 3500),
    ...extra,
  });
  noteTelegram({ kind: 'reply', chatId, ok: true, summary: String(text || '').slice(0, 80) });
}

function startText() {
  const names = commandNames();
  const lines = [
    'AdminPanel.',
    'Команды:',
    '/balance — остаток штрихкодов',
    '/status — то же, что /balance',
    'Кнопка «Получить сводку» — разбор заявок за сегодня или вчера',
  ];
  if (names.some((name) => name !== 'balance' && name !== 'status')) {
    lines.push(...names.filter((name) => name !== 'balance' && name !== 'status').map((name) => `/${name}`));
  }
  return lines.join('\n');
}

async function onCommand(token, chatId, command) {
  if (command === 'start') {
    await reply(token, chatId, startText(), { reply_markup: BALANCE_MARKUP });
    return;
  }
  const handler = commandHandler(command);
  if (!handler) {
    await reply(token, chatId, 'Неизвестная команда. /start');
    return;
  }
  const text = await handler({ chatId, command });
  const stock = command === 'balance' || command === 'status';
  await reply(token, chatId, text, {
    reply_markup: BALANCE_MARKUP,
    ...(stock ? { parse_mode: 'HTML' } : {}),
  });
}

export async function handleUpdate(update) {
  const settings = telegramSecrets();
  if (!settings.enabled || !settings.token) return;
  const callback = update?.callback_query;
  if (callback) {
    const chatId = callback.message?.chat?.id;
    const token = settings.token;
    try {
      await telegramCall(token, 'answerCallbackQuery', { callback_query_id: callback.id });
    } catch {
      /* кнопка не должна ронять опрос */
    }
    if (!allowed(chatId)) return;
    if (callback.data === 'barcode:balance') {
      await reply(token, chatId, await balanceReply(), { reply_markup: BALANCE_MARKUP, parse_mode: 'HTML' });
    }
    const period = digestPeriod(callback.data);
    if (period) {
      const pickerId = callback.message?.message_id;
      void runDigest(token, chatId, period, pickerId);
    }
    return;
  }
  const message = update?.message;
  const text = String(message?.text || '').trim();
  const chatId = message?.chat?.id;
  if (text === SUMMARY_BUTTON) {
    if (!allowed(chatId)) return;
    await reply(settings.token, chatId, 'Выберите период для анализа:', {
      reply_markup: periodKeyboard(),
    });
    return;
  }
  if (text === BALANCE_BUTTON) {
    if (!allowed(chatId)) return;
    await reply(settings.token, chatId, await balanceReply(), {
      reply_markup: BALANCE_MARKUP,
      parse_mode: 'HTML',
    });
    return;
  }
  if (!text.startsWith('/')) return;
  const command = text.slice(1).split(/[\s@]/)[0].toLowerCase();
  if (!allowed(chatId)) {
    if (command === 'start' && settings.token) {
      try {
        await telegramCall(settings.token, 'sendMessage', {
          chat_id: chatId,
          text: 'Этот чат не подключён к AdminPanel.',
        });
      } catch {
        /* отказ без повтора */
      }
    }
    return;
  }
  await onCommand(settings.token, chatId, command);
}

async function pollLoop() {
  let pauseMs = 2000;
  while (running) {
    const settings = telegramSecrets();
    if (!settings.enabled || settings.transport !== 'poll' || !settings.token) {
      await sleep(3000);
      continue;
    }
    pollAbort = new AbortController();
    const timer = setTimeout(() => pollAbort.abort(), 30000);
    try {
      const offset = readUpdateOffset();
      const updates = await telegramCall(settings.token, 'getUpdates', {
        offset: offset || undefined,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      }, { timeoutMs: 32000, signal: pollAbort.signal });
      pauseMs = 2000;
      for (const update of updates || []) {
        writeUpdateOffset(Number(update.update_id) + 1);
        try {
          await handleUpdate(update);
        } catch (err) {
          noteTelegram({ kind: 'update', chatId: '', ok: false, error: err.message });
        }
      }
    } catch (err) {
      if (err.status !== 499) {
        noteTelegram({ kind: 'poll', chatId: '', ok: false, error: err.message });
        await sleep(pauseMs);
        pauseMs = Math.min(60000, pauseMs * 2);
      }
    } finally {
      clearTimeout(timer);
      pollAbort = null;
    }
  }
}

export function wakeTelegramPoll() {
  pollAbort?.abort();
}

export function startTelegramBot() {
  if (running) return;
  running = true;
  loopPromise = pollLoop();
}

export function stopTelegramBot() {
  running = false;
  wakeTelegramPoll();
  loopPromise = null;
}

export function telegramWebhook(req, res) {
  const settings = telegramSecrets();
  if (settings.transport !== 'webhook' || !settings.webhookSecret) {
    return res.status(404).end();
  }
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== settings.webhookSecret) {
    return res.status(401).end();
  }
  res.json({ ok: true });
  const update = req.body;
  if (update?.update_id) writeUpdateOffset(Number(update.update_id) + 1);
  handleUpdate(update).catch((err) => {
    noteTelegram({ kind: 'webhook', chatId: '', ok: false, error: err.message });
  });
}

export async function testTelegramConnection() {
  const settings = telegramSecrets();
  if (!settings.token) {
    const err = new Error('Токен бота не задан');
    err.status = 400;
    throw err;
  }
  const me = await telegramCall(settings.token, 'getMe', {});
  return { ok: true, username: String(me?.username || '') };
}

export async function sendTelegramTest() {
  const results = await sendToChats('Тест Telegram-бота AdminPanel.', {
    reply_markup: BALANCE_MARKUP,
  }, { kind: 'test', summary: 'test' });
  const failed = results.filter((row) => !row.ok);
  if (failed.length === results.length) {
    const err = new Error(failed[0]?.error || 'Не удалось отправить');
    err.status = 502;
    throw err;
  }
  return { ok: true, sent: results.filter((row) => row.ok).length, failed: failed.length };
}

export async function onBarcodeRefreshed(snap) {
  try {
    await considerBarcodeAlert(snap, (text, extra, log) => sendToChats(text, extra, log));
  } catch (err) {
    noteTelegram({ kind: 'alert', chatId: '', ok: false, error: err.message });
  }
}
