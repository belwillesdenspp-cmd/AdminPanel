# Мультипровайдер ИИ и пул ключей

Документ этапа 1. Выбранный вариант: тонкие адаптеры (A), файловое шифрованное хранилище (H1), приоритетный список ключей (S1), C2 только после исчерпания контура основной + резерв.

## 1. Как устроена интеграция сейчас

Единая точка вызова — `complete()` в `../GLPI/server/src/llm-analyze.js`:

- `llmProvider === gemini` (или ключ `AQ.*` / URL Google) → `gemini.js` `generateContent` на `https://generativelanguage.googleapis.com/v1beta` (AI Studio).
- иначе → OpenAI-совместимый `POST {llmUrl}/chat/completions`. В `settings.js` значения `openrouter` и `ollama` схлопываются в `openai`.

Кто вызывает LLM:

- маршрутизация и решение: `analyzeWithLlm` / `solveWithLlm`;
- OCR: `image-ocr.js` — всегда `geminiCompleteWithFallback` + `inlineData`, даже если выбран OpenAI;
- дашборд: `summary-llm.js`;
- кнопка «Проверить»: `testLlmConnection`; список моделей: `GET /models` Gemini.

Хранение ключа:

- одно поле `llmApiKey` в `../GLPI/server/data/settings.json` открытым текстом;
- запас: `GLPI_LLM_API_KEY` / `GEMINI_API_KEY`;
- `GET /settings` отдаёт ключ на клиент целиком.

Ошибка лимита (Gemini): HTTP 429, `RESOURCE_EXHAUSTED`, текст `quota|rate limit`. Класс `LlmQuotaError`. Дальше меняется модель на том же ключе (`GEMINI_FALLBACK_MODELS`), не ключ.

«ИИ недоступен» (C2) — `llm-health.js`:

- 3 подряд сбоя (сеть, таймаут, 5xx, 401/403, квота) → `unavailable`;
- заявки не анализируются, автоназначение стоп;
- опрос только в этом состоянии, lease `llm-health`: Gemini `GET /models` (0 токенов), OpenAI `GET /models` иначе chat `max_tokens=1`;
- после восстановления — `resumeInboxBacklog`.

Повтор сети в `geminiFetch`: 2 попытки с паузой 800 мс. Это не пул ключей.

Итог: два протокола уже есть, но один ключ, один активный провайдер, квота = смена модели или C2.

## 2. Варианты архитектуры провайдеров

### A. Универсальный слой-адаптер (выбран)

Общий интерфейс: `complete`, `listModels`, `probe`, `classifyError`, флаги `supportsVision` / `supportsJson`. Реализации: `gemini` и `openai-compat`. Новый вендор с тем же REST — строка в каталоге. Иной протокол — новый адаптер.

Плюсы: OCR/health/пул не знают про Google; провайдеры не смешиваются; тестируется моком.  
Минусы: каркас и миграция вызовов.

### B. Параметризация текущего клиента

Расширить `if (isGeminiProvider)` без интерфейса. Меньше кода, но OCR останется особым случаем, третий протокол раздует `complete()`.

### C. Несколько независимых пайплайнов

Отдельные пути «анализ Gemini» / «анализ OpenAI». Не предлагается: дубли и рассинхрон промптов.

Различия, учтённые в адаптере:

- Gemini: свой JSON, vision через `inlineData`, health = `GET /models`, квота 429/`RESOURCE_EXHAUSTED`.
- OpenAI / OpenRouter / совместимые: `chat/completions`, картинки как `image_url`, health = `GET /models`, 429 + `Retry-After`.
- Ollama: часто без ключа, `/models` или `/api/tags`.

Из коробки: Gemini и OpenAI-compatible. Anthropic — отдельный адаптер позже.

## 3. Пул ключей (выбрано)

Ключ всегда привязан к `providerId`. Смена ключа ≠ смена провайдера.

**Хранение H1.** Файл `../GLPI/server/data/llm-keys.json`: метаданные открыто, секрет — AES-256-GCM (как `fusionCredentials.js`). Мастер-ключ: `GLPI_SECRETS_KEY` / `JWT_SECRET`. В API — только маска. Старый `llmApiKey` мигрирует при старте и вычищается из `settings.json`.

**Стратегия S1.** Приоритетный список. Квота → ключ `exhausted` до `Retry-After` или 60 мин → тот же запрос на следующий ключ того же провайдера. Лог: `provider`, `keyId`, причина, без секрета.

Смена модели Gemini остаётся внутри текущего ключа. Сначала модели, потом следующий ключ.

Провайдер: основной + необязательный резервный. Не перебирать все заведённые сервисы молча.

**C2.** Пул — первая линия. Глобальная недоступность — когда исчерпаны все ключи используемого контура (основной + резерв, если задан). Опрос: `GET /models` по первому не-exhausted ключу контура.

## 4. Экран управления ключами

Отдельная панель в настройках GLPI (админ).

Список: название, провайдер, маска, приоритет, статус, «до» (если лимит), последняя ошибка, дата проверки.

Статусы по последнему факту: не проверялся / доступен / лимит до HH:MM / ошибка.

Действия: добавить, изменить (пустой секрет = не менять), удалить, вверх/вниз, «Проверить» = `probe` / `GET /models`.

## 5. Рекомендация

Провайдеры — A. Ключи — H1 + S1. C2 — только после исчерпания контура.

Поведение без новых настроек: миграция текущего `llmApiKey` в пул Gemini с приоритетом 1, провайдер и модель как сейчас, fallback моделей включён, OCR на Gemini, если у провайдера есть vision.

## 6. Риски и файлы

Риски: OCR без vision на резерве; 429 ≠ конец дня (`exhaustedUntil`); `GET /settings` не должен отдавать секрет; смена `GLPI_SECRETS_KEY` после миграции; квота на уровне проекта Google, не ключа.

Файлы: `llm-provider.js`, `llm-keys.js`, `llm-providers/gemini.js`, `llm-providers/openai.js`, `LlmKeysPanel.jsx`; правки `llm-analyze.js`, `gemini.js`, `image-ocr.js`, `llm-health.js`, `settings.js`, `routes.js`, `App.jsx`, `api.js`, `CONTEXT.md`.

## Допущения

- OpenRouter/Ollama — семейство `openai-compat`.
- Резервный провайдер только если явно выбран.
- Шифрование на сервере GLPI, не в SQLite AdminPanel.
- Статус ключа — по ошибке реального запроса или ручной «Проверить».
- Anthropic и прочие — не в первой поставке.
