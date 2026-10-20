"""Загрузка и сохранение config.json рядом с исполняемым файлом."""

from __future__ import annotations

import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "glpi": {
        "url": "https://support.example.com/apirest.php",
        "app_token": "",
        "user_token": "",
        "verify_ssl": True,
        "timeout": 120,
    },
    "deletion": {
        "max_age_value": 1,
        "max_age_unit": "years",
        "date_field": "date",
        "statuses": [5, 6],
        "category_ids": [],
        "requester_ids": [],
        "force_purge": False,
        "dry_run": True,
        "batch_size": 50,
        "page_size": 1000,
    },
    "schedule": {
        "enabled": False,
        "mode": "daily",
        "time": "00:00",
        "interval_hours": 24,
        "day_of_week": "mon",
        "day_of_month": 1,
    },
    "journal": {
        "enabled": True,
        "path": "data/deleted_tickets.jsonl",
    },
    "export": {
        "enabled": False,
        "mode": "daily",
        "time": "23:30",
        "day_of_week": "mon",
        "interval_hours": 24,
        "scope": "all",
        "last_n_days": 1,
        "base_path": "",
        "folder_date_format": "%Y-%m-%d",
        "filename_template": "deleted_tickets_{datetime}.xlsx",
        "columns": [
            "ticket_id",
            "deleted_at",
            "status",
            "opened",
            "title",
            "sector",
            "requester",
            "force_purge",
            "source",
        ],
        "smb": {
            "username": "",
            "password_enc": "",
            "domain": "",
        },
    },
    "logging": {
        "level": "INFO",
        "max_bytes": 5_000_000,
        "backup_count": 5,
    },
}

# Поля даты GLPI: имя → search field id
DATE_FIELD_MAP = {
    "date": 15,  # дата открытия
    "date_creation": 15,
    "date_mod": 19,  # дата изменения
}

STATUS_LABELS = {
    1: "Новая",
    2: "В работе (назначена)",
    3: "В работе (запланирована)",
    4: "Ожидание",
    5: "Решена",
    6: "Закрыта",
}


def app_dir() -> Path:
    """Каталог рядом с .exe (PyInstaller) или с исходниками."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def config_path() -> Path:
    return app_dir() / "config.json"


def logs_dir() -> Path:
    path = app_dir() / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def deep_merge(base: dict, patch: dict) -> dict:
    result = deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config(path: Path | None = None) -> dict[str, Any]:
    target = path or config_path()
    if not target.exists():
        cfg = deepcopy(DEFAULT_CONFIG)
        save_config(cfg, target)
        return cfg
    with target.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)
    return deep_merge(DEFAULT_CONFIG, raw)


def save_config(config: dict[str, Any], path: Path | None = None) -> Path:
    target = path or config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return target


def mask_secret(value: str, keep: int = 4) -> str:
    s = str(value or "")
    if len(s) <= keep:
        return "***" if s else ""
    return f"{'*' * (len(s) - keep)}{s[-keep:]}"
