"""Чистое рабочее время: пн–пт, без обеда, без выходных и праздников."""

from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo


def _parse_hhmm(value: str) -> time:
    text = str(value or "").strip()
    parts = text.split(":")
    if len(parts) < 2:
        raise ValueError(f"Ожидалось ЧЧ:ММ, получено {value!r}")
    return time(int(parts[0]), int(parts[1]))


def _holiday_set(holidays) -> set:
    out = set()
    for item in holidays or []:
        if hasattr(item, "year") and hasattr(item, "month"):
            out.add(item)
            continue
        out.add(datetime.strptime(str(item)[:10], "%Y-%m-%d").date())
    return out


def _zone(schedule: dict, sample: datetime):
    name = str((schedule or {}).get("timezone") or "").strip()
    if name:
        return ZoneInfo(name)
    if sample.tzinfo is not None:
        return sample.tzinfo
    return None


def _align(dt: datetime, tz):
    if tz is None:
        return dt.replace(tzinfo=None)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _at(day, clock: time, tz) -> datetime:
    return datetime.combine(day, clock, tzinfo=tz)


def _overlap_hours(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> float:
    start = max(a0, b0)
    end = min(a1, b1)
    if end <= start:
        return 0.0
    return (end - start).total_seconds() / 3600.0


def net_working_hours(start_dt, end_dt, pending_hours, schedule, holidays) -> float:
    """Часы внутри рабочих окон минус Pending. Конец не позже начала → 0."""
    if start_dt is None or end_dt is None:
        return 0.0
    schedule = schedule or {}
    tz = _zone(schedule, start_dt if isinstance(start_dt, datetime) else end_dt)
    start = _align(start_dt, tz)
    end = _align(end_dt, tz)
    if end <= start:
        return 0.0

    workdays = set(schedule.get("workdays", [0, 1, 2, 3, 4]))
    work_start = _parse_hhmm(schedule.get("work_start", "08:30"))
    work_end = _parse_hhmm(schedule.get("work_end", "17:30"))
    lunch_start = _parse_hhmm(schedule.get("lunch_start", "13:00"))
    lunch_end = _parse_hhmm(schedule.get("lunch_end", "13:45"))
    off = _holiday_set(holidays if holidays is not None else schedule.get("holidays"))

    gross = 0.0
    day = start.date()
    last = end.date()
    if (last - day).days > 366 * 5:
        raise ValueError("Интервал длиннее 5 лет — проверьте даты заявки")
    while day <= last:
        if day.weekday() in workdays and day not in off:
            window_start = max(start, _at(day, work_start, tz))
            window_end = min(end, _at(day, work_end, tz))
            if window_end > window_start:
                gross += _overlap_hours(
                    window_start, window_end, _at(day, work_start, tz), _at(day, lunch_start, tz)
                )
                gross += _overlap_hours(
                    window_start, window_end, _at(day, lunch_end, tz), _at(day, work_end, tz)
                )
        day += timedelta(days=1)

    pending = max(0.0, float(pending_hours or 0))
    return max(0.0, gross - pending)
