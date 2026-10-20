"""Планировщик заданий APScheduler."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .logger import get_logger

JobFunc = Callable[[], None]


def _parse_hhmm(value: str) -> tuple[int, int]:
    text = str(value or "00:00").strip()
    parts = text.split(":")
    hour = int(parts[0]) if parts else 0
    minute = int(parts[1]) if len(parts) > 1 else 0
    return max(0, min(hour, 23)), max(0, min(minute, 59))


def build_trigger(schedule: dict[str, Any]):
    mode = str(schedule.get("mode") or "daily").lower()
    hour, minute = _parse_hhmm(schedule.get("time") or "00:00")

    if mode == "interval":
        hours = max(1, int(schedule.get("interval_hours") or 24))
        return IntervalTrigger(hours=hours)

    if mode == "weekly":
        dow = str(schedule.get("day_of_week") or "mon").lower()
        return CronTrigger(day_of_week=dow, hour=hour, minute=minute)

    if mode == "monthly":
        day = max(1, min(int(schedule.get("day_of_month") or 1), 28))
        return CronTrigger(day=day, hour=hour, minute=minute)

    return CronTrigger(hour=hour, minute=minute)


class CleanerScheduler:
    """Обёртка над APScheduler для GUI (background) и CLI (blocking)."""

    def __init__(self, blocking: bool = False):
        self._log = get_logger()
        self._blocking = blocking
        self._scheduler = BlockingScheduler() if blocking else BackgroundScheduler()
        self._job_id = "glpi_clean"
        self._export_job_id = "glpi_export"

    @property
    def running(self) -> bool:
        return bool(getattr(self._scheduler, "running", False))

    def _ensure_scheduler(self) -> None:
        if self._scheduler is None or getattr(self._scheduler, "state", 0) == 2:
            self._scheduler = BlockingScheduler() if self._blocking else BackgroundScheduler()

    def configure_job(self, schedule: dict[str, Any], job: JobFunc, job_id: str | None = None) -> None:
        self._ensure_scheduler()
        jid = job_id or self._job_id
        if self._scheduler.get_job(jid):
            self._scheduler.remove_job(jid)
        trigger = build_trigger(schedule)
        self._scheduler.add_job(
            job,
            trigger=trigger,
            id=jid,
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    def configure_export_job(self, export_cfg: dict[str, Any], job: JobFunc) -> None:
        if not export_cfg.get("enabled"):
            if self._scheduler and self._scheduler.get_job(self._export_job_id):
                self._scheduler.remove_job(self._export_job_id)
            return
        self.configure_job(export_cfg, job, job_id=self._export_job_id)

    def start(
        self,
        schedule: dict[str, Any],
        job: JobFunc,
        export_cfg: dict[str, Any] | None = None,
        export_job: JobFunc | None = None,
    ) -> None:
        if self._blocking:
            raise RuntimeError("Для blocking-режима используйте run_forever()")
        self.configure_job(schedule, job)
        if export_cfg is not None and export_job is not None:
            self.configure_export_job(export_cfg, export_job)
        if not self._scheduler.running:
            self._scheduler.start()
        nxt = self.next_run()
        self._log.info("Планировщик запущен. Следующая очистка: %s", nxt or "—")
        exp = self.next_export_run()
        if exp:
            self._log.info("Следующая выгрузка Excel: %s", exp)

    def run_forever(
        self,
        schedule: dict[str, Any],
        job: JobFunc,
        export_cfg: dict[str, Any] | None = None,
        export_job: JobFunc | None = None,
    ) -> None:
        self._blocking = True
        self._scheduler = BlockingScheduler()
        self.configure_job(schedule, job)
        if export_cfg is not None and export_job is not None:
            self.configure_export_job(export_cfg, export_job)
        nxt = self.next_run()
        self._log.info("Планировщик (daemon) запущен. Следующая очистка: %s", nxt or "—")
        try:
            self._scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            self.stop()

    def stop(self) -> None:
        try:
            if self._scheduler and self._scheduler.running:
                self._scheduler.shutdown(wait=False)
                self._log.info("Планировщик остановлен")
        except Exception as exc:
            self._log.debug("stop: %s", exc)
        self._scheduler = BlockingScheduler() if self._blocking else BackgroundScheduler()

    def _fmt_next(self, job_id: str) -> str | None:
        try:
            job = self._scheduler.get_job(job_id) if self._scheduler else None
        except Exception:
            return None
        if not job or not job.next_run_time:
            return None
        dt: datetime = job.next_run_time
        if dt.tzinfo:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt.strftime("%d.%m.%Y %H:%M")

    def next_run(self) -> str | None:
        return self._fmt_next(self._job_id)

    def next_export_run(self) -> str | None:
        return self._fmt_next(self._export_job_id)
