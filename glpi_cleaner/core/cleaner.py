"""Логика поиска и удаления устаревших заявок."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from dateutil.relativedelta import relativedelta
from typing import Any, Callable

from .config_manager import DATE_FIELD_MAP, STATUS_LABELS
from .deletion_journal import append_many, record_from_ticket
from .glpi_api import GlpiApiError, GlpiClient
from .logger import get_logger


ProgressCallback = Callable[[str, dict[str, Any]], None]


@dataclass
class CleanResult:
    dry_run: bool
    cutoff: str
    found: int = 0
    deleted: int = 0
    skipped_young: int = 0
    skipped_status: int = 0
    skipped_filter: int = 0
    errors: int = 0
    preview: list[dict] = field(default_factory=list)
    message: str = ""


def compute_cutoff(value: int, unit: str, now: datetime | None = None) -> datetime:
    now = now or datetime.now()
    unit = (unit or "years").lower()
    value = max(1, int(value or 1))
    if unit in ("day", "days"):
        return now - relativedelta(days=value)
    if unit in ("month", "months"):
        return now - relativedelta(months=value)
    return now - relativedelta(years=value)


def format_cutoff(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def parse_glpi_datetime(value: str) -> datetime | None:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


def ticket_date_value(ticket: dict, date_field: str) -> str:
    if date_field in ("date_mod", "modified"):
        return str(ticket.get("date_mod") or ticket.get("modified") or ticket.get("date") or "")
    return str(ticket.get("date") or ticket.get("opened") or ticket.get("date_creation") or "")


def is_eligible(
    status: int,
    opened_str: str,
    cutoff: datetime,
    allowed_statuses: list[int],
) -> tuple[bool, str]:
    if int(status) not in allowed_statuses:
        return False, "status"
    opened = parse_glpi_datetime(opened_str)
    if not opened:
        return False, "bad_date"
    if opened >= cutoff:
        return False, "too_young"
    return True, "ok"


class TicketCleaner:
    def __init__(self, config: dict[str, Any], on_progress: ProgressCallback | None = None):
        self.config = config
        self.on_progress = on_progress
        self._log = get_logger()
        self._stop = False

    def request_stop(self) -> None:
        self._stop = True

    def _emit(self, event: str, **kwargs) -> None:
        if self.on_progress:
            try:
                self.on_progress(event, kwargs)
            except Exception:
                pass

    def _client(self) -> GlpiClient:
        g = self.config["glpi"]
        return GlpiClient(
            url=g["url"],
            app_token=g["app_token"],
            user_token=g["user_token"],
            verify_ssl=g.get("verify_ssl", True),
            timeout=int(g.get("timeout") or 120),
        )

    def run(self, dry_run_override: bool | None = None) -> CleanResult:
        deletion = self.config.get("deletion") or {}
        dry_run = deletion.get("dry_run", True) if dry_run_override is None else dry_run_override
        force_purge = bool(deletion.get("force_purge", False))
        statuses = [int(x) for x in (deletion.get("statuses") or [5, 6])]
        date_field = str(deletion.get("date_field") or "date")
        date_field_id = DATE_FIELD_MAP.get(date_field, 15)
        page_size = max(50, min(int(deletion.get("page_size") or 1000), 1000))
        batch_size = max(1, min(int(deletion.get("batch_size") or 50), 100))
        category_ids = {int(x) for x in (deletion.get("category_ids") or []) if str(x).strip()}
        requester_ids = {int(x) for x in (deletion.get("requester_ids") or []) if str(x).strip()}

        cutoff_dt = compute_cutoff(
            int(deletion.get("max_age_value") or 1),
            str(deletion.get("max_age_unit") or "years"),
        )
        cutoff_str = format_cutoff(cutoff_dt)

        result = CleanResult(dry_run=dry_run, cutoff=cutoff_str)
        mode = "DRY-RUN" if dry_run else ("PURGE" if force_purge else "TRASH")
        self._log.info(
            "Старт очистки [%s]: старше %s %s (порог %s), статусы %s",
            mode,
            deletion.get("max_age_value"),
            deletion.get("max_age_unit"),
            cutoff_str,
            statuses,
        )
        self._emit("start", dry_run=dry_run, cutoff=cutoff_str)

        client = self._client()
        try:
            client.init_session()
            total, _ = client.search_tickets(
                status_codes=statuses,
                date_field_id=date_field_id,
                cutoff_str=cutoff_str,
                start=0,
                end=0,
            )
            result.found = total
            self._log.info("Найдено по фильтру поиска: %s", total)
            self._emit("found", total=total)

            if total == 0:
                result.message = "Заявок по заданным правилам не найдено"
                return result

            candidates: list[dict] = []
            for start in range(0, total, page_size):
                if self._stop:
                    break
                end = min(start + page_size - 1, total - 1)
                _, rows = client.search_tickets(
                    status_codes=statuses,
                    date_field_id=date_field_id,
                    cutoff_str=cutoff_str,
                    start=start,
                    end=end,
                )
                for row in rows:
                    ok, reason = is_eligible(row["status"], row["opened"] if date_field != "date_mod" else row["modified"] or row["opened"], cutoff_dt, statuses)
                    if not ok:
                        if reason == "too_young":
                            result.skipped_young += 1
                        elif reason == "status":
                            result.skipped_status += 1
                        continue
                    # доп. фильтры по категории/заявителю — при наличии id в строке
                    if category_ids:
                        cat = row.get("category")
                        cat_id = None
                        if isinstance(cat, dict):
                            cat_id = int(cat.get("id") or 0)
                        elif isinstance(cat, (int, float)):
                            cat_id = int(cat)
                        if cat_id is not None and cat_id not in category_ids:
                            result.skipped_filter += 1
                            continue
                    if requester_ids:
                        req = row.get("requester")
                        req_id = None
                        if isinstance(req, dict):
                            req_id = int(req.get("id") or 0)
                        elif isinstance(req, (int, float)):
                            req_id = int(req)
                        if req_id is not None and req_id not in requester_ids:
                            result.skipped_filter += 1
                            continue
                    candidates.append(row)
                self._emit("collect", collected=len(candidates), scanned=end + 1, total=total)

            result.preview = [
                {
                    "id": r["id"],
                    "status": r["status"],
                    "status_label": STATUS_LABELS.get(r["status"], str(r["status"])),
                    "opened": r["opened"],
                    "modified": r.get("modified") or "",
                    "title": r.get("title") or "",
                }
                for r in candidates[:500]
            ]

            if dry_run:
                result.deleted = 0
                result.message = (
                    f"Dry-Run: нашлось {len(candidates)} заявок к удалению "
                    f"(из {total} по поиску). Ничего не удалено."
                )
                self._log.info(result.message)
                return result

            # Повторная проверка каждой заявки перед удалением
            verified: list[dict] = []
            for row in candidates:
                if self._stop:
                    break
                tid = int(row["id"])
                try:
                    full = client.get_ticket(tid)
                except GlpiApiError:
                    result.errors += 1
                    continue
                if not full:
                    result.errors += 1
                    continue
                date_val = ticket_date_value(full, date_field)
                ok, reason = is_eligible(int(full.get("status") or 0), date_val, cutoff_dt, statuses)
                if not ok:
                    if reason == "too_young":
                        result.skipped_young += 1
                    elif reason == "status":
                        result.skipped_status += 1
                    continue
                meta = {
                    "id": tid,
                    "status": full.get("status", row.get("status")),
                    "date": full.get("date") or row.get("opened"),
                    "name": full.get("name") or row.get("title") or "",
                    "groups": row.get("groups") or "",
                    "requester": row.get("requester") or "",
                    "opened": row.get("opened") or full.get("date") or "",
                    "title": row.get("title") or full.get("name") or "",
                }
                verified.append(meta)

            journal_buf: list[dict] = []
            source = str((self.config.get("runtime") or {}).get("source") or "app")

            for i in range(0, len(verified), batch_size):
                if self._stop:
                    break
                batch_meta = verified[i : i + batch_size]
                batch_ids = [int(x["id"]) for x in batch_meta]
                ok_ids: list[int] = []
                try:
                    client.delete_tickets(batch_ids, force_purge=force_purge)
                    ok_ids = batch_ids
                    result.deleted += len(batch_ids)
                    self._log.info(
                        "Удалено пакетом %s (всего %s / %s)",
                        len(batch_ids),
                        result.deleted,
                        len(verified),
                    )
                    self._emit(
                        "deleted",
                        deleted=result.deleted,
                        target=len(verified),
                        batch=len(batch_ids),
                    )
                except GlpiApiError as exc:
                    self._log.error("Ошибка удаления пакета: %s", exc)
                    for meta in batch_meta:
                        tid = int(meta["id"])
                        try:
                            if client.delete_ticket(tid, force_purge=force_purge):
                                result.deleted += 1
                                ok_ids.append(tid)
                            else:
                                result.errors += 1
                        except GlpiApiError:
                            result.errors += 1

                by_id = {int(m["id"]): m for m in batch_meta}
                for tid in ok_ids:
                    journal_buf.append(
                        record_from_ticket(by_id[tid], force_purge=force_purge, source=source)
                    )

            if journal_buf:
                n = append_many(journal_buf, self.config)
                self._log.info("В журнал удалённых записано: %s", n)

            action = "безвозвратно удалено" if force_purge else "перемещено в корзину"
            result.message = (
                f"Готово: {action} {result.deleted} заявок. "
                f"Ошибок: {result.errors}. Порог даты: {cutoff_str}."
            )
            self._log.info(result.message)
            return result
        finally:
            client.kill_session()
            self._emit("done", result=result.__dict__)
