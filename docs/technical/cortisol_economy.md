# Cortisol Economy

## Purpose

Cortisol is the pressure meter that ties player performance, rank, and economy together.

Design intent:

- low cortisol is good for rank
- high cortisol is a source of CC generation
- calming down costs more than stressing up pays out
- the player must choose between rank health and market fuel

## Current Server Baseline

Observed current constants and thresholds:

- default starting cortisol: `1000`
- clamp range: `0..5000`
- tiers:
  - `0..300` -> `Zen`
  - `301..700` -> `Calm`
  - `701..1200` -> `Stable`
  - `1201..5000` -> `Cooked`

Observed match effects:

- Arena win: `-30` cortisol, plus streak discount
- Arena loss: `+18` cortisol
- Pong win/loss currently uses the generic match updater and is slightly different

Observed exchange constants:

- base exchange spread: `3%`
- dynamic spread can rise to `14%`

## V1 Economy Rules

## What Cortisol Represents

Cortisol is not a cosmetic score.

It drives:

- leaderboard rank
- player pressure state
- the ability to mint CC by accepting more stress
- a soft sink when players want to recover their rank posture

Lower is better.

## Win / Loss Effects

Recommended V1 player-facing rule set:

| Event | Cortisol Effect | Notes |
| --- | --- | --- |
| Arena win | `-30` base, extra reduction from streak | flagship mode should matter most |
| Arena loss | `+18` | keeps losses meaningful but not catastrophic |
| Pong win | `-25` base | lighter than Arena |
| Pong loss | `+20` | keeps casual grinding from being rank-neutral |
| Rage-quit / player-left loss | treat as loss or worse | server-owned decision |

Rules:

- wins reduce cortisol
- losses increase cortisol
- win streaks deepen the reduction, but with a cap
- the server remains the only source of truth for all match deltas

## Selling / Increasing Cortisol For CC

Player action:

- `Raise cortisol` / `stress_for_coins`

Economic meaning:

- the player accepts more pressure
- the server credits CC to the player's wallet

Observed server shape:

- payout rate increases somewhat with already-high cortisol
- payout is reduced by spread
- payout is floored to an integer CC gain

Recommended player-facing interpretation:

- this is a deliberate rank sacrifice for liquidity
- it should feel immediate and reliable
- it should never be reversible at parity

## Buying / Lowering Cortisol With CC

Player action:

- `Lower cortisol` / `coins_for_calm`

Economic meaning:

- the player spends CC
- the server reduces cortisol

Observed server shape:

- each CC buys a limited amount of calm
- the same spread system applies
- the amount of calm is intentionally weaker than the stress-sale path

Recommended player-facing interpretation:

- this is a premium recovery action
- it protects leaderboard health at a real CC cost

## Why Lowering Must Cost More Than Selling Gives

This is the core invariant.

If the loop were near-parity, players could:

- farm stress into CC
- immediately buy their rank back
- keep both liquidity and leaderboard integrity

That would break:

- the leaderboard
- CC scarcity
- the meaning of pressure management

Required invariant:

- a round-trip always loses value

Example intent:

- raising `100` cortisol might yield roughly `6..8 CC`
- spending that `6..8 CC` should recover only a small fraction of that `100` cortisol

CC must act as a sink for calm, not a full hedge against pressure.

## Suggested V1 Constants

Keep the current server values as the starting V1 constants unless a balancing pass proves otherwise.

Recommended constants:

| Setting | Suggested V1 |
| --- | --- |
| start cortisol | `1000` |
| min cortisol | `0` |
| max cortisol | `5000` |
| tier thresholds | `Zen <= 300`, `Calm <= 700`, `Stable <= 1200`, else `Cooked` |
| base exchange spread | `3%` |
| max exchange spread | `14%` |
| Arena win delta | `-30` base |
| Arena loss delta | `+18` |
| Pong win delta | `-25` base |
| Pong loss delta | `+20` |

Recommended functional rules:

- win streak benefit should cap after a few consecutive wins
- exchange spread should increase with recent exchange pressure
- exchange spread may increase slightly when cortisol is already high

## Abuse Cases To Defend Against

1. win trading
2. alt-account feeding
3. intentional loss farming followed by stress-to-CC conversion
4. repeated low-value round trips through the exchange
5. self-match or collusive room reward farming
6. bot-driven stress farming if bots ever become player-controllable

Mitigation direction:

- only completed server-validated matches change cortisol
- disconnects and player-left events should not be exploitable as soft resets
- room/result validation must stay server-authoritative
- future daily or hourly caps should be configurable server-side, not client-side

## Leaderboard Implications

Observed current behavior:

- leaderboard sorts by cortisol ascending

V1 rule:

- lower cortisol ranks higher
- CC alone does not determine leaderboard placement
- spending CC for calm can improve rank posture
- selling stress for CC should usually worsen rank posture

This keeps the leaderboard tied to pressure management, not raw wallet size.

## What Should Be Configurable Later

- starting cortisol
- tier thresholds
- per-mode win/loss deltas
- streak multiplier and cap
- base spread and max spread
- how much recent exchange pressure affects spread
- seasonal resets or floors
- special event modifiers
- anti-abuse caps

## Non-Negotiable Rules

- the client never computes authoritative cortisol outcomes
- the server writes every cortisol delta
- lowering cortisol remains a CC sink
- the round-trip never becomes economically neutral
