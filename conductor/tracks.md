# GDBx Tracks Registry

| ID | Track | Status | Spec | Plan |
|----|-------|--------|------|------|
| address-codec | `.GDBx` address format (BLAKE3+base32) | completed | [spec](./tracks/address-codec/spec.md) | [plan](./tracks/address-codec/plan.md) |
| did-registry | DID registry + PoW gate (GDBxStorageDO) | completed | [spec](./tracks/did-registry/spec.md) | [plan](./tracks/did-registry/plan.md) |
| crdt-sync | LWW-CRDT sync engine + Pages API v1 | completed | [spec](./tracks/crdt-sync/spec.md) | [plan](./tracks/crdt-sync/plan.md) |
| hardening-realtime | Phase 4: replay protection, GDPR purge, rate limits, validation, WS live sync, export, leaderboard | completed | [spec](./tracks/hardening-realtime/spec.md) | [plan](./tracks/hardening-realtime/plan.md) |
| self-sovereign-mesh | Phase 5: gun-free crypto core, zero-trust firewall (RBAC+ACL), replication pool, hybrid mesh (WS/Nostr/WebRTC), supply-chain hardening | completed | [spec](./tracks/self-sovereign-mesh/spec.md) | [plan](./tracks/self-sovereign-mesh/plan.md) |

## Live deployment notes (2026-08-21)

- **Pages → DO 500 root cause**: git-push deploys do NOT inject `wrangler.toml` DO bindings
  into the Pages project config. Fix: `npx wrangler pages deploy public --project-name gdbx --branch Dev --commit-dirty=true`
  (CLI deploy injects bindings; `public` dir, NOT `.`).
- **WS live sync**: WebSocket hub moved INSIDE `GDBxStorageObject` (singleton isolate) —
  broadcasts never miss. Pages Functions cannot forward WS upgrades; clients must use
  `wss://gdbx-do.xup.workers.dev/ws?addr=<addr>` directly.
- **gun-free (Phase 5)**: browser loads local module `/js/gdbx-crypto.js` as `window.GDBxCrypto`
  (no CDN). Runtime deps = `@noble/hashes@1.8.0` only; `npm audit` 0; SDK bundled self-contained
  to `dist/` via esbuild; supply-chain gate: `npm run check:supply-chain`.
- **One firewall, all transports**: `FirewallGuard` (PoW→replay→sig→RBAC→ACL) gates HTTP `/sync`,
  WS hub puts, AND Nostr relay `/relay` ingest identically. New DID = role `user`
  (ROOT_PUBKEYS member = superadmin); `identity.promote`/`demote` via `/identity/role`
  (superadmin-signed). ROOT_PUBKEYS not yet set in production — promote/demote live later.
- **Pool (live)**: `GDBxMirrorDO` second namespace; primary replicates DID+delta snapshots
  post-write; pool read path merges primary+mirror (LWW, rejoin healing); `/pool` shows
  primary+mirror healthy. Verified live: `/pool` 200 both nodes.
- **Hybrid mesh (live)**: Nostr kind-23124 events carry GDBX1 envelopes; `/relay` verified
  live (signed event → applied delta). WebRTC signaling builders ready in `sdk/transport.js`.
- **Verified**: LIVE E2E PASS (register→put→get→stats→purge→resolve), 84/84 unit tests,
  WS handshake welcome, live relay ingest applied, pool status healthy.

## Worker deployment

- Worker `gdbx-do` (version `2c047032-ead4-47ee-87a5-94a8a6c80f01`):
  `npx wrangler deploy --config worker/wrangler.toml`
- Pages latest deployment: `7a5ed0a5` (from `public`)
- Commits: `3ea71de` → `0d1a6a6` (Phase 4), `d299500` → `2e40c8b` (Phase 5 local, pending push)