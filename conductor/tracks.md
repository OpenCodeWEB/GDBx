# GDBx Tracks Registry

| ID | Track | Status | Spec | Plan |
|----|-------|--------|------|------|
| address-codec | `.GDBx` address format (BLAKE3+base32) | completed | [spec](./tracks/address-codec/spec.md) | [plan](./tracks/address-codec/plan.md) |
| did-registry | DID registry + PoW gate (GDBxStorageDO) | completed | [spec](./tracks/did-registry/spec.md) | [plan](./tracks/did-registry/plan.md) |
| crdt-sync | LWW-CRDT sync engine + Pages API v1 | completed | [spec](./tracks/crdt-sync/spec.md) | [plan](./tracks/crdt-sync/plan.md) |
| hardening-realtime | Phase 4: replay protection, GDPR purge, rate limits, validation, WS live sync, export, leaderboard | completed | [spec](./tracks/hardening-realtime/spec.md) | [plan](./tracks/hardening-realtime/plan.md) |
| self-sovereign-mesh | Phase 5: gun-free crypto core, zero-trust firewall (RBAC+ACL), replication pool, hybrid mesh (WS/Nostr/WebRTC), supply-chain hardening | completed | [spec](./tracks/self-sovereign-mesh/spec.md) | [plan](./tracks/self-sovereign-mesh/plan.md) |
| org-gdbx-unification | Phase 6: org-wide GDBx fabric Ã¢â‚¬â€ AiA & OS bridges, Python SDK, all OpenCodeWEB projects | completed | [spec](./tracks/org-gdbx-unification/spec.md) | [plan](./tracks/org-gdbx-unification/plan.md) |
| gdbx-cli-visual | Phase 6.1: CLI (identity/sync/vector/backup) + Visual Inspector | completed | [spec](./tracks/gdbx-cli-visual/spec.md) | [plan](./tracks/gdbx-cli-visual/plan.md) |
| gdbx-playground | Phase 6.2: Live P2P Playground Ã¢â‚¬â€ GunX parity (chat, rooms, presence, file) | completed | [spec](./tracks/gdbx-playground/spec.md) | [plan](./tracks/gdbx-playground/plan.md) |
| gdbx-ftp | Phase 6.3: Sovereign FTP Gateway Ã¢â‚¬â€ ftp-srv + GDBx + chunked pool | completed | [spec](./tracks/gdbx-ftp/spec.md) | [plan](./tracks/gdbx-ftp/plan.md) |
| gunx-compat-engine | Phase 6.4: GunX relay engine absorbed - /gunx wire protocol, GunX clients peer directly | completed | (see commit 6af063b) | - |
| gdbx-interconnect | Phase 6.5: Unified Interconnect Ã¢â‚¬â€ Global Secure Live Sync (any host + local) | plan_ready | [spec](./tracks/gdbx-interconnect/spec.md) | [plan](./tracks/gdbx-interconnect/plan.md) |

## Live deployment notes (2026-08-21)

- **Pages Ã¢â€ â€™ DO 500 root cause**: git-push deploys do NOT inject `wrangler.toml` DO bindings
  into the Pages project config. Fix: `npx wrangler pages deploy public --project-name gdbx --branch Dev --commit-dirty=true`
  (CLI deploy injects bindings; `public` dir, NOT `.`).
- **WS live sync**: WebSocket hub moved INSIDE `GDBxStorageObject` (singleton isolate) Ã¢â‚¬â€
  broadcasts never miss. Pages Functions cannot forward WS upgrades; clients must use
  `wss://gdbx.xup.workers.dev/ws?addr=<addr>` directly.
- **gun-free (Phase 5)**: browser loads local module `/js/gdbx-crypto.js` as `window.GDBxCrypto`
  (no CDN). Runtime deps = `@noble/hashes@1.8.0` only; `npm audit` 0; SDK bundled self-contained
  to `dist/` via esbuild; supply-chain gate: `npm run check:supply-chain`.
- **One firewall, all transports**: `FirewallGuard` (PoWÃ¢â€ â€™replayÃ¢â€ â€™sigÃ¢â€ â€™RBACÃ¢â€ â€™ACL) gates HTTP `/sync`,
  WS hub puts, AND Nostr relay `/relay` ingest identically. New DID = role `user`
  (ROOT_PUBKEYS member = superadmin); `identity.promote`/`demote` via `/identity/role`
  (superadmin-signed). ROOT_PUBKEYS not yet set in production Ã¢â‚¬â€ promote/demote live later.
- **Pool (live)**: `GDBxMirrorDO` second namespace; primary replicates DID+delta snapshots
  post-write; pool read path merges primary+mirror (LWW, rejoin healing); `/pool` shows
  primary+mirror healthy. Verified live: `/pool` 200 both nodes.
- **Hybrid mesh (live)**: Nostr kind-23124 events carry GDBx envelopes; `/relay` verified
  live (signed event Ã¢â€ â€™ applied delta). WebRTC signaling builders ready in `sdk/transport.js`.
- **Verified**: LIVE E2E PASS (registerÃ¢â€ â€™putÃ¢â€ â€™getÃ¢â€ â€™statsÃ¢â€ â€™purgeÃ¢â€ â€™resolve), 84/84 unit tests,
  WS handshake welcome, live relay ingest applied, pool status healthy.

## Worker deployment

- Worker `gdbx` (version `2c047032-ead4-47ee-87a5-94a8a6c80f01`):
  `npx wrangler deploy --config worker/wrangler.toml`
- Pages latest deployment: `7a5ed0a5` (from `public`)
- Commits: `3ea71de` Ã¢â€ â€™ `0d1a6a6` (Phase 4), `d299500` Ã¢â€ â€™ `2e40c8b` (Phase 5 local, pending push)
