import { Link } from 'react-router-dom';
import { AppMenuIcon } from '../appIcons';
import { useAuth } from '../auth';

export function CatalogPage() {
  const { user, apps } = useAuth();
  const enabled = apps.filter((a) => a.enabled !== false);

  return (
    <div className="page">
      <div className="page-hero">
        <h1>Добро пожаловать</h1>
        <p>
          Здравствуйте, {user?.displayName}. Выберите приложение в меню слева — оно откроется
          в этой области. Доступ к инструментам настраивается администратором индивидуально.
        </p>
      </div>

      <div className="panel stack">
        {enabled.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Нет назначенных приложений. Утилиты из «Доп. ПО» доступны всем
            сотрудникам. Остальные доступы выдаёт администратор.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Доступно приложений: {enabled.length}. Быстрый переход:
          </p>
        )}
        <div className="home-app-list">
          <Link className="home-app-chip" to="/extras">
            <strong>Доп. ПО</strong>
            <span>Утилиты и небольшие программы сектора ТП</span>
          </Link>
          {enabled.map((app) => (
            <Link key={app.id} className="home-app-chip" to={`/app/${app.id}`}>
              <span className="home-app-chip-head">
                <AppMenuIcon
                  icon={app.icon || app.id}
                  iconUrl={app.iconUrl}
                  title={app.title}
                />
                <strong>{app.title}</strong>
              </span>
              <span>{app.description || 'Открыть'}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
