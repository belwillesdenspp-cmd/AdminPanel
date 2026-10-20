# Установка через Docker

## Требования

- Docker Engine
- Docker Compose (плагин `docker compose` или классический `docker-compose`)

## Быстрый старт

1. Отредактируйте `config.json` на хосте: URL, токены, правила.  
   Сначала оставьте `"dry_run": true`.
2. Из папки `glpi_cleaner`:

```bash
docker compose up -d --build
```

3. Логи:

```bash
docker logs -f glpi-cleaner
# или файл на хосте:
tail -f logs/glpi_cleaner.log
```

4. После успешного Dry-Run измените в `config.json` `"dry_run": false`, сохраните файл.  
   Контейнер подхватит настройки на следующем запуске задания (daemon перечитывает конфиг). При сомнении:

```bash
docker compose restart
```

## Разовый прогон без демона

В `docker-compose.yml` раскомментируйте/замените `command`:

```yaml
command: ["python", "cli.py", "--once", "--dry-run"]
```

Или:

```bash
docker compose run --rm glpi-cleaner python cli.py --once --dry-run
```

## Обновление

```bash
docker compose build --no-cache
docker compose up -d
```

## Тома

| Том | Назначение |
|-----|------------|
| `./config.json` → `/app/config.json` | настройки |
| `./logs` → `/app/logs` | журналы на хосте |

Не коммитьте `config.json` с реальными токенами в открытый репозиторий.
