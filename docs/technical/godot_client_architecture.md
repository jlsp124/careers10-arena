# Godot Client Architecture

## Scope

This document defines the player-client architecture for the future Godot build.

- `web/` remains the legacy/debug/reference client.
- `client/` remains the temporary Python launcher bridge.
- `host/` and `server/` remain the authority for world state, auth, persistence, rooms, economy, messages, and market simulation.

## Project Location Recommendation

Create the Godot project at:

`godot/player_client/`

Reasons:

- It does not collide with the existing Python `client/` folder.
- It keeps the Godot workspace isolated from Host/server packaging.
- It allows phased adoption without moving or deleting the legacy web client.

Do not place the Godot project under `client/`, `web/`, or `runtime_data/`.

## Recommended Folder Layout

```text
godot/player_client/
  project.godot
  icon.svg
  autoload/
    app_runtime.gd
    settings_store.gd
    server_locator_service.gd
    client_session.gd
    api_client.gd
    realtime_client.gd
    asset_catalog.gd
    scene_router.gd
  scenes/
    boot/boot.tscn
    connect/connect.tscn
    auth/login.tscn
    menu/main_menu.tscn
    modes/arena/arena_mode_shell.tscn
    modes/arena/arena_loading.tscn
    modes/arena/arena_lobby.tscn
    modes/arena/arena_match.tscn
    modes/arena/arena_results.tscn
    modes/pong/pong_mode_shell.tscn
    modes/pong/pong_loading.tscn
    modes/pong/pong_lobby.tscn
    modes/pong/pong_match.tscn
    modes/pong/pong_results.tscn
    modes/crypto/crypto_mode_shell.tscn
    modes/messages/messages_mode_shell.tscn
    overlays/profile_overlay.tscn
    overlays/settings_overlay.tscn
    overlays/leaderboard_overlay.tscn
    overlays/confirm_exit_overlay.tscn
    shared/loading_overlay.tscn
    shared/error_state.tscn
  scripts/
    dto/
    ui/
    modes/
    services/
  resources/
    themes/
    fonts/
    shaders/
  assets_imported/
    brand/
    arena/
    pong/
    crypto/
    messages/
```

## Module and Scene Responsibilities

| Area | Responsibility | Notes |
| --- | --- | --- |
| `boot/` | load saved settings, resolve host discovery order, route to connect/login/menu | no gameplay logic |
| `connect/` | host probe, locator fetch, manual URL entry, offline states | no auth mutation beyond probe |
| `auth/` | login and create-account forms | token only, no world state |
| `menu/` | main menu cards and overlay entry points | no sidebar |
| `modes/arena/` | room join, character select, match HUD, results | consumes server-authoritative snapshots only |
| `modes/pong/` | room join, match HUD, results | consumes server-authoritative snapshots only |
| `modes/crypto/` | home, wallet, market, explorer, activity read models | player-facing, no admin/runtime controls |
| `modes/messages/` | DM thread list, chat, capability-gated group creation UI | no moderator controls |
| `overlays/` | profile, settings, leaderboard, exit confirm | mode-scoped overlays only |

## Autoload / Singleton Plan

| Autoload | Owns | Persists Across Scenes | Must Not Own |
| --- | --- | --- | --- |
| `AppRuntime` | app version, build flags, current mode, overlay stack | yes | auth token, wallet balances, match truth |
| `SettingsStore` | `user://settings.json`, graphics/audio prefs, remembered locator URL, remembered host list | yes | session token, server DTOs |
| `ServerLocatorService` | saved host probe order, locator cache, host probe results | yes | auth session, room state |
| `ClientSession` | auth token, current user profile, active host URL, capabilities | yes | market balances, match results |
| `ApiClient` | HTTP request wrapper, DTO parsing, retry rules, auth headers | yes | UI state, gameplay logic |
| `RealtimeClient` | websocket lifecycle, typed event bus, lobby snapshot cache, mode event dispatch | yes | authoritative room simulation |
| `AssetCatalog` | local manifest lookup for imported Godot assets | yes | remote host selection |
| `SceneRouter` | scene transitions, full-screen mode ownership, back-stack rules | yes | network state |

## Client State Ownership

The Godot client may own only local, non-authoritative state.

Allowed client-owned state:

- saved host URLs and locator URL
- last successful host profile
- auth token issued by the server
- local settings: fullscreen, audio, debug visibility, language later
- ephemeral UI state: selected menu card, selected wallet tab, selected thread, scroll position
- cached read models from server responses and websocket events
- imported asset lookup tables

Server-authoritative state:

- account validity, sessions, bans, mute state
- cortisol, tier, win/loss record, streak, KOs, deaths
- wallet balances, token balances, liquidity shares
- token reserves, market prices, slippage, explorer history
- room membership, seat ownership, readiness, character lock-ins
- arena and pong simulation state, results, rewards
- DM history, attachments, deletions, moderation, future groups

## API Client Layer

`ApiClient` should be thin and deterministic.

Rules:

- Every request is built from the currently selected Host origin.
- The token is sent with `Authorization: Bearer <token>` or `X-Session-Token` on every authenticated request.
- The Godot client does not rely on browser cookies.
- The client parses server JSON into typed DTOs immediately. Scenes should not consume raw payload dictionaries.
- Request methods should map 1:1 to product use cases: `probe_host()`, `login()`, `register()`, `fetch_me()`, `fetch_dashboard()`, `fetch_wallets()`, `fetch_market()`, `fetch_explorer_*()`, `fetch_leaderboard()`, `upload_file()`.
- Mutation methods for trading, token launch, and liquidity stay behind explicit confirmation UI and are server-authoritative.

Recommended request pipeline:

1. Build request URL from active Host.
2. Attach auth headers if logged in.
3. Parse success/error envelope.
4. Convert to DTO.
5. Publish DTO to the requesting scene or store slice.

## Websocket / Event Layer

`RealtimeClient` should expose typed subscriptions rather than raw string handling in every scene.

Responsibilities:

- connect to `/ws` for legacy compatibility first, then later to `/ws/player` if the adapter layer is added
- send `hello` with the current session token after socket open
- publish connection state updates for Boot, Connect, Settings, and in-mode reconnect banners
- keep a small cache of:
  - lobby state
  - presence
  - last match-found payload
  - current room snapshot for Arena or Pong
  - DM push queue and file-deleted notices

Rules:

- gameplay scenes consume snapshots and event deltas; they do not simulate authority locally
- if the socket drops during a match, the client enters reconnect/degraded UI and waits for the next authoritative snapshot
- no scene writes directly to another scene's state; all cross-scene live data flows through `RealtimeClient`

## Asset Loading Strategy

Use a manifest-driven imported asset pipeline.

Recommended rule set:

- `assets/game/asset_manifest.json` becomes the future lookup manifest for player-facing art.
- The Godot project imports reviewed copies into `godot/player_client/assets_imported/`.
- Runtime scene code uses local Godot resources, not direct reads from `assets/generated/`, `assets/public/`, or `web/assets/`.
- Legacy web files like `/assets/characters.json` and `/assets/maps.json` are reference sources only until a player-facing content manifest is formalized.
- If an asset is missing, fall back to a neutral placeholder and log the missing asset id. Do not reach into `web/assets/` at runtime.

## Save and Settings Storage Strategy

Use `user://` only.

Recommended files:

- `user://settings.json`
  - fullscreen
  - audio enabled
  - audio volume
  - debug overlay flag
  - remembered locator URL
- `user://hosts.json`
  - saved host profiles
  - last successful host id
  - last manual URL
- `user://session.json`
  - auth token
  - active host id
  - last login username hint
- `user://cache/*.json`
  - optional non-authoritative cached market/explorer snapshots

Rules:

- caches are disposable
- no gameplay or economy truth is restored from disk without server confirmation
- logout clears `session.json` but keeps host profiles and settings

## Ownership Matrix

| Concern | Godot Player Client | Python Host/server |
| --- | --- | --- |
| boot flow | yes | no |
| host discovery | yes | no |
| auth UI | yes | session issuance and validation |
| player profile display | yes | profile truth |
| menu and navigation | yes | no |
| arena rendering and inputs | yes | simulation, scoring, rewards |
| pong rendering and inputs | yes | simulation, scoring, rewards |
| crypto views | yes | balances, pools, trades, explorer truth |
| messages UI | yes | message storage, delivery, attachments |
| moderator/admin controls | no | yes |
| runtime backup/restore | no | yes |
| world persistence | no | yes |

## Client-Authoritative State That Must Never Exist

Never persist or trust the following as client authority:

- cortisol or tier
- CC or token balances
- token reserves or prices
- liquidity ownership
- match winner, score, or rewards
- room roster truth
- ready state truth
- character lock truth
- moderation state
- unread count truth if it becomes server-backed later
- attachment access permissions
- any `runtime_data` path or backup metadata

## Implementation Guardrails

- Do not repurpose the existing Python `client/` folder into the Godot project.
- Do not make Godot depend on the old sidebar shell.
- Do not add admin/runtime controls to the player client.
- Do not let Godot write any file under `runtime_data/live/`.
- Do not mirror Python server logic into GDScript.
