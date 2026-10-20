"""Сценарий: конфиг → GLPI → метрики → файл."""

from __future__ import annotations

import calendar
from datetime import datetime
from pathlib import Path

from core.analyzer import evaluate_ticket, summarize
from core.exporter import write_csv, write_json, write_xlsx
from core.glpi_api import GlpiClient


def period_start(cfg: dict, since_days: int | None, now: datetime) -> datetime:
    tz = now.tzinfo
    if since_days is not None:
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        from datetime import timedelta

        return start - timedelta(days=int(since_days))
    analysis = cfg["analysis"]
    value = int(analysis.get("period_value") or 3)
    unit = str(analysis.get("period_unit") or "months")
    if unit == "days":
        from datetime import timedelta

        return now - timedelta(days=value)
    month = now.month - value
    year = now.year
    while month <= 0:
        month += 12
        year -= 1
    day = min(now.day, calendar.monthrange(year, month)[1])
    return now.replace(year=year, month=month, day=day, hour=0, minute=0, second=0, microsecond=0, tzinfo=tz)


def run_analysis(cfg: dict, log, since_days: int | None = None, dry_run: bool = False, output: str | None = None):
    client = GlpiClient(cfg["glpi"], log)
    schedule = cfg["work_schedule"]
    holidays = schedule.get("holidays") or []
    analysis = cfg["analysis"]
    sla = float(analysis.get("sla_hours") or 8)
    done = {int(item) for item in analysis.get("statuses") or [5, 6]}
    try:
        client.connect()
        now = datetime.now(client.tz) if client.tz else datetime.now()
        since = period_start(cfg, since_days, now)
        log.info("Период с %s, сектор %s", since.strftime("%Y-%m-%d"), analysis.get("sector_name"))
        found = client.search_tickets(since, analysis)
        if dry_run:
            path = Path(output or cfg["output"].get("report_path") or "report.xlsx").with_suffix(".json")
            path.write_text(
                __import__("json").dumps(found, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            log.info("Dry-run: %s заявок → %s", len(found), path)
            return {"summary": {}, "rows": found, "path": str(path), "over_count": 0}

        rows = []
        for idx, item in enumerate(found, start=1):
            raw = client.enrich(item, bool(analysis.get("deduct_pending", True)))
            rows.append(evaluate_ticket(raw, schedule, holidays, sla, done))
            if idx % 25 == 0:
                log.info("Посчитано %s / %s", idx, len(found))
        summary = summarize(rows, sla)
        path = Path(output or cfg["output"].get("report_path") or "report.xlsx")
        write_json(path.with_suffix(".json"), summary, rows)
        if path.suffix.lower() == ".csv":
            write_csv(path, rows)
        elif path.suffix.lower() == ".json":
            write_json(path, summary, rows)
        else:
            write_xlsx(path, summary, rows)
        log.info(
            "Готово: N=%s, среднее=%s, превышений=%s, файл %s",
            summary.get("n"),
            summary.get("avg_hours"),
            summary.get("over_count"),
            path,
        )
        return {"summary": summary, "rows": rows, "path": str(path), "over_count": summary.get("over_count") or 0}
    finally:
        client.close()
