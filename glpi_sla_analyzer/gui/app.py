"""Минимальное окно: подключение, параметры, результаты, журнал."""

from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from core.config_manager import DEFAULTS, load_config, save_config
from core.glpi_api import GlpiClient
from core.logger import build_logger
from core.runner import run_analysis


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("GLPI SLA — рабочий календарь")
        self.geometry("980x640")
        self.minsize(800, 520)
        self.cfg = load_config("config.json") if __import__("pathlib").Path("config.json").exists() else DEFAULTS
        self.log_queue = queue.Queue()
        self.result = None
        self._build()
        self.after(200, self._drain_log)

    def _build(self):
        book = ttk.Notebook(self)
        book.pack(fill="both", expand=True, padx=8, pady=8)
        self.tab_conn = ttk.Frame(book)
        self.tab_params = ttk.Frame(book)
        self.tab_result = ttk.Frame(book)
        self.tab_log = ttk.Frame(book)
        book.add(self.tab_conn, text="Подключение")
        book.add(self.tab_params, text="Параметры")
        book.add(self.tab_result, text="Результаты")
        book.add(self.tab_log, text="Журнал")
        self._conn()
        self._params()
        self._results()
        self.log_box = tk.Text(self.tab_log, height=20, wrap="word")
        self.log_box.pack(fill="both", expand=True, padx=6, pady=6)

    def _row(self, parent, label, variable, row, show=""):
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=6, pady=4)
        entry = ttk.Entry(parent, textvariable=variable, width=64, show=show)
        entry.grid(row=row, column=1, sticky="ew", padx=6, pady=4)
        return entry

    def _conn(self):
        g = self.cfg.get("glpi") or {}
        self.url = tk.StringVar(value=g.get("url", ""))
        self.app_token = tk.StringVar(value=g.get("app_token", ""))
        self.user_token = tk.StringVar(value=g.get("user_token", ""))
        self.verify_ssl = tk.BooleanVar(value=bool(g.get("verify_ssl", True)))
        self.tz = tk.StringVar(value=g.get("timezone", "Europe/Minsk"))
        frame = self.tab_conn
        frame.columnconfigure(1, weight=1)
        self._row(frame, "URL", self.url, 0)
        self._row(frame, "App-Token", self.app_token, 1, show="*")
        self._row(frame, "User-Token", self.user_token, 2, show="*")
        self._row(frame, "Часовой пояс", self.tz, 3)
        ttk.Checkbutton(frame, text="Проверять SSL", variable=self.verify_ssl).grid(row=4, column=1, sticky="w")
        ttk.Button(frame, text="Проверить подключение", command=self._test).grid(row=5, column=1, sticky="w", padx=6, pady=8)
        ttk.Button(frame, text="Сохранить config.json", command=self._save).grid(row=5, column=1, sticky="e", padx=6)

    def _params(self):
        a = self.cfg.get("analysis") or {}
        s = self.cfg.get("work_schedule") or {}
        self.period = tk.StringVar(value=str(a.get("period_value", 3)))
        self.sector = tk.StringVar(value=str(a.get("sector_name") or "НСИ"))
        self.category_id = tk.StringVar(value="" if not a.get("sector_category_id") else str(a.get("sector_category_id")))
        self.sla = tk.StringVar(value=str(a.get("sla_hours", 8)))
        self.work_start = tk.StringVar(value=s.get("work_start", "08:30"))
        self.work_end = tk.StringVar(value=s.get("work_end", "17:30"))
        self.lunch_start = tk.StringVar(value=s.get("lunch_start", "13:00"))
        self.lunch_end = tk.StringVar(value=s.get("lunch_end", "13:45"))
        frame = self.tab_params
        frame.columnconfigure(1, weight=1)
        self._row(frame, "Период, месяцев", self.period, 0)
        self._row(frame, "Сектор (текст категории)", self.sector, 1)
        self._row(frame, "itilcategories_id (пусто = текст)", self.category_id, 2)
        self._row(frame, "SLA, часов", self.sla, 3)
        self._row(frame, "Начало дня", self.work_start, 4)
        self._row(frame, "Конец дня", self.work_end, 5)
        self._row(frame, "Обед с", self.lunch_start, 6)
        self._row(frame, "Обед до", self.lunch_end, 7)
        ttk.Label(frame, text="Праздники, по дате в строке").grid(row=8, column=0, sticky="nw", padx=6)
        self.holidays = tk.Text(frame, height=6, width=40)
        self.holidays.grid(row=8, column=1, sticky="ew", padx=6, pady=4)
        self.holidays.insert("1.0", "\n".join(s.get("holidays") or []))
        ttk.Button(frame, text="Считать", command=self._run).grid(row=9, column=1, sticky="w", padx=6, pady=8)

    def _results(self):
        self.cards = tk.StringVar(value="Запустите расчёт на вкладке «Параметры».")
        ttk.Label(self.tab_result, textvariable=self.cards, justify="left").pack(anchor="w", padx=8, pady=6)
        cols = ("id", "title", "status", "hours", "excess", "note")
        self.tree = ttk.Treeview(self.tab_result, columns=cols, show="headings", height=16)
        titles = {
            "id": "ID",
            "title": "Заголовок",
            "status": "Статус",
            "hours": "Часы",
            "excess": "Превышение",
            "note": "Замечание",
        }
        for key in cols:
            self.tree.heading(key, text=titles[key])
            self.tree.column(key, width=120 if key != "title" else 280, anchor="w")
        self.tree.tag_configure("over", background="#f4c7c3")
        self.tree.pack(fill="both", expand=True, padx=6, pady=4)
        bar = ttk.Frame(self.tab_result)
        bar.pack(fill="x", padx=6, pady=4)
        ttk.Button(bar, text="Excel", command=lambda: self._export("xlsx")).pack(side="left")
        ttk.Button(bar, text="CSV", command=lambda: self._export("csv")).pack(side="left", padx=6)

    def _collect(self) -> dict:
        holidays = [line.strip() for line in self.holidays.get("1.0", "end").splitlines() if line.strip()]
        cat = self.category_id.get().strip()
        cfg = {
            "glpi": {
                "url": self.url.get().strip(),
                "app_token": self.app_token.get().strip(),
                "user_token": self.user_token.get().strip(),
                "verify_ssl": bool(self.verify_ssl.get()),
                "timeout": 30,
                "timezone": self.tz.get().strip() or "Europe/Minsk",
            },
            "analysis": {
                "period_value": int(self.period.get() or 3),
                "period_unit": "months",
                "sector_name": self.sector.get().strip() or "НСИ",
                "sector_category_id": int(cat) if cat else None,
                "statuses": [5, 6],
                "sla_hours": float(self.sla.get() or 8),
                "deduct_pending": True,
            },
            "work_schedule": {
                "workdays": [0, 1, 2, 3, 4],
                "work_start": self.work_start.get().strip(),
                "work_end": self.work_end.get().strip(),
                "lunch_start": self.lunch_start.get().strip(),
                "lunch_end": self.lunch_end.get().strip(),
                "holidays": holidays,
                "timezone": self.tz.get().strip(),
            },
            "output": {"report_path": "report.xlsx"},
        }
        return cfg

    def _save(self):
        try:
            cfg = self._collect()
        except ValueError as err:
            messagebox.showerror("Параметры", str(err))
            return
        path = filedialog.asksaveasfilename(defaultextension=".json", initialfile="config.json")
        if path:
            save_config(path, cfg)
            self._log(f"Сохранено {path}")

    def _log(self, text: str):
        self.log_queue.put(text)

    def _drain_log(self):
        while True:
            try:
                line = self.log_queue.get_nowait()
            except queue.Empty:
                break
            self.log_box.insert("end", line + "\n")
            self.log_box.see("end")
        self.after(200, self._drain_log)

    def _test(self):
        def work():
            log = build_logger()
            log.handlers.clear()
            client = GlpiClient(self._collect()["glpi"], log)
            try:
                client.connect()
                self._log("Подключение успешно")
                self.after(0, lambda: messagebox.showinfo("GLPI", "Сессия открыта"))
            except Exception as err:
                self._log(str(err))
                self.after(0, lambda: messagebox.showerror("GLPI", str(err)))
            finally:
                client.close()

        threading.Thread(target=work, daemon=True).start()

    def _run(self):
        def work():
            log = build_logger(verbose=True)

            import logging

            handler = logging.Handler()
            handler.emit = lambda record: self._log(record.getMessage())
            log.handlers = [handler]
            try:
                cfg = self._collect()
                result = run_analysis(cfg, log)
            except Exception as err:
                self._log(str(err))
                return
            self.result = result
            self.after(0, lambda: self._show(result))

        threading.Thread(target=work, daemon=True).start()

    def _show(self, result):
        summary = result.get("summary") or {}
        self.cards.set(
            "\n".join(
                [
                    f"В среднем: {summary.get('n')} шт., среднее {self._num(summary.get('avg_hours'))} ч",
                    f"Превысили SLA: {summary.get('over_count')} ({self._num(summary.get('over_share_pct'))}%)",
                    f"Среднее превышение: {self._num(summary.get('avg_excess'))} ч",
                    f"Максимум: {self._num(summary.get('max_excess'))} ч, заявка {summary.get('max_excess_id')}",
                    f"Медиана {self._num(summary.get('median'))}, P90 {self._num(summary.get('p90'))}, P95 {self._num(summary.get('p95'))}",
                    f"Мин {self._num(summary.get('min_hours'))}, макс {self._num(summary.get('max_hours'))}",
                    f"Незавершённые: {summary.get('open_count')}, ошибки дат: {summary.get('skipped')}",
                    f"Файл: {result.get('path')}",
                ]
            )
        )
        for item in self.tree.get_children():
            self.tree.delete(item)
        for row in result.get("rows") or []:
            note = row.get("warning") or ("Pending не вычтен" if row.get("pending_not_deducted") else "")
            if row.get("open"):
                note = note or "незавершена"
            self.tree.insert(
                "",
                "end",
                tags=("over",) if row.get("over_sla") else (),
                values=(
                    row.get("id"),
                    str(row.get("title") or "")[:80],
                    row.get("status"),
                    self._num(row.get("net_hours")),
                    self._num(row.get("excess_hours")) if row.get("included") else "",
                    note,
                ),
            )

    def _export(self, kind: str):
        if not self.result:
            messagebox.showinfo("Экспорт", "Сначала выполните расчёт")
            return
        from core.exporter import write_csv, write_xlsx
        from pathlib import Path

        path = filedialog.asksaveasfilename(defaultextension=f".{kind}")
        if not path:
            return
        target = Path(path)
        if kind == "csv":
            write_csv(target, self.result["rows"])
        else:
            write_xlsx(target, self.result["summary"], self.result["rows"])
        self._log(f"Экспорт {target}")

    @staticmethod
    def _num(value):
        if value is None:
            return "—"
        return f"{float(value):.2f}"


def main():
    App().mainloop()
