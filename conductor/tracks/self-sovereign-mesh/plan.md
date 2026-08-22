# Plan — self-sovereign-mesh (Phase 5)

> Track: `self-sovereign-mesh` · Spec: `./spec.md` · Status: plan ready
> Order: crypto core → supply-chain → firewall → pool → mesh

---

## Step 1 — `gdbx-crypto` module (A1) — TDD

**File:** `sdk/gdbx-crypto.js` (pure Web Crypto, browser + Node + worker, zero deps, pure ESM)
**Test:** `test/test_crypto.mjs` (red first)

- `pair()` — ECDSA P-256 keypair; pubkey `x.y` (base64url, no padding) — SEA-shape-compatible
- `sign(body, pair)` — canonical JSON (key-sorted) → SHA-256 → ECDSA → **`GDBx` envelope**: `"GDBx" + JSON.stringify({m, s})` (s = base64url raw signature)
- `verify(body, sig, pub)` — GDBx verify (async, pure WebCrypto)
- `verifyCompat(body, sig, pub)` — GDBx **or** legacy SEA v1 (backward compat for old clients)
- Tests: roundtrip, tampered body rejected, wrong pubkey rejected, known-vector lock, GDBx+SEA-v1 compat both accepted

## Step 2 — Worker verify (A3) — gun-free confirm

**File:** `worker/src/verify.js`
- Add `verifySig(body, sig, pub)` = `verifyCompat` logic (GDBx preferred, SEA v1 fallback)
- `verifySeaSig` kept as alias (existing callers unchanged)
- `worker/src/GDBxStorageDO.js` — switch call sites to `verifySig`
- Tests: existing 48 still pass (SEA v1 path) + new GDBx path tests in `test_crypto.mjs` against worker verify

## Step 3 — SDK + browser gun removal (A2/A3) — TDD

- `sdk/gdbx-sdk.js` + `sdk/gdbx-ws-client.js`: drop `import("gun/sea.js")` → `import { pair, sign } from "./gdbx-crypto.js"`
- `public/js/gdbx-live.js`: `window.Gun.SEA` → `window.GDBxCrypto` (local script)
- `public/index.html`: **remove gun CDN scripts (lines 499-501)** → add local `gdbx-crypto.js` script
- Tests migrated off gun: `test/test_phase4.mjs`, `test/test_security_hardening.mjs`, `test/test_websocket.mjs`, `test/_live_e2e.mjs` — replace `require("gun")` / `require("gun/sea.js")` with `sdk/gdbx-crypto.js` (GDBx signing)
- Verify: full suite green **without gun installed**; sandbox live test (put → signed GDBx → worker verify ✓)

## Step 4 — Supply-chain hardening (E)

- `package.json`: remove `gun` dependency; pin `@noble/hashes` exact version; add `esbuild` (devDep) + `build` script
- Bundle SDK → `dist/gdbx.mjs` (noble inlined at build time — GenosDB pattern: vendored + pinned + bundled)
- `npm audit` → 0 vulnerabilities; runtime deps → **0** (check `npm ls --omit=dev`)
- `THIRD_PARTY_LICENSES.md` (noble/hashes, esbuild note)
- CI gate: `scripts/check-supply-chain.mjs` — fails if runtime deps > 0 or audit has findings
- Commit: `chore: supply-chain hardening — gun removed, zero runtime deps`

## Step 5 — Firewall: RBAC + ACL + FirewallGuard (B) — TDD

**Files:** `worker/src/roles.js`, `worker/src/FirewallGuard.js`, `worker/src/GDBxStorageDO.js`
**Test:** `test/test_firewall.mjs` (red first)

- Roles: `guest(0) → user(1) → manager(2) → admin(3) → superadmin(4)`; stored per addr in DO
- New DID registers as **guest** (read-only); `identity.promote` action (signed, superadmin-only) upgrades roles
- `ROOT_PUBKEYS` (worker var) = superadmin set (GDBx pubkey format)
- Node-level ACL: `collaborators` list per addr; owner + collaborators may write a key; others → 403
- `FirewallGuard.check()` pipeline: PoW → replay → signature (GDBx/SEA) → RBAC → ACL → validation → pass
- All existing routes (did.register, sync.put, purge, export) run through FirewallGuard

## Step 6 — Pool: replication + failover (C) — TDD

**Files:** `worker/src/GDBxMirrorDO.js`, `worker/wrangler.toml` (namespace), `worker/src/GDBxStorageDO.js` (replicate hook)
**Test:** `test/test_pool.mjs` (red first, DO-mocked)

- `GDBxMirrorDO` — same CRDT storage class, separate namespace (`gdbx-mirror`)
- Primary DO: after successful write → `env.GDBX_MIRROR.idFromName(addr)` → `stub.fetch` replicate (signed node-to-node handshake — membership crypto-verified)
- Read failover: primary unavailable → mirror serve; rejoin → CRDT merge (LWW + tombstones)
- Pool status endpoint: `/api/v1/pool` (nodes, health, replication lag)

## Step 7 — Hybrid mesh transports (D) — TDD

**Files:** `sdk/transport.js` (interface), `sdk/transport-ws.js` (refactor existing WS client), `sdk/transport-nostr.js`, `worker/src/RouterDO.js` (transport table)
**Test:** `test/test_transport.mjs` (mock relay / mock peer)

- Transport interface: `connect(addr)`, `send(msg)`, `onMessage`, `close`, `health()`
- WS transport: existing `gdbx-ws-client.js` refactored onto interface
- Nostr signaling transport: relay publish/subscribe (own signed messages via gdbx-crypto; optional shared-password channel encryption)
- `RouterDO`: per-addr transport registry + selection; **auto-select WS → fallback Nostr** (heartbeat/health based)
- WebRTC adapter: interface + smoke stub (DataChannel mapping) — full impl in later phase

## Step 8 — Integration, deploy, docs

1. Full suite: old 48 + new (crypto, firewall, pool, transport) all green; `npm ls --omit=dev` → 0
2. `npx wrangler deploy --config worker/wrangler.toml` (gdbx-do + mirror namespace + RouterDO)
3. `npx wrangler pages deploy public --project-name gdbx --branch Dev --commit-dirty=true`
4. Live verify: sandbox put (GDBx signed) ✓, stats ✓, live WS delta ✓, live E2E ✓
5. `conductor/tracks.md` → self-sovereign-mesh completed; commit `feat: ...`

## Test commands (Windows, per file)

```powershell
node --test test/test_crypto.mjs
node --test test/test_firewall.mjs
node --test test/test_pool.mjs
node --test test/test_transport.mjs
node --test test/test_codec.mjs test/test_storage.mjs test/test_security_hardening.mjs test/test_websocket.mjs test/test_phase4.mjs
node --test test/_live_e2e.mjs
```

## Risks / Notes

- **SEA v1 compat**: old clients keep working (verifyCompat) while new SDK signs GDBx — no data migration needed
- **Browser crypto**: WebCrypto `crypto.subtle` available in all modern browsers (secure context only — pages.dev is https ✓)
- **DO-to-DO calls**: mirror replication uses DO stubs (idFromName + fetch) — no public URL needed
- Nostr relay in tests = local mock server (no external dependency in CI)