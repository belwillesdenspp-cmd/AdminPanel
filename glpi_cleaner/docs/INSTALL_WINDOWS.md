# Установка на Windows

## Способ 1. Готовый `.exe` (рекомендуется)

1. Соберите проект на машине с Python (один раз):

```bat
cd glpi_cleaner
build_windows.bat
```

2. Из папки `dist\` скопируйте:
   - `GLPI_Cleaner.exe`
   - `glpi-cleaner-cli.exe`
3. Рядом положите `config.json` (из корня проекта).
4. Создайте папку `logs` (программа создаст сама при запуске).
5. Запустите `GLPI_Cleaner.exe`.

Дальше — [USER_GUIDE.md](USER_GUIDE.md), раздел 3.

## Способ 2. Из исходников

1. Установите Python 3.10+ с галочкой **Add to PATH**.
2. В командной строке:

```bat
cd /d C:\путь\к\glpi_cleaner
python -m pip install -r requirements.txt
python main.py
```

## Служба через NSSM

1. Скачайте NSSM: https://nssm.cc/download  
2. От администратора:

```bat
nssm install GLPICleaner "C:\Programs\glpi_cleaner\glpi-cleaner-cli.exe"
nssm set GLPICleaner AppParameters "--daemon"
nssm set GLPICleaner AppDirectory "C:\Programs\glpi_cleaner"
nssm start GLPICleaner
```

3. Проверка: `services.msc` → GLPICleaner.

Перед включением службы в `config.json` задайте токены, правила и при необходимости `"dry_run": false` **только после** успешного Dry-Run вручную.

## Планировщик заданий Windows

1. Создать задачу → ежедневно в нужное время.
2. Программа: полный путь к `glpi-cleaner-cli.exe`.
3. Аргументы: `--once`
4. «Начать в»: папка с `config.json`.

## Антивирус

Добавьте папку программы в исключения, если Defender блокирует свежесобранный `.exe`.
