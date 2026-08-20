# GDBx Tracks Registry

| ID | Track | Status | Spec | Plan |
|----|-------|--------|------|------|
| address-codec | `.GDBx` address format (BLAKE3+base32) | completed | [spec](./tracks/address-codec/spec.md) | [plan](./tracks/address-codec/plan.md) |
| did-registry | DID registry + PoW gate (GDBxStorageDO) | completed | [spec](./tracks/did-registry/spec.md) | [plan](./tracks/did-registry/plan.md) |
| crdt-sync | LWW-CRDT sync engine + Pages API v1 | completed | [spec](./tracks/crdt-sync/spec.md) | [plan](./tracks/crdt-sync/plan.md) |
| hardening-realtime | Phase 4: replay protection, GDPR purge, rate limits, validation, WS live sync, export, leaderboard | completed | [spec](./tracks/hardening-realtime/spec.md) | [plan](./tracks/hardening-realtime/plan.md) |
| self-sovereign-mesh | Phase 5: gun-free crypto core, zero-trust firewall (RBAC+ACL), replication pool, hybrid mesh (WS/Nostr/WebRTC), supply-chain hardening | plan_ready | [spec](./tracks/self-sovereign-mesh/spec.md) | [plan](./tracks/self-sovereign-mesh/plan.md) |

## Live deployment notes (2026-08-21)

- **Pages → DO 500 root cause**: git-push deploys do NOT inject `wrangler.toml` DO bindings
  into the Pages project config. Fix: `npx wrangler pages deploy public --project-name gdbx --branch Dev --commit-dirty=true`
  (CLI deploy injects bindings; `public` dir, NOT `.`).
- **WS live sync**: WebSocket hub moved INSIDE `GDBxStorageObject` (singleton isolate) —
  broadcasts never miss. Pages Functions cannot forward WS upgrades; clients must use
  `wss://gdbx-do.xup.workers.dev/ws?addr=<addr>` directly.
- **Browser SEA**: CDN `gun@0.2020.1241` (matches Node/worker verify path); esm.sh sea.js
  default export is empty — classic script tags required.
- **Verified**: LIVE E2E PASS (register→put→get→stats→purge→resolve), 48/48 unit tests,
  WS handshake 101, sandbox delta broadcast (single socket, sender echo + backoff reconnect).

## Worker deployment

- Worker `gdbx-do` (version `23f2af74-7284-4327-8069-5252e95165ec`):
  `npx wrangler deploy --config worker/wrangler.toml`
- Pages latest deployment: `3b1330ef` (from `public`)
- Commits: `3ea71de` → `0d1a6a6`