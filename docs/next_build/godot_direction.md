# Godot Direction

## Locked Direction

- Python Host/server remains the world owner.
- Godot becomes the real player client.
- The old web app becomes debug/reference only.
- Admin controls stay in the Host app only.
- The player client has no admin controls.

## Player Flow

- Boot.
- Connect.
- Login.
- Main Menu.
- Arena.
- Pong.
- Crypto.
- Messages.

## UI Constraints

- No sidebar.
- Full-screen mode entry and exit must be supported.
- The player client should read like a game app, not an admin dashboard.

## Boundary Rules

- The client does not own world data.
- The Host/server owns sessions, state, and persistence.
- Debug and operator tools should stay out of the player-facing Godot client.
- The old browser SPA remains available only as a reference/debug surface unless a task explicitly says otherwise.
