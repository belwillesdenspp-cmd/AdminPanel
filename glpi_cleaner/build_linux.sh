#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Установка зависимостей ==="
python3 -m pip install -r requirements.txt

echo "=== Сборка GUI ==="
python3 -m PyInstaller --noconfirm --clean --onefile --windowed \
  --name GLPI_Cleaner \
  --add-data "config.json:." \
  main.py

echo "=== Сборка CLI ==="
python3 -m PyInstaller --noconfirm --clean --onefile --console \
  --name glpi-cleaner-cli \
  --add-data "config.json:." \
  cli.py

echo
echo "Готово. Бинарники: dist/GLPI_Cleaner и dist/glpi-cleaner-cli"
echo "Скопируйте их вместе с config.json в одну папку."
