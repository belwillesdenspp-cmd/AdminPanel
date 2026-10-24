import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';

export type TelegramSettings = {
  enabled: boolean;
  notifyEnabled: boolean;
  transport: 'poll' | 'webhook';
  chatIds: string[];
  threshold: number;
  apps: { barcode: boolean };
  tokenSet: boolean;
  webhookSecretSet: boolean;
};

export function TelegramBotModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<TelegramSettings | null>(null);
  const [token, setToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [chats, setChats] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.telegramSettings().then((row) => {
      setForm(row);
      setChats(row.chatIds.join('\n'));
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить');
    });
  }, []);

  function patch(partial: Partial<TelegramSettings>) {
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const saved = await api.saveTelegramSettings({
        ...form,
        chatIds: chats,
        token,
        webhookSecret,
      });
      setForm(saved);
      setToken('');
      setWebhookSecret('');
      setChats(saved.chatIds.join('\n'));
      setInfo('Сохранено');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const result = await api.testTelegram();
      setInfo(result.username ? `Подключение есть: @${result.username}` : 'Подключение есть');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нет связи');
    } finally {
      setBusy(false);
    }
  }

  async function testMessage() {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const result = await api.sendTelegramTest();
      setInfo(`Отправлено в чаты: ${result.sent}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal modal--wide form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>Telegram-бот</h3>
        {!form ? <p>Загрузка…</p> : (
          <>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              Бот включён
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.notifyEnabled}
                onChange={(e) => patch({ notifyEnabled: e.target.checked })}
              />
              Уведомлять о низком остатке
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.apps.barcode}
                onChange={(e) => patch({ apps: { barcode: e.target.checked } })}
              />
              Приложение «Мониторинг остатка ШК»
            </label>
            <label>
              Токен
              <input
                type="password"
                autoComplete="new-password"
                value={token}
                placeholder={form.tokenSet ? 'задан, введите новый чтобы заменить' : 'токен от BotFather'}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <label>
              Chat ID, по одному в строке
              <textarea value={chats} onChange={(e) => setChats(e.target.value)} />
            </label>
            <label>
              Порог остатка
              <input
                type="number"
                min={0}
                value={form.threshold}
                onChange={(e) => patch({ threshold: Number(e.target.value) })}
              />
            </label>
            <label>
              Как принимать команды
              <select
                value={form.transport}
                onChange={(e) => patch({ transport: e.target.value as 'poll' | 'webhook' })}
              >
                <option value="poll">Опрос (сервер сам спрашивает Telegram)</option>
                <option value="webhook">Webhook (Telegram вызывает панель)</option>
              </select>
            </label>
            {form.transport === 'webhook' && (
              <label>
                Секрет webhook
                <input
                  type="password"
                  autoComplete="new-password"
                  value={webhookSecret}
                  placeholder={form.webhookSecretSet ? 'задан' : 'тот же, что secret_token в setWebhook'}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                />
              </label>
            )}
            {form.transport === 'webhook' && (
              <p className="muted">Адрес для setWebhook: /api/telegram/webhook</p>
            )}
          </>
        )}
        {error && <div className="error">{error}</div>}
        {info && <p className="muted">{info}</p>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Закрыть</button>
          <button type="button" className="btn secondary" disabled={busy || !form} onClick={() => void check()}>
            Проверить подключение
          </button>
          <button type="button" className="btn secondary" disabled={busy || !form} onClick={() => void testMessage()}>
            Тестовое уведомление
          </button>
          <button type="submit" className="btn" disabled={busy || !form}>Сохранить</button>
        </div>
      </form>
    </div>
  );
}
