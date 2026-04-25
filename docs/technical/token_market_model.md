# Token Market Model

## Purpose

This document defines the player-facing market model for Godot V1.

## Player Wallet Model

Player-facing V1 rule:

- one wallet per user

Current backend reality:

- the legacy web surface exposes multiple wallets

Compatibility decision:

- Godot V1 uses the server's `default_wallet_id` as the player's only wallet
- legacy extra wallets remain debug-only in the old web UI
- Godot does not expose wallet create/reorder/delete flows in V1

## Base Currency

`CC` is the base currency.

Rules:

- every player wallet holds CC
- every player-created token trades against CC
- every liquidity pool is `CC <-> token`
- all prices, market cap, liquidity, and explorer value are expressed in CC

## Player-Created Tokens

V1 market focus:

- player-created tokens first
- each token has one primary `CC/token` pool
- tokens may have category, theme, description, and optional icon

The player client should prioritize:

- human-created launches
- clearly-labeled player tokens
- explorer traceability

## AMM Recommendation

Use a constant-product AMM.

Core pool state:

- `cc_reserve`
- `token_reserve`

Displayed spot price:

- `price = cc_reserve / token_reserve`

This matches the current server direction closely enough and is simple to explain in UI.

## Liquidity And Price Impact

Rules:

- large buys remove tokens from the pool and add CC, pushing price up
- large sells add tokens to the pool and remove CC, pushing price down
- the larger the trade compared to reserves, the larger the slippage
- thin pools move faster and are riskier

Player explanation:

- low liquidity means bigger price swings
- high liquidity means steadier fills

## Create Token Flow

Recommended V1 flow:

1. player enters name, symbol, description, category, and optional icon
2. player chooses seed liquidity in CC
3. player confirms creator allocation
4. server validates wallet ownership and CC balance
5. server creates the token
6. server seeds the `CC/token` pool
7. server credits creator allocation to the player's wallet
8. server emits explorer events
9. token appears in Market and Explorer

Required server-side outcomes:

- deduct seed CC from the player's wallet
- initialize reserves
- write token metadata
- write explorer records

## Buy Flow

Recommended V1 flow:

1. player selects token
2. player enters token amount or later uses a quote helper
3. server calculates fill, fee, and slippage from pool reserves
4. server debits CC
5. server updates reserves
6. server credits token balance
7. server writes explorer transaction

The client never calculates the authoritative final fill.

## Sell Flow

Recommended V1 flow:

1. player selects held token
2. player enters sell amount
3. server calculates proceeds, fee, and slippage
4. server debits token balance
5. server updates reserves
6. server credits CC
7. server writes explorer transaction

## Explorer Events

The explorer should expose at least these event kinds for market activity:

- `token_create`
- `liquidity_add`
- `liquidity_remove`
- `trade`
- `exchange`
- `market_event`

Player-facing rule:

- every important market mutation should leave an explorer-visible trail

## Suggested V1 Constants To Carry Forward

Observed current server constants are reasonable starting points:

- minimum launch liquidity: `25 CC`
- trade fee baseline: `1.25%`
- creator allocation clamp: `8%..55%`

These should stay server-owned and configurable.

## What The Godot Client Should Surface

Market views should emphasize:

- price
- change
- liquidity depth
- recent volume
- creator
- risk flags
- explorer trace links

Do not over-emphasize:

- bot-only hype feeds
- fabricated urgency
- fake market social proof

## What Old Fake / Bot-Heavy Behavior Must Not Carry Forward

The legacy market sim includes a lot of bot activity and bot-oriented feeds.

Do not carry forward into the Godot player client:

- auto-generated bot token launches presented like real player launches
- bot-heavy top movers with no labeling
- fake "community" sentiment as if it were human demand
- default views dominated by bot accounts instead of player-created assets
- hidden creator concentration presented as healthy liquidity

Allowed carry-forward behavior:

- background bot liquidity support if clearly labeled
- explorer records that show bot activity transparently
- market movement caused by bots, but never disguised as player demand

## Player-Facing V1 Priorities

Godot V1 should present the market as:

- one player wallet
- one base currency
- clear AMM pricing
- transparent slippage
- transparent explorer history
- player-created tokens first

## Non-Negotiable Rules

- the client never owns reserves or balances
- price is a server read model, not a client guess
- bot activity is labeled or deprioritized
- one primary wallet per player in Godot V1
