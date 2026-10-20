"""Сессия GLPI REST: поиск заявок и поля ожидания."""

from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from core.pending import pending_hours_from_log, seconds_to_hours

_RANGE_TOTAL = re.compile(r"/(\d+)\s*$")
_STATUS_IN_TEXT = re.compile(r"\((\d+)\)")


def _status_int(value) -> int:
    if isinstance(value, int):
        return value
    text = str(value or "").strip()
    if text.isdigit():
        return int(text)
    match = _STATUS_IN_TEXT.search(text)
    return int(match.group(1)) if match else 0


class GlpiError(RuntimeError):
    pass


class GlpiClient:
    def __init__(self, glpi: dict, log):
        self.url = str(glpi.get("url") or "").rstrip("/")
        self.app_token = str(glpi.get("app_token") or "")
        self.user_token = str(glpi.get("user_token") or "")
        self.verify = bool(glpi.get("verify_ssl", True))
        self.timeout = int(glpi.get("timeout") or 30)
        self.tz_name = str(glpi.get("timezone") or "").strip()
        self.log = log
        self.session = requests.Session()
        self.token = ""
        self.tz = self._timezone()

    def _timezone(self):
        if self.tz_name:
            return ZoneInfo(self.tz_name)
        self.log.warning("Часовой пояс в конфиге пуст — беру локальный")
        return datetime.now().astimezone().tzinfo

    def parse_dt(self, value):
        text = str(value or "").strip()
        if not text or text.startswith("0000"):
            return None
        text = text.replace("T", " ")[:19]
        try:
            naive = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
        if self.tz is None:
            return naive
        return naive.replace(tzinfo=self.tz)

    def close(self):
        if not self.token:
            return
        try:
            self.session.get(
                f"{self.url}/killSession",
                headers=self._headers(),
                timeout=self.timeout,
                verify=self.verify,
            )
        except requests.RequestException:
            pass
        self.token = ""

    def _headers(self) -> dict:
        headers = {
            "App-Token": self.app_token,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if self.token:
            headers["Session-Token"] = self.token
        return headers

    def connect(self) -> str:
        if not self.url or not self.app_token or not self.user_token:
            raise GlpiError("Укажите URL, App-Token и User-Token")
        headers = self._headers()
        headers["Authorization"] = f"user_token {self.user_token}"
        try:
            res = self.session.get(
                f"{self.url}/initSession",
                headers=headers,
                timeout=self.timeout,
                verify=self.verify,
            )
        except requests.RequestException as err:
            raise GlpiError(f"Нет связи с GLPI: {err}") from err
        if res.status_code >= 400:
            raise GlpiError(f"initSession HTTP {res.status_code}")
        body = res.json()
        self.token = str(body.get("session_token") or "")
        if not self.token:
            raise GlpiError("GLPI не вернул session_token")
        self.log.info("Сессия GLPI открыта")
        return self.token

    def _get(self, path: str, params=None):
        res = self.session.get(
            f"{self.url}/{path.lstrip('/')}",
            headers=self._headers(),
            params=params,
            timeout=self.timeout,
            verify=self.verify,
        )
        if res.status_code >= 400 and res.status_code != 206:
            raise GlpiError(f"GET {path} HTTP {res.status_code}")
        try:
            body = res.json()
        except ValueError:
            body = None
        return res, body

    def search_tickets(self, since: datetime, analysis: dict) -> list[dict]:
        """Страницы search/Ticket. Критерий даты и категории НСИ."""
        since_text = since.strftime("%Y-%m-%d %H:%M:%S")
        category_id = analysis.get("sector_category_id")
        parts = [
            ("criteria[0][field]", "15"),
            ("criteria[0][searchtype]", "morethan"),
            ("criteria[0][value]", since_text),
            ("criteria[1][link]", "AND"),
            ("criteria[1][field]", "7"),
        ]
        if category_id:
            parts += [
                ("criteria[1][searchtype]", "equals"),
                ("criteria[1][value]", str(int(category_id))),
            ]
        else:
            parts += [
                ("criteria[1][searchtype]", "contains"),
                ("criteria[1][value]", str(analysis.get("sector_name") or "НСИ")),
            ]
        parts += [
            ("criteria[0][link]", "AND"),
            ("sort", "15"),
            ("order", "DESC"),
            ("forcedisplay[0]", "2"),
            ("forcedisplay[1]", "1"),
            ("forcedisplay[2]", "12"),
            ("forcedisplay[3]", "15"),
            ("forcedisplay[4]", "17"),
            ("forcedisplay[5]", "16"),
            ("forcedisplay[6]", "7"),
            ("forcedisplay[7]", "153"),
            ("forcedisplay[8]", "154"),
        ]
        rows = []
        start = 0
        page = 100
        total = None
        while True:
            params = parts + [("range", f"{start}-{start + page - 1}")]
            res, body = self._get("search/Ticket", params)
            data = (body or {}).get("data") or []
            if total is None:
                total = int((body or {}).get("totalcount") or 0)
                header = res.headers.get("Content-Range") or ""
                match = _RANGE_TOTAL.search(header)
                if match:
                    total = int(match.group(1))
            for row in data:
                rows.append(self._map_search_row(row))
            self.log.info("Поиск: получено %s из %s", len(rows), total)
            if not data or (total is not None and len(rows) >= total):
                break
            start += len(data)
        return rows

    def _map_search_row(self, row: dict) -> dict:
        category = row.get("7")
        if isinstance(category, list):
            category = category[0] if category else ""
        return {
            "id": int(row.get("2") or 0),
            "title": str(row.get("1") or ""),
            "status": _status_int(row.get("12")),
            "category": str(category or ""),
            "opened_raw": row.get("15") or "",
            "solved_raw": row.get("17") or "",
            "closed_raw": row.get("16") or "",
            "waiting_raw": row.get("153"),
            "solve_stat_raw": row.get("154"),
        }

    def enrich(self, row: dict, deduct_pending: bool) -> dict:
        """Даты и ожидание из поиска. Карточка — только если в поиске пусто."""
        opened = self.parse_dt(row.get("opened_raw"))
        status = int(row.get("status") or 0)
        solved = self.parse_dt(row.get("solved_raw"))
        closed = self.parse_dt(row.get("closed_raw"))
        waiting = seconds_to_hours(row.get("waiting_raw"))
        solve_stat = seconds_to_hours(row.get("solve_stat_raw"))
        if opened is None or (status in (5, 6) and ((status == 5 and solved is None) or (status == 6 and closed is None))):
            _res, ticket = self._get(f"Ticket/{row['id']}")
            ticket = ticket or {}
            opened = opened or self.parse_dt(ticket.get("date"))
            status = int(ticket.get("status") or status or 0)
            solved = solved or self.parse_dt(ticket.get("solvedate"))
            closed = closed or self.parse_dt(ticket.get("closedate"))
            if waiting is None:
                waiting = seconds_to_hours(ticket.get("waiting_duration"))
            if solve_stat is None:
                solve_stat = seconds_to_hours(ticket.get("solve_delay_stat"))
            title = str(ticket.get("name") or row.get("title") or "")
        else:
            title = str(row.get("title") or "")
        end = solved if status == 5 else closed if status == 6 else None
        pending_source = "waiting_duration"
        pending = waiting or 0.0
        if deduct_pending and not waiting:
            pending, pending_source = self._pending_from_history(row["id"])
        return {
            **row,
            "status": status,
            "title": title,
            "opened": opened,
            "end": end,
            "pending_hours": pending,
            "pending_source": pending_source,
            "solve_delay_stat_hours": solve_stat,
        }

    def _pending_from_history(self, ticket_id: int):
        try:
            _res, body = self._get(f"Ticket/{ticket_id}/Log")
        except GlpiError as err:
            self.log.warning("Заявка %s: журнал статусов недоступен (%s)", ticket_id, err)
            return 0.0, "missing"
        rows = body if isinstance(body, list) else []
        hours = pending_hours_from_log(rows, self.parse_dt)
        if hours > 0:
            self.log.info("Заявка %s: Pending восстановлен из журнала, %.2f ч", ticket_id, hours)
            return hours, "history"
        self.log.warning("Заявка %s: waiting_duration пуст, в журнале нет статуса 4 — Pending не вычтен", ticket_id)
        return 0.0, "missing"
