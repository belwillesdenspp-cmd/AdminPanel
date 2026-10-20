"""Метрики по уже посчитанному чистому времени. Модель не вызывается."""

from __future__ import annotations

import math
from collections import defaultdict

from core.working_time import net_working_hours


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * p
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return ordered[int(rank)]
    weight = rank - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def evaluate_ticket(raw: dict, schedule: dict, holidays, sla_hours: float, done_statuses: set[int]) -> dict:
    warning = ""
    net = None
    status = int(raw.get("status") or 0)
    opened = raw.get("opened")
    end = raw.get("end")
    finished = status in done_statuses
    if finished:
        if opened is None or end is None or end <= opened:
            warning = "пустая или неверная дата решения"
        else:
            net = net_working_hours(
                opened,
                end,
                raw.get("pending_hours") or 0,
                schedule,
                holidays,
            )
    over = bool(net is not None and net > sla_hours)
    return {
        **raw,
        "net_hours": net,
        "over_sla": over,
        "excess_hours": (net - sla_hours) if over else 0.0,
        "warning": warning,
        "included": finished and net is not None and not warning,
        "open": not finished,
        "pending_not_deducted": raw.get("pending_source") == "missing",
    }


def summarize(rows: list[dict], sla_hours: float) -> dict:
    done = [row for row in rows if row.get("included")]
    times = [float(row["net_hours"]) for row in done]
    over = [row for row in done if row["over_sla"]]
    n = len(times)
    excesses = [float(row["excess_hours"]) for row in over]
    record = max(over, key=lambda row: row["excess_hours"]) if over else None
    weeks = defaultdict(list)
    months = defaultdict(list)
    for row in done:
        end = row.get("end")
        if end is None:
            continue
        weeks[f"{end.isocalendar().year}-W{end.isocalendar().week:02d}"].append(row["net_hours"])
        months[end.strftime("%Y-%m")].append(row["net_hours"])

    def bucket(groups):
        return [
            {
                "period": key,
                "count": len(vals),
                "avg_hours": sum(vals) / len(vals),
                "over_sla": sum(1 for value in vals if value > sla_hours),
            }
            for key, vals in sorted(groups.items())
        ]

    return {
        "n": n,
        "open_count": sum(1 for row in rows if row.get("open")),
        "skipped": sum(1 for row in rows if row.get("warning")),
        "avg_hours": (sum(times) / n) if n else None,
        "over_count": len(over),
        "over_share_pct": (len(over) / n * 100.0) if n else None,
        "avg_excess": (sum(excesses) / len(excesses)) if excesses else None,
        "max_excess": record["excess_hours"] if record else None,
        "max_excess_id": record["id"] if record else None,
        "median": percentile(times, 0.5),
        "p90": percentile(times, 0.9),
        "p95": percentile(times, 0.95),
        "min_hours": min(times) if times else None,
        "max_hours": max(times) if times else None,
        "weeks": bucket(weeks),
        "months": bucket(months),
    }
