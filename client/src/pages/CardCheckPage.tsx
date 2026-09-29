import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { CardCheckItem, CardCheckResult, CardCheckSourceId } from '../types';

type Filter = 'all' | 'nsi' | 'pricing';

const SOURCES: { id: CardCheckSourceId; label: string }[] = [
  { id: 'bmk', label: 'БМК' },
  { id: 'bvd', label: 'БВД' },
];

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="8"
        y="8"
        width="11"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M5 16V6.5A1.5 1.5 0 0 1 6.5 5H15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7h14M10 7V5h4v2M8 7v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlagMark({ on }: { on: boolean }) {
  return (
    <span className={`card-check-flag${on ? ' is-on' : ''}`} title={on ? 'установлена' : 'не установлена'}>
      {on ? '✓' : '—'}
    </span>
  );
}

export function CardCheckPage() {
  const [source, setSource] = useState<CardCheckSourceId>('bmk');
  const [text, setText] = useState('');
  const [fusionUser, setFusionUser] = useState('');
  const [fusionPassword, setFusionPassword] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [result, setResult] = useState<CardCheckResult | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    if (!result) return [];
    if (filter === 'all') return result.items;
    return result.items.filter((item) => item.destination === filter);
  }, [result, filter]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.getFusionLogin(source);
        if (cancelled) return;
        setSavedUsername(status.saved ? status.username : null);
        if (status.saved && status.username) setFusionUser(status.username);
      } catch {
        if (!cancelled) setSavedUsername(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  function onSourceChange(next: CardCheckSourceId) {
    setSource(next);
    setResult(null);
    setFilter('all');
    setError('');
    setCopied('');
    setFusionPassword('');
  }

  async function runCheck() {
    setChecking(true);
    setError('');
    setCopied('');
    try {
      const data = await api.checkItemCards(text, source, {
        username: fusionUser.trim() || undefined,
        password: fusionPassword || undefined,
        save: remember && Boolean(fusionPassword),
      });
      setResult(data);
      setFilter('all');
      if (data.savedLogin) {
        setSavedUsername(data.savedUsername || fusionUser.trim() || null);
        setFusionPassword('');
      }
      if (data.authRequired) {
        setError(
          `Fusion ${data.sourceLabel} не отдал карточку без входа. Укажите логин и пароль той же учётки, с которой карточка открывается в браузере, и сохраните их для себя.`,
        );
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Не удалось проверить карточки');
    } finally {
      setChecking(false);
    }
  }

  async function saveLogin() {
    setSaving(true);
    setError('');
    try {
      const status = await api.saveFusionLogin(source, fusionUser.trim(), fusionPassword);
      setSavedUsername(status.username);
      setFusionPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить вход Fusion');
    } finally {
      setSaving(false);
    }
  }

  async function deleteLogin() {
    setSaving(true);
    setError('');
    try {
      await api.deleteFusionLogin(source);
      setSavedUsername(null);
      setFusionPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить вход Fusion');
    } finally {
      setSaving(false);
    }
  }

  async function copyBarcode(item: CardCheckItem) {
    await copyText(item.barcode);
    setCopied(item.barcode);
  }

  const sourceLabel = SOURCES.find((item) => item.id === source)?.label || source.toUpperCase();

  return (
    <div className="page page--wide">
      <div className="page-hero">
        <div className="page-hero-row">
          <Link className="page-back" to="/extras" title="Назад" aria-label="Назад">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 6 9 12l6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <h1>Проверка карточки товара</h1>
        </div>
        <p>
          Выберите базу Fusion (БМК или БВД), введите штрихкоды и нажмите
          «Проверить». Логин и пароль Fusion сохраняются только для вашего
          пользователя AdminPanel, в зашифрованном виде. Если карточка
          заблокирована, «введена» не учитывается.
        </p>
      </div>

      <div className="panel stack">
        <form
          className="card-check-form"
          onSubmit={(e) => {
            e.preventDefault();
            void runCheck();
          }}
        >
          <div className="card-check-source" role="radiogroup" aria-label="База Fusion">
            <span className="card-check-source-label">База</span>
            <div className="period-pills">
              {SOURCES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={source === item.id}
                  className={`period-pill${source === item.id ? ' is-active' : ''}`}
                  disabled={checking}
                  onClick={() => onSourceChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="card-check-fusion">
            <label>
              Логин Fusion
              <input
                type="text"
                value={fusionUser}
                onChange={(e) => setFusionUser(e.target.value)}
                autoComplete="username"
                disabled={checking || saving}
                placeholder="как в Gippo / Fusion"
              />
            </label>
            <label>
              Пароль Fusion
              <input
                type="password"
                value={fusionPassword}
                onChange={(e) => setFusionPassword(e.target.value)}
                autoComplete="current-password"
                disabled={checking || saving}
                placeholder={savedUsername ? 'сохранён для вас' : ''}
              />
            </label>
          </div>
          <div className="card-check-fusion-actions">
            <label className="card-check-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={checking || saving}
              />
              Запомнить для меня
            </label>
            <button
              type="button"
              className="btn secondary"
              disabled={checking || saving || !fusionUser.trim() || !fusionPassword}
              onClick={() => void saveLogin()}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
            {savedUsername ? (
              <>
                <span className="muted">Сохранено: {savedUsername}</span>
                <button
                  type="button"
                  className="btn-icon"
                  title="Удалить сохранённый вход Fusion"
                  aria-label="Удалить сохранённый вход Fusion"
                  disabled={checking || saving}
                  onClick={() => void deleteLogin()}
                >
                  <TrashIcon />
                </button>
              </>
            ) : null}
          </div>
          <label>
            Штрихкоды
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="4810344000804&#10;4810344000805"
              disabled={checking}
              rows={5}
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn" disabled={checking || !text.trim()}>
            {checking ? 'Проверка…' : `Проверить в ${sourceLabel}`}
          </button>
        </form>
        {error ? <div className="error">{error}</div> : null}
        {copied ? <div className="muted">Скопировано: {copied}</div> : null}

        {result ? (
          <>
            <div className="ip-scan-stats">
              <article>
                <strong>{result.totals.total}</strong>
                <span>
                  штрихкодов · {result.sourceLabel} · {(result.elapsedMs / 1000).toFixed(1)} с
                </span>
              </article>
              <article>
                <strong>{result.totals.nsi}</strong>
                <span>в НСИ</span>
              </article>
              <article className="is-free">
                <strong>{result.totals.pricing}</strong>
                <span>в ценообразование</span>
              </article>
              <article>
                <strong>{result.totals.missing + result.totals.error}</strong>
                <span>не найдены / ошибка</span>
              </article>
            </div>
            {result.truncated ? (
              <p className="muted" style={{ margin: 0 }}>
                Проверены первые {result.max} штрихкодов.
              </p>
            ) : null}
            {result.invalid.length ? (
              <p className="muted" style={{ margin: 0 }}>
                Пропущены некорректные значения: {result.invalid.join(', ')}
              </p>
            ) : null}

            <div className="toolbar-row">
              <div className="period-pills" role="tablist" aria-label="Фильтр назначения">
                {(
                  [
                    ['all', `Все · ${result.totals.total}`],
                    ['nsi', `НСИ · ${result.totals.nsi}`],
                    ['pricing', `Ценообразование · ${result.totals.pricing}`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className={`period-pill${filter === id ? ' is-active' : ''}`}
                    aria-selected={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Штрихкод</th>
                    <th>Товар</th>
                    <th>Введена</th>
                    <th>Обработана</th>
                    <th>Заблокирована</th>
                    <th>Назначение</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.barcode}>
                      <td>
                        <code>{item.barcode}</code>
                      </td>
                      <td>
                        {item.found ? (
                          <>
                            <div>{item.name || '—'}</div>
                            {item.nameItemGroup ? (
                              <div className="muted">{item.nameItemGroup}</div>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">{item.error || 'не найдена'}</span>
                        )}
                      </td>
                      <td>{item.found ? <FlagMark on={item.flags.entered} /> : '—'}</td>
                      <td>{item.found ? <FlagMark on={item.flags.processed} /> : '—'}</td>
                      <td>{item.found ? <FlagMark on={item.flags.inactive} /> : '—'}</td>
                      <td>
                        <span
                          className={`badge${
                            item.destination === 'pricing' ? ' ok' : item.doubt ? '' : ' admin'
                          }`}
                          title={item.reason}
                        >
                          {item.destinationLabel}
                        </span>
                        <div className="muted card-check-reason">{item.reason}</div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Копировать штрихкод"
                          aria-label="Копировать штрихкод"
                          onClick={() => void copyBarcode(item)}
                        >
                          <CopyIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Штрихкоды можно вставлять списком. Поиск идёт только в выбранной базе.
            Сохранённый вход Fusion доступен только вам.
          </p>
        )}
      </div>
    </div>
  );
}
