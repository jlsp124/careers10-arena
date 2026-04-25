# Repo Rules

- Product direction: Cortisol Arcade Host/Client minigame center.
- `Cortisol Host.exe` owns the world/runtime/sync data.
- `Cortisol Client.exe` is the player app.
- Browser mode is debug/fallback only.
- Do not do broad rewrites, redesigns, or engine migrations.
- Keep the build scripts working.

## Validation

- `python -m py_compile server\app.py server\db.py server\http_api.py server\ws.py host\host_app.py client\client_app.py`
- `powershell -ExecutionPolicy Bypass -File scripts\build_release.ps1 -Version 0.1.1 -Clean`
