# Design Direction

Cortisol Arcade should feel like a focused desktop arcade client with an economy spine, not a marketing site and not a generic admin panel.

The current visual target is:

- Phantom-inspired shell polish: premium black base, glassy panels, restrained neon highlights, precise spacing.
- mempool-space-like density for explorer/network views: scan-friendly rows, tabular numbers, compact chips, clear hierarchy.
- Arcade/game-center energy where play surfaces need it: large game marquees, direct room actions, readable match HUDs, high-contrast primary calls.

## Tone

- Dense, usable, and game-adjacent.
- Fast route switching.
- Clear Host connection state.
- Arcade surfaces should feel playable first, explanatory second.
- Economy surfaces should feel like a simulated terminal, not real finance.

## Visual Priorities

- Arena and Pong get the clearest play affordances.
- Wallets, Market, and Explorer should look connected through common CC, wallet, token, and transaction language.
- Messages should remain practical and direct.
- Settings should stay diagnostic and plain.

## Design System

- Base: `#090b12`, panel `#111724`, elevated panel `#151d2b`.
- Text: bright foreground, muted blue-gray support text, tabular numbers in market/explorer rows.
- Accent palette: neon green for primary state, cyan for network/data, violet for game contrast, amber for caution, pink/red for danger.
- Border language: thin blue-gray borders by default, green/cyan highlight only on active or hover states.
- Radius: 6-8px. Large rounded marketing cards are not part of the V1 shell.
- Panels/cards: one frame per surface; avoid nested card-on-card decoration unless it is a real repeated item or detail module.
- Buttons/tabs/inputs/lists/tables share the same border and fill rules. Primary actions are green; secondary actions are cyan-tinted; danger is pink/red.
- Icon language: compact monochrome glyphs in square nav cells and action labels. Avoid unrelated emoji-style icon mixtures.

## Asset Direction

- Use real bitmap assets, not fake SVG sketches.
- Current V1 assets are original procedural PNGs staged under `assets/generated/`, approved under `assets/public/`, and served from `web/assets/`.
- Asset manifest is `assets/manifest.json`.
- Prompt/spec notes live in `assets/prompts/`.
- If third-party assets are imported later, licensing and attribution must be captured in the manifest before use.

## Surface Rules

- No Hub/community nav item.
- No coming-soon nav items.
- No boss mode UI.
- No fake packaging readiness copy.
- No unregistered games presented as V1-ready products.

## Product Language

Use these names consistently:

- Cortisol Arcade for the full product.
- Cortisol Host for the local authoritative runtime.
- Cortisol Client for the player client.
- Cortisol Coin or CC for simulated utility currency.
- Simnet or internal ledger only when describing the fake explorer/economy layer.

Avoid language that implies:

- real crypto
- real assets
- real wallet custody
- public chain activity
- finished executable distribution before packaging is real
