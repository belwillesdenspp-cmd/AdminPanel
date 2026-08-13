import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AppInfo } from '../types';

export function AppsAdminPage() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const data = await api.listAllApps();
      setApps(data.apps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(id);
  }, []);

  async function toggle(app: AppInfo) {
    try {
      await api.setAppEnabled(app.id, !app.enabled);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус');
    }
  }

  return (
    <div className="page">
      <div className="page-hero">
        <h1>Управление приложениями</h1>
        <p>
          Реестр встроенных приложений. Отключение скрывает приложение из каталога
          специалистов; для полного старта/останова нужен перезапуск AdminPanel.
        </p>
      </div>
      <div className="panel stack">
        {error && <div className="error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Название</th>
                <th>Путь</th>
                <th>Порт</th>
                <th>Статус процесса</th>
                <th>Health</th>
                <th>Включено</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id}>
                  <td>{app.id}</td>
                  <td>
                    <strong>{app.title}</strong>
                    <div className="muted">{app.description}</div>
                  </td>
                  <td>{app.publicPath}</td>
                  <td>{app.internalPort ?? '—'}</td>
                  <td>{app.runtime?.running ? `PID ${app.runtime.pid}` : 'не запущен'}</td>
                  <td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
