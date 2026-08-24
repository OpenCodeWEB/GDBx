# Track: Self-Sovereign Mesh, Firewall & Pool

> **Track ID:** `self-sovereign-mesh` · **Phase:** 5 · **Status:** spec draft
> **ভিশন:** `.GDBx` নিজের পায়ে দাঁড়াবে — নিজস্ব সিস্টেম, নিজস্ব ফায়ারওয়াল, নিজস্ব পুল, নিজস্ব হাইব্রিড মেশ। অনুকরণ নয় — 100% ভরসাযোগ্য open project।

---

## 1. প্রেক্ষাপট (Context)

### 1.1 ভিত্তি — GenosDB vs GunDB Supply-Chain বিশ্লেষণ

`genosdb.com/gundb-supply-chain-security` (Socket.dev report, জুলাই 2026) পড়া ও বিশ্লেষণ করা হয়েছে:

**GunDB-র Supply-Chain অবস্থা (gun@0.2020.1241):**
- **4 critical CVE** + 24 high + 16 medium + 5 low — dependency tree-তে, upstream 2020-এ থেমে যাওয়ায় fix আসছে না
- **201 packages unmaintained** (5+ বছর), 23 deprecated
- **38 eval/dynamic execution**, 20 shell access, 22 network access, 78 filesystem access, 75 env-var access
- 2 install scripts, 2 obfuscated packages, 2 native binaries, typosquat-adjacent names
- Last release 2020 — maintainer নিজেই বলেছেন maintenance paused ("no promised timeline")

**GenosDB-র উত্তর (যা GDBx adopt করবে):**
1. **Zero dependencies** — Socket.dev: `Dependencies: 0`। Primitives (Ethereum sig, MessagePack, Pako) pinned + reviewed + **build-time bundled** — install-এ npm থেকে fresh resolve হয় না। No preinstall/postinstall hooks। Pure ESM, static code, no eval।
2. **Vulnerability score 100/100**, License 80 (single declared license + THIRD_PARTY_LICENSES.md)
3. **Cryptographic enforcement at runtime (data plane)** — প্রতিটি write author-এর key দিয়ে signed, প্রতিটি peer verify করে
4. **Zero-trust RBAC**: guest → user → manager → admin → superadmin; নতুন identity = write-blocked guest; superadmin sign করে promote
5. **Node-level ACLs** — per-node read/write/delete grants, cryptographic verify
6. **Decentralized signaling** — WebRTC + Nostr relays (GenosRTC)
7. **Client-side encryption** — `sm.put()/sm.get()` E2E encrypted
8. **Feature surface demonstrated** — 50+ runnable example apps

### 1.2 GDBx-এর বর্তমান দুর্বলতা (এই track-এর কারণ)

| দুর্বলতা | অবস্থা |
|---|---|
| Browser এখনো `gun@0.2020.1241` CDN থেকে SEA-র জন্য টানে | **এটাই GunDB-র supply-chain risk GDBx-এ ঢুকেছে** — 4 critical CVE-সহ tree |
| SEA signature ফরম্যাট gun-সংযুক্ত | নিজস্ব verify (`worker/src/verify.js`) আছে, কিন্তু browser-side এখনো gun-নির্ভর |
| WS hub DO-তে সরেছে (Phase 4) | ✓ কিন্তু transport এখনো শুধু WebSocket |
| PoW + replay + rate limits আছে | ✓ কিন্তু "firewall" হিসেবে সমন্বিত নয়, RBAC/ACL-এর zero-trust মডেল নেই |
| Data একটাই DO-তে (gdbx) | ✗ pool/replication নেই — node পড়ে গেলে data ঝুঁকিতে |

---

## 2. এই Track-এ যোগ করা Special Features

### A. নিজস্ব সিস্টেম — gun সম্পূর্ণ বাদ (Self-Sovereign Crypto Core)

**A1. `gdbx-crypto` module (zero-dependency)** — browser + Node + worker-এ একই pure WebCrypto:
- ECDSA P-256 sign/verify (não-SEA, নিজস্ব canonical JSON signing)
- SHA-256 PoW, BLAKE3 checksum (`@noble/hashes` vendored + pinned)
- নিজস্ব key-pair generation + `gdbx@` identity format
- **Supply-chain clean**: কোনো runtime dependency নেই; primitives build-time bundled; no install scripts; pure ESM

**A2. index.html থেকে gun CDN script সম্পূর্ণ বাদ** — `window.Gun.SEA` প্রতিস্থাপন নিজস্ব `GDBxCrypto` দিয়ে

**A3. SDK + worker-এ gun-মুক্ত verify** — `sdk/gdbx-sdk.js` + `worker/src/verify.js` একই crypto module ব্যবহার করবে

### B. ফায়ারওয়াল (Protocol-Level Firewall / Zero-Trust Perimeter)

**B1. Zero-Trust RBAC**: প্রতিটি identity-র role — `guest(0) → user(1) → manager(2) → admin(3) → superadmin(4)`। নতুন DID = guest (write-blocked); superadmin-এর signed promotion-এ upgrade। Role প্রতিটি operation-এ verify।

**B2. Node-level ACLs**: প্রতি key/node-এ read/write/delete grants — owner + collaborators। Non-collaborator write cryptographic-ভাবে reject (এখনকার DID services binding-এর সম্প্রসারণ)।

**B3. Firewall gate (unified)**: PoW + replay/nonce + rate limits + validation + RBAC/ACL — একটাই pipeline `FirewallGuard`-এ, যেকোনো transport-এ একই নিয়ম (WS, HTTP, ভবিষ্যতে WebRTC/Nostr)।

### C. পুল সিস্টেম (Replication Pool)

**C1. Multi-node replication**: প্রতি `.GDBx` address-এর data ≥2 storage node-এ (gdbx + mirror DO/namespace) — লেখা primary-তে, async replicate।

**C2. Pool membership crypto-verified**: pool-এ join করার সময় node নিজের key দিয়ে sign করে; nodes একে অপরকে verify করে (zero-trust join — GenosDB-র "verification, not belief" নীতি)।

**C3. Automatic failover + heal**: primary নিচে গেলে replica serve করে; rejoin-এ CRDT merge (LWW + tombstones)।

### D. হাইব্রিড মেশ (Hybrid Mesh / Multi-Transport)

**D1. Transport abstraction**: `transport` interface — একই message flow WS/WebRTC/Nostr-এ চলে।

**D2. GenosRTC-প্যাটার্ন signaling**: WebRTC data channel + Nostr relay signaling (নিজস্ব audited crypto/codec, ঐচ্ছিক shared-password encryption)।

**D3. Auto transport selection + fallback**: প্রতি address-এ best transport (latency/availability) + automatic failover; `RouterDO` transport table-এ রেজিস্ট্রেশন।

### E. Supply-Chain Hardening (GDBx নিজেই clean থাকবে)

**E1.** `npm audit` → **0 vulnerabilities**; `Dependencies: 0` (runtime); no install scripts
**E2.** `THIRD_PARTY_LICENSES.md` — vendored primitives-এর license accountability
**E3.** Socket.dev-style self-check CI step (dependency count + audit gate)
**E4.** Pinned exact versions, no floating ranges

---

## 3. Scope (এই track-এ যা আছে)

- [x] A1–A3: gun-মুক্ত crypto core (browser + Node + worker)
- [x] B1–B3: zero-trust RBAC + node ACL + unified firewall gate
- [x] C1–C3: replication pool (DO mirror) + crypto-verified membership + failover
- [x] D1–D3: transport abstraction + Nostr signaling + WebRTC channel + auto-fallback
- [x] E1–E4: supply-chain hardening + CI gate

## 4. Out of Scope (এই track-এ নয়)

- Tor v3 (.onion) / I2P / IPFS transport implementation (roadmap Phase 6 — adapter interface থাকবে, implementation পরে)
- Blockchain RPC bridge
- GunX payment bridge (আলাদা track, আগে থেকে parked)
- Naming/payment tokenomics

## 5. Acceptance Criteria

1. `index.html`-এ gun CDN script **আছে না**; sandbox নিজস্ব crypto-তে sign/verify করে — `[Node A] ✓ signed (gdbx-crypto)` + worker verify PASS
2. `npm ls --omit=dev` → 0 runtime dependencies; `npm audit` → 0
3. Unit tests: RBAC (guest write-blocked, forged role rejected, superadmin promotion), ACL (non-collaborator rejected), sm.put/sm.get E2E roundtrip, pool replication + failover, firewall gate (replay/PoW/rate)
4. Live E2E PASS (register→put→get→stats→purge) gun-free stack-এ
5. WS live sync delta broadcast এখনো কাজ করে (Phase 4 রিগ্রেশন নেই) — 48/48 পুরনো tests + নতুন
6. Transport abstraction এ WebSocket adapter চলে; Nostr signaling unit-test-এ (mock relay); WebRTC adapter smoke-test (Node-এ DataChannel mocking বা browser demo)
7. `conductor/tracks.md` আপডেট

---

## 6. Implementation Order (Plan-এর আগে দিকনির্দেশনা)

1. **A**: `gdbx-crypto` module + tests → browser swap (সবচেয়ে urgent — supply-chain risk এখনই বন্ধ)
2. **E**: supply-chain hardening + CI gate (গান বাদ পড়লেই dependency শূন্য)
3. **B**: RBAC + ACL + FirewallGuard pipeline
4. **C**: pool (mirror DO + membership + failover)
5. **D**: transport abstraction → Nostr signaling → WebRTC
6. Full suite + live deploy + docs

> **নীতি (GenosDB-র):** "Replace trust with verification" — প্রতিটি operation cryptographic verify; package self-contained; feature surface demonstrated, not asserted।