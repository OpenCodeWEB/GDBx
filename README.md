# ⚡ GDBx ~ Global Decentralized DataBase Sync

> **Cryptographically Secure, Anti-Censorship, Multi-Transport LWW-CRDT Database Engine.**

[![Tests](https://img.shields.io/badge/Tests-48%2F48%20Passing-brightgreen)](#) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Live](https://img.shields.io/badge/Live-gdbx.pages.dev-blue)](https://gdbx.pages.dev) [![Branch](https://img.shields.io/badge/Branch-Dev-purple)](https://github.com/OpenCodeWEB/GDBX/tree/Dev)

By [@ABsUP](https://github.com/ABsUP) & [@OpenCodeWEB](https://github.com/OpenCodeWEB)

---

## 🌟 Key Highlights

- **Cryptographic Namespace (.GDBx):** BLAKE3-checksummed + Base32 58-character self-sovereign address format — just as `.onion` identifies Tor, `.GDBx` identifies the Global Decentralized DataBase.
- **Universal Transport Mesh:** Smart routing across WebRTC P2P, Nostr Relays, WebSocket (real-time), Tor v3, I2P, and IPFS.
- **Mathematical Consistency:** Hybrid Conflict-Free Replicated Data Type (CRDT) with Last-Write-Wins (LWW) state resolution.
- **Zero-Trust Security:** SEA (ECDSA P-256) signed deltas, adaptive PoW anti-spam, replay protection, and GDPR-ready cryptographic erasure.
- **Serverless by Design:** Cloudflare Workers + Durable Objects + SQLite + Pages. No central server, no single point of failure.

---

## 🛠️ Architecture & Protocol Spec

- [1. Address Format & Checksum Decoding](#address-format--checksum-decoding)
- [2. Multi-Transport Fallback Matrix](#multi-transport-fallback-matrix)
- [3. CRDT State Vector & Signature Envelope](#crdt-state-vector--signature-envelope)

### Address Format & Checksum Decoding

```
[1B version][1B network][32B pubkey-hash][2B BLAKE3 checksum] → base32 (RFC 4648) → 58 chars + ".gdbx"
```

| Network | Byte | Example suffix |
|---|---|---|
| mainnet | `0x00` | `…54mm.gdbx` |
| testnet | `0x01` | `…abcd.gdbx` |
| local | `0x02` | `…efgh.gdbx` |

Addresses are **identity-bound**: the address is derived from your P-256 public key, so `did:gdbx:<addr>` is verifiable without any central authority.

### Multi-Transport Fallback Matrix

| Transport | Typical Latency | Role |
|---|---|---|
| WebRTC DataChannel | < 30ms | Direct P2P mesh |
| GDBx Edge WebSocket | < 150ms | Persistent cloud layer (live now) |
| Nostr Relays (Kind 30000 LWW) | < 200ms | Public relay broadcast |
| Tor / I2P proxy wrapper | — | Anti-censorship fallback |

### CRDT State Vector & Signature Envelope

Every write is a signed delta batch:

```json
{
  "addr": "<58-char>",
  "pubkey": "<SEA pub>",
  "pubkeyHex": "04||X||Y (130 hex)",
  "deltas": [{ "key": "app/settings/theme", "value": "dark", "clock": 1787000000000 }],
  "ts": 1787000000000,
  "nonce": 42,
  "diff": 2,
  "hash": "0000abc…",
  "sig": "<SEA ECDSA signature>"
}
```

Conflict resolution: **LWW by monotonic clock**; tie → lexicographic pubkey wins.

---

## 🚀 Quickstart (SDK Usage)

```javascript
import { GDBx } from './gdbx-sdk.js';

const db = new GDBx({ appKey: 'my_app' });
await db.init();

// Real-time Put & Set
db.get('profile/settings').put({ theme: 'dark', notifications: true });

// Live Subscription
db.get('profile/settings').on((data) => {
  console.log('Real-time State Update:', data);
});
```

### Raw SDK (current API)

```javascript
import { makePair, registerDID, putDeltas, getDeltas, stats, purgeIdentity, exportState, leaderboard } from './sdk/gdbx-sdk.js';

const pair = await makePair();
// …pubkeyHex = your 130-char uncompressed P-256 hex…
await registerDID({ pubkeyHex, pair });
await putDeltas({ pubkeyHex, pair, deltas: [{ key: 'greeting', value: 'Hello GDBx!' }] });
const state = await getDeltas(addr);
console.log(await stats());
```

### Real-Time WebSocket Client

```javascript
import { GDBxWS } from './sdk/gdbx-ws-client.js';

const gdbx = new GDBxWS({ pubkeyHex, pair });
await gdbx.connect();
gdbx.on('delta', (e) => console.log('live update:', e.key, e.value));
await gdbx.put([{ key: 'status', value: 'online' }]);
```

---

## 🔗 Public API (live)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/address` | pubkey → .gdbx address + DID |
| `GET` | `/api/v1/address/:addr` | validate + describe |
| `POST` | `/api/v1/did/register` | register identity (PoW + SEA) |
| `GET` | `/api/v1/did/:addr` | resolve DID document |
| `POST` | `/api/v1/sync` | signed CRDT delta batch |
| `GET` | `/api/v1/sync/:addr?prefix=` | read state vector |
| `WS` | `/api/v1/ws?addr=` | real-time full-duplex sync |
| `POST` | `/api/v1/peers` | presence heartbeat |
| `POST` | `/api/v1/export` | signed backup snapshot |
| `DELETE` | `/api/v1/identity` | GDPR right-to-be-forgotten |
| `GET` | `/api/v1/leaderboard` | global mesh analytics |
| `GET` | `/api/v1/stats` | live ledger stats |
| `GET` | `/api/v1/health` | liveness |

---

## 🔒 Security & OWASP Hardening

- **PoW Anti-Spam:** Adaptive SHA-256 leading-zero difficulty (`2 ≤ Diff ≤ 4`) — abuse becomes economically infeasible.
- **Replay Defense:** Monotonic nonce + 60s sliding timestamp window — replayed requests rejected with `401`.
- **GDPR Compliance:** Cryptographic data erasure via `DELETE /api/v1/identity` (SEA proof-of-ownership required).
- **Strict Validation:** Flat-primitive JSON only, 32KB delta cap, strict key charset, bounded DID services.
- **Rate Limiting:** Sliding-window limits per IP/address (DID 10/min, writes 30/min, reads 120/min) → `429` + `Retry-After`.
- **Key Isolation:** Private keys stay 100% client-side (WebCrypto). The edge never touches unencrypted keys.
- **Signed Deltas:** Every mutation is ECDSA P-256 signed via Gun SEA — only authorized writes merge.

---

## 🧪 Testing

```bash
# all unit + integration tests (48 tests)
node --test test/test_codec.mjs test/test_storage.mjs test/test_security_hardening.mjs test/test_websocket.mjs test/test_phase4.mjs

# live end-to-end against gdbx.pages.dev
node test/_live_e2e.mjs
```

Coverage: address codec determinism, DID registry, PoW + SEA gates, LWW conflicts, replay attacks, expired timestamps, GDPR erasure, WebSocket protocol, leaderboard analytics.

---

## 🗺️ Roadmap

- [x] **Phase 0** — Scaffold (Conductor setup, Cloudflare Pages + Worker)
- [x] **Phase 1** — Address Codec (BLAKE3 + base32, DID resolver)
- [x] **Phase 2** — DID Registry + PoW Gate (GDBxStorageDO, SEA signed writes)
- [x] **Phase 3** — CRDT Sync Engine (LWW merge, presence, stats, Pages API v1)
- [x] **Phase 4** — Hardening + Real-time (replay protection, GDPR, rate limits, WebSocket sync, export/backup, leaderboard)
- [ ] **Phase 5** — Multi-Transport Router (WebRTC / Nostr / Tor / I2P / IPFS)
- [ ] **Phase 6** — Public Audit (independent security audit, load testing)

---

## 📄 License & Governance

Licensed under the [MIT License](LICENSE). Built by [@ABsUP](https://github.com/ABsUP) & [@OpenCodeWEB](https://github.com/OpenCodeWEB). Contributions, issues and forks welcome — open a PR on the `Dev` branch.

**Live:** [gdbx.pages.dev](https://gdbx.pages.dev) · **Repo:** [github.com/OpenCodeWEB/GDBX](https://github.com/OpenCodeWEB/GDBX)