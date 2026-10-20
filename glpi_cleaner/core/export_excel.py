"""Выгрузка журнала удалённых заявок в Excel."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from .config_manager import load_config
from .deletion_journal import DEFAULT_COLUMNS, query_records
from .logger import get_logger
from .smb_access import ensure_writable_path


COLUMN_LABELS = {
    "ticket_id": "№ заявки GLPI",
    "deleted_at": "Дата удаления",
    "status": "Статус",
    "opened": "Дата открытия",
    "title": "Тема",
    "sector": "Сектор",
    "requester": "Инициатор",
    "force_purge": "Безвозвратно",
    "source": "Источник",
}


def _columns(config: dict) -> list[str]:
    cols = (config.get("export") or {}).get("columns") or DEFAULT_COLUMNS
    return [str(c) for c in cols]


def build_filename(template: str, when: datetime | None = None) -> str:
    when = when or datetime.now()
    name = template or "deleted_tickets_{datetime}.xlsx"
    name = name.replace("{datetime}", when.strftime("%Y-%m-%d_%H-%M"))
    name = name.replace("{date}", when.strftime("%Y-%m-%d"))
    if not name.lower().endswith(".xlsx"):
        name += ".xlsx"
    return name


def folder_name_for_date(deleted_at: str, fmt: str) -> str:
    text = str(deleted_at or "")[:10]
    try:
        dt = datetime.strptime(text, "%Y-%m-%d")
        return dt.strftime(fmt or "%Y-%m-%d")
    except ValueError:
        return datetime.now().strftime(fmt or "%Y-%m-%d")


def export_to_xlsx(
    rows: list[dict[str, Any]],
    target_file: Path,
    columns: list[str] | None = None,
) -> Path:
    try:
        from openpyxl import Workbook
    except ImportError as exc:
        raise RuntimeError("Установите openpyxl: pip install openpyxl") from exc

    cols = columns or DEFAULT_COLUMNS
    wb = Workbook()
    ws = wb.active
    ws.title = "Удалённые"
    ws.append([COLUMN_LABELS.get(c, c) for c in cols])
    for row in rows:
        ws.append([row.get(c, "") for c in cols])
    target_file.parent.mkdir(parents=True, exist_ok=True)
    # конфликт имён
    final = target_file
    if final.exists():
        stem, suf = final.stem, final.suffix
        n = 2
        while final.exists():
            final = final.with_name(f"{stem}({n}){suf}")
            n += 1
    wb.save(final)
    return final


def export_journal(
    config: dict | None = None,
    *,
    filters: dict | None = None,
    manual_path: str | None = None,
) -> Path:
    """
    Выгрузка журнала.
    Если manual_path задан — один файл туда.
    Иначе — base_path / <дата> / filename (группы по дате удаления).
    """
    cfg = config or load_config()
    exp = cfg.get("export") or {}
    log = get_logger()
    filters = filters or {}
    rows = query_records(config=cfg, **filters)
    cols = _columns(cfg)

    if manual_path:
        target = Path(manual_path)
        if target.is_dir() or str(manual_path).endswith(("/", "\\")):
            fname = build_filename(str(exp.get("filename_template") or ""))
            target = Path(manual_path) / fname
        with ensure_writable_path(str(target.parent), cfg) as base:
            out = export_to_xlsx(rows, Path(base) / target.name, cols)
        log.info("Excel выгружен: %s (записей: %s)", out, len(rows))
        return out

    base_path = str(exp.get("base_path") or "").strip()
    if not base_path:
        raise RuntimeError("Не задан export.base_path — укажите путь сохранения")

    folder_fmt = str(exp.get("folder_date_format") or "%Y-%m-%d")
    template = str(exp.get("filename_template") or "deleted_tickets_{datetime}.xlsx")

    # Группировка по дате удаления
    by_day: dict[str, list[dict]] = {}
    for row in rows:
        key = folder_name_for_date(str(row.get("deleted_at") or ""), folder_fmt)
        by_day.setdefault(key, []).append(row)

    if not by_day:
        # пустой журнал — один файл за сегодня
        key = datetime.now().strftime(folder_fmt)
        by_day[key] = []

    last_out: Path | None = None
    with ensure_writable_path(base_path, cfg) as base:
        base_p = Path(base)
        for day, day_rows in sorted(by_day.items()):
            fname = build_filename(template)
            out = export_to_xlsx(day_rows, base_p / day / fname, cols)
            last_out = out
            log.info("Excel: %s (%s записей)", out, len(day_rows))
    assert last_out is not None
    return last_out


def run_scheduled_export(config: dict | None = None) -> Path | None:
    cfg = config or load_config()
    exp = cfg.get("export") or {}
    if not exp.get("enabled"):
        return None
    scope = str(exp.get("scope") or "all")
    filters: dict[str, Any] = {}
    if scope == "last_n_days":
        n = max(1, int(exp.get("last_n_days") or 1))
        from datetime import timedelta

        start = (datetime.now() - timedelta(days=n)).strftime("%Y-%m-%d")
        filters["date_from"] = start
    elif scope == "since_last":
        # упрощённо: за сегодня
        filters["date_from"] = datetime.now().strftime("%Y-%m-%d")
    return export_journal(cfg, filters=filters)
