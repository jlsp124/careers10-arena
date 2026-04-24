# Arena

Arena is the flagship Cortisol Arcade platform fighter. It is opened from Play and uses server-authoritative room state.

## Runtime Owners

- Client screen: `web/js/screens/ArenaScreen.js`
- Renderer: `web/js/render_arena.js`
- Input mapper: `web/js/input.js`
- Server room: `server/game/arena_sim.py`
- Catalog data: `web/assets/characters.json`, `web/assets/maps.json`

## V1 Contract

- Players enter through Play, direct room join, or practice.
- Host owns room lifecycle, input handling, scoring, match end, and rewards.
- Client renders snapshots and sends input only.
- V1 does not expose online queue matchmaking; room links and LAN join flow are the intended path.
- Arena is a V1 flagship game and must stay visible in the product surface.
