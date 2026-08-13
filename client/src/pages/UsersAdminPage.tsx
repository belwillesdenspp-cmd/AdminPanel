import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import type { AppInfo, Role, User } from '../types';

export function UsersAdminPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setError('');
    try {
      const [u, a] = await Promise.all([api.listUsers(), api.listAllApps()]);
      setUsers(u.users);
      setApps(a.apps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page">
      <div className="page-hero">
        <h1>Пользователи</h1>
        <p>Создавайте специалистов и назначайте доступ к приложениям индивидуально.</p>
      </div>

      <div className="panel stack">
        <div className="toolbar-row">
          <div className="muted">Всего: {users.length}</div>
          <button type="button" className="btn" onClick={() => setShowCreate(true)}>
            Новый пользователь
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Логин</th>
                <th>Имя</th>
                <th>Роль</th>
                <th>Доступ</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'admin' : ''}`}>
                      {u.role === 'admin' ? 'администратор' : 'специалист'}
                    </span>
                  </td>
                  <td>
                    {u.role === 'admin'
                      ? 'Все приложения'
                      : (u.appIds || [])
                          .map((id) => apps.find((a) => a.id === id)?.title || id)
                          .join(', ') || '—'}
                  </td>
                  <td>{u.isActive ? 'активен' : 'отключён'}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setEditUser(u)}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={currentUser?.id === u.id}
                        title={
                          currentUser?.id === u.id
                            ? 'Нельзя удалить собственную учётную запись'
                            : 'Удалить пользователя'
                        }
                        onClick={() => setDeleteUser(u)}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {deleteUser && (
        <div className="modal-backdrop" onClick={() => !deleting && setDeleteUser(null)}>
          <div className="modal stack" onClick={(e) => e.stopPropagation()}>
            <h3>Удалить пользователя?</h3>
            <p className="muted" style={{ margin: 0 }}>
              Учётная запись <strong>{deleteUser.displayName}</strong> (
              {deleteUser.username}) будет удалена безвозвратно вместе с назначенными
              доступами.
            </p>
            {error && <div className="error">{error}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={deleting}
                onClick={() => setDeleteUser(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setError('');
                  try {
                    await api.deleteUser(deleteUser.id);
                    setDeleteUser(null);
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Не удалось удалить');
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <UserModal
          apps={apps}
          title="Новый пользователь"
          onClose={() => setShowCreate(false)}
          onSave={async (payload) => {
            await api.createUser(payload);
            setShowCreate(false);
            await load();
          }}
        />
      )}

      {editUser && (
        <UserModal
          apps={apps}
          title={`Редактирование: ${editUser.username}`}
          initial={editUser}
          onClose={() => setEditUser(null)}
          onSave={async (payload) => {
            await api.updateUser(editUser.id, {
              displayName: payload.displayName,
              role: payload.role,
              isActive: payload.isActive,
              appIds: payload.appIds,
              password: payload.password || undefined,
            });
            setEditUser(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function UserModal({
  title,
  apps,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  apps: AppInfo[];
  initial?: User;
  onClose: () => void;
  onSave: (payload: {
    username: string;
    password: string;
    displayName: string;
    role: Role;
    isActive: boolean;
    appIds: string[];
  }) => Promise<void>;
}) {
  const [username, setUsername] = useState(initial?.username || '');
  const [displayName, setDisplayName] = useState(initial?.displayName || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(initial?.role || 'specialist');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [appIds, setAppIds] = useState<string[]>(initial?.appIds || []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggleApp(id: string) {
    setAppIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({
        username: username.trim(),
        password,
        displayName: displayName.trim() || username.trim(),
        role,
        isActive,
        appIds,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3>{title}</h3>
        {!initial && (
          <label>
            Логин
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
        )}
        <label>
          Отображаемое имя
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </label>
        <label>
          {initial ? 'Новый пароль (необязательно)' : 'Пароль'}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!initial}
          />
        </label>
        <label>
          Роль
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="specialist">Специалист</option>
            <option value="admin">Администратор</option>
          </select>
        </label>
        {initial && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Активен</span>
          </label>
        )}
        {role === 'specialist' && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
              Доступ к приложениям
            </div>
            <div className="checks">
              {apps.map((app) => (
                <label key={app.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={appIds.includes(app.id)}
                    onChange={() => toggleApp(app.id)}
                  />
                  <span>{app.title}</span>
                </label>
              ))}
            </div>
          </div>
        )}
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
