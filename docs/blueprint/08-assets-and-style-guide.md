# Assets And Style Guide

This document is the V1 visual contract for Cortisol Arcade.

## Product Feel

Cortisol Arcade uses a dark premium desktop shell with game-center energy. The shell should feel cohesive across Client launcher, Host admin, Play, Mini-Games, Wallets, Market, Explorer, Messages, and Settings.

## Tokens

- Background: near-black blue, not flat black.
- Panels: dark navy glass with thin blue-gray borders.
- Primary accent: neon green for connection, ready, and primary play actions.
- Data accent: cyan for explorer/network density and diagnostics.
- Game accent: violet for arcade contrast.
- Caution: amber.
- Danger: pink/red.
- Radius: 6px to 8px.
- Typography: system UI stack with display weight used sparingly for page titles and game hero text.

## Components

- Shell nav uses square glyph cells instead of letter shortcuts.
- Buttons use one shared language: primary, secondary, ghost, danger.
- Inputs/selects are dark fields with cyan border and green focus.
- Lists and explorer rows are dense, tabular, and scan-friendly.
- Game entries use image marquees plus direct room/queue actions.
- Panels frame major surfaces; repeated items use cards; page sections should not become decorative nested cards.

## Current Asset Pipeline

Source/generated:

- `assets/generated/ca-logo-mark.png`
- `assets/generated/cortisol-client-keyart.png`
- `assets/generated/arena-marquee.png`
- `assets/generated/pong-marquee.png`
- `assets/generated/simnet-grid.png`

Approved public:

- `assets/public/ca-logo-mark.png`
- `assets/public/cortisol-client-keyart.png`
- `assets/public/arena-marquee.png`
- `assets/public/pong-marquee.png`
- `assets/public/simnet-grid.png`

Served by dev web client:

- `web/assets/ca-logo-mark.png`
- `web/assets/cortisol-client-keyart.png`
- `web/assets/arena-marquee.png`
- `web/assets/pong-marquee.png`
- `web/assets/simnet-grid.png`

## Licensing

No third-party image assets were imported in this pass. The PNGs above are original procedural assets generated for this repo. Future third-party imports must include license and attribution metadata in `assets/manifest.json`.

## Still Needed

- Character art or refined silhouettes for Arena fighters.
- Optional high-resolution installer icons for Host and Client packaging.
- More specific token/avatar art if the market surface needs branded generated token media later.
