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
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, X, Y, Listbox, PhotoImage, StringVar, Tk, Text, messagebox
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


CLIENT_CONFIG_PATH = RUNTIME_PATHS.live_root / "client" / "connection_profiles.json"
LOGO_PATH = ROOT / "web" / "assets" / "ca-logo-mark.png"

try:
    import webview  # type: ignore
except Exception:  # pragma: no cover - optional runtime dependency
    webview = None

PALETTE = {
    "bg": "#090b12",
    "panel": "#111724",
    "field": "#070a10",
    "text": "#f3f7ff",
    "muted": "#8f9cb0",
    "green": "#62f7b1",
}


def _host_exe_candidates() -> list[Path]:
    configured = os.getenv("CORTISOL_HOST_EXE", "").strip()
    candidates = []
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.extend(
        [
            APP_ROOT / "Cortisol Host.exe",
            APP_ROOT / "Cortisol Host" / "Cortisol Host.exe",
            APP_ROOT.parent / "Cortisol Host.exe",
            APP_ROOT.parent / "Cortisol Host" / "Cortisol Host.exe",
        ]
    )
    return candidates


def _find_host_exe() -> Path | None:
    for candidate in _host_exe_candidates():
        path = candidate if candidate.is_absolute() else (APP_ROOT / candidate)
        if path.exists():
            return path.resolve()
    return None


def _local_host_command(port: str) -> list[str]:
    if getattr(sys, "frozen", False):
        host_exe = _find_host_exe()
        if not host_exe:
            raise FileNotFoundError("Cortisol Host.exe must be next to Cortisol Client.exe, or set CORTISOL_HOST_EXE.")
        return [str(host_exe), "--server", "--host", "127.0.0.1", "--port", port]
    return [sys.executable, str(SERVER_APP), "--host", "127.0.0.1", "--port", port]


def _client_window_command(url: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [str(Path(sys.executable).resolve()), "--app-window", url]
    return [sys.executable, str(Path(__file__).resolve()), "--app-window", url]


class ClientLauncherApp:
    def __init__(self) -> None:
        self.root = Tk()
        self.root.title("Cortisol Client")
        self.root.geometry("980x680")
        self.root.minsize(880, 620)
        self.root.configure(bg=PALETTE["bg"])

        self.config = self._load_config()
        self.local_process: subprocess.Popen[str] | None = None
        self.local_token = secrets.token_urlsafe(32)
        self.output_queue: queue.Queue[str] = queue.Queue()
        self.logo_image = self._load_logo()

        settings = self.config.get("settings") or {}
        self.local_port_var = StringVar(value=str(settings.get("local_port", "8080")))
        self.join_host_var = StringVar(value=str(settings.get("join_host", "")))
        self.join_port_var = StringVar(value=str(settings.get("join_port", "8080")))
        self.url_var = StringVar(value=str(settings.get("url", "")))
        self.status_var = StringVar(value="Choose a Cortisol Host.")

        self._build_style()
        self._build_ui()
        self._render_profiles()
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
        style.configure("Title.TLabel", background=PALETTE["bg"], foreground=PALETTE["text"], font=("Segoe UI", 20, "bold"))
        style.configure("Small.TLabel", background=PALETTE["bg"], foreground=PALETTE["muted"], font=("Segoe UI", 9))
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
        ttk.Label(header, text="Cortisol Client", style="Title.TLabel").pack(side=LEFT)
        ttk.Label(header, textvariable=self.status_var, style="Small.TLabel").pack(side=RIGHT)

        status = ttk.Frame(outer, style="Panel.TFrame", padding=12)
        status.pack(fill=X, pady=(14, 10))
        ttk.Label(status, textvariable=self.status_var, style="Panel.TLabel").pack(anchor="w")

        notebook = ttk.Notebook(outer)
        notebook.pack(fill=BOTH, expand=True)
        self._build_local_tab(notebook)
        self._build_join_tab(notebook)
        self._build_url_tab(notebook)
        self._build_settings_tab(notebook)

    def _build_local_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="Play Local")
        panel = ttk.Frame(tab, style="Panel.TFrame", padding=14)
        panel.pack(fill=X)
        ttk.Label(panel, text="Use a Cortisol Host on this machine.", style="Panel.TLabel").pack(anchor="w", pady=(0, 10))
        row = ttk.Frame(panel, style="Panel.TFrame")
        row.pack(fill=X)
        self._labeled_entry(row, "Local port", self.local_port_var, width=10).pack(side=LEFT, padx=(0, 10))
        ttk.Button(row, text="Play Local", style="Accent.TButton", command=self.play_local).pack(side=LEFT, padx=4)
        ttk.Button(row, text="Start Local Host", command=self.start_local_host).pack(side=LEFT, padx=4)
        ttk.Button(row, text="Stop Local Host", style="Danger.TButton", command=self.stop_local_host).pack(side=LEFT, padx=4)

        self.local_log = Text(tab, bg=PALETTE["field"], fg=PALETTE["text"], insertbackground=PALETTE["green"], relief="flat", height=18)
        self.local_log.pack(fill=BOTH, expand=True, pady=(12, 0))
        self._append_log("Local mode can start a same-machine Host process for development.")

    def _build_join_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="Join Host")
        panel = ttk.Frame(tab, style="Panel.TFrame", padding=14)
        panel.pack(fill=X)
        ttk.Label(panel, text="Enter the Host computer IP or LAN name. Do not use localhost for another machine.", style="Panel.TLabel").pack(anchor="w", pady=(0, 10))
        row = ttk.Frame(panel, style="Panel.TFrame")
        row.pack(fill=X)
        self._labeled_entry(row, "Host or IP", self.join_host_var, width=34).pack(side=LEFT, padx=(0, 10))
        self._labeled_entry(row, "Port", self.join_port_var, width=10).pack(side=LEFT, padx=(0, 10))
        ttk.Button(row, text="Join Host", style="Accent.TButton", command=self.join_host).pack(side=LEFT, padx=4)

    def _build_url_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="URL / Tunnel")
        panel = ttk.Frame(tab, style="Panel.TFrame", padding=14)
        panel.pack(fill=X)
        ttk.Label(panel, text="Use a tunnel, school network URL, or custom Cortisol Host address.", style="Panel.TLabel").pack(anchor="w", pady=(0, 10))
        row = ttk.Frame(panel, style="Panel.TFrame")
        row.pack(fill=X)
        self._labeled_entry(row, "Host URL", self.url_var, width=58).pack(side=LEFT, padx=(0, 10))
        ttk.Button(row, text="Connect", style="Accent.TButton", command=self.connect_url).pack(side=LEFT, padx=4)

    def _build_settings_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=12)
        notebook.add(tab, text="Settings")
        panel = ttk.Frame(tab, style="Panel.TFrame", padding=14)
        panel.pack(fill=BOTH, expand=True)
        ttk.Label(panel, text="Recent Host profiles", style="Panel.TLabel").pack(anchor="w")
        body = ttk.Frame(panel, style="Panel.TFrame")
        body.pack(fill=BOTH, expand=True, pady=(10, 0))
        self.profile_list = Listbox(body, bg=PALETTE["field"], fg=PALETTE["text"], selectbackground="#126044", relief="flat")
        self.profile_list.pack(side=LEFT, fill=BOTH, expand=True)
        actions = ttk.Frame(body, style="Panel.TFrame")
        actions.pack(side=RIGHT, fill=Y, padx=(10, 0))
        ttk.Button(actions, text="Connect Selected", command=self.connect_selected_profile).pack(fill=X, pady=(0, 8))
        ttk.Button(actions, text="Clear Profiles", command=self.clear_profiles).pack(fill=X)

    def _labeled_entry(self, parent: ttk.Frame, label: str, var: StringVar, *, width: int) -> ttk.Frame:
        frame = ttk.Frame(parent, style="Panel.TFrame")
        ttk.Label(frame, text=label, style="Small.TLabel").pack(anchor="w")
        ttk.Entry(frame, textvariable=var, width=width).pack(anchor="w", fill=X)
        return frame

    def play_local(self) -> None:
        url = self._normalize_url(f"http://127.0.0.1:{self.local_port_var.get().strip() or '8080'}/")
        if not self._probe(url):
            if not self.start_local_host():
                return
            if not self._wait_for_host(url):
                self._set_status("Local Host did not become reachable.", error=True)
                return
        self._open_client(url, mode="local", label="Local Host")

    def start_local_host(self) -> bool:
        if self._local_running():
            self._set_status("Local Host is already running.")
            return True
        port = self.local_port_var.get().strip() or "8080"
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["CORTISOL_HOST_CONTROL_TOKEN"] = self.local_token
        try:
            command = _local_host_command(port)
        except FileNotFoundError as exc:
            messagebox.showerror("Start Local Host failed", str(exc))
            return False
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        try:
            self.local_process = subprocess.Popen(
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
            messagebox.showerror("Start Local Host failed", str(exc))
            return False
        threading.Thread(target=self._read_process_output, daemon=True).start()
        self._set_status("Starting Local Host...")
        return True

    def stop_local_host(self) -> None:
        if not self._local_running():
            self._set_status("No Local Host process started by this Client.")
            return

        def worker() -> None:
            port = self.local_port_var.get().strip() or "8080"
            try:
                self._request_json(
                    f"http://127.0.0.1:{port}/api/host-control/shutdown",
                    method="POST",
                    payload={},
                    headers={"X-Host-Control-Token": self.local_token},
                )
                self._thread_status("Stopping Local Host...")
            except Exception as exc:
                self._thread_log(f"Graceful stop failed: {exc}. Terminating process.")
                if self.local_process:
                    self.local_process.terminate()
                return
            if self.local_process:
                try:
                    self.local_process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self._thread_log("Local Host did not stop within 15 seconds. Terminating process.")
                    self.local_process.terminate()

        threading.Thread(target=worker, daemon=True).start()

    def join_host(self) -> None:
        host = self.join_host_var.get().strip()
        if not host:
            self._set_status("Enter a Host IP or LAN name.", error=True)
            return
        raw = host if "://" in host or ":" in host else f"{host}:{self.join_port_var.get().strip() or '8080'}"
        self._connect(raw, mode="join-host", label=f"LAN Host {host}")

    def connect_url(self) -> None:
        self._connect(self.url_var.get(), mode="url", label="")

    def connect_selected_profile(self) -> None:
        index = self._selected_profile_index()
        if index is None:
            return
        profile = self._profiles()[index]
        self._connect(profile["hostUrl"], mode=profile.get("mode", "url"), label=profile.get("label", ""))

    def clear_profiles(self) -> None:
        self.config["profiles"] = []
        self._save_config()
        self._render_profiles()

    def _connect(self, raw_url: str, *, mode: str, label: str) -> None:
        try:
            url = self._normalize_url(raw_url)
        except Exception:
            self._set_status("Enter a valid Host URL.", error=True)
            return
        if not self._probe(url):
            return
        self._open_client(url, mode=mode, label=label)

    def _open_client(self, url: str, *, mode: str, label: str) -> None:
        self._remember_profile(url, mode=mode, label=label)
        launch_url = self._with_launch_params(url, mode=mode, label=label)
        if self._launch_desktop_view(launch_url):
            self._set_status(f"Opened Cortisol Client window at {url}")
            self.root.after(100, self.root.destroy)
            return
        webbrowser.open(launch_url)
        self._set_status(f"Opened browser fallback for {url}")

    def _launch_desktop_view(self, url: str) -> bool:
        if webview is None:
            self._set_status("Desktop webview unavailable; using browser fallback.", error=True)
            return False
        try:
            subprocess.Popen(
                _client_window_command(url),
                cwd=str(APP_ROOT),
                env=os.environ.copy(),
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            )
            return True
        except Exception as exc:
            self._set_status(f"Desktop view failed: {exc}", error=True)
            return False

    def _probe(self, url: str) -> bool:
        self._set_status(f"Checking {url}...")
        try:
            status = self._request_json(urllib.parse.urljoin(url, "/api/client/status"), method="GET", timeout=4)
        except Exception as exc:
            parsed = urllib.parse.urlparse(url)
            host = (parsed.hostname or "").lower()
            if host in {"localhost", "127.0.0.1", "::1"}:
                self._set_status(f"Host not running on {parsed.netloc}: {exc}", error=True)
            else:
                self._set_status(f"Host unreachable at {parsed.netloc}: {exc}", error=True)
            return False
        if not status.get("ok"):
            self._set_status("Host did not return a valid client status.", error=True)
            return False
        self._set_status(f"Connected to {status.get('host') or 'Cortisol Host'} at {url}")
        return True

    def _wait_for_host(self, url: str) -> bool:
        for _ in range(40):
            if self._probe(url):
                return True
            time.sleep(0.25)
        return False

    def _request_json(self, url: str, *, method: str = "GET", payload: dict | None = None, headers: dict | None = None, timeout: int = 5) -> dict:
        data = None
        req_headers = dict(headers or {})
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, method=method, headers=req_headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(body or str(exc)) from exc

    def _normalize_url(self, raw: str) -> str:
        value = str(raw or "").strip()
        if not value:
            raise ValueError("missing_url")
        if not value.lower().startswith(("http://", "https://")):
            value = f"http://{value}"
        parsed = urllib.parse.urlparse(value)
        if not parsed.netloc:
            raise ValueError("missing_host")
        return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "/", "", "", ""))

    def _with_launch_params(self, url: str, *, mode: str, label: str) -> str:
        parsed = urllib.parse.urlparse(url)
        query = dict(urllib.parse.parse_qsl(parsed.query))
        query["clientLaunch"] = "1"
        query["clientMode"] = mode
        if label:
            query["clientLabel"] = label
        return urllib.parse.urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path or "/",
                "",
                urllib.parse.urlencode(query),
                parsed.fragment or "/home",
            )
        )

    def _remember_profile(self, url: str, *, mode: str, label: str) -> None:
        profiles = [profile for profile in self._profiles() if profile.get("hostUrl") != url]
        profiles.insert(
            0,
            {
                "hostUrl": url,
                "mode": mode,
                "label": label or f"Cortisol Host {urllib.parse.urlparse(url).netloc}",
                "lastConnectedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )
        self.config["profiles"] = profiles[:8]
        self.config["settings"] = {
            "local_port": self.local_port_var.get().strip() or "8080",
            "join_host": self.join_host_var.get().strip(),
            "join_port": self.join_port_var.get().strip() or "8080",
            "url": self.url_var.get().strip(),
        }
        self._save_config()
        self._render_profiles()

    def _profiles(self) -> list[dict]:
        profiles = self.config.get("profiles")
        return profiles if isinstance(profiles, list) else []

    def _selected_profile_index(self) -> int | None:
        selection = self.profile_list.curselection()
        if not selection:
            messagebox.showerror("No profile selected", "Select a Host profile first.")
            return None
        return int(selection[0])

    def _render_profiles(self) -> None:
        self.profile_list.delete(0, END)
        for profile in self._profiles():
            self.profile_list.insert(END, f"{profile.get('label', 'Cortisol Host')} | {profile.get('hostUrl', '')}")

    def _load_config(self) -> dict:
        if CLIENT_CONFIG_PATH.exists():
            try:
                data = json.loads(CLIENT_CONFIG_PATH.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass
        return {"profiles": [], "settings": {}}

    def _save_config(self) -> None:
        CLIENT_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CLIENT_CONFIG_PATH.write_text(json.dumps(self.config, indent=2, sort_keys=True), encoding="utf-8")

    def _read_process_output(self) -> None:
        if not self.local_process or not self.local_process.stdout:
            return
        for line in self.local_process.stdout:
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
        if self.local_process and self.local_process.poll() is not None:
            code = self.local_process.returncode
            self._append_log(f"Local Host exited with code {code}.")
            self.local_process = None
        self.root.after(2000, self._poll_process)

    def _local_running(self) -> bool:
        return self.local_process is not None and self.local_process.poll() is None

    def _append_log(self, text: str) -> None:
        self.local_log.insert(END, text + "\n")
        self.local_log.see(END)

    def _thread_log(self, text: str) -> None:
        self.root.after(0, lambda: self._append_log(text))

    def _set_status(self, text: str, *, error: bool = False) -> None:
        self.status_var.set(text)
        if error:
            self._append_log(text)

    def _thread_status(self, text: str) -> None:
        self.root.after(0, lambda: self._set_status(text))

    def _on_close(self) -> None:
        if self._local_running():
            if not messagebox.askyesno("Stop Local Host?", "Stop the Local Host started by this Client before closing?"):
                return
            self._stop_local_host_blocking()
        self.root.destroy()

    def _stop_local_host_blocking(self) -> None:
        port = self.local_port_var.get().strip() or "8080"
        self._set_status("Stopping Local Host...")
        self.root.update_idletasks()
        try:
            self._request_json(
                f"http://127.0.0.1:{port}/api/host-control/shutdown",
                method="POST",
                payload={},
                headers={"X-Host-Control-Token": self.local_token},
            )
        except Exception as exc:
            self._append_log(f"Graceful stop failed: {exc}. Terminating process.")
            if self.local_process:
                self.local_process.terminate()
        if self.local_process:
            try:
                self.local_process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self._append_log("Local Host did not stop within 15 seconds. Terminating process.")
                self.local_process.terminate()
                try:
                    self.local_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.local_process.kill()
            self.local_process = None


def main() -> None:
    if "--app-window" in sys.argv[1:]:
        index = sys.argv.index("--app-window")
        launch_url = sys.argv[index + 1] if index + 1 < len(sys.argv) else "http://127.0.0.1:8080/"
        if webview is not None:
            webview.create_window("Cortisol Client", launch_url, width=1440, height=960)
            webview.start()
            return
        webbrowser.open(launch_url)
        return
    app = ClientLauncherApp()
    app.run()


if __name__ == "__main__":
    main()
