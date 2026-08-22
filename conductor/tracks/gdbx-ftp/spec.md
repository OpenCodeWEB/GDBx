# Track: GDBx FTP Bridge — Sovereign FTP Gateway (GunX parity, GDBx-native)

> **Track ID:** `gdbx-ftp` | **Phase:** 6.3 | **Status:** spec draft
> **Parent:** `org-gdbx-unification`, `gdbx-playground`
> **Gemini Consultation:** `gemini.google.com/app/65e128ca6eac1cdd` (FTP integration, 2026-08-21)
> **Top 1:** Node.js Local Bridge Adapter (ftp-srv + WebCrypto) — 100% FileZilla compatible, bypasses Workers TCP limit, keeps GDBx zero-trust

## 1. Context & Why FTP

FTP is legacy but still used by FileZilla, enterprise pipelines, IoT. GDBx already routes WS+Nostr+WebRTC — adding FTP as hybrid-mesh transport makes `.GDBx` truly "One address. Every technology." Gemini proposed 5 alternatives; Top 1 is local loopback gateway (127.0.0.1:2121) that FileZilla connects to, bridge converts FTP commands to GDBx-signed deltas.

**Why not Cloudflare Workers native FTP?** Workers have no raw TCP socket — FTP's classic PORT/PASV (dual ports) cannot run on edge. Solution: Local daemon (Node `ftp-srv`) on 127.0.0.1, converts FTP to GDBx WebSocket deltas (single socket, firewall-gated, pool-replicated). No external network sees plain-text FTP.

## 2. Goals

### G1. Sovereign FTP Gateway (Local Loopback)
- CLI: `gdbx ftp gateway --port 2121` → starts `ftp-srv` on 127.0.0.1:2121
- FileZilla: Host `127.0.0.1:2121`, Username `<addr>.gdbx`, Password `<priv>` or session token → local bridge captures, GDBx-signs, encrypts, puts to GDBx mesh
- `ftp://<addr>.gdbx/path` virtual routing — `<addr>` is target GDBx node's address (resolved via GDBx peerDiscovery)

### G2. GDBx Delta ↔ FTP File Mapping
- File binary **not** in LWW delta directly. Delta stores **Manifest** at `sys/ftp/manifest/<filepath_hash>`:
  ```json
  { "path": "/docs/paper.pdf", "size": 10485760, "chunks": ["hash1","hash2"], "iv": "base64...", "owner": "pub...", "updatedAt": 1774137600000 }
  ```
- Chunks: AES-GCM encrypted (key from room? or per-file random IV + GDBx-signed manifest), BLAKE3 hashed, stored in `GDBxMirrorDO` pool or Cloudflare R2 (or P2P WebRTC if R2 not configured) — Chunk size 256KB (adaptive like GunX's file)
- `GDBx Signed FTP Commands`: `{op: "FTP_STOR", path, manifest}` signed via `GDBxCrypto.sign` (like playground's PoW+sig)

### G3. SDK (`sdk/ftp_bridge.js`, `sdk/utils/chunker.js`)
- `sdk/utils/chunker.js` (Priority 1): `chunker.process(fileData) → {manifest, encryptedChunks}`, `chunker.assemble(chunks, iv)`, BLAKE3 hash, AES-GCM
- `sdk/ftp_bridge.js` (Priority 2): `class GDBxFTP { connect(gdbxUrl), put(localPath, remotePath), get(remotePath), sync(prefix) }` — uses `GdbxClient` + `FirewallGuard`
- Pure JS, no `gun`, uses `@noble/hashes` BLAKE3, WebCrypto AES-GCM

### G4. CLI (`packages/gdbx-cli` → `gdbx ftp ...`)
- `gdbx ftp gateway --port 2121 --api https://gdbx-do.xup.workers.dev` — starts local `ftp-srv` daemon
- `gdbx ftp put ./local.pdf /remote.pdf --addr <target>.gdbx`
- `gdbx ftp get /remote.pdf ./local.pdf`
- `gdbx ftp ls /path` — list via `sys/ftp/manifest/<prefix>/*` deltas
- `gdbx ftp sync /docs --watch` — CRDT subscribe

### G5. Worker & R2 (Priority 4)
- `worker/src/FtpBridge.js` — edge manifest index, R2 bucket `GDBX_FTP_BUCKET` for chunks (if configured), else P2P WebRTC fallback
- `POST /api/ftp/chunk` — upload chunk (if R2), `GET /api/ftp/chunk/<hash>` — download

### G6. Playground UI
- Drag-and-drop Web FTP Explorer in `#playground` — shows `sys/ftp/manifest/*` as file tree, upload/download via SDK

## 3. Non-Goals
- Full FUSE mount (deferred, platform-dependent)
- Virtual WASM FTP daemon (deferred)
- Cloudflare Workers native FTP (impossible due to TCP)

## 4. Constraints
- **No plain-text over network**: FTP plain-text only on 127.0.0.1 loopback, immediately GDBx-signed + AES-GCM encrypted
- **Passive mode only**: `ftp-srv` PASV bound to 127.0.0.1, no external PORT
- **Workers no TCP**: All FTP→GDBx conversion happens in local daemon, not edge
- **Flat-primitive**: Manifest value is JSON string (32KB max includes manifest, chunks separate)
- **Supply-chain**: `ftp-srv@4.6.1` + `basic-ftp@5.0.5` pinned, `npm audit 0`

## 5. 5 Alternatives (Gemini)

1. **Node.js Local Bridge Adapter (ftp-srv + WebCrypto)** — PRO: 100% FileZilla compatible, bypasses Workers TCP limit, keeps GDBx zero-trust — **Top 1** ✅
2. Cloudflare Workers HTTP-to-FTP Stream Proxy — PRO: lightweight HTTP client, CON: not FileZilla compatible
3. WebRTC-Direct Browser FTP Playground — PRO: zero install, CON: no FileZilla mount
4. Custom FUSE Drive (gdbx-fuse) — PRO: Finder/Explorer drive, CON: complex C/FUSE
5. Virtual WASM FTP Daemon — PRO: isolated/portable, CON: not FileZilla native

## 6. Acceptance

- [ ] `sdk/utils/chunker.js` — chunk, encrypt, hash, assemble, 5+ tests, `npm audit 0`
- [ ] `sdk/ftp_bridge.js` — `GDBxFTP` put/get/sync, GDBx signed, 5+ tests (mock)
- [ ] `packages/gdbx-cli` — `gdbx ftp gateway` starts ftp-srv on 127.0.0.1:2121, FileZilla can `ftp://<addr>.gdbx` list/put/get
- [ ] `function/api/ftp/*` or `worker/src/FtpBridge.js` — chunk upload/download (R2 or P2P fallback)
- [ ] Playground drag-drop shows `sys/ftp/manifest/*` as file tree
- [ ] `88/88` existing tests still pass, `npm run check:supply-chain` pass
