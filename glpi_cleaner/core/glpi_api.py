"""Клиент REST API GLPI."""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .logger import get_logger


class GlpiApiError(Exception):
    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


class GlpiClient:
    def __init__(
        self,
        url: str,
        app_token: str,
        user_token: str,
        verify_ssl: bool = True,
        timeout: int = 120,
    ):
        self.api_url = str(url or "").rstrip("/")
        if self.api_url.endswith("/"):
            self.api_url = self.api_url.rstrip("/")
        self.app_token = str(app_token or "").strip()
        self.user_token = str(user_token or "").strip()
        self.verify_ssl = bool(verify_ssl)
        self.timeout = int(timeout) or 120
        self.session_token: str | None = None
        self._log = get_logger()

        self._http = requests.Session()
        retries = Retry(
            total=5,
            backoff_factor=1.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET", "POST", "PUT", "DELETE", "HEAD"]),
        )
        adapter = HTTPAdapter(max_retries=retries)
        self._http.mount("https://", adapter)
        self._http.mount("http://", adapter)

    def _headers(self, with_session: bool = True) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "App-Token": self.app_token,
        }
        if with_session and self.session_token:
            headers["Session-Token"] = self.session_token
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        with_session: bool = True,
        json_body: Any = None,
        params: dict | None = None,
    ) -> Any:
        if not self.api_url:
            raise GlpiApiError("Не указан URL API GLPI")
        if not self.app_token or not self.user_token:
            raise GlpiApiError("Не указаны App-Token и/или User-Token")

        url = f"{self.api_url}/{path.lstrip('/')}"
        last_err: Exception | None = None
        for attempt in range(1, 6):
            try:
                resp = self._http.request(
                    method,
                    url,
                    headers=self._headers(with_session=with_session),
                    json=json_body,
                    params=params,
                    timeout=self.timeout,
                    verify=self.verify_ssl,
                )
                if resp.status_code in (200, 201, 204, 206):
                    if not resp.content:
                        return None
                    try:
                        return resp.json()
                    except ValueError:
                        return resp.text
                # 401 — сброс сессии и одна повторная попытка после re-init
                if resp.status_code == 401 and with_session and attempt == 1:
                    self.session_token = None
                    self.init_session()
                    continue
                msg = self._format_error(resp)
                raise GlpiApiError(msg, status=resp.status_code, body=resp.text[:500])
            except GlpiApiError:
                raise
            except requests.RequestException as exc:
                last_err = exc
                wait = min(2 ** attempt, 30)
                self._log.warning("Сетевая ошибка (попытка %s/5): %s. Ждём %s с…", attempt, exc, wait)
                time.sleep(wait)
        raise GlpiApiError(f"Не удалось связаться с GLPI: {last_err}")

    @staticmethod
    def _format_error(resp: requests.Response) -> str:
        try:
            body = resp.json()
            if isinstance(body, list):
                return ": ".join(str(x) for x in body if x)
            if isinstance(body, dict) and body.get("error"):
                return str(body["error"])
        except Exception:
            pass
        text = (resp.text or "").strip()[:300]
        if resp.status_code == 401:
            return "Ошибка 401: неверный App-Token или User-Token (проверьте токены)"
        if resp.status_code == 404:
            return "Ошибка 404: объект не найден (возможно, уже удалён)"
        return f"HTTP {resp.status_code}: {text or 'без описания'}"

    def init_session(self) -> str:
        headers = self._headers(with_session=False)
        headers["Authorization"] = f"user_token {self.user_token}"
        url = f"{self.api_url}/initSession"
        try:
            resp = self._http.get(
                url,
                headers=headers,
                timeout=self.timeout,
                verify=self.verify_ssl,
            )
        except requests.RequestException as exc:
            raise GlpiApiError(f"Нет связи с GLPI: {exc}") from exc

        if resp.status_code != 200:
            raise GlpiApiError(self._format_error(resp), status=resp.status_code)

        data = resp.json()
        token = data.get("session_token") if isinstance(data, dict) else None
        if not token:
            raise GlpiApiError("GLPI не вернул session_token")
        self.session_token = token
        self._log.info("Сессия GLPI открыта")
        return token

    def kill_session(self) -> None:
        if not self.session_token:
            return
        try:
            self._request("GET", "killSession")
            self._log.info("Сессия GLPI закрыта")
        except Exception as exc:
            self._log.debug("killSession: %s", exc)
        finally:
            self.session_token = None

    def __enter__(self) -> "GlpiClient":
        self.init_session()
        return self

    def __exit__(self, *args) -> None:
        self.kill_session()

    def get_full_session(self) -> dict:
        data = self._request("GET", "getFullSession")
        return data if isinstance(data, dict) else {}

    def get_glpi_config(self) -> dict:
        data = self._request("GET", "getGlpiConfig")
        return data if isinstance(data, dict) else {}

    def test_connection(self) -> dict[str, Any]:
        """Проверка подключения: сессия + версия GLPI."""
        self.init_session()
        try:
            session = self.get_full_session().get("session") or {}
            cfg = self.get_glpi_config()
            version = (
                cfg.get("cfg_glpi", {}).get("version")
                or cfg.get("version")
                or session.get("glpi_current_version")
                or "неизвестно"
            )
            entity = session.get("glpiactive_entity_name") or session.get("glpiactive_entity")
            return {
                "ok": True,
                "version": str(version),
                "entity": entity,
                "user": session.get("glpiname") or session.get("glpiID"),
                "message": f"Подключение успешно. Версия GLPI: {version}",
            }
        finally:
            self.kill_session()

    def get_ticket(self, ticket_id: int) -> dict | None:
        try:
            data = self._request("GET", f"Ticket/{int(ticket_id)}")
            return data if isinstance(data, dict) else None
        except GlpiApiError as exc:
            if exc.status == 404:
                return None
            raise

    def search_tickets(
        self,
        *,
        status_codes: list[int],
        date_field_id: int,
        cutoff_str: str,
        start: int,
        end: int,
    ) -> tuple[int, list[dict]]:
        """Поиск заявок: статусы OR + дата открытия/изменения < cutoff."""
        params: dict[str, Any] = {}
        for i, code in enumerate(status_codes):
            prefix = f"criteria[0][criteria][{i}]"
            params[f"{prefix}[field]"] = 12
            params[f"{prefix}[searchtype]"] = "equals"
            params[f"{prefix}[value]"] = int(code)
            if i > 0:
                params[f"{prefix}[link]"] = "OR"

        params["criteria[1][link]"] = "AND"
        params["criteria[1][field]"] = int(date_field_id)
        params["criteria[1][searchtype]"] = "lessthan"
        params["criteria[1][value]"] = cutoff_str

        params["sort"] = 2
        params["order"] = "ASC"
        params["range"] = f"{start}-{end}"
        params["forcedisplay[0]"] = 2
        params["forcedisplay[1]"] = 12
        params["forcedisplay[2]"] = 15
        params["forcedisplay[3]"] = 19
        params["forcedisplay[4]"] = 7
        params["forcedisplay[5]"] = 4
        params["forcedisplay[6]"] = 8
        params["forcedisplay[7]"] = 1

        query = urlencode(params, doseq=True)
        data = self._request("GET", f"search/Ticket?{query}")
        if not isinstance(data, dict):
            return 0, []
        total = int(data.get("totalcount") or 0)
        rows = []
        for row in data.get("data") or []:
            groups = row.get("8")
            if groups is None or groups == "":
                groups = []
            elif not isinstance(groups, list):
                groups = [groups]
            req = row.get("4")
            if isinstance(req, list):
                req = ", ".join(str(x) for x in req)
            rows.append(
                {
                    "id": int(row.get("2") or 0),
                    "status": int(row.get("12") or 0),
                    "opened": str(row.get("15") or ""),
                    "modified": str(row.get("19") or ""),
                    "category": row.get("7") or "",
                    "requester": str(req or ""),
                    "groups": groups,
                    "title": str(row.get("1") or ""),
                }
            )
        return total, rows

    def delete_tickets(self, ids: list[int], force_purge: bool = False) -> list[dict]:
        """Массовое удаление. force_purge=True — безвозвратно."""
        if not ids:
            return []
        body = {
            "input": [{"id": int(i)} for i in ids],
            "force_purge": bool(force_purge),
        }
        data = self._request("DELETE", "Ticket/", json_body=body)
        if isinstance(data, list):
            return data
        return [{"result": data}]

    def delete_ticket(self, ticket_id: int, force_purge: bool = False) -> bool:
        path = f"Ticket/{int(ticket_id)}"
        if force_purge:
            path += "?force_purge=1"
        try:
            self._request("DELETE", path)
            return True
        except GlpiApiError as exc:
            if exc.status == 404:
                return True
            raise
