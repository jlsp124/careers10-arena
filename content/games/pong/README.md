# Pong

Pong is the V1 registered head-to-head arcade minigame. It is opened from Mini-Games and runs through websocket room state.

## Runtime Owners

- Client screen: `web/js/screens/MiniGamesScreen.js`
- Server room: `server/game/minigames/pong.py`
- Route: `#/pong`

## V1 Contract

- Players can open a private room for direct 1v1 or spectating.
- Host owns ball, paddle, score, timer, and match result.
- Client sends paddle input and renders Host snapshots.
- V1 does not expose online queue matchmaking; direct rooms are the intended entry flow.
- Pong is a V1 flagship minigame and must stay visible in the product surface.
