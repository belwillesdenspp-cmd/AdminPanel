"""Календарь: пн–пт 08:30–17:30, обед 13:00–13:45 не считается."""

from datetime import datetime

from core.working_time import net_working_hours

SCHEDULE = {
    "workdays": [0, 1, 2, 3, 4],
    "work_start": "08:30",
    "work_end": "17:30",
    "lunch_start": "13:00",
    "lunch_end": "13:45",
}


def at(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M")


def hours(start: str, end: str, pending: float = 0, holidays=None) -> float:
    return net_working_hours(at(start), at(end), pending, SCHEDULE, holidays or [])


def test_same_day_without_lunch():
    # Пн 09:00–12:00 целиком до обеда.
    assert hours("2026-10-05 09:00", "2026-10-05 12:00") == 3.0


def test_crosses_lunch():
    # 12:00–13:00 = 1.0, 13:45–14:00 = 0.25.
    assert hours("2026-10-05 12:00", "2026-10-05 14:00") == 1.25


def test_crosses_night():
    # Пн 16:00–17:30 = 1.5, Вт 08:30–09:00 = 0.5.
    assert hours("2026-10-05 16:00", "2026-10-06 09:00") == 2.0


def test_crosses_weekend():
    # Пт 16:00–17:30 = 1.5, сб и вс нет, Пн 08:30–09:00 = 0.5.
    assert hours("2026-10-09 16:00", "2026-10-12 09:00") == 2.0


def test_holiday_is_skipped():
    # Понедельник в списке праздников, остаётся только вторник 08:30–10:00.
    assert hours("2026-10-05 10:00", "2026-10-06 10:00", holidays=["2026-10-05"]) == 1.5


def test_five_minutes():
    assert hours("2026-10-05 10:00", "2026-10-05 10:05") == 5 / 60


def test_two_weeks():
    # Десять полных рабочих дней (пн 05.10 … пт 16.10), утро следующего понедельника не входит.
    assert hours("2026-10-05 08:30", "2026-10-19 08:30") == 10 * 8.25


def test_pending_is_subtracted():
    # Эталон 11.5 минус 1.5 часа ожидания.
    assert hours("2026-10-05 10:00", "2026-10-06 14:00", pending=1.5) == 10.0


def test_pending_larger_than_gross_is_zero():
    assert hours("2026-10-05 10:00", "2026-10-06 14:00", pending=100) == 0.0


def test_end_before_start_is_zero():
    assert hours("2026-10-06 14:00", "2026-10-05 10:00") == 0.0


def test_known_answer_monday_to_tuesday():
    # Пн 10:00–13:00 = 3.0 и 13:45–17:30 = 3.75 → 6.75
    # Вт 08:30–13:00 = 4.5 и 13:45–14:00 = 0.25 → 4.75
    # Итого 11.5
    assert hours("2026-10-05 10:00", "2026-10-06 14:00") == 11.5


def test_full_workday_is_8_25():
    assert hours("2026-10-05 08:30", "2026-10-05 17:30") == 8.25
