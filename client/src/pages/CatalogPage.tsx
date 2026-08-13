import { Link } from 'react-router-dom';
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
          <p className="muted">
            Нет доступных приложений. Обратитесь к администратору для назначения прав.
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Доступно приложений: {enabled.length}. Быстрый переход:
            </p>
            <div className="home-app-list">
              {enabled.map((app) => (
                <Link key={app.id} className="home-app-chip" to={`/app/${app.id}`}>
                  <strong>{app.title}</strong>
                  <span>{app.description || 'Открыть'}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
