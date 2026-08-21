# Track: Org-Wide GDBx Unification — AiA & OS + All OpenCodeWEB Projects

> **Track ID:** `org-gdbx-unification` | **Phase:** 6 | **Status:** spec draft
> **Goal:** `github.com/OpenCodeWEB` এর সকল প্রজেক্টকে এক `.GDBx` address & sync fabric-এ যুক্ত করা — বিশেষ করে **AiA** (Master Intelligence Engine) ও **OS** (OpenCodeWEBsOS) কে GDBx-এর self-sovereign mesh-এ নেটিভভাবে চালানো।

---

## 1. Context

### 1.1 OpenCodeWEB Org Landscape (local at `D:\OpenCodeWEBsUI\OpenCodeWEB\`)

| Repo | Role | Current Sync |
|---|---|---|
| **GDBX** | Core: Global Decentralized DataBase Sync (this repo) | GDBxStorageDO + GDBxMirrorDO + FirewallGuard + hybrid mesh — gun-free, 84/84 tests, live |
| **AiA** | `core/` Python fleet (:9090) — brain, executors, lib | Node `gun-relay/bridge.js` → GunX `wss://gunx.pages.dev/gun` via GunBridge RPC (Python stdlib) |
| **OS** | `portal/` + `gateway/` + `core/` + `gun-relay/` — OS portal, multi-device /u/, /o/, /C/ community | Same GunX bridge (`bridge.js` + `relay.js` :8765), track `os-gunx` in progress |
| **GunX** | Serverless GunDB relay (Workers+DO, live `gunx.pages.dev`) — legacy mesh | Will be superseded by GDBx pool as primary fabric |
| **Gun / Gun-dev / Gun-serverless** | Upstream GunDB forks | Reference only |
| **AG, DB, UI, Voice, Worker, PRD, SandBox, Servers** | Domain verticals | No unified sync — siloed |

**Problem:** প্রতিটি প্রজেক্ট আলাদা sync ব্যবহার করে — AiA Python gun bridge, OS GunX, অন্যগুলো siloed। Identity fragmented, data siloed, supply-chain risk (gun@0.2020.1241) সব জায়গায়। GDBx Phase 5 এখন gun-free, zero-trust, pool+mesh ready — এটাই org-wide fabric হওয়া উচিত।

### 1.2 GDBx Phase 5 Baseline (what we have to share)

- **Crypto:** `sdk/gdbx-crypto.js` pure WebCrypto ECDSA P-256, GDBX1 envelope, SEA v1 compat
- **Firewall:** `FirewallGuard` PoW→replay→sig→RBAC→ACL on every mutation (HTTP/WS/Nostr)
- **Pool:** `GDBxMirrorDO` replication, LWW merge, `/pool` health
- **Mesh:** `sdk/transport.js` ws→nostr (kind 23124)→webrtc, `POST /relay`, `putDeltasHybrid`
- **Supply-chain:** `@noble/hashes@1.8.0` only, `dist/` bundle, `npm audit 0`
- **Live:** `gdbx-do.xup.workers.dev` (v `2c047032`), `gdbx.pages.dev`, 84/84 tests

### 1.3 Gemini Consultation (2026-08-21, gemini.google.com/app/65e128ca6eac1cdd)

Gemini validated the fabric and proposed org-wide next steps — adopted into this track:

- **CLI & Visual Inspector** (High) — org-wide DX
- **Vector Embeddings for AI Agents** (High) — AiA decentralized memory
- **IPFS/Filecoin/Arweave Off-Chain Anchoring + Field-Level E2EE** (High) — OS media & secrets
- Also: DIDComm v2, UCAN, VC, Nostr adapter, React hooks, Time-travel debugger — deferred to later tracks

---

## 2. Goals (This Track Must Deliver)

### G1. GDBx as Org Shared Library (Zero-Copy)
- Publish `sdk/` as importable package for JS/TS projects (`GDBX` npm or git submodule) — single source of truth
- Publish **Python SDK** `packages/gdbx-py/` — `gdbx_py` (pure Python, no gun dep) mirroring JS crypto/PoW/transport
- Shared `dist/` bundle usable from any Pages/Worker

### G2. AiA Integration (Priority ★)
AiA `core/` + `brain/` + `executors/` currently write `os/aia/events` via `GUN_BRIDGE_TOKEN` → `gun-relay/bridge.js` → GunX.

**After:**
- `AiA/core/gdbx_bridge.py` (new) — Python GDBx client: `make_pair()`, `register_did()`, `put_deltas()`, `get_deltas()`, `put_vector()`, `search_vector()` — talks directly to `https://gdbx-do.xup.workers.dev` (HTTP + WS `wss://gdbx-do.../ws?addr=`)
- `AiA/brain/memory.py` — store agent learnings as GDBx deltas `aia/memory/<session>/<key>` + vector embeddings `aia/vectors/<id>` (1536-dim, cosine search via worker `/vector/query`)
- `AiA/executors/*` — read/write shared state via GDBx instead of Gun soul `os/aia/events`
- Backward compat: keep `GUN_BRIDGE_TOKEN` path for 1 release, but default to `GDBX_*` env vars
- Tests: `AiA/tests/test_gdbx_bridge.py` (mirrors `GDBX/test/test_storage.mjs` semantics) + live e2e

### G3. OS Integration (Priority ★)
OS currently has `gun-relay/` (bridge.js, relay.js, supervisor) + `os-gunx` track. Migrate to GDBx:

**After:**
- `OS/gdbx-relay/` (new, sibling to `gun-relay/`) — Node GDBx relay bridge: reuses `sdk/gdbx-sdk.js` + `sdk/gdbx-ws-client.js` (not gun), exposes same RPC (`put`, `get`, `watch`) for Python fleet
- `OS/gateway/` + `OS/portal/` — import `sdk/gdbx-sdk.js` (or `dist/gdbx.mjs`) — community `/C/` discussions sync via GDBx pool, not GunX
- `OS/core/` Python — use `gdbx_py` (shared with AiA) for server-side sync
- `OS/conductor/tracks/os-gdbx/` — new track superseding `os-gunx` (migration guide, dual-run flag `USE_GDBX=1`)
- Preserve `gun-relay/` for fallback until cutover verified

### G4. Org-Wide Rollout (Light Touch)
- For remaining repos (AG, DB, UI, Voice, etc.): add `GDBX` as optional sync backend — docs + example `examples/gdbx-hello/` + shared `conductor/product.md` cross-link
- Update `github.com/OpenCodeWEB` org-level `README` (if exists) + each repo's `conductor/product.md` to reference `did:gdbx:<addr>` as canonical identity

### G5. DX Polish (Gemini Sprint 1 Lite)
- CLI: `packages/gdbx-cli/` — `gdbx identity create`, `gdbx sync watch --addr`, `gdbx vector put` (thin wrapper over SDK, `commander`)
- This track implements minimal CLI (identity + vector) to unblock AiA/OS; full visual inspector deferred

---

## 3. Non-Goals (Out of Scope)

- Tor/I2P/IPFS full transports (Phase 7) — only IPFS CID anchoring stub if needed
- Replacing GunX relay globally — GDBx runs alongside GunX for one release
- ZKP/VC/UCAN/DIDComm (deferred)
- Visual mesh inspector UI (deferred, stub only)
- Multi-region backup relay (deferred)

---

## 4. Functional Requirements

### FR1. Python SDK Parity
- `gdbx_py.crypto` — `pair()`, `sign(body, pair)`, `verify(body, sig, pub)` — WebCrypto-equivalent via `cryptography` or `ecdsa` + `hashlib` — GDBX1 envelope identical to JS
- `gdbx_py.codec` — `make_address(pubkey_hex, network)`, `normalize_address()` — BLAKE3 + base32, matches `sdk/gdbx-codec.js` vectors
- `gdbx_py.client` — `GdbxClient(base_url, pair, pubkey_hex)` with `register_did()`, `put_deltas(deltas)`, `get_deltas(prefix)`, `put_vector(key, vector)`, `search_vector(query_vec, top_k)`
- PoW: `mine_pow(addr, pub, payload, ts, diff)` — same `hash_input` + SHA256 + difficulty as worker
- Must pass JS↔Python cross-verify: JS-signed delta verified by Python, and vice versa

### FR2. AiA Bridge
- Env: `GDBX_API=https://gdbx-do.xup.workers.dev`, `GDBX_ADDR`, `GDBX_PUB`, `GDBX_PRIV`, `GDBX_PUBKEY_HEX` (or derive from pair)
- On startup, `gdbx_bridge.py` registers DID if not exists, then `put_deltas` for each `learn` event
- Vector path: `aia/vectors/<uuid>` stores `{text, vector, clock, ownerPub}` — worker `/vector/put` + `/vector/query` (if not yet in worker, stub via `kv:` with cosine in Python for now, migrate to DO later)
- Fallback: if `GDBX_*` not set, use legacy `GUN_BRIDGE_TOKEN` path (log warning)

### FR3. OS Bridge
- `OS/gdbx-relay/bridge.js` — HTTP RPC `POST /gdbx/put`, `GET /gdbx/get?addr=&prefix=`, `WS /gdbx/watch` — internally uses `sdk/gdbx-sdk.js` (no `gun` import)
- `OS/gdbx-relay/package.json` — deps: `undefined` gun, only `@noble/hashes` (inherited) — verify `npm ls --omit=dev` clean
- Portal: `OS/portal/src/lib/gdbx.ts` (or `public/js/gdbx-live.js` reuse) — community sync reads from GDBx pool
- Feature flag: `USE_GDBX=1` enables GDBx path; otherwise gun path (for safe rollout)

### FR4. Org Docs & Discoverability
- `GDBX/conductor/tracks.md` entry for this track
- `AiA/conductor/tracks/aia-gdbx/` + `OS/conductor/tracks/os-gdbx/` stubs linking to this spec
- `examples/gdbx-hello/` in GDBX repo — minimal JS + Python "Hello GDBx" that works against live worker

### FR5. Tests & Live Verify
- `GDBX/test/test_gdbx_py_parity.mjs` (or `.py`) — JS↔Python sign/verify + address vectors
- `GDBX/test/test_org_integration.mjs` — mock AiA/OS bridge flows (register→put→mirror→read)
- `AiA/tests/test_gdbx_bridge.py` — unit + (optional) live `GDBX_API` e2e (skipped if no env)
- `OS/gdbx-relay/test/test_bridge.mjs` — RPC round-trip
- Live: `python AiA/core/gdbx_bridge.py --check` + `node OS/gdbx-relay/bridge.js --check` both hit live `gdbx-do` and converge on same `.gdbx` addr

---

## 5. Design Constraints

- **No gun in new code** — new bridges/SDKs must not import `gun` or `gun/sea`; use `gdbx-crypto` only
- **One firewall, all transports** — all writes through `FirewallGuard` (PoW+replay+sig+RBAC+ACL) — no bypass
- **Supply-chain clean** — Python SDK: `cryptography` or `ecdsa` pinned exact, no install scripts; JS: keep `@noble/hashes@1.8.0` only
- **Backward compat** — AiA/OS keep gun path until `USE_GDBX` proven live; no breaking change in one release
- **Local-first** — Node bridges must work offline (queue) and sync on reconnect (like portal's offline queue)

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Python crypto diverges from JS WebCrypto (GDBX1) | Cross-verify tests + shared test vectors (`test/vectors/gdbx1.json`) |
| AiA/OS env var sprawl | Single `GDBX_*` set, documented in `conductor/product.md`, fallback to gun |
| Worker `/vector/*` not yet implemented | Stub cosine search in Python/client first, migrate to DO `sqlite-vec` next track |
| Org rollout breaks other repos | Opt-in docs only, no forced migration; `examples/` template |
| PoW difficulty mismatch Python vs worker | Reuse `getDifficulty` logic verbatim, test with JS vectors |

---

## 7. Acceptance Criteria

- [ ] `packages/gdbx-py/gdbx_py/{crypto,codec,client}.py` exists, `pip install -e` works, `pytest` green, JS↔Python cross-verify passes
- [ ] `AiA/core/gdbx_bridge.py` can `register_did` + `put_deltas` + `get_deltas` against live `gdbx-do` (verified by JS client reading same key)
- [ ] `OS/gdbx-relay/bridge.js` RPC works (JS SDK, no gun), portal community sync reads from GDBx pool when `USE_GDBX=1`
- [ ] `GDBX/test/test_org_integration.mjs` + `test_gdbx_py_parity` green, 84/84 existing tests still green
- [ ] Live verify: `python AiA/core/gdbx_bridge.py --demo` and `node OS/gdbx-relay/bridge.js --demo` converge on same `.gdbx` address, `/pool` healthy, `/relay` still works
- [ ] Docs: `GDBX/conductor/tracks.md` + `AiA/conductor/tracks/aia-gdbx/` + `OS/conductor/tracks/os-gdbx/` linked
