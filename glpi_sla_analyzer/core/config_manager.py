"""Чтение config.json и подстановка периода из CLI."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

DEFAULTS = {
    "glpi": {
        "url": "https://support.willesden.by/apirest.php",
        "app_token": "",
        "user_token": "",
        "verify_ssl": True,
        "timeout": 30,
        "timezone": "Europe/Minsk",
    },
    "analysis": {
        "period_value": 3,
        "period_unit": "months",
        "sector_name": "НСИ",
        "sector_category_id": None,
        "statuses": [5, 6],
        "sla_hours": 8.0,
        "deduct_pending": True,
    },
    "work_schedule": {
        "workdays": [0, 1, 2, 3, 4],
        "work_start": "08:30",
        "work_end": "17:30",
        "lunch_start": "13:00",
        "lunch_end": "13:45",
        "holidays": ["2026-01-01", "2026-01-02", "2026-03-08", "2026-05-01"],
    },
    "output": {"report_path": "report.xlsx"},
}


def _merge(base: dict, extra: dict) -> dict:
    out = deepcopy(base)
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str | Path) -> dict:
    file = Path(path)
    raw = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {}
    cfg = _merge(DEFAULTS, raw)
    cfg["work_schedule"]["timezone"] = cfg["glpi"].get("timezone") or ""
    return cfg


def save_config(path: str | Path, cfg: dict) -> None:
    Path(path).write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
