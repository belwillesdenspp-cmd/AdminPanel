#!/usr/bin/env python3
"""Headless-режим: один прогон или демон по расписанию.

Примеры:
  python cli.py --once
  python cli.py --daemon
  python cli.py --once --config /path/to/config.json
"""

from __future__ import annotations

import argparse
import signal
import sys
from pathlib import Path

# Чтобы импорты работали и из исходников, и из PyInstaller
if getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(sys.executable).resolve().parent))
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.cleaner import TicketCleaner
from core.config_manager import load_config, save_config
from core.logger import get_logger, setup_logging
from core.scheduler import CleanerScheduler


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="GLPI Cleaner — удаление устаревших заявок без графического окна",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--once",
        action="store_true",
        help="Один запуск очистки и выход (для cron / Task Scheduler)",
    )
    group.add_argument(
        "--daemon",
        action="store_true",
        help="Работать постоянно по расписанию из config.json",
    )
    group.add_argument(
        "--export-once",
        action="store_true",
        help="Один раз выгрузить журнал удалённых заявок в Excel и выйти",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Путь к config.json (по умолчанию — рядом с программой)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Принудительно только предпросмотр (ничего не удалять)",
    )
    parser.add_argument(
        "--no-dry-run",
        action="store_true",
        help="Принудительно выполнить удаление (игнорирует dry_run в конфиге)",
    )
    return parser.parse_args(argv)


def run_once(config: dict, dry_run_override: bool | None = None) -> int:
    log = get_logger()
    config = dict(config)
    config["runtime"] = {**(config.get("runtime") or {}), "source": "cli"}
    cleaner = TicketCleaner(config)
    try:
        result = cleaner.run(dry_run_override=dry_run_override)
        log.info(result.message)
        print(result.message)
        return 0 if result.errors == 0 else 2
    except Exception as exc:
        log.exception("Ошибка очистки: %s", exc)
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1


def run_export(config: dict) -> int:
    from core.export_excel import run_scheduled_export

    log = get_logger()
    try:
        out = run_scheduled_export(config)
        if out is None:
            log.info("Автовыгрузка отключена")
            return 0
        log.info("Автовыгрузка: %s", out)
        print(f"Выгружено: {out}")
        return 0
    except Exception as exc:
        log.exception("Ошибка выгрузки: %s", exc)
        print(f"Ошибка выгрузки: {exc}", file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config_path = Path(args.config) if args.config else None
    config = load_config(config_path)

    logging_cfg = config.get("logging") or {}
    setup_logging(
        level=str(logging_cfg.get("level") or "INFO"),
        max_bytes=int(logging_cfg.get("max_bytes") or 5_000_000),
        backup_count=int(logging_cfg.get("backup_count") or 5),
    )
    log = get_logger()

    dry_override: bool | None = None
    if args.dry_run:
        dry_override = True
    elif args.no_dry_run:
        dry_override = False

    if args.once:
        log.info("Режим --once")
        return run_once(config, dry_run_override=dry_override)

    if args.export_once:
        log.info("Режим --export-once")
        # принудительно выполнить выгрузку даже если export.enabled=false
        config = dict(config)
        export = dict(config.get("export") or {})
        export["enabled"] = True
        config["export"] = export
        return run_export(config)

    # daemon
    schedule = config.get("schedule") or {}
    if not schedule.get("enabled", False):
        log.warning("В config.json schedule.enabled=false — включаю для daemon-режима")
        schedule["enabled"] = True
        config["schedule"] = schedule
        if config_path is None:
            save_config(config)

    scheduler = CleanerScheduler(blocking=True)

    def job() -> None:
        cfg = load_config(config_path)
        cfg = dict(cfg)
        cfg["runtime"] = {**(cfg.get("runtime") or {}), "source": "daemon"}
        run_once(cfg, dry_run_override=dry_override)

    def export_job() -> None:
        cfg = load_config(config_path)
        run_export(cfg)

    def _shutdown(signum, frame) -> None:  # noqa: ARG001
        log.info("Получен сигнал %s — останавливаем…", signum)
        scheduler.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    log.info("Режим --daemon")
    export_cfg = config.get("export") or {}
    scheduler.run_forever(schedule, job, export_cfg=export_cfg, export_job=export_job)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
