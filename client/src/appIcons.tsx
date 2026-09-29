const commonProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

export const APP_ICON_KEYS = [
  'instructions',
  'tmc',
  'torcy',
  'compusers',
  'citrix',
  'glpi',
  'equipment',
  'grid',
  'folder',
  'users',
  'wrench',
  'database',
  'network',
  'chart',
  'printer',
  'shield',
  'ticket',
  'monitor',
] as const;

export type AppIconKey = (typeof APP_ICON_KEYS)[number];

export const APP_ICON_LABELS: Record<AppIconKey, string> = {
  instructions: 'Инструкция',
  tmc: 'Коробка',
  torcy: 'Экран',
  compusers: 'Пользователи',
  citrix: 'Сессия',
  glpi: 'Заявки',
  equipment: 'Перевозка',
  grid: 'Плитка',
  folder: 'Папка',
  users: 'Сотрудник',
  wrench: 'Инструмент',
  database: 'База',
  network: 'Сеть',
  chart: 'График',
  printer: 'Принтер',
  shield: 'Щит',
  ticket: 'Тикет',
  monitor: 'Монитор',
};

export function isAppIconKey(value: string): value is AppIconKey {
  return (APP_ICON_KEYS as readonly string[]).includes(value);
}

export function AppGlyph({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  const common = { ...commonProps, width: size, height: size };
  switch (name) {
    case 'instructions':
      return (
        <svg {...common}>
          <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
          <path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H18" />
          <path d="M9 8.5h5.5M9 12h4" />
        </svg>
      );
    case 'tmc':
      return (
        <svg {...common}>
          <path d="M4.5 8.5 12 4l7.5 4.5v7L12 20l-7.5-4.5v-7Z" />
          <path d="M12 12v8M12 12 4.5 8.5M12 12l7.5-3.5" />
        </svg>
      );
    case 'torcy':
    case 'monitor':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="12" rx="2" />
          <path d="M8 21h8M12 17v4" />
          <path d="M8 9.5h8M8 13h5" />
        </svg>
      );
    case 'compusers':
    case 'users':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5.5 18.5c1.4-2.8 3.6-4.2 6.5-4.2s5.1 1.4 6.5 4.2" />
          <path d="M17.5 7.5a2.5 2.5 0 0 1 0 5" />
          <path d="M19.8 18.2c.7-1.3 1.1-2.4 1.1-3.4" />
        </svg>
      );
    case 'citrix':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="12.5" rx="2" />
          <path d="M8 20h8M12 17v3" />
          <circle cx="9" cy="10.5" r="1.6" />
          <path d="M13 9.2h4.2M13 12h3" />
        </svg>
      );
    case 'equipment':
      return (
        <svg {...common}>
          <path d="M3.5 8h10.5v8.5H3.5z" />
          <path d="M14 11.5h3.2L19.5 14v2.5H14" />
          <circle cx="7" cy="18.2" r="1.35" />
          <circle cx="16.5" cy="18.2" r="1.35" />
        </svg>
      );
    case 'glpi':
    case 'ticket':
      return (
        <svg {...common}>
          <path d="M6 5.5h12v13H6z" />
          <path d="M9 9h6M9 12.5h6M9 16h4" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3.5 7.5h6l1.8 2H20.5v9.5H3.5z" />
        </svg>
      );
    case 'wrench':
      return (
        <svg {...common}>
          <path d="M14.5 6.5a4 4 0 0 0-5.7 5.5L4 16.8 7.2 20l4.8-4.8a4 4 0 0 0 5.5-5.7L15 12l-3-3 2.5-2.5Z" />
        </svg>
      );
    case 'database':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6.5" rx="7.5" ry="2.5" />
          <path d="M4.5 6.5v11c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-11" />
          <path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
        </svg>
      );
    case 'network':
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="2.2" />
          <circle cx="18" cy="6.5" r="2.2" />
          <circle cx="18" cy="17.5" r="2.2" />
          <path d="M8 12h6.2M16.2 7.8 9.8 11.2M16.2 16.2 9.8 12.8" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4.5 19.5h15" />
          <path d="M7 19.5V12h3v7.5M12.5 19.5V8h3v11.5M18 19.5v-5h2.2v5" />
        </svg>
      );
    case 'printer':
      return (
        <svg {...common}>
          <path d="M7 9V4.5h10V9" />
          <rect x="4.5" y="9" width="15" height="8" rx="1.5" />
          <path d="M7 13.5h10v6.5H7z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3.5 19.5 6.5v6.2c0 4.2-3.2 7.2-7.5 8.8-4.3-1.6-7.5-4.6-7.5-8.8V6.5L12 3.5Z" />
          <path d="M9.2 12.2 11.3 14.3 15.2 9.8" />
        </svg>
      );
    case 'grid':
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
  }
}

export function AppMenuIcon({
  icon,
  iconUrl,
  title,
  size = 20,
}: {
  icon?: string;
  iconUrl?: string | null;
  title: string;
  size?: number;
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className="app-menu-img"
        title={title}
      />
    );
  }
  return <AppGlyph name={icon || 'grid'} size={size} />;
}
