# CONTEXT: AdminPanel

Карта системы для человека и для другой ИИ-модели. Читать **до** правок кода.

Единый шлюз сектора ТП: логин, права, прокси `/apps/<id>` → дочерние сервисы на `127.0.0.1`. Этот репозиторий — **оболочка**. Приложения лежат **рядом**, не внутри:

`../Instructions` · `../Учет ТМЦ` · `../Torcy` · `../CompUsers` · `../CitrixSessions` · `../GLPI` · `../EquipmentMove` · `../KnowledgeBase` (карточки БЗ для GLPI, не проксируется)

| | |
|---|---|
| Порт шлюза | **4000** (`ADMIN_PORT`, **не** `PORT`) |
| Хост | `0.0.0.0` |
| Старт | `Запустить AdminPanel.bat` или `npm start` |
| Сборка оболочки | `npm run build` |
| Сборка детей | `npm run build:apps` (`BASE_PATH=/apps/<id>`) |
| Логин по умолчанию | `admin` / `admin` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) — на живой БД пароль мог быть сменён |

---

## Как работать с кодом

1. Шлюз и дети — **разные** git-репозитории. Правка ТМЦ/GLPI/Citrix — в `../<имя>`, не в `AdminPanel/client`, кроме прокси/меню.
2. Секреты (`.env`, `settings.json`, API-ключи) **не** в git и **не** в чат.
3. Кнопки стандартных действий — иконка + русские `title`/`aria-label` (`.cursor/rules/ui-icon-buttons.mdc`). Не подключать MUI/antd/новую icon-библиотеку.
4. После UI-правок ребёнка: `$env:BASE_PATH='/apps/<id>'; npm run build` в его `client/`, затем перезапуск процесса на его порту (супервизор поднимет снова).
5. Не коммитить, пока пользователь не попросил. Не `push --force`, не трогать `git config`.
6. Новый пункт меню **не** добавляется правкой SQLite вручную: запись в `config/apps.json` → перезапуск → оформление в админке.
7. Вёрстка детей в iframe — **на всю ширину** (`max-width: none`, `min-width: 0`). Не использовать `100vw` (шире iframe из‑за полосы прокрутки). Горизонтальный скролл только внутри `.table-wrap` или тела модалки, не у `body`. Оболочка: `.shell-main` и `.app-frame-shell` с `overflow-x: hidden`.

---

## Карта AdminPanel/

```
AdminPanel/
  client/src/
    main.tsx           BrowserRouter + AuthProvider
    App.tsx            роуты оболочки
    auth.tsx           AuthContext
    api/client.ts      fetch /api/* (credentials: include)
    types.ts           User, AppInfo
    appIcons.tsx       SVG-пресеты меню + AppMenuIcon
    components/        ShellLayout, RequireAuth
    pages/             Login, Catalog, AppFrame, Users/Apps admin, Extras, IpScan
    styles.css         тема оболочки
  server/src/
    index.js           вход; ADMIN_PORT; delete PORT; static client/dist
    auth.js            JWT + cookie admin_session
    middleware.js      attachUser / requireAuth / requireAdmin / requireAppAccessFor
    db.js              SQLite + sync apps.json
    appIcons.js        допустимые ключи значков (дубль клиента)
    proxy.js           http-proxy-middleware + WS upgrades
    supervisor.js      spawn/restart детей
    portGuard.js       снять слушателя порта ребёнка
    routes/            auth, users, apps, tools
    tools/             ip.js, folderOpener.js
    data/admin.db      пользователи, apps, права
    data/app-icons/    загруженные значки (не в git)
  config/apps.json     техника детей (id, cwd, port, publicPath) — не подписи меню
  scripts/             build-apps.mjs, install-folder-opener.*, open-network-access.ps1
  prompts/             заготовки промптов GLPI (runtime — в ../GLPI/server/data/)
  prompts/routing-compact.md   стандарт вкладки «Общий» (первичный анализ)
  prompt_ai_agent_routing.md   полный master: справочник и источник секторов
  docs/ai-providers-design.md  архитектура провайдеров ИИ и пула ключей
  Запустить AdminPanel.bat
```

Точки входа: `client/src/main.tsx` → `App.tsx`; `server/src/index.js`.

Роуты UI оболочки (`App.tsx`): `/login` · `/` каталог · `/app/:appId` iframe · `/extras` · `/extras/ip-scan` · `/extras/card-check` · `/admin/users` · `/admin/apps` (adminOnly).

---

## Архитектура шлюза

```
Браузер ──cookie JWT──► :4000 /api/*              оболочка
        ──iframe──────► :4000 /apps/<id> ──proxy──► 127.0.0.1:<port>
Супервизор: reclaim порта → spawn npm start (HOST, PORT, BASE_PATH из apps.json)
```

**Стек:** Node 18+, Express 4, better-sqlite3, bcryptjs, jsonwebtoken, cookie-parser, http-proxy-middleware. Клиент: React 19, react-router-dom, Vite. Нет Redux.

**Сессия:** JWT 12 ч, httpOnly cookie `admin_session` (sameSite=lax). Роли: `admin` | `specialist`. Admin видит все приложения; specialist — только строки `user_app_permissions`. Пароли bcrypt.

**Прокси [инвариант]:** в ребёнка уходят `X-Admin-User-Id`, `X-Admin-Username`, `X-Admin-Role`, `X-Admin-Display-Name` и секрет приложения. Ребёнок пускает по секрету **или** loopback + `X-Admin-User-Id`. HTML без сессии → редирект `/login?next=`. WebSocket (VNC) **только** через `attachAppProxyUpgrades`; у HPM `ws: false`.

| id | заголовок | env |
|---|---|---|
| instructions | `X-Admin-Gateway-Secret` | `ADMIN_GATEWAY_SECRET` |
| tmc | `X-Tmc-Gateway-Secret` | `TMC_GATEWAY_SECRET` |
| torcy | `X-Torcy-Gateway-Secret` | `TORCY_GATEWAY_SECRET` |
| compusers | `X-CompUsers-Gateway-Secret` | `COMPUSERS_GATEWAY_SECRET` |
| citrix | `X-Citrix-Gateway-Secret` | `CITRIX_GATEWAY_SECRET` |
| glpi | `X-Glpi-Gateway-Secret` | `GLPI_GATEWAY_SECRET` |
| equipment | `X-Equipment-Gateway-Secret` | `EQUIPMENT_GATEWAY_SECRET` |

**SQLite** (`server/src/db.js`):

- `users`
- `apps` — при старте из `apps.json` синхронятся `public_path`, host/port, cwd, command. **Не затираются:** `title`, `description`, `icon`, `sort_order`, `enabled`, файл значка. Id, которых нет в json, **удаляются** из таблицы (и связанные права)
- `user_app_permissions` — доступ специалиста к `app.id`
- `user_app_prefs` — `pinned` в сайдбаре у пользователя

Колонки значка: `icon` (ключ из `appIcons.js`), `icon_ext` + файл в `data/app-icons/`, `icon_updated`.

**Env шлюза:** `JWT_SECRET`, `ADMIN_PORT`, `HOST`, `COOKIE_SECURE`, `SUPERVISOR=0` (не поднимать детей — **не** для рабочей панели), `*_GATEWAY_SECRET`.

**Порты детей** (только loopback):

| id | порт | publicPath |
|---|---|---|
| instructions | 5174 | `/apps/instructions` |
| tmc | 3001 | `/apps/tmc` |
| torcy | 3002 | `/apps/torcy` |
| compusers | 3003 | `/apps/compusers` |
| citrix | 3004 | `/apps/citrix` |
| glpi | 3005 | `/apps/glpi` |
| equipment | 3006 | `/apps/equipment` |

Контракт ребёнка: `healthPath` **без** префикса `/apps/...` (обычно `/api/health`); bind `HOST`/`PORT`; клиент с `import.meta.env.BASE_URL`.

`npm run install:apps` ставит Instructions, ТМЦ, Torcy, GLPI, EquipmentMove. **CompUsers и Citrix** ставятся отдельно в своих папках. `npm run build:apps` собирает **все** записи из `apps.json` (включая CompUsers и Citrix).

---

## Модули оболочки

**Каталог / фрейм** — `CatalogPage.tsx`, `AppFramePage.tsx`, `ShellLayout.tsx`. Список из БД (название, описание, значок). Сайдбар: pinned → `sort_order`. Iframe на `publicPath`. postMessage `adminpanel:open-external` для vnc/ssh/rdp/telnet/`adminpanel-folder:`.

**Пользователи** — `routes/users.js`, `UsersAdminPage.tsx`. CRUD, роль, активность, набор `appIds` (не для admin). Нельзя удалить последнего admin и себя.

**Управление приложениями** — `routes/apps.js`, `AppsAdminPage.tsx`. Health/runtime; вкл/выкл; title/description; значок SVG-пресет или PNG/JPEG/WebP/GIF до 400 КБ; порядок стрелками; «сбросить к каталогу». Состав (id/порт/cwd) **только** из `apps.json`.

**Уведомления оболочки** — кнопка «Уведомления» над списком приложений (не строка каталога). `GET/PUT /api/apps/notifications`, SQLite `ui_prefs` ключ `notifications`. Поля: `position` (`top-center` | `top-right` | `bottom-right`), `opacity` 0.55–1, `hideSec` 5–120. По умолчанию сверху по центру, 0.92, 20 с. Читает оболочка один раз (`ShellLayout.tsx`, кэш в модуле) и применяет к баннерам ИИ GLPI и тостам «Торцов» (`.shell-alerts`). Сохранение шлёт `adminpanel:notify` в уже открытую оболочку. PUT только admin. Триггеры опросов GLPI/Торцов не менялись.

**Доп. ПО** — `ExtrasPage.tsx`: каталог утилит (не дочерние приложения).

- **Сканер IP** — `/extras/ip-scan`, `IpScanPage.tsx` + `tools/ip.js`: ping+ARP, макс /22, копирование IP, скан **на сервере**.
- **Проверка карточки товара** — `/extras/card-check`, `CardCheckPage.tsx` + `tools/cardCheck.js` + `POST /api/tools/card-check`. Без ИИ. Пользователь выбирает базу **БМК** (`http://172.16.2.52:8080`) или **БВД** (`http://172.16.0.164:8080`), затем штрихкоды → LS Fusion `Item.getItemCard` только выбранной базы. БВД без входа отвечает «Нет доступа к API». Логин/пароль Fusion хранятся **на пользователя AdminPanel** в SQLite `user_fusion_credentials` (AES-256-GCM, AAD = userId+source), пароль на клиент не отдаётся. API: `GET/PUT/DELETE /api/tools/card-check/fusion`. Ключ: `FUSION_CREDENTIALS_KEY` или `JWT_SECRET`. Общий env-логин Fusion не используется — иначе все видели бы одну учётку. Признаки: `entered` / `processed` / `inactive`. При `inactive=1` «введена» недействительна. Назначение: заблокирована → **НСИ**; введена и не обработана → **ценообразование**; не введена и не обработана → **НСИ**; иное / не найдена → **НСИ**.
- Установщик протокола папок: `GET /api/tools/folder-opener` (в UI «Доп. ПО» пункта нет; bat ставит протокол при старте).

---

## Дочерние приложения

### База знаний — `../Instructions` :5174 `/apps/instructions`

Дерево `M:\Документы\Инструкции\...`; превью docx/pdf/img/video; поиск; SSE rescan; корень (admin). Сервер срезает `BASE_PATH` с `req.url`. Health: `/api/health`.

### Учёт ТМЦ — `../Учет ТМЦ` :3001 `/apps/tmc`

Категории: остаток = число единиц `in_stock`, порог `threshold`, «в пути» `in_transit`. Выдача, списание, ТТН, журнал. Вёрстка на всю ширину iframe (`Layout` без `max-w-6xl`); модалки и таблицы не дают горизонтальный скролл страницы.

На карточках страницы «Категории» (вид «Сетка», `client/src/pages/HomePage.jsx`) под остатком и порогом чип «В пути: N» с иконкой грузовика (`Icon` из `AutoOrderShared.jsx`). Число — `categories.in_transit` из `GET /categories` (то же поле, что disabled-поле в `EditCategoryModal.jsx`); отдельного запроса и N+1 нет. Ноль показывается как `0`. Вид «Список» не менялся.

**Автозаказ:** `orders` (`draft` / `ordered` / `in_transit` / `completed`) + `order_items`. Подготовка: порог − остаток − в пути. Word + номер счёта → оформлен.

- Позиции **без категории** сохраняются; в карточке подсвечены янтарным. При формировании Word категорию предлагают **по каждой позиции отдельно** (оставить без категории / создать только для неё / выбрать существующую).
- К заказу крепятся **счёт (PDF)** и **ТТН** (`orders.invoice_path`, `ttn_path`, `ttn_barcode`). При загрузке ТТН штрихкод распознаётся тем же `ttnRecognize.js`, что в приходе; номер можно поправить вручную. Документы смотрят из карточки и из списка.
- Приход можно **привязать к заказу** (и к его счёту/ТТН). У единиц `items.order_id`. FIFO «в пути» сначала списывает выбранный заказ. Остаток без категории закрытие заказа не блокирует.
- «Оформить» / статус «В пути» увеличивает `in_transit`. Приход FIFO списывает «в пути» и закрывает заказ. Номер, статус и позиции правятся в любом статусе. Удаление заказа в любом статусе (для `in_transit` откатывается ещё не поступившее). Удаление категории: `order_items.category_id` → `ON DELETE SET NULL`.

Файлы: `client/src/pages/AutoOrderPage.jsx`, `AutoOrderDetailPage.jsx`, `components/ReceiptModal.jsx`, `ttnRecognize.js`; `server/src/routes/autoOrder.js`, `receipts.js`, `orderTransit.js`, `autoOrderDocx.js`, `db.js`. Сборка: `BASE_PATH=/apps/tmc`.

### Торцы — `../Torcy` :3002 `/apps/torcy`

Мониторинг цифровых рекламных торцов. Ping **на сервере** (`server/src/services/monitor.js`), не в UI: интервал `ping_interval_ms`, смена online/offline пишет `alerts` и SSE `broadcast('alert')`. Сообщения: «Потеряна связь с торцом …» / «Восстановлена связь с торцом …» (`kind` `offline`|`online`). Оболочка AdminPanel опрашивает `GET /apps/torcy/api/alerts?afterId=` и показывает тосты в любом приложении (в т.ч. База знаний). Дубли подавляются по id; клик открывает `/app/torcy`. Пока открыты сами «Торцы», shell-тост не дублирует UI ребёнка. Скрытие iframe при смене приложения мониторинг не останавливает.

**Журнал** (`services/audit.js`, таблица `action_logs`, страница «Журнал действий», только admin): потеря/восстановление связи, добавление и удаление торца, SSH (перезагрузка, метрики, массовая команда), прочие действия. Уровень `info` / `warn` / `error` (колонка `level`). Одинаковое событие по тому же объекту за 15 минут не дублируется. Каждая новая запись дописывается в журнал GLPI (`../GLPI/server/data/activity.jsonl`, тип `torcy`) и видна на странице «Журнал» GLPI (фильтр типа «Торцы», экспорт Excel теми же фильтрами). Свой экспорт: `GET /api/logs/export` — те же фильтры, что список (источник, действие, магазин, уровень, поиск), до 4000 строк, `xlsx`.

**Выбор торцов на странице магазина** (admin): чекбокс внутри карточки/строки (`DeviceCard`, класс `device-pick`). «Выбрать все» / снятие, промежуточное состояние, счётчик. Кнопки активны только при выборе: «Команда», «Пауза», «Вернуть с паузы», «Удалить» (удаление — модальное подтверждение). Пауза не удаляет торец (`POST /api/shops/:id/bulk-pause`, `bulk-delete`).

**Модальное окно «Команда»:** поле своей команды, кнопки «Рестарт» и «Выкл» (штатные reboot/shutdown), пользовательские кнопки в настройке `ssh_custom_commands` (`GET/POST/PATCH/DELETE /api/settings/ssh-commands`). Отправка своей команды — `POST /api/shops/:id/ssh`. Подтверждение и запрет опасных команд сохраняются. Результат по каждому торцу, запись в журнал.

### Авторизации ПК — `../CompUsers` :3003 `/apps/compusers`

Журнал входов с UNC; инкрементальный импорт. Клиент на всю ширину iframe, без горизонтального скролла страницы. `server/src/importer.js`, `client/src/App.jsx`.

### Сессии Citrix — `../CitrixSessions` :3004 `/apps/citrix`

XenApp; logoff; сообщение; VNC (WS); UNC-папка пользователя. **Не** открывать папку через `explorer.exe` на сервере — клиент шлёт `adminpanel-folder:` родителю. Протокол: `scripts/install-folder-opener.ps1`. Сборка: `BASE_PATH=/apps/citrix`. Папка: `CitrixSessions/server/src/userFolder.js`. Вёрстка на всю ширину iframe; VNC-окно и таблица вписываются в iframe без `100vw`.

### Перемещение оборудования — `../EquipmentMove` :3006 `/apps/equipment`

Журнал передачи техники (системный блок, монитор, комплект, принтер, МФУ, ИБП + свои типы); составные позиции (инв. №, серийный №, примечание); откуда/куда из справочника или вручную; дата; ТТН (скан/PDF/Word/Excel) с просмотром; фото; комментарий; кто внёс. Справочники объектов (офис/ТО/склад, БВД/БМК) и типов.

Поиск журнала: общий запрос (подстрока без регистра и «ё»; слова по отдельности; инв./серийный без дефисов и пробелов; похожие слова 1–2 опечатки) **и** фильтры в шапке каждого столбца. Несколько фильтров складываются через И (например откуда + дата). Клик по названию столбца сортирует по возрастанию / убыванию (хранится в `localStorage` `equipment.sort`). Сортировка и фильтры на сервере, вместе с пагинацией.

SQLite `server/data/equipment.db`, вложения `server/uploads/`. Сборка: `BASE_PATH=/apps/equipment`. Файлы: `server/src/db.js`, `routes.js`, `search.js`, `client/src/App.jsx`. Форма перемещения и предпросмотр документов вписываются в ширину iframe (сетки `minmax(0, 1fr)`, без `100vw`).

### GLPI — `../GLPI` :3005 `/apps/glpi`

Очередь заявок УИТ из Service Desk. **Не** плагин GLPI: свой React + Express, пишет в GLPI через REST. Health: `/api/health`. Сборка: `$env:BASE_PATH='/apps/glpi'; npm run build` в `../GLPI/client`, затем снять слушателя **3005**.

```
../GLPI/
  client/src/          App.jsx (дашборд+настройки+масштаб шрифта), Inbox.jsx, Working.jsx, Logs.jsx, LlmKeysPanel.jsx, workingDraft.js,
                       inboxDraft.js (черновик секторов: auto/manual, applyAutoProposal), SectorMultiSelect.jsx,
                       OcrScanBlock.jsx, ticketIcons.jsx, TicketThread.jsx, PromptEditor.jsx, Attachments.jsx, fontScale.js, GlpiDirectoriesPanel.jsx
  server/src/          index.js :3005; routes.js; inbox.js; working.js; inbox-worker.js; inbox-runtime.js; glpi-focus.js;
                       staged-analysis.js; ocr-followup.js; classify.js; settings.js; activity-log.js; glpi-directories.js; glpi-directories-worker.js;
                       leader-lease.js (единый автообработчик), ticket-lock.js, assign-guard.js, glpi-session.js, llm-health.js,
                       llm-keys.js, llm-provider.js, llm-providers/
  server/data/         settings.json, routing-feedback.json, auto-assign-state.json, leader-leases.json, ocr-followup-state.json, llm-health.json, llm-keys.json, activity.jsonl, glpi-directories.json (gitignored);
                       ai-prompt.json (runtime промптов, в gitignore GLPI нет — ключи туда не класть)
```

**Интервалы (не путать):**

| Ключ | Что делает |
|---|---|
| `pollIntervalMs` | Серверный poller дашборда (`dashboard.js`) и клиент дашборда в режиме `auto` |
| `dashboardRefreshMode` | Клиент дашборда: `auto` / `onload` (открытие + смена периода) / `manual` (кнопка). Смена периода всегда грузит заново |
| `inboxRefreshIntervalSec` | Клиент Inbox, счётчики «Новые»/«В работе», интервал серверного `inbox-worker`. `0` — в UI только кнопка «Обновить»; worker всё равно тикает не реже чем раз в 15 с (минимум 5 с). Черновики карточки (`dirtyRef`, `groupMarks`/`groupCleared`) не сбрасывать |
| `directoryRefreshSec` | Снимок групп/категорий из исходного GLPI (`glpi-directories.js`). `0` — только кнопка в настройках. Дефолт 600 |

Специалисту `GET /inbox` и `GET /inbox/count` отдают `ui` (`inboxRefreshIntervalSec`, `showSolutionSuggestions`, `solutionDisabledSectorIds`) — админский `GET /settings` не нужен.

**Дашборд (admin):** заявки секторов УИТ по **дате открытия**, без УМТС/ОТО/СБ. СОКС в карточках и блоках есть; в диаграмме «закрыто силами СПП» СОКС исключён. Периоды: сегодня / вчера / 7д / 30д / открытые / свой. Фильтр сектора в «Кратком описании» — выпадающий список поверх страницы (`position: fixed` + portal), чтобы при низкой высоте блока заявок пункты не обрезались.

Блок **«Краткое описание»:** по умолчанию Gemini (`llmSummaryEnabled`). Галочка «Анализ нейросетью» выключает API — эвристика (`summary.js`). Сбой Google → разбор по правилам. Кэш сводки по составу заявок.

**Inbox:** статус «Новый», карточки на всю ширину (не узкая таблица). Поля: тип / **секторы мультивыбором на карточке** / категория / SLA. Кнопки: **Назначить**, **AI**, иконки ответа и решения. Пока анализ ИИ не завершён (`llmPending`), на карточке **нет сектора и категории** (эвристика карточку не заполняет; категория из GLPI в разбор не подмешивается). После `preview` worker ставит сектор/категорию из анализа. UI `POST /inbox/:id/preview` только анализ, без автоназначения. Составная заявка правится **на карточке**, не отдельной таблицей. Просмотр вложения — lightbox через portal на `document.body` (`Attachments.jsx`), иначе строки списка наезжают на картинку.

- **Секторы на «Новые»:** галочки можно снять, в том числе поставленные автоматически. Источник отметки в черновике: `groupMarks[id] = 'auto'|'manual'`, снятые вручную — `groupCleared[id]=true` (для следующего этапа: повторный анализ без отката ручных правок). Правило «категория Запрос в НСИ → сектор НСИ» **не** возвращает галочку, если оператор её снял. Фоновый `GET /inbox` и завершение `preview` не перезаписывают черновик, если `dirtyRef` или есть ручные отметки/снятия. Без выбранного сектора «Назначить» недоступна (`title`/`aria-label`: «Выберите сектор назначения.»). Поле категории не блокируется сектором: при САКПО список тот же (белый список справочника), выбор сохраняется в черновике.
- **Развёрнутая заявка:** клик по карточке открывает заголовок (перенос длинных строк, HTML как текст через `ticketTitleText`), OCR, тред, вложения. Модалка изображения/файла — `createPortal` на `body`, `z-index` 90.
- **Повторный анализ:** иконка на строке, `POST /inbox/:id/reanalyze` (кэш маршрутизации и OCR сбрасывается). Авто-галочки заменяются новым разбором (`applyAutoProposal`), ручные и `groupCleared` сохраняются. Автоназначение с этой кнопки **не** вызывается.

**В работе** (`Working.jsx`, `working.js`): статусы GLPI **2** Processing assigned («В работе»), **3** Processing planned («Запланирована»), **4** Pending («Ожидание»). Фильтр «В работе» = 2+3, «Ожидание» = 4, «Все» = 2+3+4. **По умолчанию** фильтр сектора **СПП** (не все сектора сразу). Подсветка статуса в списке: **2/3 — зелёная**, **4 — жёлтая** (`workingStatusBadgeClass`). Счётчики, ручное «Обновить», пагинация (`search/Ticket` + `range`), выбор **20/40/60/80** заявок на странице. Карточка как на «Новые»: заголовок, поля тип/секторы/категория/SLA/**статус**, разворот с тредом и вложениями. Кнопки: **Сохранить** (переназначение секторов с DELETE старых Group_Ticket, категория, SLA, статус, тип), повторный анализ, ответ/скрытое сообщение, решение. Повторный анализ: те же правила, что на «Новые» (`reanalyzeTicket({ requireNew: false })`, двухэтапный OCR, правило НСИ, скрытая OCR-заметка), результат — **только предложение** (`applied: false`), в поля и GLPI не пишется, пока оператор не нажмёт «Подставить в поля» и затем «Сохранить». Снимок `expected` + `inspectTicketForUpdate` + `ticket-lock` — гонки и чужие правки → 409 `STALE`. Состояние и ошибки по заявке независимы, двойной клик режется. **Не** попадают в `inbox-worker` / `listNewTickets` (там только статус 1). Навигация: вкладка «В работе» у админа и специалиста. API: `GET /working`, `GET /working/count`, `POST /working/:id/update|reanalyze|followup|solution`. Followup `isPrivate` принимают и `/inbox/:id/followup`, и `/working/:id/followup`.

- **Назначить** — назначение в GLPI + скрытое `ITILFollowup` о назначении. Если есть решение — **второе** скрытое сообщение: шаги нейросети, инструкция из «Базы знаний», карточки БЗ, промпт, эвристика. Блок **«Каталог типовых решений» в followup не пишется** — каталог только во входе `solveWithLlm` и в окне AI. Нет текста кроме каталога — второго сообщения нет. Контракт API: `includeSolutionNote !== false`. Выключить целиком (`showSolutionSuggestions`) или по секторам (`solutionDisabledSectorIds`, как OCR). Автоназначение всегда `includeSolutionNote: false`.
- **Параллельное назначение (C3):** у каждой карточки своё состояние «Назначить» (загрузка / успех / ошибка); сбой одной не трогает остальные. На сервере — очередь на заявку (`ticket-lock.js`) + не больше 5 одновременных записей в GLPI. Перед записью повторно читаются статус и Group_Ticket; уже обработанная заявка → HTTP 409 `ALREADY_HANDLED` («Заявка уже обработана…»); повтор с теми же секторами → идемпотентный успех `ALREADY_ASSIGNED`. Двойной клик на клиенте игнорируется (`assigningRef`).
- **Многопользовательский режим (C4):** GLPI REST ходит под **одним** сервисным App-Token/User-Token (в настройках), не под учёткой AdminPanel. Изоляция операторов — заголовки шлюза `X-Admin-User-*`; в скрытой заметке о назначении строка `Оператор AdminPanel: ФИО (login)`. Сессия GLPI одна на процесс (`glpi-session.js`): параллельный `initSession` схлопывается, 401 сбрасывает только тот токен, с которым упал запрос.
- **Единый автообработчик:** файловый lease `leader-lease.js` (ключи `inbox-auto` и `llm-health`, TTL 45 с, файл `server/data/leader-leases.json`). `inbox-auto`: основной владелец — серверный worker `server:<pid>` (`claimServerInboxAutoLease`). Клиентский `userId:instance` больше не забирает лок, пока worker должен обрабатывать (фон или GLPI — активное приложение AdminPanel); `POST /inbox/lease` в паузе не назначает лидера, чтобы лок не застревал на клиенте. `llm-health`: владелец `server:<pid>`; опрос ИИ API при недоступности только у одного процесса. Интерфейс: `createLeaseStore` / `acquire` / `renew` / `release` / `peek` / `claimInboxAutoLease` / `claimServerInboxAutoLease`.
- **Главный переключатель автоназначения (C1):** `autoAssignEnabled` (по умолчанию **вкл.**). Эффективные сектора = переключатель И `autoAssignSectorIds`. Выключение не затирает чекбоксы секторов (в UI серые, значения на месте).
- **ИИ недоступен (C2):** после `llmOutageThreshold` (по умолчанию 3) подряд сбоев **всего контура** (основной провайдер + резерв, если задан). Квота одного ключа не включает C2: пул переключает ключ того же провайдера. Опрос связи **только в этом состоянии**, интервал `llmOutagePollSec` (15–600, дефолт 60). Probe: `GET /models` по первому живому ключу контура (0 токенов). После восстановления — `resumeInboxBacklog`. Состояние **не** меняет `autoAssignEnabled` и сектора. API: `GET /ai-status`.
- **Пул ключей ИИ:** `llm-keys.js`, файл `server/data/llm-keys.json`. Секрет — AES-256-GCM (`GLPI_SECRETS_KEY` / `JWT_SECRET`), в UI только маска. Ключ привязан к провайдеру, порядок = приоритет. 429/`RESOURCE_EXHAUSTED` → `exhaustedUntil` (`Retry-After` или 60 мин) → следующий ключ того же провайдера, заявка не прерывается. Экран: `LlmKeysPanel.jsx` — **список строк** (название, провайдер, маска, статус, кнопки в одной строке). «Добавить ключ API» открывает отдельное окно; итог — короткое уведомление. Добавление/ошибка пишутся в журнал (`llm-key` / `error`). Старый `llmApiKey` из `settings.json` мигрирует при старте и вычищается. `GET /settings` ключ не отдаёт (`llmApiKeySet`).
- **Права UI GLPI:** специалист — «Новые» и «В работе». **Админ** — ещё дашборд, **Журнал**, настройки (в т.ч. справочники секторов/категорий), промпты, ключи ИИ. API: `requireAdmin` только при `role === 'admin'` (`GET/PUT /settings`, `/glpi-directories*`, `/ai-prompt*`, `/llm-keys*`, `/logs`, дашборд).
- **Журнал** (`activity-log.js`, `activity-log-export.js`, `Logs.jsx`): локальный JSONL `server/data/activity.jsonl` (ротация ~4 МБ / 4000 строк), **без ИИ**. Пишет автоназначение и удержание (сектор, уверенность, правило, rationale), ручные назначения и правки «В работе», ответы/решения, настройки, промпты, ключи (без секрета), C2 on/off, **скан изображений (`ocr`)**, **переключение провайдера (`llm`)**, ошибки API. Страница «Журнал» — фильтры тип/уровень/заявка/поиск, `GET /logs`. **Экспорт в Excel** (только admin): кнопка на странице, `GET /logs/export` — те же query-параметры фильтра, до **4000** строк (`LOG_EXPORT_MAX`), библиотека `xlsx` (уже в `GLPI/server`). Колонки: дата/время, пользователь, тип, сообщение, источник (GLPI / заявка #N). Событие экспорта пишется в журнал.
- **Провайдеры:** адаптеры `llm-providers/gemini.js` и `openai.js`, диспетчер `llm-provider.js`. Основной / резервный / OCR: `llmProvider`, `llmFallbackProvider`, `llmFallbackModel`, `llmOcrProvider`, `llmOcrModel`. Vision: модель OCR только на hop OCR-провайдера (не подставлять Gemini-id в OpenAI). Квота/сеть/5xx на основном → следующий ключ, затем резервный hop; `noteLlmSuccess` снимает outage. Типичный контур: основной OpenAI-совместимый + резерв Gemini. Секреты **не** в git и **не** в этом файле.
- **Доступность ИИ и ключи:** `llm-api-error.js` — классификация `network_error` / `quota_exceeded` / `invalid_key` / `server_error` / `content` (без лишних generate). `llm-health.js` — глобальный outage, poller **только пока unavailable** (lease + `llmOutagePollSec`), экспоненциальный backoff, пропуск probe при cooldown квоты по `exhaustedUntil` ключей. Успешный `completeWithPool` снимает outage (`noteLlmSuccess` → `reconcileKeyPool` после recovery). Пока сбой **не** `quota_exceeded`, poller перед probe прогоняет до 4 ключей со статусом `exhausted` (ложный «лимит» после сети); при реальной квоте probe молчит до `exhaustedUntil`. Ручной `POST /llm-keys/refresh` (админ, один запуск, пауза 1.5 с между ключами, `GET /models`) — кнопки: иконка у чипа «ИИ недоступен» в шапке и «Обновить все ключи» в окне ключей. Отдельный probe ключа сохранён. Статусы ключа в пуле: `ok`, `network` (ключ **остаётся** в ротации), `exhausted`, `invalid`, `error`. Probe — `GET /models` (0 токенов). Уведомления: `activity-log` + опциональный webhook `llmAdminWebhookUrl` / env `GLPI_LLM_ADMIN_WEBHOOK` (`llm-admin-notify.js`, throttle 5 мин).
- **Фон GLPI:** приём/анализ/автоназначение — серверный `inbox-worker.js`, не UI. Inbox только подписывается (`GET /inbox`, `GET /runtime`). Переключение приложения в оболочке **размонтирует** iframe (`AppFramePage` — один iframe); скрытый iframe не держим (троттлинг вкладки). Свёрнутое окно AdminPanel **не** считается неактивным. Настройка `glpiBackgroundEnabled` (по умолчанию **вкл.**): выкл. + открыто другое приложение AdminPanel → новые preview/assign не стартуют, текущие доходят, серверный lease отпускается после inflight. Heartbeat оболочки `POST /runtime/focus` (`glpi-focus.js`, TTL 25 с). Индикатор в шапке GLPI: работает / пауза (фон выключен) / ИИ недоступен / автоназначение выключено. Пауза не сбрасывает ticket-lock и не держит клиентский `inbox-auto`.
- **AI** — `POST /inbox/:id/analyze` (`analyzeTicket`): маршрутизация + `solveWithLlm`. Окно открывается **даже без сектора** (удержание, расхождение правил и ИИ, `missing`). `buildPreview` при пустых группах / без SLA **не** блокирует разбор: `preview` может быть `null`, текст в `previewError`. Сообщение «Нужно выбрать хотя бы одну группу «Назначено»» — это проверка **назначения** (`buildPreview` / «Назначить»), не запрет смотреть AI. «Подтвердить и назначить» по-прежнему требует группу и SLA. Готовый `aiNote.advice` на apply без второго вызова решения, если сектора те же.
- Ответ / Решение — публичный followup / `ITILSolution`. Тред, вложения.
- Баннер **оператору** на карточке: онбординг, уверенность не «высокая». **Не** публичный followup инициатору. Удержание автоназначения — один скрытый комментарий (`is_private: 1`, состояние в `auto-assign-state.json`, не дублировать на каждый poll). Текст: `buildOperatorHoldPrompt` / HTML в GLPI — `buildOperatorHoldFollowupHtml` (`auto-assign.js`): заголовок «ИИ не назначил…», маркированный `<ul>` по `missing` (строка с `; ` режется на пункты, скобки не отрываются), затем «Назначьте заявку после проверки.». Фраз «Инициатору ничего не отправлялось» / «Инициатору это сообщение не отправлялось» нет. ИИ повторно не вызывается. Баннер Inbox — `pre-wrap`. Скрытая OCR-заметка (`ocr-followup.js`) те же фразы про инициатора тоже не пишет.
- OCR **не** в списке заявок. Выжимка — в раскрытой карточке (клик по заявке) и в окне **AI** (блок **«Скан изображений»**).

**Онбординг** = новый сотрудник (логин+пароль): «создать учётную запись / рабочий стол», «нормы положенности». Не «починить Citrix» и не только папка. Правило в `classify.js` + разбор в `onboarding.js` → САПО+СПП, тип запрос, кат. 211. ФИО нового **всегда** нужно. «Как у …» / «по аналогии с» — **строка ФИО**, не карточка User в GLPI; закрывает права **или** перечень систем. Нехватка → `onboardingIncomplete` / `needsOperatorInput` / баннер; **не** `skipAssign` (ручное назначение должно работать). `skipAssign` только электрика / особый инициатор.

**Автоназначение** (`auto-assign.js`, после preview): `autoAssignEnabled` (мастер, по умолчанию вкл.) И `autoAssignSectorIds` (по умолчанию `[]` — сектора выкл.). **`autoAssignBlockedGroupIds`** — id групп, на которые авто **не** ставит (ручное «Назначить» можно). Дефолт id из `server/data/assign-block-defaults.json` (группа **1976** «1С-АктиТехСофт» / atsoft; в снимке справочника `enabled: false`). Имена подрядчиков **не** в коде. Текст заявки про **belcrystal.by help** / atsoft (не UNC `ЭДиН\atsoft`) — правила вкладки «Блокировка автоназначения» (`contractor-belcrystal`, `contractor-atsoft`), merge по id если правила ещё нет. Журнал `assign-block` (ruleId или `source: autoAssignBlockedGroupIds` + groupIds). В GLPI **нет** групп с именами «belcrystal.by help» / «atsoft»; в AdminPanel **нет** сектора с таким именем. REST `applyAssignment` (`GLPI/server`, сессия **ai agent**) пишет **Group_Ticket** только из белого списка УИТ и поля заявки (тип, категория, SLA из `sla-catalog.js`); **User_Ticket** в коде **нет**. Пользователь **belcrystal.by help (4816)** и SLA **KCO Belcrystal (19)** на [#555218](https://support.willesden.by/front/ticket.form.php?id=555218) (06‑10‑2026 ~16:47, автор **ai agent**) — **не** из списка секторов: id **19** не в whitelist SLA AdminPanel; типично **бизнес‑правила GLPI** после REST (часто категория **ПО > КСО (331)** + состав «КСО»). AdminPanel затем перезаписал SLA на **SLA САКПО средний (55)**, исполнитель‑user мог **остаться**. Кейс 555218: авто **СОКС (1984)** + **САКПО (1987)** + кат. **331** — ошибка маршрутизации (ожидание **только САКПО**, категория 0). Нативных RuleTicket в репозитории нет. Уверенность — **категории** `высокая` / `средняя` / `низкая` (не проценты 0–100). Авто только при **`высокая`**. Составная: авто **весь набор**, только если мастер вкл. и **каждый** предложенный сектор включён и не в blocked. Иначе оператор. **НСИ** — только при правиле `hardRuleId=nsi` или подтверждённом промпте; иначе без автоназначения. **Согласование** (`routing-consensus.js`): расхождение эвристики и ИИ по сектору → пустые группы, заявка остаётся «Новая». Не переназначать/не переудерживать ту же заявку, пока не сменился fingerprint. Пока ИИ недоступен (`llm-health.js`, квота/ключи/сеть) `canAutoAssign` и `settleAutoAssignment` **не** назначают (настройки секторов не затираются). Мастер, список секторов, пауза фона и «ИИ недоступен» — независимые флаги.

**OCR** (`image-ocr.js` + `staged-analysis.js`): **двухэтапный** разбор. Сначала текст → сектор и флаг «нужен скан». Картинки — только если текста мало (`needImages`, «см. скрин», короткое описание). Не OCR при создании новой карточки товара. Vision — `completeWithPool` (как кнопка AI): основная модель, при сбое резерв; не только Gemini. Баг: `isGeminiProvider` в `image-ocr.js` не импортировался и ронял `analyzeTicket`. Скрытая заметка `ocr-followup.js`: в GLPI только `<br>` (теги `<p>`/`<hr>`/`<ul>` схлопываются в простыню). Блок на файл, предложения с новой строки, `————` между кадрами. Журнал: `ocr`, `llm`. Лимиты: `ocrMaxImagesPerTicket`, 4 МБ. Повторный анализ Inbox/«В работе»: `POST /inbox/:id/reanalyze`, без автоназначения.

**Шрифт UI:** кнопки A / A+ в шапке, масштаб 85–140%, `localStorage` `glpi.fontScale`.

**Окна настроек (только admin):** «Настройки GLPI» — блоки `settings-block`, в том числе **«Секторы и категории GLPI»** (`GlpiDirectoriesPanel.jsx`). Чекбоксы секторов в **Автоназначение**, **Распознавание изображений** (`ocrDisabledSectorIds`) и **Варианты решения** (`solutionDisabledSectorIds`) берут **тот же** рабочий список, что и этот блок — без отдельного запроса: `GET /settings` → `directoryGroupsForSettings()` / `catalogs()`; при переключении в панели — `workingGroups` из ответа `GET/PATCH /glpi-directories` (`onWorkingGroupsChange`). Снятый сектор сразу исчезает из блоков, сохранённые id режутся (`pruneSettingsSectorLists`). Пустой/ошибочный список — подсказка администратору, журнал `directories`. «Промпты» — вкладки Общий / По секторам / Типовые решения / **Блокировка автоназначения**. «Ключи ИИ» — список строк + модалка добавления.

**Справочники GLPI** (`glpi-directories.js`): рабочий список секторов/категорий = **включённые** (`enabled`) строки снимка, один источник `workingGroupsFromSnapshot` / `resolveWorkingCatalogs` (кэш снимка + public 10 мин). Нет подмены пустого выбора полным `GROUPS`/`CATEGORIES`. Выгрузка через `listGlpiCollection` (`glpi.js`): query `range` + заголовок `Range`; курсор на **число строк страницы**. Один заголовок Range этот GLPI режет до `list_limit` (~50) и при шаге 200 пропускал хвост (СОКС/НСИ «нет в GLPI», нет «Заказы на оплату» / «К финансовому ресурсу»). Источник `directoriesSource`: `builtin` / `glpi` / `merged` (дефолт). Снимок `server/data/glpi-directories.json` (не в git). Кэш 10 мин, `POST /glpi-directories/refresh`, авто `directoryRefreshSec`. Нет в REST после опроса → `missingInGlpi`, enabled не сбрасывается; включить снова нельзя, пока не появится в GLPI. Категория 0 «Не назначать» всегда в рабочих категориях. API admin: `GET /glpi-directories` (`workingGroups` в том же ответе), `POST /glpi-directories/refresh`, `PATCH /glpi-directories/options`, `PATCH /glpi-directories/:kind/:id` `{enabled}` (чужой id → 400 `NOT_IN_GLPI`). Журнал `directories` (вкл/выкл, смена источника, пустой список), `directories-migrate`.

**Блокировка автоназначения** (`assign-blocks.js`, вкладка в `PromptEditor.jsx` / `AssignBlocksPanel.jsx`). Файл `server/data/assign-blocks.json`, без новой таблицы. Доп. заготовки `assign-block-defaults.json` подмешиваются **по id**, если правила ещё нет (админ может выключить). Поля условий — только то, что уже есть на заявке (без доп. запросов в GLPI): заявитель, заголовок, текст, подпись, подписанты, склейка этих полей, тип, id категории, id статуса. Операторы: есть / не есть / содержит / не содержит / начинается / заканчивается / regex / не regex / существует / не существует. Связка И или ИЛИ, порядок `priority`. Совпадение → `autoAssignBlocked`, уверенность «низкая» (не `skipAssign`: ручное назначение можно). Сид: «Иванов Александр»; подрядчики belcrystal/atsoft — defaults. Журнал: тип `assign-block`. API admin: `GET/PUT /assign-blocks`, `POST /assign-blocks/preview`.

**Обучение:** `learnFromApply` пишет кейсы в `ai-prompt.json` (`compileExperience`, до 50+30 строк). Хвост опыта **добавляется** к тексту вкладки «Общий» в `compiledPromptText()`, поэтому доходит до модели. Рабочий few-shot — `routing-feedback.json` → `recentRoutingExamples(8)` в user payload. Это не fine-tune. Пример из feedback должен учитываться сразу. `matchPrompt` / `scorePromptRule` / `keywordsFrom` отбрасывают приветствие, благодарность и стоп-слова подписи; иначе подтверждённый кейс цеплялся к любой заявке и открывал автоназначение **НСИ** через `promptConfirmed`.

**Жёсткие правила `classify.js`:** список `HARD_RULES` проверяется **сверху вниз**, срабатывает **первое**. Правила ТСД / DFO / скрипт прайсов / акты / уценка-документ / Lotus / заключения / Spaceman / торцы стоят **выше** правила `nsi`, чтобы слово «ПСЦ» или ложный кейс не отправили заявку в НСИ. Это **не** НСИ: ТСД-железо → СОКС; DFO и скрипт прайсов, акты, уценка-документ → СРИСиС; Spaceman → ОРПОиП; рассылка Lotus и база заключений → САПО; торцы → СПП. **Бейдж / доступ кассира (сотрудника) к кассе, POS, КСО** (`badge`) → **САКПО + СПП**, категория 0; номер кассы в `missing` не требовать. Правило `onboarding` **пропускается**, если УЗ/доступ для **инвентаризации или переучета** (не новый ПК/нормы положенности) — иначе сбивает в САПО+СПП.

**Подписи** (`message-parse.js`): в треде UI подпись как была. Для **маршрутизации** LLM: из текста снимаются приветствие/спасибо (`stripPoliteNoise`); из подписи в модель идут только ТО/телефон (`routingContactsFromSignature`), с пометкой «не учитывать для сектора». Лог `[llm] analyze fields`: id и флаги `title` / `content` / `signature`, без текста заявки.

- **Назначение в GLPI:** белый список групп, категория, тип, срочность/влияние/приоритет, SLA max TTR. SLA среднего уровня — `DEFAULT_SLA_BY_GROUP_ID` в `sla-catalog.js` (имена GLPI вроде «СРиСИС» / «Навексофт (МП)» не ломают выбор). Несколько секторов → SLA с большим сроком. Только сектор НСИ и категория 0 → «Запрос в НСИ»; составная НСИ+другой — нет. «Запрос в НСИ» добавляет группу НСИ, **если оператор её не снял** (`groupCleared` / `blockedGroupIds`). **Категорию при САКПО оператор выбирает вручную** (в т. ч. «К сетевому ресурсу» для SET10); авторазбор **не** ставит «ПО > КСО» (`normalizeCategoryForGroups`, без авто-правила на «К сетевому»). Ручной выбор `buildPreview` / `applyCatalogRules` не обнуляет. Сбой скрытого followup не откатывает назначение. `toGlpiHtml` делает кликабельными URL, пути `/apps/instructions/view` и упоминания БЗ (`KB 818`, `KB id=818`, `GLPI knowbase id=818`, опционально `«название»`) → `{GLPI_URL}/front/knowbaseitem.form.php?id=N`.

**Конвейер заявки** (`routeTicket` / `applyAssignment` в `inbox.js`):

1. Эвристика: `classify.js` + `onboarding.js`, `assign-catalog.js`, `kb-semantic.js` (`../KnowledgeBase/server/src/kb-data.js`), `instruction-map.js`, `propose-solutions.js`.
2. **Этап 1, только текст:** LLM-маршрутизация без картинок (`analyzeWithLlm` + `compiledPromptText()` из вкладки «Общий»: `baseText` + путь `generalPath`). Стандартный файл — `prompts/routing-compact.md`, путь меняется в редакторе. Поля `needImages`, `nsiCreateCard`. JSON **без** `advice` — шаги решения не запрашиваются.
3. **Этап 2, изображения по необходимости** (`decideOcrNeed` в `staged-analysis.js`): OCR Gemini vision `inlineData`, затем повтор эвристики и LLM уже с `ocrText`. Если этап 2 не нужен — `ocr.skipped` = `clear` / `nsi` / …
4. LLM-решение: `solveWithLlm` при **AI** и при **Назначить**. System — **только** промпт секторов с карточки (`compiledSolutionPrompt`, без master). Нет файла сектора (QlikView / Навексофт / Битрикс) — короткий fallback, не 35 тыс. общего текста. Каталог: `searchCatalogForTicket(..., { strictSectors: true })` — чанки без overlap с назначенными секторами отбрасываются. Имена секторов в LLM — `groupIds` карточки, не `analysis.groups` (если оператор сменил сектор, совет строится заново). Кэш решения `solutionCache` 10 мин по fingerprint+groupIds (AI затем «Назначить» без смены сектора — без второго вызова). Готовый `aiNote.advice` с AI переиспользуется, только если набор секторов тот же.
5. Автоназначение или удержание (`canAutoAssign` / `shouldHoldForOperator`). Повторный анализ **не** вызывает автоназначение.
6. Провайдер: `completeWithPool` — адаптер Gemini или OpenAI-compat, ключ из пула. 429 на ключе → следующий ключ провайдера; на модели Gemini по-прежнему lite → flash → pro. OCR идёт через тот же пул (vision). Дефолт: `gemini-3.5-flash-lite`. Резервный провайдер только если выбран явно.

**Порядок ИИ:** заявка → общий промпт вкладки «Общий» (`compiledPromptText` = файл `generalPath` + накопленный опыт) → сектор. «Назначить» / AI-решение → промпт **этого** сектора + top-N каталога **этого** сектора. Маршрутизация **не** просит JSON `advice`; шаги даёт только `solveWithLlm` (кнопка AI и «Назначить»). На apply при тех же секторах шаги не пересчитываются.

**Настройки** (`settings.js`, форма в `App.jsx`, `GET /settings` отдаёт `groups` из `directoryGroupsForSettings()` — те же включённые сектора, что в блоке справочника, плюс `groupsWarning`; секрет не отдаёт): `directoriesSource`, `directoryRefreshSec`, `llmEnabled`, `llmSummaryEnabled`, `llmProvider` (`gemini`|`openai`), `llmUrl` (для OpenRouter: `https://openrouter.ai/api/v1`), `llmFallbackProvider`, `llmFallbackModel` (модель резервного источника, не путать с `llmModel`), `llmOcrProvider`, `llmOcrModel`, `llmModel`, `llmFallbackEnabled`, `autoAssignEnabled` (мастер, дефолт true), `autoAssignSectorIds`, `autoAssignBlockedGroupIds`, `glpiBackgroundEnabled` (фон GLPI, дефолт true), `llmOutageThreshold` (2–20, дефолт 3), `llmOutagePollSec` (15–600, дефолт 60), `llmAdminWebhookUrl` (опц., POST JSON при outage/recovery), `ocrEnabled`, `ocrFollowupEnabled`, `ocrDisabledSectorIds`, `ocrMaxImagesPerTicket`, `showSolutionSuggestions`, `solutionDisabledSectorIds`, `inboxRefreshIntervalSec`, `dashboardRefreshMode`, `pollIntervalMs`. Ключи — отдельный store и экран. Env: `GLPI_LLM_*`, `GLPI_LLM_ADMIN_WEBHOOK`, `GLPI_SECRETS_KEY`, `GLPI_POLL_MS`. Ключи не коммитить и не писать в чат.

**Промпты (кнопка «Промпты» в Inbox, `PromptEditor.jsx`):**

| Вкладка | Зачем в анализе | Runtime | Заготовка | Порядок размера |
|---|---|---|---|---|
| Общий | единственный system для первичного анализа (`analyzeWithLlm` + эвристика `matchPrompt`) | `baseText` + `generalPath` + `compileExperience` | `prompts/routing-compact.md` (кнопка «Стандарт»; путь меняется) | ~13 тыс. симв. + хвост опыта; JSON без `advice`; `maxOutputTokens=1024`. Старый master `prompt_ai_agent_routing.md` в анализ не подмешивается, пока его не укажут в этом поле |
| По секторам | `compiledSolutionPrompt(имена с карточки)` → `solveWithLlm`; **без** общего master | `sectorTexts[<имя>]` | `prompts/sectors/sector_*.md` | см. таблицу секторов ниже |
| Типовые решения | Маршрутизация: top-6, мягкий штраф чужому сектору. Решение: `strictSectors` — только чанки назначенных секторов | `kbText` + `kbPath` | `prompts/catalog-typical-solutions.md` | ~72 тыс. симв. в RAM (чанки кэшируются); в модель — не целиком |

`prompts/sectors/_COMMON.md` — фрагмент синхронизации (организация, ограничения, вне УИТ). **Не** грузить в агента отдельно: те же абзацы уже скопированы в секторные файлы.

| Файл | Сектор GLPI | ~симв. | Содержание |
|---|---|---|---|
| `sector_SPP.md` | СПП (1870) | 49 тыс. | L1, автозакрытие шаблонами, эскалация |
| `sector_SOKS.md` | СОКС (1984) | 22 тыс. | кассы, весы, эквайринг, ТСД |
| `sector_SASITI.md` | САСиТИ (1871) | 20 тыс. | сеть, Wi‑Fi, телефония |
| `sector_SAPO.md` | САПО (1869) | 29 тыс. | серверы, AD, доступы, Lotus |
| `sector_SRISIS.md` | СРИСиС (1985) | 55 тыс. | L2: цены, ЭТТН, 1С (пересекается с каталогом) |
| `sector_SAISPS.md` | САиСПС (1986) | 5 тыс. | GUI LSF, права форм, колонки |
| `sector_SAKPO.md` | САКПО (1987) | 35 тыс. | пик-лист, КСО, Set10 |
| `sector_NSI.md` | НСИ (2017) | 38 тыс. | карточки, ПСЦ, GTIN, стоп-лист; OCR: не фото товара при **создании** карточки |
| `sector_SPOP.md` | СПОП (1988) | 12 тыс. | ремонт принтеров/МФУ (Минск) |
| `sector_ORPOIP.md` | ОРПОиП и ОРПОиП (LSF) (1979, 2014) | 20 тыс. | один файл на две группы |

Нет секторного файла (маршрут только общим промптом / эвристикой): **А2Консалтинг (QlikView)** 1891, **Навексофт** 2010, **Битрикс 24** 2009.

**Каталог** `catalog-typical-solutions.md`: детально **СРИСиС** (22 инструкции), **НСИ** (18+), **САКПО** (7); таблица разводки L2 «ОРиСИТ»; блок «прочие» кратко. Поиск: keywords (≥4 букв, top-12) + имя сектора в заголовке чанка (`detectSectors`). Limit 6, порог score ≥ 6. Решение заявки: только чанки, у которых сектор пересекается с назначенными (составная заявка — объединение). Чанки без метки сектора (L2-таблица, «общие правила») в решение не идут — шаги тогда из промпта сектора и БЗ.

В UI задаётся **путь к файлу на сервере** (поле + «Стандарт» + «Загрузить»). **«Обновить все»** перечитывает общий промпт, каталог и все секторные файлы с диска и сохраняет в `ai-prompt.json`; отдельные вкладки по-прежнему грузятся по одному. После загрузки путь пишется в store (`generalWatch` / `kbWatch` / `sector.watch`). Пока watch включён, анализ **перечитывает файл с диска** (кэш по mtime). «Сохранить» из текстового поля отключает watch — дальше используется сохранённый текст.

Хранилище runtime: `../GLPI/server/data/ai-prompt.json` (в `.gitignore` GLPI **нет**, в отличие от `settings.json` — не класть ключи туда). API: `GET/PUT /api/ai-prompt`, `PUT /api/ai-prompt/sector`, `PUT /api/ai-prompt/kb`, `POST /api/ai-prompt/import-file` `{ kind: 'general'|'sector'|'kb', name?, path? }`, `POST /api/ai-prompt/import-all`.

**Ключевые файлы:** `inbox.js`, `working.js`, `inbox-worker.js`, `inbox-runtime.js`, `glpi-focus.js`, `leader-lease.js`, `llm-api-error.js`, `llm-health.js`, `llm-admin-notify.js`, `llm-keys.js`, `llm-provider.js`, `llm-providers/`, `activity-log.js`, `ticket-lock.js`, `assign-guard.js`, `glpi-session.js`, `staged-analysis.js`, `ocr-followup.js`, `classify.js`, `routing-consensus.js`, `onboarding.js`, `image-ocr.js`, `auto-assign.js`, `routing-feedback.js`, `documents.js`, `llm-analyze.js`, `gemini.js`, `ai-prompt.js`, `settings.js`, `dashboard.js`, `summary.js`, `summary-llm.js`, `assign-catalog.js`, `glpi-directories.js`, `sla-catalog.js`, `message-parse.js`, `kb-catalog.js`, `client/src/Inbox.jsx`, `Working.jsx`, `Logs.jsx`, `LlmKeysPanel.jsx`, `GlpiDirectoriesPanel.jsx`, `workingDraft.js`, `inboxDraft.js`, `App.jsx`, `TicketThread.jsx`, `PromptEditor.jsx`.

---

## API шлюза

Тот же origin, `credentials: include`. Ошибки: `{ error }`.

| Метод | Путь | Кто |
|---|---|---|
| GET | `/api/health` | все |
| POST | `/api/auth/login` | публичный |
| POST | `/api/auth/logout` | сессия |
| GET | `/api/auth/me` | auth; apps с icon/iconUrl/pinned |
| GET | `/api/apps` | свои + online/runtime (порядок с pinned) |
| GET | `/api/apps/all` | admin |
| PATCH | `/api/apps/:id` | admin `{enabled,title,description,icon,sortOrder}` |
| POST | `/api/apps/:id/icon` | admin `{dataUrl}` |
| GET | `/api/apps/:id/icon` | у кого есть доступ |
| DELETE | `/api/apps/:id/icon` | admin |
| POST | `/api/apps/:id/restore` | admin, оформление из apps.json |
| POST | `/api/apps/:id/move` | admin `{direction: up\|down}` |
| PATCH | `/api/apps/:id/prefs` | `{pinned}` текущего пользователя |
| CRUD | `/api/users` | admin |
| GET | `/api/tools` | auth |
| GET | `/api/tools/interfaces` | auth |
| POST | `/api/tools/ip-scan` | `{cidr}` |
| POST | `/api/tools/card-check` | `{barcodes, source, fusionUsername?, fusionPassword?, saveCredentials?}` — Fusion-учётка только текущего пользователя |
| GET | `/api/tools/card-check/fusion` | `{source}` — есть ли сохранённый вход (логин, без пароля) |
| PUT | `/api/tools/card-check/fusion` | `{source, username, password}` — проверить вход и сохранить зашифрованно |
| DELETE | `/api/tools/card-check/fusion` | `?source=` — удалить свои данные Fusion |
| GET | `/api/tools/folder-opener` | скачать .bat протокола |

Дети: `/apps/<id>/api/...` (часто тот же `/api/...` на loopback).

---

## Состояние и паттерны

- React Context `AuthProvider`: `user`, `apps`, `loading`, `login/logout/refresh`.
- localStorage: `adminpanel.sidebarCollapsed`; у Citrix — свои колонки/сорт.
- Сессия только cookie. Значки шлюза: `data/app-icons/`. Дети — свои БД/settings/poller.
- Роутинг оболочки: RR v6, layout + `Outlet`. Встраивание: `/app/:appId` → iframe `app.publicPath` (**один** iframe, предыдущее приложение размонтируется). Фоновая работа GLPI/Торцов — на серверах детей + оверлеи `ShellLayout`, не hidden iframe.
- Sync `apps.json`: INSERT нового id; UPDATE только техники; DELETE id, которых нет в json. Пустой `icon` после синка = `id`. Первая пустая БД: пользователь `ADMIN_USERNAME`/`ADMIN_PASSWORD` (иначе `admin`/`admin`).
- Супервизор + `portGuard.js`: перед стартом снять слушателя порта; spawn с явным `PORT` (родительский `PORT`/`ADMIN_PORT` в ребёнка не тащить); exit → рестарт; EADDRINUSE → reclaim. `stopAllApps` убивает дерево PID.
- В сайдбаре загруженный файл значка важнее пресета, пока файл не снимут.

---

## Ловушки

1. Шлюз слушает **только** `ADMIN_PORT` (`delete process.env.PORT` в `index.js`). Детям супервизор ставит `PORT` из `apps.json`. Иначе Citrix/CompUsers садятся на :4000 или шлюз на :3004.
2. Клиенты детей **обязаны** быть собраны с `BASE_PATH=/apps/<id>`, иначе `/assets` бьёт мимо iframe.
3. Не запускать `explorer.exe` на сервере — только протокол `adminpanel-folder:` на ПК оператора.
4. Health супервизора: `http://127.0.0.1:<port><healthPath>` **без** `/apps/...`. UI — через `/apps/<id>/...`.
5. Не включать `ws: true` у HPM — сломает VNC.
6. Не оставлять `SUPERVISOR=0` на рабочей панели. После правок кода ребёнка обычный перезапуск: супервизор снимет осиротевших с 3001–3006 и 5174.
7. Названия в меню живут в SQLite. Правка `title` в `apps.json` **не** перезапишет существующее приложение; сброс — в админке «Сбросить к каталогу».
8. `folderOpener.js` грузится из `routes/tools.js` мягко (статический import раньше ронял шлюз). Ярлык bat: `cd` в папку bat, `ADMIN_PORT=4000`, пустые `PORT`/`SUPERVISOR`, проверка `/api/health` (не любой слушатель :4000). Без `client/dist` UI нет — bat собирает сам.
9. GLPI тянет карточки БЗ из `../KnowledgeBase` (`kb-semantic.js`). Нет этого репозитория — смысловой поиск по статьям упадёт при импорте модуля.
10. `gemini-2.5-flash-lite` для новых ключей Google недоступна; не ставить её дефолтом.
11. GLPI: `skipAssign` **не** ставить из‑за нехватки ФИО/прав/систем — оператор должен мочь назначить. Автоназначение по умолчанию выкл. (`autoAssignSectorIds: []`). Не слать публичный `ITILFollowup` инициатору «уточните данные»; только Inbox + опционально скрытая заметка. В скрытой заметке об удержании **не** писать «Инициатору ничего не отправлялось».
12. `pollIntervalMs` — не интервал Inbox. Inbox: `inboxRefreshIntervalSec`. Не открывать GLPI как плагин PHP — код в `../GLPI`.
13. Не скармливать LLM весь `catalog-typical-solutions.md` и все `sector_*.md` сразу. Решение: только секторы с карточки + top-N их чанков (`strictSectors`). Общий master на шаге решения **не** подмешивать.
14. Первичный анализ берёт промпт **только** из вкладки «Общий» (`compiledPromptText`, путь `generalPath`). Стандарт — `prompts/routing-compact.md`. Не читать второй захардкоженный файл и не подмешивать master, если он не указан в этом поле. Не просить `advice` на этапе routing — шаги только в `solveWithLlm`.
15. Кэш маршрутизации и кэш решения **в памяти процесса** (10 мин). Рестарт :3005 сбрасывает оба → повторный LLM. OCR кэш свой (`image-ocr.js`).
16. Смена сектора на карточке после AI делает `aiNote.advice` недействительным: apply пересчитывает решение под новые `groupIds`. Не писать в заявку шаги «старого» сектора.
17. Учётки Fusion для проверки карточек — только `req.user.id`. Не читать чужой `user_id` из body. Не возвращать пароль. Не использовать общий `FUSION_BVD_USER` на всех операторов.
18. GLPI API — **сервисный** User-Token, общий на процесс. Не заводить кэш session_token «на пользователя AdminPanel» (токенов GLPI на оператора нет). 401 инвалидировать по равенству токена, иначе параллельный initSession сотрёт свежий. Автоанализ/автоназначение — у серверного worker с lease `inbox-auto` (`server:<pid>`). Клиентский Inbox не должен забирать лок в паузе фона и не шлёт preview с автоназначением.
19. Повторный анализ («Новые» и «В работе») не вызывает `settleAutoAssignment`. Скрытая OCR-заметка (`ocr-followup.js`) не дублируется при том же отпечатке текста+файлов; новый текст скана — новое сообщение. Не слать вторую заметку «удержание оператора» с кнопки анализа.
20. Недоступность ИИ (`llm-health.js`) не должна сбрасывать `autoAssignEnabled` и `autoAssignSectorIds`. Проверка связи — только пока unavailable и только у держателя lease `llm-health`. Не слать generateContent «для пинга», пока есть GET /models. Пауза фона (`glpiBackgroundEnabled=false` и GLPI не активен в оболочке) не должна рвать ticket-lock и не должна оставлять `inbox-auto` на клиенте; свёрнутое окно паузой не считать.
21. Ключи ИИ — только `llm-keys.json` (AES-256-GCM), не `settings.json` и не ответ `GET /settings`. Не логировать секрет. C2 — после исчерпания всех ключей контура, не после первой 429. Смена `GLPI_SECRETS_KEY` после миграции сделает ключи нечитаемыми.
22. Журнал GLPI — только локальный `activity.jsonl`, без внешней отправки и без ИИ. Настройки, промпты, ключи, справочники GLPI и журнал — только `role=admin`.
23. Справочники секторов/категорий не дублируются в SQL AdminPanel. В рабочий список — только id из снимка исходного GLPI (или builtin). Не принимать id с клиента, которого нет в снимке. Автоопрос не затирает `enabled`. Удаление `glpi-directories.json` возвращает builtin, заявки по id не переписывать.

---

## Быстрый поиск

| Ищу | Где |
|---|---|
| Логин / JWT / cookie | `server/src/auth.js`, `routes/auth.js` |
| Права на приложение | `db.js` `userHasAppAccess`, `middleware.js` |
| Прокси / заголовки / WS | `server/src/proxy.js` |
| Каталог детей | `config/apps.json` → sync SQLite |
| Оформление меню | `AppsAdminPage.tsx`, `routes/apps.js`, `appIcons.tsx` |
| Закрепление | `user_app_prefs`, PATCH `/api/apps/:id/prefs`, `ShellLayout.tsx` |
| Старт детей / порты | `supervisor.js`, `portGuard.js` |
| Сайдбар / iframe | `ShellLayout.tsx`, `AppFramePage.tsx` |
| Сканер IP | `server/src/tools/ip.js` |
| Папка Citrix | `../CitrixSessions/server/src/userFolder.js`, `scripts/install-folder-opener.ps1` |
| Дашборд GLPI | `../GLPI/server/src/dashboard.js`, `summary.js`, `summary-llm.js`; режим `dashboardRefreshMode` |
| Inbox / назначение / скрытый чат | `../GLPI/server/src/inbox.js` `toGlpiHtml`, `glpi.js` `knowbaseUrl`; `client/src/Inbox.jsx`; preview `POST /inbox/:id/preview` (без автоназначения), apply `includeSolutionNote !== false`; лок `ticket-lock.js`, проверка `assign-guard.js` |
| Страница «В работе» | `../GLPI/server/src/working.js`, `assign-guard.js` `inspectTicketForUpdate`; `client/src/Working.jsx`; `GET /working`, `POST /working/:id/update` (снимок `expected`); reanalyze без автоприменения |
| Единый автообработчик Inbox | `../GLPI/server/src/leader-lease.js` (`inbox-auto`, `llm-health`), `inbox-worker.js`, `POST /inbox/lease`, `X-Inbox-Instance` |
| Фон GLPI / фокус оболочки | `../GLPI/server/src/inbox-worker.js`, `inbox-runtime.js`, `glpi-focus.js`, `GET /runtime`, `POST /runtime/focus`; индикатор `client/src/App.jsx` `RuntimeChip`; heartbeat `ShellLayout.tsx` |
| ИИ недоступен / опрос API | `../GLPI/server/src/llm-health.js`, `GET /ai-status`; оверлей `client/src/components/ShellLayout.tsx` |
| Уведомления Торцов в оболочке | `../Torcy/server/src/services/monitor.js`, `GET /api/alerts?afterId=`; тосты `ShellLayout.tsx` `TorcyAlertOverlay` |
| Автоназначение GLPI | `../GLPI/server/src/auto-assign.js`, `autoAssignEnabled` + `autoAssignSectorIds` + `autoAssignBlockedGroupIds`; правила `assign-blocks.js` / `assign-block-defaults.json` |
| Сессия GLPI API | `../GLPI/server/src/glpi-session.js`, `dashboard.js` `withGlpiSession` |
| Решение на «Назначить» | `inbox.js` `formatSolutionAdvice` / `buildPrivateSolutionNote` — в GLPI нейросеть + инструкция + БЗ + промпт; **без** `fromCatalog`; каталог только во входе `solveWithLlm` и в окне AI |
| Расход токенов GLPI | `llm-analyze.js` (`analyzeWithLlm`, `solveWithLlm`, `ROUTING_OUTPUT_SPEC`); `ai-prompt.js` `compiledPromptText` / `compiledSolutionPrompt`; вкладка «Общий» (`generalPath`); `kb-catalog.js` `searchTypicalSolutions` |
| Онбординг / доступ сотрудника | `../GLPI/server/src/onboarding.js`, правило `onboarding` в `classify.js` |
| OCR вложений GLPI | `../GLPI/server/src/image-ocr.js` → `completeLlm` / `completeWithPool` (`llmOcrProvider` или основной); `documents.js` `listTicketImageFiles`; заметка `ocr-followup.js` |
| Обучение маршрутизации | `../GLPI/server/src/ai-prompt.js` `learnFromApply`, `routing-feedback.js` |
| Настройки GLPI | `../GLPI/server/src/settings.js`, форма `client/src/App.jsx`; `GET/PUT /settings` (**admin**) |
| Справочники секторов/категорий | `../GLPI/server/src/glpi-directories.js`, `glpi-directories-worker.js`; UI `GlpiDirectoriesPanel.jsx`; API `/glpi-directories*` (**admin**) |
| Журнал GLPI | `../GLPI/server/src/activity-log.js`, `activity-log-export.js`, `GET /logs`, `GET /logs/export`; UI `client/src/Logs.jsx`, `api.downloadLogsExport` |
| Подписи писем GLPI | `../GLPI/server/src/message-parse.js`, `uit.js` `htmlToText`, `TicketThread.jsx` |
| SLA / НСИ / группы | `../GLPI/server/src/assign-catalog.js`, `sla-catalog.js` |
| Gemini / fallback моделей | `../GLPI/server/src/gemini.js`, `llm-analyze.js`, настройки `App.jsx` |
| Пул ключей / провайдеры ИИ | `../GLPI/server/src/llm-keys.js`, `llm-provider.js`, `llm-providers/`; UI `LlmKeysPanel.jsx` (список + модалка добавления); API `/llm-keys` (**admin**) |
| Промпты / каталог решений | `../GLPI/server/src/ai-prompt.js`, `kb-catalog.js`, `PromptEditor.jsx` (**admin**); заготовки `prompts/` |
| Автозаказ ТМЦ | `../Учет ТМЦ/client/src/pages/AutoOrderPage.jsx`, `AutoOrderDetailPage.jsx`, `ttnRecognize.js`; `server/src/routes/autoOrder.js`, `receipts.js`, `orderTransit.js` |
| Вёрстка iframe | `Layout.jsx` / `index.css` ТМЦ; `styles.css` CompUsers, Citrix, EquipmentMove; оболочка `client/src/styles.css`, `AppFramePage.tsx` |
| Перемещение оборудования | `../EquipmentMove/client/src/App.jsx`, `server/src/routes.js`, `search.js` |
| База знаний (файлы) | `../Instructions/server/index.js` |
| Карточки KB для GLPI | `../KnowledgeBase/server/src/kb-data.js` |
| Порт шлюза | только `ADMIN_PORT` |
| Файрвол LAN | `scripts/open-network-access.ps1` |
| Лаунчер | `Запустить AdminPanel.bat` |
