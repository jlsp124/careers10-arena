from __future__ import annotations

import json
import os
import queue
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import END, LEFT, RIGHT, BOTH, X, Y, Listbox, PhotoImage, StringVar, Tk, Text, messagebox
from tkinter import ttk


def _resource_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent)).resolve()
    return Path(__file__).resolve().parents[1].resolve()


def _app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return _resource_root()


RESOURCE_ROOT = _resource_root()
APP_ROOT = _app_root()
ROOT = RESOURCE_ROOT
SERVER_APP = RESOURCE_ROOT / "server" / "app.py"
SERVER_DIR = RESOURCE_ROOT / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from util import RUNTIME_PATHS  # noqa: E402


CONTROL_CONFIG_PATH = RUNTIME_PATHS.world_state_dir / "host_control.json"
LOGO_PATH = ROOT / "web" / "assets" / "ca-logo-mark.png"

PALETTE = {
    "bg": "#090b12",
    "panel": "#111724",
    "panel_alt": "#151d2b",
    "field": "#070a10",
    "text": "#f3f7ff",
    "muted": "#8f9cb0",
    "green": "#62f7b1",
    "cyan": "#67d8ff",
    "danger": "#ff6f8f",
}


def _server_command(host: str, port: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [str(Path(sys.executable).resolve()), "--server", "--host", host, "--port", port]
    return [sys.executable, str(SERVER_APP), "--host", host, "--port", port]


class HostControlApp:
    def __init__(self) -> None:
        self.root = Tk()
        self.root.title("Cortisol Host")
        self.root.geometry("1120x760")
        self.root.minsize(980, 680)
        self.root.configure(bg=PALETTE["bg"])

        self.process: subprocess.Popen[str] | None = None
        self.token = secrets.token_urlsafe(32)
        self.output_queue: queue.Queue[str] = queue.Queue()
        self.last_status: dict = {}
        self.user_rows: list[dict] = []
        self.snapshot_rows: list[dict] = []
        self.config = self._load_config()
        self.logo_image = self._load_logo()

        self.host_var = StringVar(value=str(self.config.get("host", "0.0.0.0")))
        self.port_var = StringVar(value=str(self.config.get("port", "8080")))
        self.join_url_var = StringVar(value=str(self.config.get("join_url", "")))
        self.passphrase_var = StringVar(value="")
        self.note_var = StringVar(value="Manual Host backup")
        self.announce_var = StringVar(value="")
        self.minutes_var = StringVar(value="10")

        self.status_vars = {
            "state": StringVar(value="Stopped"),
            "local": StringVar(value="http://localhost:8080/"),
            "join": StringVar(value=""),
            "world": StringVar(value="No world status yet"),
            "dirty": StringVar(value="Dirty: unknown"),
            "sync": StringVar(value="Sync: unknown"),
            "secret": StringVar(value="Secret: unknown"),
        }

        self._build_style()
        self._build_ui()
        self._drain_output()
        self._poll_process()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def run(self) -> None:
        self.root.mainloop()

    def _load_logo(self) -> PhotoImage | None:
        if not LOGO_PATH.exists():
            return None
        try:
            return PhotoImage(file=str(LOGO_PATH)).subsample(10, 10)
        except Exception:
            return None

    def _build_style(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure(".", background=PALETTE["bg"], foreground=PALETTE["text"], fieldbackground=PALETTE["panel"])
        style.configure("TFrame", background=PALETTE["bg"])
        style.configure("Panel.TFrame", background=PALETTE["panel"])
        style.configure("TLabel", background=PALETTE["bg"], foreground=PALETTE["text"])
        style.configure("Panel.TLabel", background=PALETTE["panel"], foreground=PALETTE["text"])
        style.configure("Title.TLabel", background=PALETTE["bg"], foreground=PALETTE["text"], font=("Segoe UI", 18, "bold"))
        style.configure("Small.TLabel", background=PALETTE["bg"], foreground=PALETTE["muted"], font=("Segoe UI", 9))
        style.configure("Card.TLabel", background=PALETTE["panel"], foreground=PALETTE["text"], font=("Segoe UI", 10, "bold"))
        style.configure("Logo.TLabel", background=PALETTE["bg"])
        style.configure("TButton", padding=(10, 6), background="#1e283a", foreground=PALETTE["text"], bordercolor="#253044")
        style.map("TButton", background=[("active", "#27354c")])
        style.configure("Accent.TButton", background="#126044", foreground="#ffffff")
        style.map("Accent.TButton", background=[("active", "#16865d")])
        style.configure("Danger.TButton", background="#7b2b42", foreground="#ffffff")
        style.map("Danger.TButton", background=[("active", "#9b3653")])
        style.configure("TEntry", fieldbackground=PALETTE["field"], foreground=PALETTE["text"], bordercolor="#253044")
        style.configure("TNotebook", background=PALETTE["bg"], borderwidth=0)
        style.configure("TNotebook.Tab", background="#151d2b", foreground=PALETTE["text"], padding=(12, 7))
        style.map("TNotebook.Tab", background=[("selected", "#1e283a")])

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=16)
        outer.pack(fill=BOTH, expand=True)

        header = ttk.Frame(outer)
        header.pack(fill=X)
        if self.logo_image:
            ttk.Label(header, image=self.logo_image, style="Logo.TLabel").pack(side=LEFT, padx=(0, 10))
        ttk.Label(header, text="Cortisol Host", style="Title.TLabel").pack(side=LEFT)
        ttk.Label(header, textvariable=self.status_vars["state"], style="Small.TLabel").pack(side=RIGHT)

        controls = ttk.Frame(outer, style="Panel.TFrame", padding=12)
        controls.pack(fill=X, pady=(14, 10))
        self._labeled_entry(controls, "Bind", self.host_var, width=14).pack(side=LEFT, padx=(0, 10))
        self._labeled_entry(controls, "Port", self.port_var, width=8).pack(side=LEFT, padx=(0, 10))
        self._labeled_entry(controls, "Join URL override", self.join_url_var, width=36).pack(side=LEFT, padx=(0, 10))
        ttk.Button(controls, text="Start Host", style="Accent.TButton", command=self.start_host).pack(side=LEFT, padx=4)
        ttk.Button(controls, text="Stop Host", style="Danger.TButton", command=self.stop_host).pack(side=LEFT, padx=4)
        ttk.Button(controls, text="Open Client", command=self.open_client).pack(side=LEFT, padx=4)
        ttk.Button(controls, text="Refresh", command=self.refresh_status).pack(side=LEFT, padx=4)

        cards = ttk.Frame(outer)
        cards.pack(fill=X, pady=(0, 10))
        for key, title in (
            ("local", "Local URL"),
            ("join", "Join URL"),
            ("world", "World"),
            ("dirty", "Dirty State"),
            ("sync", "Backups"),
            ("secret", "Encryption"),
        ):
            card = ttk.Frame(cards, style="Panel.TFrame", padding=10)
            card.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 8))
            ttk.Label(card, text=title, style="Panel.TLabel").pack(anchor="w")
            ttk.Label(card, textvariable=self.status_vars[key], style="Card.TLabel", wraplength=160).pack(anchor="w", pady=(5, 0))

        notebook = ttk.Notebook(outer)
        notebook.pack(fill=BOTH, expand=True)
        self._build_status_tab(notebook)
        self._build_backup_tab(notebook)
        self._build_admin_tab(notebook)
        self._build_logs_tab(notebook)

    def _build_status_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="Status")
        self.status_text = Text(tab, bg=PALETTE["field"], fg=PALETTE["text"], insertbackground=PALETTE["green"], relief="flat", height=18)
        self.status_text.pack(fill=BOTH, expand=True)
        self._set_text(self.status_text, "Start the Host to see live world status.")

    def _build_backup_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="Backup / Restore")

        secret_row = ttk.Frame(tab)
        secret_row.pack(fill=X, pady=(0, 10))
        self._labeled_entry(secret_row, "Passphrase", self.passphrase_var, width=44, show="*").pack(side=LEFT, padx=(0, 10))
        ttk.Button(secret_row, text="Save Local Secret", command=self.save_secret).pack(side=LEFT, padx=4)
        ttk.Button(secret_row, text="Open Sync Folder", command=lambda: self.open_folder(RUNTIME_PATHS.sync_root)).pack(side=LEFT, padx=4)
        ttk.Button(secret_row, text="Open Runtime Folder", command=lambda: self.open_folder(RUNTIME_PATHS.root)).pack(side=LEFT, padx=4)

        backup_row = ttk.Frame(tab)
        backup_row.pack(fill=X, pady=(0, 10))
        self._labeled_entry(backup_row, "Backup note", self.note_var, width=58).pack(side=LEFT, padx=(0, 10))
        ttk.Button(backup_row, text="Backup Now", style="Accent.TButton", command=self.backup_now).pack(side=LEFT, padx=4)
        ttk.Button(backup_row, text="Restore Selected", style="Danger.TButton", command=self.restore_selected).pack(side=LEFT, padx=4)

        body = ttk.Frame(tab)
        body.pack(fill=BOTH, expand=True)
        self.snapshot_list = Listbox(body, bg=PALETTE["field"], fg=PALETTE["text"], selectbackground="#126044", relief="flat")
        self.snapshot_list.pack(side=LEFT, fill=BOTH, expand=True)
        self.snapshot_detail = Text(body, bg=PALETTE["field"], fg=PALETTE["text"], insertbackground=PALETTE["green"], relief="flat", width=48)
        self.snapshot_detail.pack(side=RIGHT, fill=BOTH, expand=True, padx=(10, 0))
        self.snapshot_list.bind("<<ListboxSelect>>", lambda _event: self._show_snapshot_detail())

    def _build_admin_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="Admin")
        left = ttk.Frame(tab)
        left.pack(side=LEFT, fill=BOTH, expand=True)
        right = ttk.Frame(tab)
        right.pack(side=RIGHT, fill=Y, padx=(12, 0))

        ttk.Label(left, text="Users", style="TLabel").pack(anchor="w")
        self.user_list = Listbox(left, bg=PALETTE["field"], fg=PALETTE["text"], selectbackground="#126044", relief="flat")
        self.user_list.pack(fill=BOTH, expand=True, pady=(6, 0))

        self._labeled_entry(right, "Announcement", self.announce_var, width=34).pack(fill=X, pady=(0, 10))
        ttk.Button(right, text="Send Announcement", command=self.send_announcement).pack(fill=X, pady=(0, 10))
        self._labeled_entry(right, "Minutes", self.minutes_var, width=12).pack(fill=X, pady=(0, 10))
        ttk.Button(right, text="Kick Selected", command=self.kick_selected).pack(fill=X, pady=(0, 8))
        ttk.Button(right, text="Mute Selected", command=self.mute_selected).pack(fill=X, pady=(0, 8))
        ttk.Button(right, text="Ban Selected", style="Danger.TButton", command=self.ban_selected).pack(fill=X, pady=(0, 8))

    def _build_logs_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="Logs")
        row = ttk.Frame(tab)
        row.pack(fill=X, pady=(0, 8))
        ttk.Button(row, text="Refresh Logs", command=self.refresh_logs).pack(side=LEFT)
        ttk.Button(row, text="Open Log Folder", command=lambda: self.open_folder(RUNTIME_PATHS.logs_dir)).pack(side=LEFT, padx=8)
        self.log_text = Text(tab, bg=PALETTE["field"], fg=PALETTE["text"], insertbackground=PALETTE["green"], relief="flat")
        self.log_text.pack(fill=BOTH, expand=True)

    def _labeled_entry(self, parent: ttk.Frame, label: str, var: StringVar, *, width: int, show: str = "") -> ttk.Frame:
        frame = ttk.Frame(parent)
        ttk.Label(frame, text=label, style="Small.TLabel").pack(anchor="w")
        ttk.Entry(frame, textvariable=var, width=width, show=show).pack(anchor="w", fill=X)
        return frame

    def start_host(self) -> None:
        if self._process_running():
            self._append_log("Host is already running.")
            return
        self._save_config()
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["CORTISOL_HOST_CONTROL_TOKEN"] = self.token
        if self.passphrase_var.get().strip():
            env["CORTISOL_SYNC_PASSPHRASE"] = self.passphrase_var.get().strip()
        command = _server_command(self.host_var.get().strip() or "0.0.0.0", self.port_var.get().strip() or "8080")
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        try:
            self.process = subprocess.Popen(
                command,
                cwd=str(APP_ROOT),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=creationflags,
            )
        except Exception as exc:
            messagebox.showerror("Start Host failed", str(exc))
            return
        threading.Thread(target=self._read_process_output, daemon=True).start()
        self.status_vars["state"].set("Starting")
        self.root.after(1000, self.refresh_status)

    def stop_host(self) -> None:
        if not self._process_running():
            self.status_vars["state"].set("Stopped")
            return

        def worker() -> None:
            try:
                self._api("POST", "/api/host-control/shutdown", {})
                self._thread_log("Shutdown requested. Waiting for Host cleanup.")
            except Exception as exc:
                self._thread_log(f"Graceful shutdown failed: {exc}. Terminating process.")
                if self.process:
                    self.process.terminate()
                return
            if self.process:
                try:
                    self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self._thread_log("Host did not stop within 15 seconds. Terminating process.")
                    self.process.terminate()

        threading.Thread(target=worker, daemon=True).start()

    def open_client(self) -> None:
        url = self._active_join_url()
        if not url:
            url = f"http://localhost:{self.port_var.get().strip() or '8080'}/"
        webbrowser.open(url)

    def refresh_status(self) -> None:
        if not self._process_running():
            self.status_vars["state"].set("Stopped")
            self.status_vars["local"].set(f"http://localhost:{self.port_var.get().strip() or '8080'}/")
            self.status_vars["join"].set(self.join_url_var.get().strip() or "Start Host to detect LAN URLs")
            return

        def worker() -> None:
            try:
                status = self._api("GET", "/api/host-control/status")
                self.root.after(0, lambda: self._apply_status(status))
            except Exception as exc:
                self.root.after(0, lambda exc=exc: self.status_vars["state"].set(f"Starting / unavailable: {exc}"))

        threading.Thread(target=worker, daemon=True).start()

    def refresh_logs(self) -> None:
        if self._process_running():
            def worker() -> None:
                try:
                    result = self._api("GET", "/api/host-control/logs?lines=300")
                    text = "\n".join(result.get("lines") or [])
                except Exception as exc:
                    text = f"Could not fetch live logs: {exc}\n\n{self._local_log_text()}"
                self.root.after(0, lambda: self._set_text(self.log_text, text))

            threading.Thread(target=worker, daemon=True).start()
        else:
            self._set_text(self.log_text, self._local_log_text())

    def save_secret(self) -> None:
        secret = self.passphrase_var.get().strip()
        if len(secret) < 8:
            messagebox.showerror("Passphrase too short", "Use at least 8 characters.")
            return
        if self._process_running():
            def worker() -> None:
                try:
                    self._api("POST", "/api/host-control/sync-secret", {"passphrase": secret})
                    self.root.after(0, lambda: messagebox.showinfo("Secret saved", "Local sync passphrase saved under runtime_data/live/."))
                    self.root.after(0, self.refresh_status)
                except Exception as exc:
                    self.root.after(0, lambda exc=exc: messagebox.showerror("Secret save failed", str(exc)))

            threading.Thread(target=worker, daemon=True).start()
            return
        RUNTIME_PATHS.sync_passphrase_path.parent.mkdir(parents=True, exist_ok=True)
        RUNTIME_PATHS.sync_passphrase_path.write_text(secret, encoding="utf-8")
        messagebox.showinfo("Secret saved", "Local sync passphrase saved under runtime_data/live/.")

    def backup_now(self) -> None:
        if not self._process_running():
            messagebox.showerror("Host stopped", "Start Host before creating a backup.")
            return

        def worker() -> None:
            try:
                result = self._api("POST", "/api/host-control/backup", {"note": self.note_var.get()})
                snapshot = result.get("snapshot") or {}
                self._thread_log(f"Backup complete: {snapshot.get('snapshot_id')}")
                self.root.after(0, self.refresh_status)
            except Exception as exc:
                self.root.after(0, lambda exc=exc: messagebox.showerror("Backup failed", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def restore_selected(self) -> None:
        snapshot = self._selected_snapshot()
        if not snapshot:
            messagebox.showerror("No snapshot selected", "Select a snapshot first.")
            return
        if not self._process_running():
            messagebox.showerror("Host stopped", "Start Host before staging a restore.")
            return
        snapshot_id = str(snapshot.get("snapshot_id") or "")
        if not messagebox.askyesno("Stage restore", f"Stage restore for {snapshot_id}?\nThe Host must be restarted to apply it."):
            return

        def worker() -> None:
            try:
                self._api("POST", "/api/host-control/restore", {"snapshot_id": snapshot_id})
                self.root.after(0, lambda: messagebox.showinfo("Restore staged", "Restore staged. Stop and start Host to apply it."))
                self.root.after(0, self.refresh_status)
            except Exception as exc:
                self.root.after(0, lambda exc=exc: messagebox.showerror("Restore failed", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def send_announcement(self) -> None:
        text = self.announce_var.get().strip()
        if not text:
            return
        self._post_admin("/api/host-control/announce", {"text": text}, "Announcement sent")

    def kick_selected(self) -> None:
        user = self._selected_user()
        if user:
            self._post_admin("/api/host-control/kick", {"user_id": user["id"]}, f"Kicked {user['username']}")

    def mute_selected(self) -> None:
        user = self._selected_user()
        if user:
            self._post_admin(
                "/api/host-control/mute",
                {"user_id": user["id"], "minutes": self._minutes()},
                f"Muted {user['username']}",
            )

    def ban_selected(self) -> None:
        user = self._selected_user()
        if user and messagebox.askyesno("Ban user", f"Ban {user['username']} for {self._minutes()} minutes?"):
            self._post_admin(
                "/api/host-control/ban",
                {"user_id": user["id"], "minutes": self._minutes()},
                f"Banned {user['username']}",
            )

    def _post_admin(self, path: str, payload: dict, success: str) -> None:
        if not self._process_running():
            messagebox.showerror("Host stopped", "Start Host first.")
            return

        def worker() -> None:
            try:
                self._api("POST", path, payload)
                self._thread_log(success)
                self.root.after(0, self.refresh_status)
            except Exception as exc:
                self.root.after(0, lambda exc=exc: messagebox.showerror("Admin action failed", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def open_folder(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])

    def _apply_status(self, status: dict) -> None:
        self.last_status = status
        server = status.get("server") or {}
        world = status.get("world") or {}
        dirty = status.get("dirty_state") or {}
        sync = status.get("sync") or {}

        local = str(server.get("local_url") or f"http://localhost:{self.port_var.get()}/")
        lan_urls = server.get("lan_urls") or []
        join = self.join_url_var.get().strip() or (lan_urls[0] if lan_urls else local)
        self.status_vars["state"].set("Running")
        self.status_vars["local"].set(local)
        self.status_vars["join"].set(join)
        self.status_vars["world"].set(f"{world.get('users', 0)} users / {world.get('online', 0)} online / {world.get('rooms', 0)} rooms")
        self.status_vars["dirty"].set(f"{'Dirty' if dirty.get('dirty') else 'Clean'} ({dirty.get('dirty_event_count', 0)} changes)")
        self.status_vars["sync"].set(f"{len(status.get('snapshots') or [])} snapshots")
        self.status_vars["secret"].set("Configured" if sync.get("secret_configured") else "Missing")
        self._set_text(self.status_text, json.dumps(status, indent=2, sort_keys=True))
        self._apply_users(status.get("users") or [], status.get("online_users") or [])
        self._apply_snapshots(status.get("snapshots") or [])

    def _apply_users(self, users: list[dict], online: list[dict]) -> None:
        online_ids = {int(user.get("id")) for user in online if user.get("id") is not None}
        self.user_rows = users
        self.user_list.delete(0, END)
        for user in users:
            suffix = "online" if int(user.get("id", 0)) in online_ids else "offline"
            muted = " muted" if int(user.get("muted_until") or 0) > int(time.time()) else ""
            banned = " banned" if int(user.get("banned_until") or 0) > int(time.time()) else ""
            self.user_list.insert(END, f"{user.get('id')}: {user.get('username')} ({suffix}{muted}{banned})")

    def _apply_snapshots(self, snapshots: list[dict]) -> None:
        self.snapshot_rows = snapshots
        self.snapshot_list.delete(0, END)
        for snapshot in snapshots:
            self.snapshot_list.insert(
                END,
                f"{snapshot.get('snapshot_id')} | {snapshot.get('reason')} | {snapshot.get('created_at')}",
            )
        self._show_snapshot_detail()

    def _show_snapshot_detail(self) -> None:
        snapshot = self._selected_snapshot()
        self._set_text(self.snapshot_detail, json.dumps(snapshot or {}, indent=2, sort_keys=True))

    def _selected_user(self) -> dict | None:
        selection = self.user_list.curselection()
        if not selection:
            messagebox.showerror("No user selected", "Select a user first.")
            return None
        return self.user_rows[int(selection[0])]

    def _selected_snapshot(self) -> dict | None:
        selection = self.snapshot_list.curselection()
        if not selection or int(selection[0]) >= len(self.snapshot_rows):
            return None
        return self.snapshot_rows[int(selection[0])]

    def _minutes(self) -> int:
        try:
            return max(1, int(self.minutes_var.get()))
        except ValueError:
            return 10

    def _api(self, method: str, path: str, payload: dict | None = None) -> dict:
        port = self.port_var.get().strip() or "8080"
        url = f"http://127.0.0.1:{port}{path}"
        data = None
        headers = {"X-Host-Control-Token": self.token}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=6) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
                raise RuntimeError(parsed.get("detail") or parsed.get("error") or body)
            except json.JSONDecodeError:
                raise RuntimeError(body or str(exc))

    def _read_process_output(self) -> None:
        if not self.process or not self.process.stdout:
            return
        for line in self.process.stdout:
            self.output_queue.put(line.rstrip())

    def _drain_output(self) -> None:
        while True:
            try:
                line = self.output_queue.get_nowait()
            except queue.Empty:
                break
            self._append_log(line)
        self.root.after(200, self._drain_output)

    def _poll_process(self) -> None:
        if self.process and self.process.poll() is not None:
            code = self.process.returncode
            self._append_log(f"Host process exited with code {code}.")
            self.process = None
            self.status_vars["state"].set("Stopped")
        elif self._process_running():
            self.root.after(2000, self.refresh_status)
        self.root.after(2000, self._poll_process)

    def _process_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def _append_log(self, text: str) -> None:
        self.log_text.insert(END, text + "\n")
        self.log_text.see(END)

    def _thread_log(self, text: str) -> None:
        self.root.after(0, lambda: self._append_log(text))

    def _set_text(self, widget: Text, text: str) -> None:
        widget.delete("1.0", END)
        widget.insert("1.0", text)

    def _local_log_text(self) -> str:
        path = RUNTIME_PATHS.logs_dir / "host.log"
        if not path.exists():
            return "No host.log yet."
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-300:])

    def _active_join_url(self) -> str:
        if self.join_url_var.get().strip():
            return self.join_url_var.get().strip()
        return self.status_vars["local"].get().strip()

    def _load_config(self) -> dict:
        if CONTROL_CONFIG_PATH.exists():
            try:
                data = json.loads(CONTROL_CONFIG_PATH.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass
        return {}

    def _save_config(self) -> None:
        CONTROL_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "host": self.host_var.get().strip() or "0.0.0.0",
            "port": self.port_var.get().strip() or "8080",
            "join_url": self.join_url_var.get().strip(),
        }
        CONTROL_CONFIG_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def _on_close(self) -> None:
        if self._process_running():
            if not messagebox.askyesno("Stop Cortisol Host?", "Stop the Host before closing this window?"):
                return
            self._stop_host_blocking()
        self.root.destroy()

    def _stop_host_blocking(self) -> None:
        self.status_vars["state"].set("Stopping")
        self.root.update_idletasks()
        try:
            self._api("POST", "/api/host-control/shutdown", {})
            self._append_log("Shutdown requested. Waiting for Host cleanup.")
        except Exception as exc:
            self._append_log(f"Graceful shutdown failed: {exc}. Terminating process.")
            if self.process:
                self.process.terminate()
        if self.process:
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self._append_log("Host did not stop within 15 seconds. Terminating process.")
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
            self.process = None


def _run_server_child() -> None:
    from app import main as server_main

    server_main()


def main() -> None:
    if "--server" in sys.argv[1:]:
        index = sys.argv.index("--server")
        sys.argv = [sys.argv[0], *sys.argv[index + 1 :]]
        _run_server_child()
        return
    app = HostControlApp()
    app.run()


if __name__ == "__main__":
    main()
