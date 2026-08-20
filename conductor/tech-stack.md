# Tech Stack — GDBx

## Runtime & Platform
- **Cloudflare Workers** (`worker/`) — Durable Objects (SQLite-backed), REST API
- **Cloudflare Pages** (`public/` + `functions/`) — static UI + API routes proxy
- **Domain:** `gdbx.pages.dev` (production = git push to `main`; `wrangler pages deploy` = Preview only)

## Languages
- **JavaScript (ESM)** — worker + pages functions + SDK (browser + Node)
- **Node 20+** — tests (node:test), tooling

## Crypto
- **BLAKE3** — `.gdbx` address checksum (`@noble/hashes/blake3.js`)
- **SHA-256** — PoW mining, general hashing
- **SEA (GunDB)** — ECDSA P-256 signatures for identity/auth
- **HMAC-SHA256** — signed sync deltas
- **Base32 (RFC 4648, lowercase, no padding)** — address encoding

## Key Libraries
- `gun` + `gun/sea` — mesh identity + SEA crypto (client)
- `@noble/hashes` — BLAKE3/SHA (worker + node, no WASM needed)
- `zod` (or minimal JSON schema) — input validation (worker)

## Architecture
```
browser/edge (GunDB client, SDK)
   │  wss/https
   ▼
gdbx.pages.dev ──► functions/api/v1/*  ──► Worker Durable Objects
                                              ├─ GDBxStorageDO (CRDT store)
                                              ├─ RegistryDO (address registry)
                                              └─ RouterDO (transport table)
```
- Multi-transport: WebRTC (P2P direct), Nostr relays, Tor v3 (.onion), I2P, IPFS — all routable via one `.GDBx` address
- Local-first: nodes sync via CRDT (LWW + tombstones), no central DB required

## Tooling
- `wrangler` — deploy worker + pages
- `node --test test/` — unit + integration
- Git + GitHub Actions (CI: test → build → deploy via Pages git integration)