# GLPI Cleaner

Портируемое приложение для автоматического удаления устаревших заявок (тикетов) из GLPI через REST API.

- **GUI** (tkinter) — для настройки на рабочем месте  
- **Фон** — кнопка «Запустить в фоне», трей, или CLI `--daemon` (окно можно закрыть)  
- **CLI** — headless-режим для сервера (`--once` / `--daemon`)  
- **Документация для новичка** — начинайте с [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

## Возможности

- Подключение к GLPI (App-Token + User-Token)
- Фильтр по возрасту заявки (дни / месяцы / годы) и статусам
- Dry-Run (предпросмотр без удаления)
- Удаление в корзину или безвозвратно (`force_purge`)
- Планировщик (APScheduler) и запуск через cron / Task Scheduler / systemd / Docker
- Портативность: папку с `.exe` и `config.json` можно скопировать на другой ПК

## Быстрый старт

```bat
cd glpi_cleaner
python -m pip install -r requirements.txt
python main.py
```

Сервер без окна:

```bat
python cli.py --once --dry-run
python cli.py --daemon
```

Сборка Windows:

```bat
build_windows.bat
```

## Документация

| Файл | Для кого |
|------|----------|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | **Главная инструкция** — с нуля за ~15 минут |
| [docs/CHEATSHEET.md](docs/CHEATSHEET.md) | Шпаргалка на одну страницу |
| [docs/FAQ.md](docs/FAQ.md) | Вопросы «а можно ли…» |
| [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md) | Windows / NSSM / Task Scheduler |
| [docs/INSTALL_LINUX.md](docs/INSTALL_LINUX.md) | Linux / systemd / cron |
| [docs/INSTALL_DOCKER.md](docs/INSTALL_DOCKER.md) | Docker Compose |

## Структура

```
glpi_cleaner/
├── main.py              # GUI
├── cli.py               # headless
├── core/                # бизнес-логика (без tkinter)
├── gui/app.py
├── config.json
├── requirements.txt
├── build_windows.bat
├── build_linux.sh
├── Dockerfile
├── docker-compose.yml
├── glpi-cleaner.service
└── docs/
```

## Безопасность по умолчанию

В `config.json`:

- `dry_run`: **true**
- `force_purge`: **false**

Перед массовым удалением сделайте резервную копию БД GLPI.

## Версии

- **v1.1** — журнал удалённых заявок, поиск/фильтр, Excel ручной/авто, UNC+SMB (пароль зашифрован)

## Пример curl

См. конец [docs/USER_GUIDE.md](docs/USER_GUIDE.md) (приложение с curl).

## Лицензия

Внутренний инструмент. Токены и URL вашей среды не храните в публичных репозиториях.
