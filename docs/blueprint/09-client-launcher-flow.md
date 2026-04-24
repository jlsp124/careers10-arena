# Client Launcher Flow

This is the V1 direction for `Cortisol Client.exe`.

## Purpose

The Client app is the normal player entrypoint. It selects a Cortisol Host, verifies that the Host is reachable, then opens the player-facing arcade shell.

The Client must not require a user to manually type `localhost` into a browser.

## Current Implementation

Development entrypoint:

```powershell
python client\client_app.py
```

The desktop launcher supports:

- `Play Local`: uses `127.0.0.1:<port>` and can start `server/app.py` as a same-machine Host process for development.
- `Join Host`: uses a LAN IP/name and port.
- `URL / Tunnel`: uses a full Host URL.
- `Settings`: recent Host profiles stored as local Client preferences.

The web shell also has a pre-auth Client launcher in `web/index.html` and `web/js/app.js`. It verifies the selected Host through `GET /api/client/status` before auth or websocket startup.

## Host Status Contract

Public endpoint:

```text
GET /api/client/status
```

This endpoint returns product identity, Host role, app version, local/LAN URL hints, and visible V1 surface metadata. It is intentionally safe for unauthenticated Client launch probing and does not expose world data.

## Boundaries

- Client profiles are preferences, not world data.
- Client never writes wallets, market state, explorer state, uploads, snapshots, or game results.
- Local mode still runs Host code for persistence authority.
- Tunnel/custom URL mode is required because another machine cannot use `localhost` to reach the Host.
- Packaging is not complete until `Cortisol Client.exe` launches this flow and passes local, LAN, and tunnel smoke tests.
