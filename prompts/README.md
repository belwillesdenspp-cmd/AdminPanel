# Промпты AI-агентов по секторам УИТ

Секторные промпты собраны из master-файла [`prompt_ai_agent_routing.md`](prompt_ai_agent_routing.md).

**Маршрутизация GLPI (LLM):** файл из вкладки «Общий». Стандартный путь — [`routing-compact.md`](routing-compact.md). Master в анализ не идёт, пока его не укажут в этом поле.

**Каталог типовых решений:** [`catalog-typical-solutions.md`](catalog-typical-solutions.md) — **СРИСиС**, **НСИ**, **САКПО** + таблица **L2** (разводка группы «ОРиСИТ»).

**Автозакрытие L1/L2:** [`prompt_ai_agent_routing.md`](prompt_ai_agent_routing.md) — раздел «Автозакрытие типовых заявок».

| Файл | Сектор |
|---|---|
| [`sector_SPP.md`](sectors/sector_SPP.md) | СПП — L1, автозакрытие шаблонами |
| [`sector_SOKS.md`](sectors/sector_SOKS.md) | СОКС — кассы, весы, эквайринг, ТСД |
| [`sector_SASITI.md`](sectors/sector_SASITI.md) | САСиТИ — сеть, Wi‑Fi, телефония |
| [`sector_SAPO.md`](sectors/sector_SAPO.md) | САПО — серверы, AD, доступы, Lotus |
| [`sector_SRISIS.md`](sectors/sector_SRISIS.md) | СРИСиС — L2: цены, ЭТТН, 1С |
| [`sector_SAISPS.md`](sectors/sector_SAISPS.md) | САиСПС — L2: GUI LSF, права форм |
| [`sector_SAKPO.md`](sectors/sector_SAKPO.md) | САКПО — L2: пик-лист, КСО, Set10 |
| [`sector_NSI.md`](sectors/sector_NSI.md) | НСИ — карточки, ПСЦ, GTIN, стоп-лист |
| [`sector_SPOP.md`](sectors/sector_SPOP.md) | СПОП — ремонт принтеров/МФУ (Минск) |
| [`sector_ORPOIP.md`](sectors/sector_ORPOIP.md) | ОРПОиП — разработка LSF, Gedemin, ABM |

**Когда что использовать**

- **Первичный анализ / назначение в GLPI** — файл из вкладки «Общий» (`compiledPromptText`). Стандартный путь — `routing-compact.md`, путь можно сменить в настройках.
- **Полный master** — `prompt_ai_agent_routing.md`: источник секторных файлов и справочник. В анализ не уходит, пока его не укажут во вкладке «Общий».
- **Агент сектора** (чат, консультация, `solveWithLlm`) — файл из `sectors/`.
- **Правки правил назначения** — сначала **`routing-compact.md`** (только сжатые формулировки, без раздувания). Полные кейсы, таблицы и каталог — **`prompt_ai_agent_routing.md`**, **`catalog-typical-solutions.md`**, **`sectors/`**.

Инструкции приложения «База знаний»: `M:\Документы\Инструкции\Мои инструкции`.
