import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { BarcodeSettings, BarcodeSnapshot } from '../types';

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatWhen(value: string) {
  if (!value) return 'ещё не обновлялось';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

function formatNum(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

const EMPTY_PORTAL = { url: '', username: '', apiKey: '', password: '', clearApiKey: false, clearPassword: false };

export function BarcodeMonitorPage() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [data, setData] = useState<BarcodeSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm] = useState<BarcodeSettings | null>(null);
  const [secrets, setSecrets] = useState({ bvd: { ...EMPTY_PORTAL }, bmk: { ...EMPTY_PORTAL } });
  const [notice, setNotice] = useState('');

  async function load() {
    const next = await api.barcodeMonitor();
    setData(next);
    setForm(next.settings);
    return next;
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить'));
  }, []);

  useEffect(() => {
    if (!data?.settings.refreshEnabled) return undefined;
    const timer = window.setInterval(() => {
      load().catch(() => {});
    }, data.settings.refreshSec * 1000);
    return () => window.clearInterval(timer);
  }, [data?.settings.refreshEnabled, data?.settings.refreshSec]);

  async function refreshNow() {
    setBusy(true);
    setError('');
    try {
      setData(await api.refreshBarcodeMonitor());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить');
    } finally {
      setBusy(false);
    }
  }

  function patchPortal(id: 'bvd' | 'bmk', field: string, value: string | boolean) {
    setSecrets((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setNotice('');
    setError('');
    try {
      const saved = await api.saveBarcodeSettings({
        refreshEnabled: form.refreshEnabled,
        refreshSec: form.refreshSec,
        threshold: form.threshold,
        colorBvd: form.colorBvd,
        colorBmk: form.colorBmk,
        bvd: {
          url: form.bvd.url,
          username: form.bvd.username,
          apiKey: secrets.bvd.apiKey,
          password: secrets.bvd.password,
          clearApiKey: secrets.bvd.clearApiKey,
          clearPassword: secrets.bvd.clearPassword,
        },
        bmk: {
          url: form.bmk.url,
          username: form.bmk.username,
          apiKey: secrets.bmk.apiKey,
          password: secrets.bmk.password,
          clearApiKey: secrets.bmk.clearApiKey,
          clearPassword: secrets.bmk.clearPassword,
        },
      });
      setForm(saved);
      setSecrets({ bvd: { ...EMPTY_PORTAL }, bmk: { ...EMPTY_PORTAL } });
      setNotice('Настройки сохранены');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  }

  async function test(source: 'bvd' | 'bmk') {
    setNotice('');
    setError('');
    try {
      const result = await api.testBarcodePortal(source);
      setNotice(`${source === 'bvd' ? 'БВД' : 'БМК'}: связь есть, номиналов ${result.count}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Нет связи');
    }
  }

  const threshold = data?.settings.threshold ?? 5000;

  return (
    <div className="page page--wide">
      <div className="page-hero">
        <div className="page-hero-row">
          <Link className="page-back" to="/extras" title="Назад" aria-label="Назад">
            <BackIcon />
          </Link>
          <h1>Мониторинг остатка ШК</h1>
        </div>
        <p>Свободные штрихкоды стикеров уценки. Красным — остаток не выше порога ({formatNum(threshold)}).</p>
      </div>

      <div className="barcode-toolbar">
        <button className="btn" type="button" onClick={refreshNow} disabled={busy} title="Обновить сейчас" aria-label="Обновить сейчас">
          <RefreshIcon />
          {busy ? 'Обновление…' : 'Обновить'}
        </button>
        <span className="barcode-updated">Обновлено: {formatWhen(data?.updatedAt || '')}</span>
        {admin && (
          <button className="btn secondary" type="button" onClick={() => setSettingsOpen((v) => !v)}>
            Настройки
          </button>
        )}
      </div>

      <ul className="barcode-legend">
        <li><i style={{ background: data?.settings.colorBvd || '#E37B0A' }} /> БВД — оранжевый</li>
        <li><i style={{ background: data?.settings.colorBmk || '#2E7D32' }} /> БМК — зелёный</li>
        <li><i className="is-low" /> ≤ {formatNum(threshold)} — красный</li>
      </ul>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="barcode-notice" role="status">{notice}</div>}

      <div className="barcode-board">
        {(data?.bases || []).map((base) => (
          <section key={base.id} className="barcode-col" style={{ borderLeftColor: base.color }}>
            <h2 style={{ background: `color-mix(in srgb, ${base.color} 22%, #fff)` }}>
              <i style={{ background: base.color }} /> {base.title}
            </h2>
            {base.error && <div className="error" role="alert">{base.error}. Показаны последние успешные данные.</div>}
            <div className="barcode-cards">
              {base.items.map((item) => {
                const low = item.free <= threshold;
                return (
                  <article
                    key={item.nominal}
                    className="barcode-row"
                    style={{ background: `color-mix(in srgb, ${base.color} 16%, #fff)` }}
                  >
                    <div className="barcode-nominal">
                      <span className="barcode-nominal-value">{item.nominal}</span>
                      <span className="barcode-nominal-label">Номинал</span>
                    </div>
                    <div className={`barcode-free${low ? ' is-low' : ''}`}>{formatNum(item.free)}</div>
                  </article>
                );
              })}
              {!base.items.length && <p className="barcode-empty">Нет данных</p>}
            </div>
          </section>
        ))}
      </div>

      {admin && settingsOpen && form && (
        <form className="panel barcode-settings" onSubmit={save}>
          <h2>Настройки</h2>
          <div className="barcode-settings-grid">
          {(['bvd', 'bmk'] as const).map((id) => (
            <fieldset key={id} className={id === 'bvd' ? 'is-bvd' : 'is-bmk'}>
              <legend>{id === 'bvd' ? 'Портал БВД' : 'Портал БМК'}</legend>
              <label>
                URL
                <input value={form[id].url} onChange={(e) => setForm({ ...form, [id]: { ...form[id], url: e.target.value } })} />
              </label>
              <label>
                Логин
                <input value={form[id].username} onChange={(e) => setForm({ ...form, [id]: { ...form[id], username: e.target.value } })} autoComplete="off" />
              </label>
              <label>
                API-ключ {form[id].apiKeySet ? '(задан)' : '(не задан)'}
                <input type="password" value={secrets[id].apiKey} placeholder="не менять" autoComplete="new-password" onChange={(e) => patchPortal(id, 'apiKey', e.target.value)} />
              </label>
              <label>
                Пароль {form[id].passwordSet ? '(задан)' : '(не задан)'}
                <input type="password" value={secrets[id].password} placeholder="не менять" autoComplete="new-password" onChange={(e) => patchPortal(id, 'password', e.target.value)} />
              </label>
              <div className="barcode-checks">
                <label>
                  <input type="checkbox" checked={secrets[id].clearApiKey} onChange={(e) => patchPortal(id, 'clearApiKey', e.target.checked)} />
                  Сбросить ключ
                </label>
                <label>
                  <input type="checkbox" checked={secrets[id].clearPassword} onChange={(e) => patchPortal(id, 'clearPassword', e.target.checked)} />
                  Сбросить пароль
                </label>
              </div>
              <button className="btn ghost" type="button" onClick={() => test(id)}>Проверить подключение</button>
            </fieldset>
          ))}
          </div>
          <div className="barcode-settings-split">
            <fieldset>
              <legend>Автообновление</legend>
              <label className="check-row">
                <input type="checkbox" checked={form.refreshEnabled} onChange={(e) => setForm({ ...form, refreshEnabled: e.target.checked })} />
                Включено
              </label>
              <label>
                Интервал, секунды
                <input type="number" min={30} max={3600} value={form.refreshSec} onChange={(e) => setForm({ ...form, refreshSec: Number(e.target.value) })} />
              </label>
            </fieldset>
            <fieldset>
              <legend>Подсветка</legend>
              <label>
                Порог
                <input type="number" min={0} value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} />
              </label>
              <div className="barcode-colors">
                <label>
                  Цвет БВД
                  <input type="color" value={form.colorBvd} onChange={(e) => setForm({ ...form, colorBvd: e.target.value })} />
                </label>
                <label>
                  Цвет БМК
                  <input type="color" value={form.colorBmk} onChange={(e) => setForm({ ...form, colorBmk: e.target.value })} />
                </label>
              </div>
            </fieldset>
          </div>
          <button className="btn" type="submit">Сохранить</button>
        </form>
      )}
    </div>
  );
}
