# Установка на Linux

## Вариант A. Бинарник PyInstaller

На машине со сборкой:

```bash
cd glpi_cleaner
chmod +x build_linux.sh
./build_linux.sh
```

На сервере:

```bash
sudo mkdir -p /opt/glpi-cleaner
sudo cp dist/glpi-cleaner-cli /opt/glpi-cleaner/
sudo cp config.json /opt/glpi-cleaner/
sudo mkdir -p /opt/glpi-cleaner/logs
```

Проверка:

```bash
/opt/glpi-cleaner/glpi-cleaner-cli --once --dry-run
```

## Вариант B. Python из исходников

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-venv
cd /opt
sudo mkdir glpi-cleaner && sudo chown "$USER" glpi-cleaner
# скопируйте файлы проекта в /opt/glpi-cleaner
cd /opt/glpi-cleaner
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python cli.py --once --dry-run
```

Для службы укажите в unit-файле:

```
ExecStart=/opt/glpi-cleaner/.venv/bin/python /opt/glpi-cleaner/cli.py --daemon
```

## systemd

1. Создайте пользователя (если ещё нет):

```bash
sudo useradd -r -s /usr/sbin/nologin glpi-cleaner || true
sudo chown -R glpi-cleaner:glpi-cleaner /opt/glpi-cleaner
```

2. Установите unit:

```bash
sudo cp /opt/glpi-cleaner/glpi-cleaner.service /etc/systemd/system/
# при необходимости отредактируйте ExecStart под python или бинарник
sudo systemctl daemon-reload
sudo systemctl enable --now glpi-cleaner
sudo systemctl status glpi-cleaner
```

3. Логи:

```bash
sudo journalctl -u glpi-cleaner -f
tail -f /opt/glpi-cleaner/logs/glpi_cleaner.log
```

## cron (разовый запуск)

```bash
crontab -e
```

Строка:

```cron
0 0 * * * /opt/glpi-cleaner/glpi-cleaner-cli --once >> /opt/glpi-cleaner/logs/cron.log 2>&1
```

Или с venv:

```cron
0 0 * * * /opt/glpi-cleaner/.venv/bin/python /opt/glpi-cleaner/cli.py --once >> /opt/glpi-cleaner/logs/cron.log 2>&1
```

## GUI на Linux

Нужен tkinter:

```bash
sudo apt install -y python3-tk
python3 main.py
```

На «чистом» сервере без рабочего стола используйте только `cli.py`.
