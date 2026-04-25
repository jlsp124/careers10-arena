# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


REPO_ROOT = Path(SPECPATH).resolve().parents[1]
SERVER_ROOT = REPO_ROOT / "server"

datas = [
    (str(REPO_ROOT / "web"), "web"),
    (str(REPO_ROOT / "content"), "content"),
    (str(REPO_ROOT / "assets" / "manifest.json"), "assets"),
    (str(REPO_ROOT / "assets" / "public"), "assets/public"),
]

hiddenimports = [
    "admin_cli",
    "auth",
    "db",
    "host_control_api",
    "http_api",
    "matchmaking",
    "runtime",
    "uploads",
    "util",
    "world_state",
    "ws",
    "game.arena_defs",
    "game.arena_sim",
    "game.constants",
    "game.entities",
    "game.protocol",
    "game.minigames.chess",
    "game.minigames.pong",
    "game.minigames.reaction_duel",
    "game.minigames.typing_duel",
    "aiohttp",
    "aiohttp.web",
    "cryptography.fernet",
    "cryptography.hazmat.primitives.kdf.pbkdf2",
]

a = Analysis(
    [str(REPO_ROOT / "host" / "host_app.py")],
    pathex=[str(REPO_ROOT), str(SERVER_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="Cortisol Host",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
