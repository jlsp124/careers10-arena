# AGENTS

- Treat the old web SPA under `web/` as legacy/debug unless a task explicitly says otherwise.
- Do not continue the pywebview/browser-wrapper path.
- The future player client is Godot.
- The Python Host/server owns world state.
- The client does not own world data.
- No admin controls in the player client.
- Do not do broad rewrites.
- Do not commit `runtime_data/live/`.
- Keep Python compile passing.
