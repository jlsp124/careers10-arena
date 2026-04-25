# Manual Smoke Checklist

Use this for quick local validation after packaging changes.

## Source Runtime

```powershell
python -m py_compile server\runtime.py server\util.py server\app.py host\host_app.py client\client_app.py
python server\app.py --host 127.0.0.1 --port 8080
```

Then check:

- `http://127.0.0.1:8080/api/client/status`
- `http://127.0.0.1:8080/`

Stop with `Ctrl+C`.

## Packaged Host

```powershell
.\scripts\build_host.ps1 -Clean
& ".\dist\windows\Cortisol Host.exe"
```

In the Host window:

- Save a sync passphrase.
- Start Host.
- Refresh status.
- Open Client.
- Backup now.
- Stop Host.

## Packaged Client

```powershell
.\scripts\build_client.ps1 -Clean
& ".\dist\windows\Cortisol Client.exe"
```

In the Client launcher:

- Use `Play Local` with `Cortisol Host.exe` in the same folder.
- Use `Join Host` against `127.0.0.1:8080` when Host is already running.
- Use `URL / Tunnel` with `http://127.0.0.1:8080/`.
- Try an unreachable URL and confirm the error appears before auth.

## Release Zip

```powershell
.\scripts\build_release.ps1 -Version 0.1.0 -Clean
Expand-Archive -LiteralPath ".\dist\release\Cortisol Arcade-0.1.0-windows.zip" -DestinationPath ".\dist\release\smoke" -Force
```

Run both executables from the extracted release folder and repeat the Host and Client checks above.
