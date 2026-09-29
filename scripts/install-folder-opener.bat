@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-folder-opener.ps1"
if errorlevel 1 (
  echo Не удалось установить помощник открытия папок.
  pause
  exit /b 1
)
echo.
echo Готово. Папки пользователей будут открываться на этом компьютере.
if /I "%~1"=="/silent" exit /b 0
pause
