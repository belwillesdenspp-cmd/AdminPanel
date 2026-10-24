/** Вызовы Telegram Bot API. В ошибках нет URL: в нём был бы токен. */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function telegramCall(token, method, body = {}, { timeoutMs = 8000, signal } = {}) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const aborted = new Error('Опрос Telegram прерван');
      aborted.status = 499;
      throw aborted;
    }
    const fail = new Error('Нет связи с Telegram');
    fail.status = 502;
    throw fail;
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.ok === false) {
    const fail = new Error(String(data.description || `Telegram ${res.status}`).slice(0, 240));
    fail.status = res.status;
    fail.retryAfter = Number(data.parameters?.retry_after) || 0;
    throw fail;
  }
  return data.result;
}

export async function telegramCallRetry(token, method, body, options) {
  try {
    return await telegramCall(token, method, body, options);
  } catch (err) {
    if (err.status !== 429 && err.status < 500) throw err;
    await sleep(Math.min(5, err.retryAfter || 2) * 1000);
    return telegramCall(token, method, body, options);
  }
}
