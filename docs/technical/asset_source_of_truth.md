# Asset Source Of Truth

## Purpose

This document resolves the current duplicate asset story without moving files in this pass.

## Current State

Observed asset layers:

- `assets/generated/`
  - generated source candidates
  - duplicated bitmaps
- `assets/public/`
  - approved public copies
  - duplicated with `assets/generated/`
- `web/assets/`
  - legacy web-served runtime copies and JSON catalogs
- `assets/game/`
  - future organized target
  - mostly empty folders plus `asset_manifest.json`
- `assets/prompts/`
  - art-direction and provenance prompts
- `assets/manifest.json`
  - current duplicate mapping for generated/public/served

## Recommended Source Hierarchy

Use a layered truth model.

### 1. Creative Source

Treat as source candidates:

- `assets/generated/`
- `assets/prompts/`

Meaning:

- upstream art source or regeneration input
- not the runtime master
- may contain duplicates, experiments, or files not yet approved for the player client

### 2. Approved Export Source

Treat as the current approved bitmap source:

- `assets/public/`

Meaning:

- reviewed project-owned exports
- closest thing to the current shipping asset set
- what Godot should eventually pull from unless a newer reviewed asset replaces it

### 3. Future Organized Canonical Manifest

Treat as the future organized target:

- `assets/game/`
- `assets/game/asset_manifest.json`

Meaning:

- the future canonical player-client asset inventory
- the place where approved assets should be reorganized by domain
- not authoritative yet until actual reviewed files are copied into it

### 4. Runtime Copies

Treat as copies only:

- `web/assets/`
- future Godot-imported copies under `godot/player_client/assets_imported/`

Meaning:

- runtime-serving layer
- never the master source
- safe to replace from approved upstream assets later

## Decision Table

| Path | Treat As | Do Not Treat As |
| --- | --- | --- |
| `assets/generated/` | creative source candidate | final runtime truth |
| `assets/public/` | approved export source | Godot import cache |
| `assets/game/` | future canonical organized target | already-complete asset system |
| `web/assets/` | legacy runtime copy | source of truth |
| `assets/prompts/` | provenance and regeneration input | shipping asset folder |

## Immediate Rule Set

Until `assets/game/` is populated:

- use `assets/public/` as the approved source for future Godot intake
- keep `assets/generated/` for provenance and regeneration
- keep `web/assets/` alive for the legacy web UI
- do not edit runtime copies first and then backfill source later

## How `assets/game/` Should Become Canonical Later

Future direction:

- copy approved assets into the right domain folder under `assets/game/`
- update `assets/game/asset_manifest.json`
- import from `assets/game/` into the Godot project

Suggested categories already exist:

- `assets/game/brand/`
- `assets/game/backgrounds/`
- `assets/game/arena/`
- `assets/game/pong/`
- `assets/game/crypto/`
- `assets/game/messages/`
- `assets/game/icons/`
- `assets/game/host/`
- `assets/game/ui_refs/`

## Safe Intake From `backup/godot-client-foundation-dirty`

Do not pull files from that branch in this pass.

When the team is ready, use this safe process:

1. inspect candidate files on `backup/godot-client-foundation-dirty`
2. compare each candidate against the current approved set in `assets/public/`
3. choose only the assets needed for the next implementation phase
4. copy selected assets into the correct `assets/game/<domain>/` folder
5. record provenance in `assets/game/asset_manifest.json`
6. only after review, import them into the Godot project

Required provenance fields for later intake:

- asset id
- source branch
- source commit
- original path on backup branch
- approved target surface
- approval state

## What Must Not Happen

- do not move or delete originals in this pass
- do not make `web/assets/` the master asset source
- do not import from the dirty backup branch directly into runtime folders
- do not mix unreviewed backup assets into `assets/public/` without provenance
- do not let Godot depend on `web/assets/characters.json` or `web/assets/maps.json` as its permanent content source

## Practical Next-State Rule

The practical source-of-truth rule after this document:

- creative source = `assets/generated/` plus prompts
- approved export source = `assets/public/`
- future canonical organized source = `assets/game/`
- legacy runtime copy = `web/assets/`

That split is stable enough to start Godot implementation without moving any existing files yet.
