"""Pending: поле waiting_duration, иначе интервалы статуса 4 в журнале."""

from __future__ import annotations

import re

_STATUS_NUM = re.compile(r"\((\d+)\)\s*$")


def seconds_to_hours(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value) / 3600.0
    except (TypeError, ValueError):
        return None


def status_code(value) -> int | None:
    text = str(value or "").strip()
    if text.isdigit():
        return int(text)
    match = _STATUS_NUM.search(text)
    if match:
        return int(match.group(1))
    return None


def pending_hours_from_log(rows, parse_dt) -> float:
    """Сумма сырых часов в статусе 4 между соседними записями журнала."""
    events = []
    for row in rows or []:
        option = row.get("id_search_option") or row.get("field")
        if str(option) not in {"12", "status"}:
            continue
        code = status_code(row.get("new_value"))
        moment = parse_dt(row.get("date_mod") or row.get("date"))
        if code is None or moment is None:
            continue
        events.append((moment, code))
    events.sort(key=lambda item: item[0])
    total = 0.0
    opened = None
    for moment, code in events:
        if code == 4 and opened is None:
            opened = moment
        elif code != 4 and opened is not None:
            if moment > opened:
                total += (moment - opened).total_seconds() / 3600.0
            opened = None
    return total
