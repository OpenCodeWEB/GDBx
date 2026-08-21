# Track: GDBx CLI & Visual Inspector

> **Track ID:** `gdbx-cli-visual` | **Phase:** 6.1 | **Status:** spec draft
> **Parent:** `org-gdbx-unification` (Gemini Top 1)

## Context
Gemini Top 1: CLI & Visual Inspector — immediate developer adoption. Org-wide DX needs terminal tooling and live topology view. Current GDBx has SDK + Python SDK + bridges, but no CLI.

## Goals
- **CLI** `packages/gdbx-cli` — `gdbx` binary (Node, `commander`):
  - `gdbx identity create [--net mainnet|testnet|local] [--out key.json]`
  - `gdbx identity show [--addr]`
  - `gdbx sync put <key> <value> [--addr --prefix]`
  - `gdbx sync get [--prefix]`
  - `gdbx sync watch [--prefix]` (WS live tail)
  - `gdbx vector put <key> <text> --vector 0.1,0.2,...`
  - `gdbx vector search --query 0.1,0.2 --topk 3`
  - `gdbx backup export --out snapshot.json`
  - `gdbx backup import --in snapshot.json`
- **Visual Inspector** — `public/js/gdbx-inspector.js` + `public/inspector.html` (optional) — D3/vis graph of pool (primary+mirror health), WS live peers, Nostr relays, vector count
- Single `GDBX_*` env handling (same as AiA/OS bridges)

## Non-Goals
- Full Yggdrasil/BitTorrent DHT (deferred)
- Multi-region backup relay (deferred)

## Requirements
- CLI uses `sdk/gdbx-crypto.js` + `sdk/gdbx-sdk.js` (gun-free, same as bridges)
- Identity stored at `~/.gdbx/key.json` (or `--out`) — `{pub, priv, pubkey_hex, addr}`
- `sync put/get` must pass through `FirewallGuard` (PoW+sig) — same as SDK
- `sync watch` uses `sdk/gdbx-ws-client.js` (WS hub `wss://gdbx-do.../ws?addr=`)
- Tests: `packages/gdbx-cli/test/test_cli.mjs` (mock SDK, no live network) — 5+ tests
- Supply-chain: `commander` pinned exact, `npm audit 0`

## Acceptance
- [ ] `node packages/gdbx-cli/bin/gdbx.js identity create` prints `addr.gdbx` + `did:gdbx:`
- [ ] `gdbx sync put/get` round-trip against live `gdbx-do` (verified by `curl` read)
- [ ] `gdbx vector put/search` stores JSON string vector and cosine search works (via `GdbxClient.search_vector` logic)
- [ ] `gdbx backup export` dumps `did + kv` snapshot (via `/export`), `import` replays
- [ ] `npm run build` still passes, `npm ls --omit=dev` still `@noble/hashes` only (cli is dev dep)
