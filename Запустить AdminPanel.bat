@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul
title AdminPanel

where npm >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js / npm не найдены. Установите Node.js и повторите запуск.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-folder-opener.ps1" >nul 2>&1

curl.exe -fsS --max-time 2 "http://127.0.0.1:4000/api/health" >nul 2>&1
if not errorlevel 1 (
  echo AdminPanel уже запущен — открываю браузер.
  start "" "http://localhost:4000"
  timeout /t 2 /nobreak >nul
  exit /b 0
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  echo Порт 4000 занят, но AdminPanel не отвечает.
  echo Закройте процесс на этом порту или задайте другой ADMIN_PORT.
  pause
  exit /b 1
)

if not exist "server\node_modules\express\package.json" (
  echo Установка зависимостей...
  call npm run install:all
  if errorlevel 1 (
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)

if not exist "client\dist\index.html" (
  echo Сборка интерфейса оболочки...
  call npm run build
  if errorlevel 1 (
    echo Не удалось собрать клиент. Без client\dist шлюз стартует без UI.
    pause
    exit /b 1
  )
)

echo Запуск AdminPanel на http://localhost:4000
echo Не закрывайте это окно, пока работает панель.
echo Остановка: Ctrl+C или закрытие окна.
echo.

set "ADMIN_PORT=4000"
set "HOST=0.0.0.0"
set "PORT="
set "SUPERVISOR="

start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "for ($i=0; $i -lt 90; $i++) { try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4000/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process 'http://localhost:4000'; break } } catch {} Start-Sleep -Seconds 1 }"

call npm start
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo AdminPanel завершился с ошибкой %EXITCODE%.
) else (
  echo AdminPanel остановлен.
)
pause
exit /b %EXITCODE%
