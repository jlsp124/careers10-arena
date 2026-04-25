# Cortisol Host Control Surface

This folder contains the Python desktop control window intended to become `Cortisol Host.exe`.

Development command:

```powershell
python host\host_app.py
```

The control window starts `server/app.py` with a one-run host-control token. It can stop the Host gracefully, open the Client URL, create encrypted backups, stage restores, open runtime folders, show logs/status, and run basic world admin actions.

This is not the player Client shell and does not move gameplay into the Host app.
