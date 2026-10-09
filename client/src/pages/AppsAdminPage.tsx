import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { APP_ICON_KEYS, APP_ICON_LABELS, AppGlyph, AppMenuIcon } from '../appIcons';
import { useAuth } from '../auth';
import { applyFavicon, type FaviconState } from '../favicon';
import type { AppInfo, NotifyPrefs } from '../types';

function IconEdit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AppsAdminPage() {
  const { refresh } = useAuth();
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState('');
  const [editApp, setEditApp] = useState<AppInfo | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [faviconOpen, setFaviconOpen] = useState(false);

  async function load() {
    setError('');
    try {
      const data = await api.listAllApps();
      setApps(data.apps);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (!editApp) void load();
    }, 10000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editApp]);

  async function toggle(app: AppInfo) {
    try {
      await api.setAppEnabled(app.id, !app.enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус');
    }
  }

  async function move(app: AppInfo, direction: 'up' | 'down') {
    try {
      await api.moveApp(app.id, direction);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить порядок');
    }
  }

  return (
    <div className="page">
      <div className="page-hero">
        <h1>Управление приложениями</h1>
        <p>
          Названия, описания и значки в боковом меню. Порядок списка общий для всех;
          каждый сотрудник может закрепить нужные приложения звёздочкой у себя.
          Отключение скрывает пункт у специалистов.
        </p>
      </div>
      <div className="panel stack">
        <div className="apps-notify-bar">
          <button type="button" className="btn" onClick={() => setNotifyOpen(true)}>
            Уведомления
          </button>
          <button type="button" className="btn" onClick={() => setFaviconOpen(true)}>
            Иконка приложения
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Значок</th>
                <th>Название</th>
                <th>Путь</th>
                <th>Порт</th>
                <th>Статус</th>
                <th>Включено</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apps.map((app, index) => (
                <tr key={app.id}>
                  <td>
                    <span className="app-admin-icon">
                      <AppMenuIcon
                        icon={app.icon || app.id}
                        iconUrl={app.iconUrl}
                        title={app.title}
                      />
                    </span>
                  </td>
                  <td>
                    <strong>{app.title}</strong>
                    <div className="muted">{app.description}</div>
                    <div className="muted">{app.id}</div>
                  </td>
                  <td>{app.publicPath}</td>
                  <td>{app.internalPort ?? '—'}</td>
                  <td>
                    <div>{app.runtime?.running ? `PID ${app.runtime.pid}` : 'не запущен'}</div>
                    <span className={`status ${app.online ? 'online' : 'offline'}`}>
                      <span className="dot" />
                      {app.online ? 'ok' : 'down'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`btn ${app.enabled ? 'secondary' : ''}`}
                      onClick={() => void toggle(app)}
                    >
                      {app.enabled ? 'Выключить' : 'Включить'}
                    </button>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={index === 0}
                        onClick={() => void move(app, 'up')}
                        title="Выше в меню"
                        aria-label="Выше в меню"
                      >
                        <IconUp />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={index === apps.length - 1}
                        onClick={() => void move(app, 'down')}
                        title="Ниже в меню"
                        aria-label="Ниже в меню"
                      >
                        <IconDown />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setEditApp(app)}
                        title="Изменить оформление"
                        aria-label="Изменить оформление"
                      >
                        <IconEdit />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editApp && (
        <AppEditModal
          app={editApp}
          onClose={() => setEditApp(null)}
          onSaved={async () => {
            setEditApp(null);
            await load();
          }}
        />
      )}
      {notifyOpen && <NotifyModal onClose={() => setNotifyOpen(false)} />}
      {faviconOpen && <FaviconModal onClose={() => setFaviconOpen(false)} />}
    </div>
  );
}

function AppEditModal({
  app,
  onClose,
  onSaved,
}: {
  app: AppInfo;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(app.title);
  const [description, setDescription] = useState(app.description || '');
  const [icon, setIcon] = useState(app.icon || app.id);
  const [iconUrl, setIconUrl] = useState(app.iconUrl || null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.updateApp(app.id, {
        title: title.trim(),
        description: description.trim(),
        icon,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || '');
        const updated = await api.uploadAppIcon(app.id, dataUrl);
        setIconUrl(updated.app.iconUrl || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить значок');
      }
    };
    reader.readAsDataURL(file);
  }

  async function restore() {
    setBusy(true);
    setError('');
    try {
      const data = await api.restoreAppAppearance(app.id);
      setTitle(data.app.title);
      setDescription(data.app.description || '');
      setIcon(data.app.icon || app.id);
      setIconUrl(data.app.iconUrl || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось восстановить');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal form modal--wide"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3>Оформление: {app.id}</h3>
        <div className="app-edit-preview">
          <span className="app-admin-icon app-admin-icon--lg">
            <AppMenuIcon icon={icon} iconUrl={iconUrl} title={title} size={28} />
          </span>
          <div>
            <strong>{title.trim() || 'Без названия'}</strong>
            <div className="muted">{description.trim() || 'Нет описания'}</div>
          </div>
        </div>
        <label>
          Название в меню
          <input
            type="text"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label>
          Описание
          <textarea
            value={description}
            maxLength={240}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '0.45rem' }}>Значок</div>
          <div className="icon-picker">
            {APP_ICON_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`icon-picker__btn${icon === key ? ' is-selected' : ''}`}
                title={APP_ICON_LABELS[key]}
                aria-label={APP_ICON_LABELS[key]}
                onClick={() => setIcon(key)}
              >
                <AppGlyph name={key} />
              </button>
            ))}
          </div>
          {iconUrl && (
            <div className="muted" style={{ marginTop: '0.45rem' }}>
              Пока загружен свой файл, он показывается в меню вместо выбранного значка.
            </div>
          )}
        </div>
        <label>
          Свой значок (PNG, JPEG, WebP, GIF до 400 КБ)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />
        </label>
        {iconUrl && (
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              try {
                await api.clearAppIcon(app.id);
                setIconUrl(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Не удалось удалить значок');
              }
            }}
          >
            Убрать загруженный значок
          </button>
        )}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void restore()}>
            Сбросить к каталогу
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

const DEFAULT_NOTIFY: NotifyPrefs = { position: 'top-center', opacity: 0.92, hideSec: 20 };

function NotifyModal({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_NOTIFY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .notifyPrefs()
      .then((data) => setPrefs(data.prefs))
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api.saveNotifyPrefs(prefs);
      window.dispatchEvent(new CustomEvent('adminpanel:notify', { detail: data.prefs }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Уведомления Торцов и GLPI</h3>
        <label>
          Положение
          <select
            value={prefs.position}
            onChange={(e) =>
              setPrefs((prev) => ({ ...prev, position: e.target.value as NotifyPrefs['position'] }))
            }
          >
            <option value="top-center">Сверху по центру</option>
            <option value="top-right">Правый верхний угол</option>
            <option value="bottom-right">Правый нижний угол</option>
          </select>
        </label>
        <label>
          Прозрачность ({Math.round(prefs.opacity * 100)}%)
          <input
            type="range"
            min={55}
            max={100}
            value={Math.round(prefs.opacity * 100)}
            onChange={(e) => setPrefs((prev) => ({ ...prev, opacity: Number(e.target.value) / 100 }))}
          />
        </label>
        <label>
          Автоскрытие, секунд
          <input
            type="number"
            min={5}
            max={120}
            value={prefs.hideSec}
            onChange={(e) => setPrefs((prev) => ({ ...prev, hideSec: Number(e.target.value) }))}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

const FAVICON_MAX = 2 * 1024 * 1024;

function faviconExt(name: string) {
  const match = /\.(ico|png|svg|gif|webp)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function FaviconModal({ onClose }: { onClose: () => void }) {
  const iconInput = useRef<HTMLInputElement>(null);
  const darkInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<FaviconState | null>(null);
  const [iconDraft, setIconDraft] = useState<{ file: File; url: string } | null>(null);
  const [darkDraft, setDarkDraft] = useState<{ file: File; url: string } | null>(null);
  const [clearDark, setClearDark] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const draftsRef = useRef({ icon: iconDraft, dark: darkDraft });
  draftsRef.current = { icon: iconDraft, dark: darkDraft };

  useEffect(() => {
    void api.faviconState().then(setState).catch((err) => {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить');
    });
    return () => {
      const drafts = draftsRef.current;
      if (drafts.icon) URL.revokeObjectURL(drafts.icon.url);
      if (drafts.dark) URL.revokeObjectURL(drafts.dark.url);
    };
  }, []);

  function take(file: File | undefined, kind: 'icon' | 'dark') {
    if (!file) return;
    if (!faviconExt(file.name)) {
      setError('Неверный формат. Допустимы ICO, PNG, SVG, GIF и WebP.');
      return;
    }
    if (file.size > FAVICON_MAX) {
      setError('Файл больше 2 МБ.');
      return;
    }
    if (file.size < 8) {
      setError('Файл пустой или повреждён.');
      return;
    }
    setError('');
    const url = URL.createObjectURL(file);
    const setDraft = kind === 'icon' ? setIconDraft : setDarkDraft;
    setDraft((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { file, url };
    });
    if (kind === 'dark') setClearDark(false);
  }

  const iconSrc = iconDraft?.url || state?.href || '/favicon.svg';
  const darkSrc = clearDark ? '' : darkDraft?.url || state?.darkHref || '';
  const dirty = Boolean(iconDraft || darkDraft || clearDark);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError('');
    try {
      const body: {
        iconDataUrl?: string;
        iconName?: string;
        darkDataUrl?: string;
        darkName?: string;
        clearDark?: boolean;
      } = {};
      if (iconDraft) {
        body.iconDataUrl = await readDataUrl(iconDraft.file);
        body.iconName = iconDraft.file.name;
      }
      if (darkDraft) {
        body.darkDataUrl = await readDataUrl(darkDraft.file);
        body.darkName = darkDraft.file.name;
      } else if (clearDark) body.clearDark = true;
      const next = await api.saveFavicon(body);
      await applyFavicon();
      setState(next);
      setIconDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
      setDarkDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
      setClearDark(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm('Вернуть стандартную иконку AdminPanel?')) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.resetFavicon();
      await applyFavicon();
      setState(next);
      setIconDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
      setDarkDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
      setClearDark(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сбросить');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal form favicon-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Иконка приложения</h3>
        <p className="favicon-hint">
          ICO, PNG, SVG, GIF или WebP, до 2 МБ. Файл сохраняется как есть, без перекодирования.
          Удобные размеры: 16×16, 32×32, 48×48, 180×180, 192×192, 512×512. Иконка вкладки общая для
          всей панели.
        </p>
        <div className="favicon-row">
          <img className="favicon-preview" src={iconSrc} alt="Текущая иконка" />
          <div className="favicon-row__text">
            <span>Текущая</span>
            <span className="favicon-name">{iconDraft?.file.name || state?.iconName || 'Стандартная'}</span>
            <button type="button" className="btn secondary" onClick={() => iconInput.current?.click()}>
              Загрузить новый
            </button>
          </div>
        </div>
        <div className="favicon-row">
          <img
            className="favicon-preview"
            src={darkSrc || iconSrc}
            alt="Иконка для тёмной темы"
            style={darkSrc ? undefined : { opacity: 0.35 }}
          />
          <div className="favicon-row__text">
            <span>Тёмная тема</span>
            <span className="favicon-name">
              {clearDark ? 'Будет убрана' : darkDraft?.file.name || state?.darkName || 'Не задана'}
            </span>
            <div className="favicon-actions">
              <button type="button" className="btn secondary" onClick={() => darkInput.current?.click()}>
                Загрузить
              </button>
              {(state?.darkHref || darkDraft) && !clearDark && (
                <button type="button" className="btn secondary" onClick={() => setClearDark(true)}>
                  Убрать
                </button>
              )}
            </div>
          </div>
        </div>
        <input
          ref={iconInput}
          type="file"
          accept=".ico,.png,.svg,.gif,.webp,image/png,image/svg+xml,image/gif,image/webp,image/x-icon"
          hidden
          onChange={(e) => {
            take(e.target.files?.[0], 'icon');
            e.target.value = '';
          }}
        />
        <input
          ref={darkInput}
          type="file"
          accept=".ico,.png,.svg,.gif,.webp,image/png,image/svg+xml,image/gif,image/webp,image/x-icon"
          hidden
          onChange={(e) => {
            take(e.target.files?.[0], 'dark');
            e.target.value = '';
          }}
        />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={reset} disabled={busy || !state?.custom}>
            Сбросить к стандартному
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn" disabled={busy || !dirty}>
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}
