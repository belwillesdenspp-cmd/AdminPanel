"""Журнал удалённых заявок (JSONL рядом с приложением)."""

from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from .config_manager import app_dir, load_config

_lock = threading.Lock()

DEFAULT_COLUMNS = [
    "ticket_id",
    "deleted_at",
    "status",
    "opened",
    "title",
    "sector",
    "requester",
    "force_purge",
    "source",
]


def journal_path(config: dict | None = None) -> Path:
    cfg = config or load_config()
    j = cfg.get("journal") or {}
    rel = str(j.get("path") or "data/deleted_tickets.jsonl")
    path = Path(rel)
    if not path.is_absolute():
        path = app_dir() / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def append_record(record: dict[str, Any], config: dict | None = None) -> None:
    cfg = config or load_config()
    if not (cfg.get("journal") or {}).get("enabled", True):
        return
    row = dict(record)
    row.setdefault("deleted_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    line = json.dumps(row, ensure_ascii=False)
    path = journal_path(cfg)
    with _lock:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


def append_many(records: list[dict[str, Any]], config: dict | None = None) -> int:
    cfg = config or load_config()
    if not (cfg.get("journal") or {}).get("enabled", True):
        return 0
    if not records:
        return 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    path = journal_path(cfg)
    with _lock:
        with path.open("a", encoding="utf-8") as fh:
            for record in records:
                row = dict(record)
                row.setdefault("deleted_at", now)
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(records)


def iter_records(config: dict | None = None):
    path = journal_path(config)
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _parse_dt(value: str) -> datetime | None:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


def query_records(
    *,
    ticket_id: str | int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    sector: str | None = None,
    requester: str | None = None,
    title: str | None = None,
    sort_by: str = "deleted_at",
    sort_desc: bool = True,
    config: dict | None = None,
) -> list[dict[str, Any]]:
    df = _parse_dt(date_from) if date_from else None
    dt = _parse_dt(date_to) if date_to else None
    if dt and len(str(date_to or "")) <= 10:
        dt = dt.replace(hour=23, minute=59, second=59)
    tid_filter = str(ticket_id).strip() if ticket_id not in (None, "") else ""
    sector_q = (sector or "").strip().lower()
    req_q = (requester or "").strip().lower()
    title_q = (title or "").strip().lower()

    rows: list[dict[str, Any]] = []
    for row in iter_records(config):
        if tid_filter and str(row.get("ticket_id", "")) != tid_filter:
            continue
        deleted_at = _parse_dt(str(row.get("deleted_at") or ""))
        if df and (not deleted_at or deleted_at < df):
            continue
        if dt and (not deleted_at or deleted_at > dt):
            continue
        if sector_q and sector_q not in str(row.get("sector") or "").lower():
            continue
        if req_q and req_q not in str(row.get("requester") or "").lower():
            continue
        if title_q and title_q not in str(row.get("title") or "").lower():
            continue
        rows.append(row)

    reverse = bool(sort_desc)
    if sort_by == "ticket_id":
        rows.sort(key=lambda r: int(r.get("ticket_id") or 0), reverse=reverse)
    else:
        rows.sort(key=lambda r: str(r.get("deleted_at") or ""), reverse=reverse)
    return rows


def record_from_ticket(
    ticket: dict[str, Any],
    *,
    force_purge: bool,
    source: str = "app",
) -> dict[str, Any]:
    groups = ticket.get("groups") or ticket.get("sector") or ""
    if isinstance(groups, list):
        sector = ", ".join(str(x) for x in groups)
    else:
        sector = str(groups or "")
    requester = ticket.get("requester") or ticket.get("users_id_recipient") or ""
    if isinstance(requester, dict):
        requester = requester.get("name") or requester.get("id") or ""
    return {
        "ticket_id": int(ticket.get("id") or ticket.get("ticket_id") or 0),
        "status": ticket.get("status"),
        "opened": ticket.get("date") or ticket.get("opened") or "",
        "title": ticket.get("name") or ticket.get("title") or "",
        "sector": sector,
        "requester": str(requester),
        "force_purge": bool(force_purge),
        "source": source,
    }
