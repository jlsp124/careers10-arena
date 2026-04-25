# Implementation Sequence

## Goal

Split the Godot migration into small, low-risk phases that respect the current repo constraints.

Global rules for every phase:

- do not move or delete `web/`
- do not move or delete `runtime_data/live/`
- do not rewrite `server/`
- do not touch gameplay logic, market logic, messages logic, packaging logic, or database logic unless the phase explicitly allows a thin additive adapter
- keep Python compile passing after any server-adjacent change

## Phase A - Godot Project Scaffold

Allowed files/folders:

- `godot/player_client/**`
- `docs/technical/**`

Forbidden changes:

- `server/**`
- `host/**`
- `client/**`
- `web/**`
- `runtime_data/**`

Acceptance criteria:

- empty Godot project exists at `godot/player_client/`
- autoload list is in place
- placeholder root scenes exist for Boot, Connect, Login, Main Menu, Arena, Pong, Crypto, Messages
- no dependency on legacy web runtime

Basic test steps:

- open project in Godot
- confirm project loads without missing autoload errors
- confirm root scene can start and exit cleanly

Rollback risk:

- low

## Phase B - Offline Shell / Navigation

Allowed files/folders:

- `godot/player_client/**`
- reviewed copies under `assets/game/**` if needed for placeholder art

Forbidden changes:

- `server/**`
- `web/**`
- `content/**`

Acceptance criteria:

- Boot, Connect, Login, Main Menu, and full-screen mode shells exist
- no global sidebar
- Back/Exit rules follow `godot_scene_flow.md`
- Arena, Pong, Crypto, and Messages each own the full viewport when entered

Basic test steps:

- launch the app offline
- navigate Boot -> Connect -> Login -> Main Menu
- enter each mode shell and return with Back
- confirm overlay ownership rules work

Rollback risk:

- low

## Phase C - Server Locator / Connect / Login

Allowed files/folders:

- `godot/player_client/**`
- static locator files outside runtime data if needed
- additive server adapter files only if strictly necessary:
  - `server/app.py`
  - `server/http_api.py`
  - new `server/player_api.py`

Forbidden changes:

- `server/db.py`
- `server/ws.py`
- `server/game/**`
- `host/**`
- `web/**`

Acceptance criteria:

- saved host URL probe works
- locator URL probe works
- manual URL probe works
- local fallback probe works
- login and register work against the selected Host
- token storage and logout work

Basic test steps:

- connect to a healthy local Host
- connect to an intentionally invalid URL and verify offline state
- verify `GET /api/client/status` probe path
- login, restart client, and verify session restore

Rollback risk:

- medium

## Phase D - Main Menu With Cards

Allowed files/folders:

- `godot/player_client/**`
- approved art intake to `assets/game/**` if needed

Forbidden changes:

- `server/**`
- `web/**`

Acceptance criteria:

- Main Menu has four primary cards: Arena, Pong, Crypto, Messages
- Profile, Settings, and Leaderboard open as overlays
- no admin controls
- no leftover legacy web-shell affordances

Basic test steps:

- login
- open each card
- verify overlay open/close behavior
- verify Back from Main Menu opens exit/disconnect confirm only

Rollback risk:

- low

## Phase E - Crypto Read-Only Integration

Allowed files/folders:

- `godot/player_client/scenes/modes/crypto/**`
- `godot/player_client/scripts/modes/crypto/**`
- additive read-only player adapter files if needed:
  - `server/http_api.py`
  - new `server/player_api.py`
  - `server/app.py`

Forbidden changes:

- `server/db.py`
- market simulation logic
- trading logic
- liquidity logic
- token launch logic
- `web/**`

Acceptance criteria:

- Crypto Home loads server-backed summaries
- Wallet view shows the primary wallet only
- Market view shows token list and token detail read-only
- Explorer view works
- Activity view shows recent wallet and market events

Basic test steps:

- login to a populated Host
- open Crypto
- verify Home, Wallet, Market, Explorer, Activity subviews
- confirm no client-side fake balances appear when offline or stale

Rollback risk:

- medium

## Phase F - Messages Integration

Allowed files/folders:

- `godot/player_client/scenes/modes/messages/**`
- `godot/player_client/scripts/modes/messages/**`
- additive message adapter files only if needed:
  - `server/http_api.py`
  - `server/app.py`
  - new `server/player_api.py`

Forbidden changes:

- `server/db.py`
- message storage schema
- DM business logic
- group schema invention in local client state
- `web/**`

Acceptance criteria:

- DM thread list works
- DM history works
- attachment upload/download/delete works
- Group Creation view exists
- if group APIs are still missing, Group Creation shows an explicit unavailable state instead of fake local groups

Basic test steps:

- open Messages
- search users
- open a DM thread
- send text and an attachment
- verify unavailable group state if groups are not yet supported

Rollback risk:

- medium

## Phase G - Pong Prototype

Allowed files/folders:

- `godot/player_client/scenes/modes/pong/**`
- `godot/player_client/scripts/modes/pong/**`

Forbidden changes:

- `server/game/minigames/pong.py`
- `server/ws.py`
- `server/db.py`
- `web/**`

Acceptance criteria:

- join Pong room
- authoritative state renders in Godot
- up/down input reaches the server
- results screen shows winner and score
- Back/Exit rules match `godot_scene_flow.md`

Basic test steps:

- connect two players or one player plus spectator
- join the same Pong room
- play to a result
- leave and re-enter cleanly

Rollback risk:

- medium

## Phase H - Arena Prototype

Allowed files/folders:

- `godot/player_client/scenes/modes/arena/**`
- `godot/player_client/scripts/modes/arena/**`
- approved Arena art intake under `assets/game/arena/**` if needed

Forbidden changes:

- `server/game/arena_sim.py`
- `server/ws.py`
- `server/db.py`
- `web/**`

Acceptance criteria:

- Arena loading flow works
- lobby and room join work
- character select works
- authoritative match snapshots render in Godot
- results screen shows server outcome and rewards

Basic test steps:

- create or join an Arena room
- ready up and select characters
- play through a full match
- verify results and return to Main Menu

Rollback risk:

- high

## Phase I - Build / Export / Release

Allowed files/folders:

- `godot/player_client/**`
- new Godot export/build scripts
- release docs
- additive packaging helpers that do not rewrite current Host packaging

Forbidden changes:

- `server/**` gameplay/data logic
- `runtime_data/live/**`
- destructive changes to existing PyInstaller Host flow

Acceptance criteria:

- Windows player export exists
- export can be pointed at a Host and run
- Host and Godot player release story is documented
- no dependency on pywebview/browser-wrapper

Basic test steps:

- export Windows build
- launch against local Host
- launch against remote/tunnel Host
- confirm boot/connect/login still work in exported build

Rollback risk:

- medium

## Phase J - Polish / Assets / FX

Allowed files/folders:

- `godot/player_client/**`
- `assets/game/**`
- non-runtime docs

Forbidden changes:

- `server/**`
- `web/**`
- gameplay rules
- market rules
- messages rules

Acceptance criteria:

- reviewed art replaces placeholders
- transitions and mode-specific FX are in place
- readability and responsiveness are polished
- no change in authoritative gameplay or economy behavior

Basic test steps:

- run through the full player flow
- verify missing assets fall back safely
- verify overlays, focus states, and full-screen behavior under load

Rollback risk:

- low

## Phase Ordering Rules

- do not skip from A to G
- do not start Arena before Connect/Login and Main Menu exist
- keep Crypto phase read-only until later product direction explicitly allows write actions
- keep Messages phase within current backend truth; do not invent local group state
- keep every phase shippable and revertable on its own

## Shared Validation Rule

After any phase that touches Python server files, run:

```powershell
python -m py_compile server\app.py server\db.py server\http_api.py server\ws.py host\host_app.py client\client_app.py
```

That compile check is mandatory even when the phase is primarily Godot-side.
