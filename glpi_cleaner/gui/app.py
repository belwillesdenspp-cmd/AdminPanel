"""Tkinter GUI для GLPI Cleaner."""

from __future__ import annotations

import threading
import tkinter as tk
from tkinter import messagebox, ttk
from typing import Any

from core.background import (
    daemon_status_text,
    is_daemon_running,
    start_daemon,
    stop_daemon,
)
from core.cleaner import TicketCleaner
from core.config_manager import (
    STATUS_LABELS,
    app_dir,
    load_config,
    logs_dir,
    save_config,
)
from core.deletion_journal import query_records
from core.export_excel import export_journal, run_scheduled_export
from core.glpi_api import GlpiClient
from core.logger import get_logger, setup_logging, subscribe_gui, unsubscribe_gui
from core.scheduler import CleanerScheduler
from core.secrets import encrypt_secret
from core.smb_access import test_path_access


class GlpiCleanerApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("GLPI Cleaner — удаление устаревших заявок")
        self.geometry("920x680")
        self.minsize(800, 560)

        self.config_data = load_config()
        logging_cfg = self.config_data.get("logging") or {}
        setup_logging(
            level=str(logging_cfg.get("level") or "INFO"),
            max_bytes=int(logging_cfg.get("max_bytes") or 5_000_000),
            backup_count=int(logging_cfg.get("backup_count") or 5),
        )
        self.log = get_logger()
        self.scheduler = CleanerScheduler(blocking=False)
        self._cleaner: TicketCleaner | None = None
        self._busy = False
        self._tray = None
        self._tray_thread = None
        self.close_to_tray_var = tk.BooleanVar(value=True)

        self._build_ui()
        self._enable_clipboard()
        self._load_into_form()
        subscribe_gui(self._append_log)
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(1000, self._refresh_daemon_status)
        self.after(1200, self._reload_deleted)

        schedule = self.config_data.get("schedule") or {}
        if schedule.get("enabled") and not is_daemon_running():
            self.after(500, self._start_scheduler_silent)

    # ── Clipboard (Ctrl+V / ПКМ) ─────────────────────────────────────

    @staticmethod
    def _is_editable(widget) -> bool:
        try:
            state = str(widget.cget("state"))
        except tk.TclError:
            return True
        return state not in ("disabled", "readonly")

    def _clipboard_get(self) -> str:
        try:
            return self.clipboard_get()
        except tk.TclError:
            return ""

    def _entry_paste(self, widget) -> None:
        if not self._is_editable(widget):
            return
        text = self._clipboard_get()
        if not text:
            return
        try:
            if widget.selection_present():
                widget.delete(tk.SEL_FIRST, tk.SEL_LAST)
        except tk.TclError:
            pass
        widget.insert(tk.INSERT, text)

    def _entry_copy(self, widget) -> None:
        try:
            if widget.selection_present():
                self.clipboard_clear()
                self.clipboard_append(widget.selection_get())
        except tk.TclError:
            pass

    def _entry_cut(self, widget) -> None:
        if not self._is_editable(widget):
            return
        try:
            if widget.selection_present():
                self.clipboard_clear()
                self.clipboard_append(widget.selection_get())
                widget.delete(tk.SEL_FIRST, tk.SEL_LAST)
        except tk.TclError:
            pass

    def _entry_select_all(self, widget) -> None:
        try:
            widget.selection_range(0, tk.END)
            widget.icursor(tk.END)
        except tk.TclError:
            pass

    def _text_paste(self, widget) -> None:
        if not self._is_editable(widget):
            return
        text = self._clipboard_get()
        if not text:
            return
        try:
            widget.delete(tk.SEL_FIRST, tk.SEL_LAST)
        except tk.TclError:
            pass
        widget.insert(tk.INSERT, text)

    def _text_copy(self, widget) -> None:
        try:
            self.clipboard_clear()
            self.clipboard_append(widget.get(tk.SEL_FIRST, tk.SEL_LAST))
        except tk.TclError:
            pass

    def _text_cut(self, widget) -> None:
        if not self._is_editable(widget):
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(widget.get(tk.SEL_FIRST, tk.SEL_LAST))
            widget.delete(tk.SEL_FIRST, tk.SEL_LAST)
        except tk.TclError:
            pass

    def _text_select_all(self, widget) -> None:
        widget.tag_add(tk.SEL, "1.0", tk.END)
        widget.mark_set(tk.INSERT, "1.0")
        widget.see(tk.INSERT)

    def _on_ctrl_keycode(self, event):
        """Ctrl+C/V/X/A по физическим клавишам — работает и при русской раскладке."""
        widget = event.widget
        # Windows keycodes: A=65, C=67, V=86, X=88
        code = getattr(event, "keycode", None)
        is_text = isinstance(widget, tk.Text)
        is_entry = isinstance(widget, (tk.Entry, ttk.Entry, ttk.Combobox, tk.Spinbox))
        if not (is_text or is_entry):
            # ttk.Spinbox / другие
            wclass = widget.winfo_class()
            if wclass in ("TEntry", "Entry", "TCombobox", "TSpinbox", "Spinbox"):
                is_entry = True
            elif wclass == "Text":
                is_text = True
            else:
                return None

        if code == 86:  # V — вставить
            if is_text:
                self._text_paste(widget)
            else:
                self._entry_paste(widget)
            return "break"
        if code == 67:  # C — копировать
            if is_text:
                self._text_copy(widget)
            else:
                self._entry_copy(widget)
            return "break"
        if code == 88:  # X — вырезать
            if is_text:
                self._text_cut(widget)
            else:
                self._entry_cut(widget)
            return "break"
        if code == 65:  # A — выделить всё
            if is_text:
                self._text_select_all(widget)
            else:
                self._entry_select_all(widget)
            return "break"
        return None

    def _show_context_menu(self, event):
        widget = event.widget
        wclass = widget.winfo_class()
        is_text = wclass == "Text" or isinstance(widget, tk.Text)
        is_entry = wclass in ("TEntry", "Entry", "TCombobox", "TSpinbox", "Spinbox") or isinstance(
            widget, (tk.Entry, ttk.Entry, ttk.Combobox, tk.Spinbox)
        )
        if not (is_text or is_entry):
            return

        menu = tk.Menu(self, tearoff=0)
        if is_text:
            menu.add_command(label="Вырезать", command=lambda: self._text_cut(widget))
            menu.add_command(label="Копировать", command=lambda: self._text_copy(widget))
            menu.add_command(label="Вставить", command=lambda: self._text_paste(widget))
            menu.add_separator()
            menu.add_command(label="Выделить всё", command=lambda: self._text_select_all(widget))
        else:
            menu.add_command(label="Вырезать", command=lambda: self._entry_cut(widget))
            menu.add_command(label="Копировать", command=lambda: self._entry_copy(widget))
            menu.add_command(label="Вставить", command=lambda: self._entry_paste(widget))
            menu.add_separator()
            menu.add_command(label="Выделить всё", command=lambda: self._entry_select_all(widget))
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _on_shift_insert(self, event):
        widget = event.widget
        if widget.winfo_class() == "Text" or isinstance(widget, tk.Text):
            self._text_paste(widget)
        else:
            self._entry_paste(widget)
        return "break"

    def _enable_clipboard(self) -> None:
        """Вставка/копирование при EN и RU раскладке + меню правой кнопкой мыши."""
        classes = ("TEntry", "Entry", "TCombobox", "TSpinbox", "Spinbox", "Text")
        for cls in classes:
            self.bind_class(cls, "<Control-KeyPress>", self._on_ctrl_keycode, add="+")
            self.bind_class(cls, "<Button-3>", self._show_context_menu, add="+")
            self.bind_class(cls, "<Shift-Insert>", self._on_shift_insert, add="+")

    # ── UI ──────────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        nb = ttk.Notebook(self)
        nb.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        self.tab_conn = ttk.Frame(nb, padding=10)
        self.tab_rules = ttk.Frame(nb, padding=10)
        self.tab_sched = ttk.Frame(nb, padding=10)
        self.tab_deleted = ttk.Frame(nb, padding=10)
        self.tab_export = ttk.Frame(nb, padding=10)
        self.tab_log = ttk.Frame(nb, padding=10)
        nb.add(self.tab_conn, text="Подключение")
        nb.add(self.tab_rules, text="Правила удаления")
        nb.add(self.tab_sched, text="Расписание")
        nb.add(self.tab_deleted, text="Удалённые")
        nb.add(self.tab_export, text="Выгрузка")
        nb.add(self.tab_log, text="Логи")

        self._build_connection_tab()
        self._build_rules_tab()
        self._build_schedule_tab()
        self._build_deleted_tab()
        self._build_export_tab()
        self._build_log_tab()

        status = ttk.Frame(self)
        status.pack(fill=tk.X, padx=8, pady=(0, 8))
        self.status_var = tk.StringVar(value=f"Папка программы: {app_dir()}")
        ttk.Label(status, textvariable=self.status_var).pack(side=tk.LEFT)

    def _build_connection_tab(self) -> None:
        f = self.tab_conn
        self.url_var = tk.StringVar()
        self.app_token_var = tk.StringVar()
        self.user_token_var = tk.StringVar()
        self.verify_ssl_var = tk.BooleanVar(value=True)
        self.timeout_var = tk.StringVar(value="120")

        rows = [
            ("URL API GLPI", self.url_var, False),
            ("App-Token", self.app_token_var, True),
            ("User-Token", self.user_token_var, True),
            ("Таймаут (сек)", self.timeout_var, False),
        ]
        for i, (label, var, secret) in enumerate(rows):
            ttk.Label(f, text=label).grid(row=i, column=0, sticky=tk.W, pady=4)
            entry = ttk.Entry(f, textvariable=var, width=70, show="*" if secret else "")
            entry.grid(row=i, column=1, sticky=tk.EW, pady=4, padx=6)

        ttk.Checkbutton(
            f,
            text="Проверять SSL-сертификат (снимите галочку при самоподписанном сертификате)",
            variable=self.verify_ssl_var,
        ).grid(row=4, column=0, columnspan=2, sticky=tk.W, pady=8)

        btns = ttk.Frame(f)
        btns.grid(row=5, column=0, columnspan=2, sticky=tk.W, pady=12)
        ttk.Button(btns, text="Проверить подключение", command=self._test_connection).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(btns, text="Сохранить", command=self._save_connection).pack(side=tk.LEFT)

        self.conn_status = tk.StringVar(value="")
        ttk.Label(f, textvariable=self.conn_status, wraplength=700).grid(
            row=6, column=0, columnspan=2, sticky=tk.W, pady=8
        )
        f.columnconfigure(1, weight=1)

        hint = (
            "Пример URL: https://support.willesden.by/apirest.php\n"
            "Токены берутся в GLPI: Настройки → Общие → API (App-Token) "
            "и Мой профиль → Ключ API (User-Token). Подробнее — docs/USER_GUIDE.md"
        )
        ttk.Label(f, text=hint, foreground="#555", wraplength=780).grid(
            row=7, column=0, columnspan=2, sticky=tk.W, pady=16
        )

    def _build_rules_tab(self) -> None:
        f = self.tab_rules
        self.age_value_var = tk.StringVar(value="1")
        self.age_unit_var = tk.StringVar(value="years")
        self.date_field_var = tk.StringVar(value="date")
        self.dry_run_var = tk.BooleanVar(value=True)
        self.force_purge_var = tk.BooleanVar(value=False)

        ttk.Label(f, text="Удалять заявки старше:").grid(row=0, column=0, sticky=tk.W)
        age_fr = ttk.Frame(f)
        age_fr.grid(row=0, column=1, sticky=tk.W, pady=4)
        ttk.Spinbox(age_fr, from_=1, to=100, textvariable=self.age_value_var, width=6).pack(
            side=tk.LEFT
        )
        ttk.Combobox(
            age_fr,
            textvariable=self.age_unit_var,
            values=("days", "months", "years"),
            width=10,
            state="readonly",
        ).pack(side=tk.LEFT, padx=6)
        ttk.Label(f, text="(days = дни, months = месяцы, years = годы)").grid(
            row=0, column=2, sticky=tk.W
        )

        ttk.Label(f, text="Поле даты:").grid(row=1, column=0, sticky=tk.W, pady=4)
        ttk.Combobox(
            f,
            textvariable=self.date_field_var,
            values=("date", "date_mod"),
            width=16,
            state="readonly",
        ).grid(row=1, column=1, sticky=tk.W)
        ttk.Label(f, text="date = дата открытия, date_mod = дата изменения").grid(
            row=1, column=2, sticky=tk.W
        )

        ttk.Label(f, text="Статусы (через запятую, коды):").grid(row=2, column=0, sticky=tk.W)
        self.statuses_var = tk.StringVar(value="5,6")
        ttk.Entry(f, textvariable=self.statuses_var, width=20).grid(row=2, column=1, sticky=tk.W)
        ttk.Label(f, text="5 = Решена, 6 = Закрыта").grid(row=2, column=2, sticky=tk.W)

        ttk.Checkbutton(
            f,
            text="Dry-Run (только предпросмотр, ничего не удалять) — рекомендуется",
            variable=self.dry_run_var,
        ).grid(row=3, column=0, columnspan=3, sticky=tk.W, pady=8)
        ttk.Checkbutton(
            f,
            text="Force purge (удалить навсегда, не в корзину) — необратимо!",
            variable=self.force_purge_var,
        ).grid(row=4, column=0, columnspan=3, sticky=tk.W)

        btns = ttk.Frame(f)
        btns.grid(row=5, column=0, columnspan=3, sticky=tk.W, pady=10)
        ttk.Button(btns, text="Сохранить правила", command=self._save_rules).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(btns, text="Предпросмотр (Dry-Run)", command=self._preview).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(btns, text="Удалить сейчас", command=self._delete_now).pack(side=tk.LEFT)

        self.rules_status = tk.StringVar(value="")
        ttk.Label(f, textvariable=self.rules_status, wraplength=800).grid(
            row=6, column=0, columnspan=3, sticky=tk.W, pady=4
        )

        cols = ("id", "status_label", "opened", "title")
        self.tree = ttk.Treeview(f, columns=cols, show="headings", height=16)
        self.tree.heading("id", text="№ заявки")
        self.tree.heading("status_label", text="Статус")
        self.tree.heading("opened", text="Дата открытия")
        self.tree.heading("title", text="Заголовок")
        self.tree.column("id", width=90)
        self.tree.column("status_label", width=120)
        self.tree.column("opened", width=150)
        self.tree.column("title", width=420)
        self.tree.grid(row=7, column=0, columnspan=3, sticky=tk.NSEW, pady=8)
        scroll = ttk.Scrollbar(f, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        scroll.grid(row=7, column=3, sticky=tk.NS)
        f.rowconfigure(7, weight=1)
        f.columnconfigure(2, weight=1)

    def _build_schedule_tab(self) -> None:
        f = self.tab_sched
        self.sched_enabled_var = tk.BooleanVar(value=False)
        self.sched_mode_var = tk.StringVar(value="daily")
        self.sched_time_var = tk.StringVar(value="00:00")
        self.sched_interval_var = tk.StringVar(value="24")
        self.sched_dow_var = tk.StringVar(value="mon")
        self.sched_dom_var = tk.StringVar(value="1")

        ttk.Checkbutton(
            f, text="Включить планировщик", variable=self.sched_enabled_var
        ).grid(row=0, column=0, columnspan=2, sticky=tk.W, pady=6)

        ttk.Label(f, text="Периодичность:").grid(row=1, column=0, sticky=tk.W)
        ttk.Combobox(
            f,
            textvariable=self.sched_mode_var,
            values=("daily", "weekly", "monthly", "interval"),
            width=14,
            state="readonly",
        ).grid(row=1, column=1, sticky=tk.W)
        ttk.Label(
            f,
            text="daily=ежедневно, weekly=еженедельно, monthly=ежемесячно, interval=каждые N часов",
        ).grid(row=1, column=2, sticky=tk.W, padx=6)

        ttk.Label(f, text="Время (ЧЧ:ММ):").grid(row=2, column=0, sticky=tk.W, pady=4)
        ttk.Entry(f, textvariable=self.sched_time_var, width=8).grid(row=2, column=1, sticky=tk.W)

        ttk.Label(f, text="Интервал (часов):").grid(row=3, column=0, sticky=tk.W)
        ttk.Entry(f, textvariable=self.sched_interval_var, width=8).grid(row=3, column=1, sticky=tk.W)

        ttk.Label(f, text="День недели (для weekly):").grid(row=4, column=0, sticky=tk.W)
        ttk.Combobox(
            f,
            textvariable=self.sched_dow_var,
            values=("mon", "tue", "wed", "thu", "fri", "sat", "sun"),
            width=8,
            state="readonly",
        ).grid(row=4, column=1, sticky=tk.W)

        ttk.Label(f, text="День месяца (для monthly):").grid(row=5, column=0, sticky=tk.W)
        ttk.Entry(f, textvariable=self.sched_dom_var, width=8).grid(row=5, column=1, sticky=tk.W)

        btns = ttk.Frame(f)
        btns.grid(row=6, column=0, columnspan=3, sticky=tk.W, pady=16)
        ttk.Button(btns, text="Сохранить", command=self._save_schedule).pack(side=tk.LEFT, padx=(0, 8))
        ttk.Button(btns, text="Запустить планировщик в окне", command=self._start_scheduler).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(btns, text="Остановить планировщик в окне", command=self._stop_scheduler).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(btns, text="Запустить сейчас", command=self._run_scheduled_now).pack(side=tk.LEFT)

        # Фоновый режим (отдельный процесс без окна)
        bg = ttk.LabelFrame(f, text="Работа в фоне (без окна)", padding=10)
        bg.grid(row=7, column=0, columnspan=3, sticky=tk.EW, pady=12)
        ttk.Label(
            bg,
            text=(
                "Фоновый демон работает отдельно от этого окна: можно закрыть программу — "
                "очистка по расписанию продолжится. Нужен файл glpi-cleaner-cli.exe "
                "в той же папке (или запуск из исходников)."
            ),
            wraplength=780,
        ).pack(anchor=tk.W)
        bg_btns = ttk.Frame(bg)
        bg_btns.pack(anchor=tk.W, pady=8)
        ttk.Button(bg_btns, text="Запустить в фоне", command=self._start_background).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(bg_btns, text="Остановить фон", command=self._stop_background).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(bg_btns, text="Свернуть в трей", command=self._minimize_to_tray).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Checkbutton(
            bg,
            text="При закрытии окна — сворачивать в трей (а не завершать программу)",
            variable=self.close_to_tray_var,
        ).pack(anchor=tk.W)
        self.daemon_status_var = tk.StringVar(value=daemon_status_text())
        ttk.Label(bg, textvariable=self.daemon_status_var, font=("", 10, "bold")).pack(
            anchor=tk.W, pady=(6, 0)
        )

        self.next_run_var = tk.StringVar(value="Следующий запуск: —")
        ttk.Label(f, textvariable=self.next_run_var, font=("", 11, "bold")).grid(
            row=8, column=0, columnspan=3, sticky=tk.W, pady=12
        )
        self.sched_status = tk.StringVar(value="")
        ttk.Label(f, textvariable=self.sched_status, wraplength=800).grid(
            row=9, column=0, columnspan=3, sticky=tk.W
        )

    def _build_deleted_tab(self) -> None:
        f = self.tab_deleted
        self.del_id_var = tk.StringVar()
        self.del_from_var = tk.StringVar()
        self.del_to_var = tk.StringVar()
        self.del_sector_var = tk.StringVar()
        self.del_req_var = tk.StringVar()
        self.del_title_var = tk.StringVar()
        self.del_sort_var = tk.StringVar(value="deleted_at")
        self.del_page_var = tk.IntVar(value=1)
        self._deleted_rows: list = []
        self._deleted_page_size = 50

        filt = ttk.Frame(f)
        filt.pack(fill=tk.X, pady=(0, 6))
        ttk.Label(filt, text="№ заявки").grid(row=0, column=0, sticky=tk.W)
        ttk.Entry(filt, textvariable=self.del_id_var, width=12).grid(row=0, column=1, padx=4)
        ttk.Label(filt, text="С даты").grid(row=0, column=2)
        ttk.Entry(filt, textvariable=self.del_from_var, width=12).grid(row=0, column=3, padx=4)
        ttk.Label(filt, text="По дату").grid(row=0, column=4)
        ttk.Entry(filt, textvariable=self.del_to_var, width=12).grid(row=0, column=5, padx=4)
        ttk.Label(filt, text="Сектор").grid(row=1, column=0, sticky=tk.W, pady=4)
        ttk.Entry(filt, textvariable=self.del_sector_var, width=16).grid(row=1, column=1, padx=4)
        ttk.Label(filt, text="Инициатор").grid(row=1, column=2)
        ttk.Entry(filt, textvariable=self.del_req_var, width=16).grid(row=1, column=3, padx=4)
        ttk.Label(filt, text="Тема").grid(row=1, column=4)
        ttk.Entry(filt, textvariable=self.del_title_var, width=20).grid(row=1, column=5, padx=4)

        btns = ttk.Frame(f)
        btns.pack(fill=tk.X, pady=4)
        ttk.Button(btns, text="Найти", command=self._reload_deleted).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(btns, text="Сбросить", command=self._reset_deleted_filters).pack(
            side=tk.LEFT, padx=(0, 6)
        )
        ttk.Button(btns, text="Выгрузить Excel (фильтр)", command=self._export_deleted_filtered).pack(
            side=tk.LEFT, padx=(0, 6)
        )
        ttk.Label(btns, text="Сортировка:").pack(side=tk.LEFT, padx=(12, 4))
        ttk.Combobox(
            btns,
            textvariable=self.del_sort_var,
            values=("deleted_at", "ticket_id"),
            width=12,
            state="readonly",
        ).pack(side=tk.LEFT)

        self.deleted_count_var = tk.StringVar(value="Найдено: 0")
        ttk.Label(f, textvariable=self.deleted_count_var).pack(anchor=tk.W)

        cols = ("ticket_id", "deleted_at", "status", "opened", "sector", "requester", "title")
        self.deleted_tree = ttk.Treeview(f, columns=cols, show="headings", height=16)
        headers = {
            "ticket_id": "№ GLPI",
            "deleted_at": "Удалено",
            "status": "Статус",
            "opened": "Открыта",
            "sector": "Сектор",
            "requester": "Инициатор",
            "title": "Тема",
        }
        widths = {
            "ticket_id": 80,
            "deleted_at": 130,
            "status": 60,
            "opened": 130,
            "sector": 120,
            "requester": 120,
            "title": 220,
        }
        for c in cols:
            self.deleted_tree.heading(c, text=headers[c])
            self.deleted_tree.column(c, width=widths[c])
        self.deleted_tree.pack(fill=tk.BOTH, expand=True, pady=4)
        nav = ttk.Frame(f)
        nav.pack(fill=tk.X)
        ttk.Button(nav, text="◀", command=self._deleted_prev_page).pack(side=tk.LEFT)
        self.deleted_page_label = tk.StringVar(value="Стр. 1")
        ttk.Label(nav, textvariable=self.deleted_page_label).pack(side=tk.LEFT, padx=8)
        ttk.Button(nav, text="▶", command=self._deleted_next_page).pack(side=tk.LEFT)

    def _build_export_tab(self) -> None:
        f = self.tab_export
        self.exp_enabled_var = tk.BooleanVar(value=False)
        self.exp_mode_var = tk.StringVar(value="daily")
        self.exp_time_var = tk.StringVar(value="23:30")
        self.exp_scope_var = tk.StringVar(value="all")
        self.exp_days_var = tk.StringVar(value="1")
        self.exp_path_var = tk.StringVar()
        self.exp_folder_fmt_var = tk.StringVar(value="%Y-%m-%d")
        self.exp_file_tpl_var = tk.StringVar(value="deleted_tickets_{datetime}.xlsx")
        self.exp_smb_user_var = tk.StringVar()
        self.exp_smb_pass_var = tk.StringVar()
        self.exp_smb_domain_var = tk.StringVar()

        ttk.Checkbutton(
            f, text="Включить автоматическую выгрузку Excel", variable=self.exp_enabled_var
        ).grid(row=0, column=0, columnspan=2, sticky=tk.W, pady=4)

        ttk.Label(f, text="Периодичность:").grid(row=1, column=0, sticky=tk.W)
        ttk.Combobox(
            f,
            textvariable=self.exp_mode_var,
            values=("daily", "weekly", "interval"),
            width=12,
            state="readonly",
        ).grid(row=1, column=1, sticky=tk.W)
        ttk.Label(f, text="Время (ЧЧ:ММ):").grid(row=2, column=0, sticky=tk.W)
        ttk.Entry(f, textvariable=self.exp_time_var, width=8).grid(row=2, column=1, sticky=tk.W)
        ttk.Label(f, text="Объём:").grid(row=3, column=0, sticky=tk.W)
        ttk.Combobox(
            f,
            textvariable=self.exp_scope_var,
            values=("all", "since_last", "last_n_days"),
            width=14,
            state="readonly",
        ).grid(row=3, column=1, sticky=tk.W)
        ttk.Label(f, text="last_n_days:").grid(row=4, column=0, sticky=tk.W)
        ttk.Entry(f, textvariable=self.exp_days_var, width=6).grid(row=4, column=1, sticky=tk.W)

        ttk.Label(f, text="Путь сохранения (локальный или \\\\server\\share\\...):").grid(
            row=5, column=0, sticky=tk.W, pady=(10, 0)
        )
        ttk.Entry(f, textvariable=self.exp_path_var, width=70).grid(
            row=6, column=0, columnspan=2, sticky=tk.EW, pady=4
        )
        ttk.Label(f, text="Формат папки по дате:").grid(row=7, column=0, sticky=tk.W)
        ttk.Entry(f, textvariable=self.exp_folder_fmt_var, width=20).grid(row=7, column=1, sticky=tk.W)
        ttk.Label(f, text="Шаблон имени файла:").grid(row=8, column=0, sticky=tk.W)
        ttk.Entry(f, textvariable=self.exp_file_tpl_var, width=40).grid(row=8, column=1, sticky=tk.W)

        smb = ttk.LabelFrame(f, text="Учётные данные сетевой папки (SMB)", padding=8)
        smb.grid(row=9, column=0, columnspan=2, sticky=tk.EW, pady=10)
        ttk.Label(smb, text="Домен:").grid(row=0, column=0, sticky=tk.W)
        ttk.Entry(smb, textvariable=self.exp_smb_domain_var, width=20).grid(row=0, column=1, padx=4)
        ttk.Label(smb, text="Логин:").grid(row=0, column=2, sticky=tk.W)
        ttk.Entry(smb, textvariable=self.exp_smb_user_var, width=20).grid(row=0, column=3, padx=4)
        ttk.Label(smb, text="Пароль:").grid(row=1, column=0, sticky=tk.W, pady=4)
        ttk.Entry(smb, textvariable=self.exp_smb_pass_var, width=20, show="*").grid(
            row=1, column=1, padx=4
        )
        ttk.Label(smb, text="(хранится зашифрованным в config.json)").grid(
            row=1, column=2, columnspan=2, sticky=tk.W
        )

        btns = ttk.Frame(f)
        btns.grid(row=10, column=0, columnspan=2, sticky=tk.W, pady=8)
        ttk.Button(btns, text="Сохранить", command=self._save_export).pack(side=tk.LEFT, padx=(0, 8))
        ttk.Button(btns, text="Проверить доступ", command=self._test_export_path).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        ttk.Button(btns, text="Выгрузить сейчас", command=self._export_now).pack(side=tk.LEFT)
        self.export_status = tk.StringVar(value="")
        ttk.Label(f, textvariable=self.export_status, wraplength=800).grid(
            row=11, column=0, columnspan=2, sticky=tk.W, pady=6
        )
        f.columnconfigure(1, weight=1)

    def _build_log_tab(self) -> None:
        f = self.tab_log
        btns = ttk.Frame(f)
        btns.pack(fill=tk.X, pady=(0, 6))
        ttk.Button(btns, text="Очистить", command=self._clear_log).pack(side=tk.LEFT, padx=(0, 8))
        ttk.Button(btns, text="Открыть папку логов", command=self._open_log_folder).pack(
            side=tk.LEFT
        )
        body = ttk.Frame(f)
        body.pack(fill=tk.BOTH, expand=True)
        self.log_text = tk.Text(body, wrap=tk.WORD, height=28, state=tk.DISABLED)
        self.log_text.pack(fill=tk.BOTH, expand=True, side=tk.LEFT)
        scroll = ttk.Scrollbar(body, command=self.log_text.yview)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.configure(yscrollcommand=scroll.set)

    def _append_log(self, message: str) -> None:
        def _ui() -> None:
            self.log_text.configure(state=tk.NORMAL)
            self.log_text.insert(tk.END, message + "\n")
            self.log_text.see(tk.END)
            self.log_text.configure(state=tk.DISABLED)

        self.after(0, _ui)

    def _clear_log(self) -> None:
        self.log_text.configure(state=tk.NORMAL)
        self.log_text.delete("1.0", tk.END)
        self.log_text.configure(state=tk.DISABLED)

    def _open_log_folder(self) -> None:
        import os
        import subprocess

        path = str(logs_dir())
        if os.name == "nt":
            os.startfile(path)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", path])

    # ── config ↔ form ───────────────────────────────────────────────

    def _load_into_form(self) -> None:
        g = self.config_data.get("glpi") or {}
        d = self.config_data.get("deletion") or {}
        s = self.config_data.get("schedule") or {}

        self.url_var.set(g.get("url") or "")
        self.app_token_var.set(g.get("app_token") or "")
        self.user_token_var.set(g.get("user_token") or "")
        self.verify_ssl_var.set(bool(g.get("verify_ssl", True)))
        self.timeout_var.set(str(g.get("timeout") or 120))

        self.age_value_var.set(str(d.get("max_age_value") or 1))
        self.age_unit_var.set(str(d.get("max_age_unit") or "years"))
        self.date_field_var.set(str(d.get("date_field") or "date"))
        statuses = d.get("statuses") or [5, 6]
        self.statuses_var.set(",".join(str(x) for x in statuses))
        self.dry_run_var.set(bool(d.get("dry_run", True)))
        self.force_purge_var.set(bool(d.get("force_purge", False)))

        self.sched_enabled_var.set(bool(s.get("enabled", False)))
        self.sched_mode_var.set(str(s.get("mode") or "daily"))
        self.sched_time_var.set(str(s.get("time") or "00:00"))
        self.sched_interval_var.set(str(s.get("interval_hours") or 24))
        self.sched_dow_var.set(str(s.get("day_of_week") or "mon"))
        self.sched_dom_var.set(str(s.get("day_of_month") or 1))

        e = self.config_data.get("export") or {}
        smb = e.get("smb") or {}
        self.exp_enabled_var.set(bool(e.get("enabled", False)))
        self.exp_mode_var.set(str(e.get("mode") or "daily"))
        self.exp_time_var.set(str(e.get("time") or "23:30"))
        self.exp_scope_var.set(str(e.get("scope") or "all"))
        self.exp_days_var.set(str(e.get("last_n_days") or 1))
        self.exp_path_var.set(str(e.get("base_path") or ""))
        self.exp_folder_fmt_var.set(str(e.get("folder_date_format") or "%Y-%m-%d"))
        self.exp_file_tpl_var.set(
            str(e.get("filename_template") or "deleted_tickets_{datetime}.xlsx")
        )
        self.exp_smb_user_var.set(str(smb.get("username") or ""))
        self.exp_smb_domain_var.set(str(smb.get("domain") or ""))
        self.exp_smb_pass_var.set("")  # не показываем пароль

    def _read_form_into_config(self) -> dict[str, Any]:
        statuses = []
        for part in self.statuses_var.get().split(","):
            part = part.strip()
            if part:
                statuses.append(int(part))
        if not statuses:
            statuses = [5, 6]

        cfg = dict(self.config_data)
        cfg["glpi"] = {
            "url": self.url_var.get().strip(),
            "app_token": self.app_token_var.get().strip(),
            "user_token": self.user_token_var.get().strip(),
            "verify_ssl": bool(self.verify_ssl_var.get()),
            "timeout": int(self.timeout_var.get() or 120),
        }
        prev_del = cfg.get("deletion") or {}
        cfg["deletion"] = {
            **prev_del,
            "max_age_value": int(self.age_value_var.get() or 1),
            "max_age_unit": self.age_unit_var.get(),
            "date_field": self.date_field_var.get(),
            "statuses": statuses,
            "force_purge": bool(self.force_purge_var.get()),
            "dry_run": bool(self.dry_run_var.get()),
        }
        cfg["schedule"] = {
            "enabled": bool(self.sched_enabled_var.get()),
            "mode": self.sched_mode_var.get(),
            "time": self.sched_time_var.get().strip(),
            "interval_hours": int(self.sched_interval_var.get() or 24),
            "day_of_week": self.sched_dow_var.get(),
            "day_of_month": int(self.sched_dom_var.get() or 1),
        }
        prev_exp = cfg.get("export") or {}
        prev_smb = prev_exp.get("smb") or {}
        smb = {
            "username": self.exp_smb_user_var.get().strip(),
            "domain": self.exp_smb_domain_var.get().strip(),
            "password_enc": prev_smb.get("password_enc") or "",
        }
        plain = self.exp_smb_pass_var.get()
        if plain:
            smb["password_enc"] = encrypt_secret(plain)
        cfg["export"] = {
            **prev_exp,
            "enabled": bool(self.exp_enabled_var.get()),
            "mode": self.exp_mode_var.get(),
            "time": self.exp_time_var.get().strip(),
            "scope": self.exp_scope_var.get(),
            "last_n_days": int(self.exp_days_var.get() or 1),
            "base_path": self.exp_path_var.get().strip(),
            "folder_date_format": self.exp_folder_fmt_var.get().strip() or "%Y-%m-%d",
            "filename_template": self.exp_file_tpl_var.get().strip()
            or "deleted_tickets_{datetime}.xlsx",
            "smb": smb,
        }
        self.config_data = cfg
        return cfg

    def _save_connection(self) -> None:
        self._read_form_into_config()
        path = save_config(self.config_data)
        self.conn_status.set(f"Сохранено: {path}")
        self.log.info("Настройки подключения сохранены")

    def _save_rules(self) -> None:
        self._read_form_into_config()
        path = save_config(self.config_data)
        self.rules_status.set(f"Правила сохранены: {path}")
        self.log.info("Правила удаления сохранены")

    def _save_schedule(self) -> None:
        self._read_form_into_config()
        path = save_config(self.config_data)
        self.sched_status.set(f"Расписание сохранено: {path}")
        self.log.info("Расписание сохранено")
        if self.sched_enabled_var.get() and self.scheduler.running:
            self._start_scheduler()

    def _save_export(self) -> None:
        self._read_form_into_config()
        path = save_config(self.config_data)
        self.exp_smb_pass_var.set("")
        self.export_status.set(f"Настройки выгрузки сохранены: {path}")
        self.log.info("Настройки выгрузки сохранены")
        if self.scheduler.running:
            self._start_scheduler()

    def _test_export_path(self) -> None:
        self._read_form_into_config()
        path = self.exp_path_var.get().strip()
        ok, msg = test_path_access(path, self.config_data)
        self.export_status.set(msg)
        if ok:
            self.log.info("Проверка пути: ok")
        else:
            self.log.error("Проверка пути: fail")

    def _export_now(self) -> None:
        self._read_form_into_config()
        save_config(self.config_data)
        if not self.exp_path_var.get().strip():
            messagebox.showwarning("Путь", "Укажите путь сохранения выгружаемых файлов")
            return

        def work() -> None:
            try:
                cfg = dict(self.config_data)
                exp = dict(cfg.get("export") or {})
                exp["enabled"] = True
                cfg["export"] = exp
                out = export_journal(cfg)
                self.after(
                    0,
                    lambda: self.export_status.set(f"Выгружено: {out}"),
                )
                self.log.info("Ручная выгрузка: %s", out)
            except Exception as exc:
                self.log.exception("Выгрузка: %s", exc)
                self.after(0, lambda: self.export_status.set(f"Ошибка: {exc}"))

        threading.Thread(target=work, daemon=True).start()

    def _deleted_filters(self) -> dict:
        return {
            "ticket_id": self.del_id_var.get().strip() or None,
            "date_from": self.del_from_var.get().strip() or None,
            "date_to": self.del_to_var.get().strip() or None,
            "sector": self.del_sector_var.get().strip() or None,
            "requester": self.del_req_var.get().strip() or None,
            "title": self.del_title_var.get().strip() or None,
            "sort_by": self.del_sort_var.get() or "deleted_at",
            "sort_desc": True,
        }

    def _reload_deleted(self) -> None:
        try:
            self._deleted_rows = query_records(**self._deleted_filters())
        except Exception as exc:
            self.log.exception("Журнал удалённых: %s", exc)
            self._deleted_rows = []
        self.del_page_var.set(1)
        self._render_deleted_page()

    def _reset_deleted_filters(self) -> None:
        self.del_id_var.set("")
        self.del_from_var.set("")
        self.del_to_var.set("")
        self.del_sector_var.set("")
        self.del_req_var.set("")
        self.del_title_var.set("")
        self._reload_deleted()

    def _render_deleted_page(self) -> None:
        for item in self.deleted_tree.get_children():
            self.deleted_tree.delete(item)
        total = len(self._deleted_rows)
        page = max(1, int(self.del_page_var.get() or 1))
        size = self._deleted_page_size
        pages = max(1, (total + size - 1) // size)
        if page > pages:
            page = pages
            self.del_page_var.set(page)
        start = (page - 1) * size
        chunk = self._deleted_rows[start : start + size]
        for row in chunk:
            self.deleted_tree.insert(
                "",
                tk.END,
                values=(
                    row.get("ticket_id"),
                    row.get("deleted_at"),
                    row.get("status"),
                    row.get("opened"),
                    row.get("sector"),
                    row.get("requester"),
                    (row.get("title") or "")[:80],
                ),
            )
        self.deleted_count_var.set(f"Найдено: {total}")
        self.deleted_page_label.set(f"Стр. {page} / {pages}")

    def _deleted_prev_page(self) -> None:
        self.del_page_var.set(max(1, int(self.del_page_var.get() or 1) - 1))
        self._render_deleted_page()

    def _deleted_next_page(self) -> None:
        self.del_page_var.set(int(self.del_page_var.get() or 1) + 1)
        self._render_deleted_page()

    def _export_deleted_filtered(self) -> None:
        self._read_form_into_config()
        path = self.exp_path_var.get().strip()
        if not path:
            messagebox.showwarning("Путь", "Сначала укажите путь на вкладке «Выгрузка»")
            return

        def work() -> None:
            try:
                out = export_journal(self.config_data, filters=self._deleted_filters())
                self.after(0, lambda: messagebox.showinfo("Excel", f"Файл: {out}"))
                self.log.info("Выгрузка по фильтру: %s", out)
            except Exception as exc:
                self.log.exception("%s", exc)
                self.after(0, lambda: messagebox.showerror("Ошибка", str(exc)))

        threading.Thread(target=work, daemon=True).start()

    # ── actions ─────────────────────────────────────────────────────

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        self.status_var.set("Выполняется…" if busy else f"Папка программы: {app_dir()}")

    def _test_connection(self) -> None:
        if self._busy:
            return
        self._read_form_into_config()
        self._set_busy(True)
        self.conn_status.set("Проверка…")

        def work() -> None:
            try:
                client = GlpiClient(
                    url=self.config_data["glpi"]["url"],
                    app_token=self.config_data["glpi"]["app_token"],
                    user_token=self.config_data["glpi"]["user_token"],
                    verify_ssl=self.config_data["glpi"].get("verify_ssl", True),
                    timeout=int(self.config_data["glpi"].get("timeout") or 120),
                )
                info = client.test_connection()
                msg = info["message"]
                if info.get("entity") is not None:
                    msg += f"\nОрганизация: {info['entity']}"
                self.after(0, lambda: self.conn_status.set(msg))
                self.log.info(info["message"])
            except Exception as exc:
                err = f"Ошибка подключения: {exc}"
                self.after(0, lambda: self.conn_status.set(err))
                self.log.error(err)
            finally:
                self.after(0, lambda: self._set_busy(False))

        threading.Thread(target=work, daemon=True).start()

    def _fill_preview(self, rows: list[dict]) -> None:
        for item in self.tree.get_children():
            self.tree.delete(item)
        for row in rows:
            self.tree.insert(
                "",
                tk.END,
                values=(
                    row.get("id"),
                    row.get("status_label") or STATUS_LABELS.get(row.get("status"), ""),
                    row.get("opened"),
                    (row.get("title") or "")[:120],
                ),
            )

    def _run_cleaner(self, dry_run: bool, confirm_delete: bool = False) -> None:
        if self._busy:
            messagebox.showinfo("Занято", "Дождитесь окончания текущей операции.")
            return
        self._read_form_into_config()
        save_config(self.config_data)

        if confirm_delete and not dry_run:
            force = self.config_data["deletion"].get("force_purge")
            warn = (
                "Будет выполнено РЕАЛЬНОЕ удаление заявок.\n\n"
                + (
                    "Включён force_purge — удаление БЕЗВОЗВРАТНОЕ.\n\n"
                    if force
                    else "Заявки попадут в корзину GLPI (можно восстановить).\n\n"
                )
                + "Сначала рекомендуем Dry-Run.\nПродолжить?"
            )
            if not messagebox.askyesno("Подтверждение", warn):
                return

        self._set_busy(True)
        self.rules_status.set("Выполняется…")

        def work() -> None:
            try:
                cfg = dict(self.config_data)
                cfg["runtime"] = {**(cfg.get("runtime") or {}), "source": "gui"}
                cleaner = TicketCleaner(cfg)
                self._cleaner = cleaner
                result = cleaner.run(dry_run_override=dry_run)

                def done() -> None:
                    self._fill_preview(result.preview)
                    self.rules_status.set(result.message)
                    if not dry_run:
                        self._reload_deleted()
                    if confirm_delete and not dry_run and result.deleted > 10:
                        messagebox.showinfo(
                            "Готово",
                            f"Удалено заявок: {result.deleted}\n{result.message}",
                        )
                    self._set_busy(False)

                self.after(0, done)
            except Exception as exc:
                err = f"Ошибка: {exc}"
                self.log.exception(err)
                self.after(0, lambda: (self.rules_status.set(err), self._set_busy(False)))

        threading.Thread(target=work, daemon=True).start()

    def _preview(self) -> None:
        self.dry_run_var.set(True)
        self._run_cleaner(dry_run=True)

    def _delete_now(self) -> None:
        # Двойное подтверждение при потенциально большом объёме
        self._read_form_into_config()
        if self.dry_run_var.get():
            if not messagebox.askyesno(
                "Dry-Run включён",
                "Сейчас включён Dry-Run — будет только предпросмотр.\n"
                "Чтобы удалить, снимите галочку Dry-Run и нажмите снова.\n\n"
                "Запустить предпросмотр?",
            ):
                return
            self._run_cleaner(dry_run=True)
            return

        if not messagebox.askyesno(
            "Первое подтверждение",
            "Вы собираетесь УДАЛИТЬ заявки по текущим правилам.\n"
            "Это действие может затронуть много записей.\n\n"
            "Продолжить?",
        ):
            return
        if not messagebox.askyesno(
            "Второе подтверждение",
            "Точно удалить? Рекомендуется сначала сделать Dry-Run и резервную копию БД GLPI.",
        ):
            return
        self._run_cleaner(dry_run=False, confirm_delete=True)

    def _job(self) -> None:
        cfg = load_config()
        cfg = dict(cfg)
        cfg["runtime"] = {**(cfg.get("runtime") or {}), "source": "gui"}
        self.config_data = cfg
        cleaner = TicketCleaner(cfg)
        try:
            result = cleaner.run()
            self.log.info(result.message)
            self.after(0, lambda: self.next_run_var.set(
                f"Следующий запуск: {self.scheduler.next_run() or '—'}"
            ))
            self.after(0, self._reload_deleted)
        except Exception as exc:
            self.log.exception("Ошибка по расписанию: %s", exc)

    def _export_job(self) -> None:
        cfg = load_config()
        try:
            out = run_scheduled_export(cfg)
            if out:
                self.log.info("Автовыгрузка Excel: %s", out)
        except Exception as exc:
            self.log.exception("Ошибка автовыгрузки: %s", exc)

    def _start_scheduler_silent(self) -> None:
        try:
            self._read_form_into_config()
            self.scheduler.start(
                self.config_data["schedule"],
                self._job,
                export_cfg=self.config_data.get("export"),
                export_job=self._export_job,
            )
            self.next_run_var.set(f"Следующий запуск: {self.scheduler.next_run() or '—'}")
        except Exception as exc:
            self.log.error("Не удалось автозапустить планировщик: %s", exc)

    def _start_scheduler(self) -> None:
        self._read_form_into_config()
        self.config_data["schedule"]["enabled"] = True
        self.sched_enabled_var.set(True)
        save_config(self.config_data)
        try:
            if self.scheduler.running:
                self.scheduler.stop()
            self.scheduler.start(
                self.config_data["schedule"],
                self._job,
                export_cfg=self.config_data.get("export"),
                export_job=self._export_job,
            )
            nxt = self.scheduler.next_run()
            self.next_run_var.set(f"Следующий запуск: {nxt or '—'}")
            exp = self.scheduler.next_export_run()
            msg = "Планировщик запущен"
            if exp:
                msg += f"; выгрузка Excel: {exp}"
            self.sched_status.set(msg)
        except Exception as exc:
            messagebox.showerror("Ошибка", str(exc))

    def _stop_scheduler(self) -> None:
        self.scheduler.stop()
        self.sched_enabled_var.set(False)
        self._read_form_into_config()
        self.config_data["schedule"]["enabled"] = False
        save_config(self.config_data)
        self.next_run_var.set("Следующий запуск: —")
        self.sched_status.set("Планировщик остановлен")

    def _run_scheduled_now(self) -> None:
        if self._busy:
            messagebox.showinfo("Занято", "Дождитесь окончания текущей операции.")
            return
        threading.Thread(target=self._job, daemon=True).start()
        self.sched_status.set("Разовый запуск по текущим правилам (см. Журнал)")

    def _refresh_daemon_status(self) -> None:
        try:
            self.daemon_status_var.set(daemon_status_text())
        except Exception:
            pass
        self.after(3000, self._refresh_daemon_status)

    def _start_background(self) -> None:
        self._read_form_into_config()
        self.config_data["schedule"]["enabled"] = True
        self.sched_enabled_var.set(True)
        save_config(self.config_data)
        # Встроенный планировщик окна не нужен — работает отдельный процесс
        try:
            if self.scheduler.running:
                self.scheduler.stop()
        except Exception:
            pass
        try:
            pid = start_daemon()
            self.daemon_status_var.set(daemon_status_text())
            self.sched_status.set(
                f"Фоновый демон запущен (PID {pid}). Окно можно закрыть — очистка продолжится."
            )
            self.next_run_var.set("Следующий запуск: по расписанию фонового демона (см. logs)")
            messagebox.showinfo(
                "Фон",
                "Программа работает в фоне.\n\n"
                "Окно можно закрыть — удаление по расписанию продолжится.\n"
                "Остановить: кнопка «Остановить фон» или служба/процесс glpi-cleaner-cli.",
            )
        except Exception as exc:
            messagebox.showerror("Не удалось запустить фон", str(exc))
            self.log.exception("start_daemon: %s", exc)

    def _stop_background(self) -> None:
        try:
            stop_daemon()
            self.daemon_status_var.set(daemon_status_text())
            self.sched_status.set("Фоновый демон остановлен")
        except Exception as exc:
            messagebox.showerror("Ошибка", str(exc))

    def _make_tray_icon_image(self):
        try:
            from PIL import Image, ImageDraw

            img = Image.new("RGB", (64, 64), color=(30, 90, 160))
            draw = ImageDraw.Draw(img)
            draw.rectangle((12, 12, 52, 52), fill=(240, 240, 240))
            draw.text((22, 20), "G", fill=(30, 90, 160))
            return img
        except Exception:
            return None

    def _minimize_to_tray(self) -> None:
        try:
            import pystray
        except ImportError:
            messagebox.showwarning(
                "Трей недоступен",
                "Не установлен пакет pystray.\n"
                "Выполните: pip install pystray pillow\n"
                "Или используйте «Запустить в фоне» — это надёжнее для сервера.",
            )
            return

        if self._tray is not None:
            self.withdraw()
            return

        image = self._make_tray_icon_image()
        if image is None:
            messagebox.showwarning(
                "Трей",
                "Не удалось создать значок (нужен pillow). Используйте «Запустить в фоне».",
            )
            return

        def on_show(icon, item):  # noqa: ARG001
            self.after(0, self._restore_from_tray)

        def on_quit(icon, item):  # noqa: ARG001
            self.after(0, lambda: self._quit_fully(stop_bg=False))

        menu = pystray.Menu(
            pystray.MenuItem("Открыть окно", on_show, default=True),
            pystray.MenuItem("Выход", on_quit),
        )
        self._tray = pystray.Icon("glpi_cleaner", image, "GLPI Cleaner", menu)
        self.withdraw()
        self._tray_thread = threading.Thread(target=self._tray.run, daemon=True)
        self._tray_thread.start()
        self.log.info("Окно свёрнуто в системный трей")

    def _restore_from_tray(self) -> None:
        self.deiconify()
        self.lift()
        if self._tray is not None:
            try:
                self._tray.stop()
            except Exception:
                pass
            self._tray = None

    def _quit_fully(self, stop_bg: bool = False) -> None:
        if stop_bg:
            try:
                stop_daemon()
            except Exception:
                pass
        unsubscribe_gui(self._append_log)
        try:
            self.scheduler.stop()
        except Exception:
            pass
        if self._tray is not None:
            try:
                self._tray.stop()
            except Exception:
                pass
            self._tray = None
        self.destroy()

    def _on_close(self) -> None:
        # Фоновый демон продолжает работать даже после закрытия GUI
        bg_running = is_daemon_running()
        if self.close_to_tray_var.get() and not bg_running:
            self._minimize_to_tray()
            return
        if bg_running:
            if messagebox.askyesno(
                "Закрытие",
                "Фоновый демон сейчас работает.\n\n"
                "Закрыть только окно (фон продолжит работу)?\n"
                "Нет — также остановить фон.",
            ):
                self._quit_fully(stop_bg=False)
            else:
                self._quit_fully(stop_bg=True)
            return
        self._quit_fully(stop_bg=False)


def run_app() -> None:
    app = GlpiCleanerApp()
    app.mainloop()
