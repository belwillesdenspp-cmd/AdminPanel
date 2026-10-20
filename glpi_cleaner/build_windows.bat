@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Установка зависимостей ===
python -m pip install -r requirements.txt
if errorlevel 1 exit /b 1

echo === Сборка GUI (GLPI_Cleaner.exe) ===
python -m PyInstaller --noconfirm --clean --onefile --windowed ^
  --name GLPI_Cleaner ^
  --add-data "config.json;." ^
  main.py
if errorlevel 1 exit /b 1

echo === Сборка CLI (glpi-cleaner-cli.exe) ===
python -m PyInstaller --noconfirm --clean --onefile --console ^
  --name glpi-cleaner-cli ^
  --add-data "config.json;." ^
  cli.py
if errorlevel 1 exit /b 1

echo.
echo Готово. Файлы в папке dist\
echo   GLPI_Cleaner.exe      — окно с вкладками
echo   glpi-cleaner-cli.exe  — серверный режим (--once / --daemon)
echo.
echo Скопируйте dist\*.exe и config.json в одну папку и запускайте.
pause
