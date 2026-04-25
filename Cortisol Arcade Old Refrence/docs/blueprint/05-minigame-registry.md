# Minigame Registry

The V1 game registry lives at:

```text
content/games/_registry.json
```

This registry is the source of truth for what Cortisol Arcade presents as V1 game content. Server files alone do not make a game part of the visible product.

## V1 Registered Games

- `arena`: flagship platform fighter, opened from Play.
- `pong`: flagship minigame, opened from Mini-Games.

## Registry Fields

- `id`: stable route/content identifier.
- `title`: display name.
- `status`: `v1_core`, `v1_flagship`, `dormant`, or `future`.
- `route`: SPA route for the visible surface.
- `server_kind`: websocket room kind when applicable.
- `client_screen`: mounted client screen that owns the UI.
- `content_path`: folder for game-specific docs/metadata.
- `flagship`: whether the game is part of the product pitch.

## Adding A Game Later

A game can be promoted into the registry only when it has:

- a visible UX owner
- a websocket or HTTP contract
- a clear route
- a testable room lifecycle or single-player lifecycle
- product copy that does not say "coming soon"
- docs under `content/games/<id>/`

Reaction, Typing, and Chess are not V1 registry entries. Their backend code can be reviewed later, but they should not reappear in navigation without registry promotion.

