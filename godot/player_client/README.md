# Godot Player Client

Phase A scaffold for the future Godot 4.x player client.

Scope in this pass:
- create an isolated Godot project under `godot/player_client/`
- register placeholder autoload singletons
- provide visible placeholder scenes for boot, connect, login, main menu, and mode shells
- avoid real networking, gameplay, and polished UI

Guardrails:
- no dependency on `web/` at runtime
- no admin controls
- no world-state authority in the client
- no changes to `server/`, `host/`, `client/`, `web/`, `packaging/`, or `runtime_data/`

Open in Godot 4.x and run the default scene to verify the scaffold loads without missing autoload errors.
