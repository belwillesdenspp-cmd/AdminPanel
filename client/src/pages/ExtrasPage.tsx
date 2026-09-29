import { Link } from 'react-router-dom';

const TOOLS = [
  {
    id: 'ip-scan',
    title: 'Сканер свободных IP',
    description:
      'Проверяет подсеть по ping и ARP: какие адреса заняты, какие свободны.',
    path: '/extras/ip-scan',
  },
  {
    id: 'card-check',
    title: 'Проверка карточки товара',
    description:
      'По выбранной базе Fusion (БМК или БВД) смотрит признаки «введена / обработана / заблокирована» и говорит, куда назначать: НСИ или ценообразование.',
    path: '/extras/card-check',
  },
];

export function ExtrasPage() {
  return (
    <div className="page">
      <div className="page-hero">
        <h1>Доп. ПО</h1>
        <p>Небольшие утилиты сектора ТП: сеть, карточки товаров и другие инструменты.</p>
      </div>
      <div className="grid-apps">
        {TOOLS.map((tool) => (
          <Link key={tool.id} className="app-card" to={tool.path}>
            <div className="app-card-meta">
              <span className="badge">утилита</span>
            </div>
            <h2>{tool.title}</h2>
            <p>{tool.description}</p>
            <span className="btn">Открыть</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
