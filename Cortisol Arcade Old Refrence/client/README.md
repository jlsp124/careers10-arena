# Cortisol Client Launcher

Development entrypoint for the future `Cortisol Client.exe`:

```powershell
python client\client_app.py
```

The Client launcher stores only local connection profiles under `runtime_data/live/client/`. It does not own world state, wallets, market data, uploads, snapshots, or game results.

Supported V1 connection modes:

- `Play Local`: connects to a same-machine Host and can start `server/app.py` for local development.
- `Join Host`: connects to a LAN Host by IP/name and port.
- `URL / Tunnel`: connects to a full Host URL such as a tunnel address.

Gameplay still runs in the web Client served by the selected Cortisol Host. Packaging into `Cortisol Client.exe` is not complete yet.
