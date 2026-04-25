# Server Locator

## Purpose

`server_locator.json` is a static discovery document for the Godot player client.

It is not the live game server.

It may be hosted on:

- GitHub Pages
- raw static GitHub content
- another static HTTPS host

It must only point players at a live Cortisol Host origin.

## Discovery Order

The Godot client resolves hosts in this order:

1. saved host URL
2. locator URL
3. manual URL entry
4. local fallback

Rules:

- each candidate is probed with `GET /api/client/status`
- the first healthy candidate wins
- no candidate is trusted without a successful probe

## Recommended `server_locator.json` Schema

```json
{
  "schema_version": 1,
  "product": "Cortisol Arcade",
  "generated_at": "2026-04-25T00:00:00Z",
  "expires_at": "2026-04-25T00:15:00Z",
  "offline_message": "Cortisol Host is currently offline.",
  "recommended_host": {
    "id": "primary",
    "label": "Main Host",
    "url": "https://example.trycloudflare.com/",
    "transport": "https",
    "origin_role": "cloudflared_tunnel",
    "priority": 100
  },
  "fallback_hosts": [
    {
      "id": "lan-doc",
      "label": "LAN Host",
      "url": "http://192.168.1.10:8080/",
      "transport": "http",
      "origin_role": "direct_lan",
      "priority": 50
    }
  ]
}
```

## Required Fields

| Field | Meaning |
| --- | --- |
| `schema_version` | document format version |
| `product` | must be `Cortisol Arcade` |
| `generated_at` | UTC timestamp the document was written |
| `expires_at` | UTC timestamp after which the client treats the locator as stale |
| `offline_message` | user-facing fallback copy |
| `recommended_host` | primary host candidate |
| `fallback_hosts` | optional lower-priority candidates |

## Saved Host URL Behavior

Saved host profiles are always preferred over the locator.

Rules:

- if the last successful host still responds to `/api/client/status`, use it
- if it fails probe, mark it unreachable and continue to locator lookup
- do not silently delete the saved host; keep it visible in Connect UI
- show the exact host that won discovery

Recommended saved profile fields:

- host url
- label
- last connected at
- last successful app version
- source: `saved`, `locator`, or `manual`

## Locator URL Behavior

The locator URL is a static document source, not a session source.

Rules:

- store the locator URL in local settings
- fetch it with `Cache-Control: no-store` behavior on Boot/Connect
- validate `schema_version`, `product`, and `expires_at`
- probe `recommended_host.url` before using it
- if `recommended_host` fails, probe `fallback_hosts` by descending priority

If the locator fetch fails:

- do not block manual entry
- do not erase saved hosts
- continue to manual URL and local fallback

## Manual URL Fallback

Manual URL entry is a user-supplied Host origin.

Rules:

- normalize to the root origin, for example `http://host:8080/`
- clear hash and query before saving
- probe before accepting
- if accepted, save it as a host profile with source `manual`
- if rejected, show the exact failure state

Manual entry must remain available even when a locator URL exists.

## Local Test Fallback

The last automatic fallback is a same-machine Host.

Default:

- `http://127.0.0.1:8080/`

Configurable:

- use the locally saved preferred port if the client has one

Rules:

- only try local fallback after saved host, locator, and manual probe paths fail
- if local fallback fails, show a specific local offline state such as `Local Host not running`

## GitHub Pages / Static GitHub Role

GitHub Pages or raw GitHub content may host:

- `server_locator.json`
- optionally later static patch notes or release metadata

They must not be treated as:

- the actual game server
- a websocket endpoint
- a host for auth, gameplay, messages, or market state

The client must never try to log in against the locator host itself.

## Cloudflared Tunnel Role

`cloudflared` is a transport option for exposing a Host origin remotely.

Expected role:

- the Host stays the world owner
- the tunnel only forwards traffic to that Host
- the locator may publish the tunnel URL as `recommended_host.url`

Rules:

- remote tunnel URLs should use HTTPS
- the player client should clearly label remote vs local/LAN hosts
- tunnel failure is treated as host unreachable, not as a client auth problem

## Update and Expiry Behavior

Locator freshness rules:

- if `expires_at` is in the past, the locator is stale
- stale locators may still be shown in Connect UI, but they should not auto-connect without a successful probe
- a successful probe can override stale metadata for the current session only

Recommended polling behavior:

- Boot fetch: once on app start
- Connect scene refresh: manual refresh or re-entry
- no background polling every few seconds

Recommended cache behavior:

- cache the last valid locator document in `user://cache/locator.json`
- only use cached locator data if live fetch fails
- cached locator data never outranks a healthy saved host

## Security Rules

- never include session tokens, passwords, or secrets in the locator document
- never include deep links with hashes or queries in host URLs
- never treat the locator origin as trusted gameplay infrastructure
- always probe the target Host before login
- show the exact host origin to the player before credential entry
- remote hosts should be clearly marked as remote
- HTTP is acceptable for LAN/local testing, but HTTPS should be preferred for public tunnel access

## User-Facing Offline States

Recommended states:

| State | Meaning |
| --- | --- |
| `Saved Host Unreachable` | remembered host failed probe |
| `Locator Unavailable` | locator document could not be fetched |
| `Locator Stale` | locator document fetched but expired |
| `Locator Host Unreachable` | locator fetched but its host failed probe |
| `Manual URL Invalid` | user entered a malformed origin |
| `Manual Host Unreachable` | user-entered host failed probe |
| `Local Host Not Running` | `127.0.0.1` fallback failed |
| `Auth Required` | host is healthy; continue to Login |

## Implementation Rules

- the locator is discovery-only
- the player client must always probe before trusting a host
- saved host wins over locator
- manual URL remains available
- local fallback remains last in the chain
