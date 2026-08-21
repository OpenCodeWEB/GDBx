# Plan — gdbx-ftp (Phase 6.3)

> Track: `gdbx-ftp` | Spec: `./spec.md` | Status: plan ready
> Order: chunker → SDK → CLI gateway → Worker/R2 → Playground UI

## Step 1 — Chunker Core (Priority 1, TDD)
**Files:** `sdk/utils/chunker.js`, `test/test_chunker.mjs` (red first)
- `chunker.process(fileData: Uint8Array, opts?: {chunkSize: 256*1024}) → {manifest, encryptedChunks, iv}`
  - `iv = crypto.getRandomValues(12)`, `key = AES-GCM 256` (derived from GDBx identity? For MVP, per-file random key stored in manifest `keyB64` encrypted with GDBX1? Simpler: random key, manifest stores `keyB64` base64url raw key — in prod, encrypt key with owner's pub)
  - For each chunk: `encrypted = AES-GCM(key, iv+index)`, `hash = BLAKE3(encrypted).hex()`, store
  - `manifest = {path, size, chunks: [hash], iv: base64url(iv), keyB64: base64url(key), hash: BLAKE3(manifest).hex()}`
- `chunker.assemble(encryptedChunks: Uint8Array[], iv, keyB64) → Uint8Array` — decrypt
- Use `@noble/hashes/blake3` + WebCrypto `AES-GCM`
- Tests: roundtrip small file, large file (1MB, 256KB chunks), tamper detection (hash mismatch), empty file

## Step 2 — SDK FTP Bridge (Priority 2, TDD)
**Files:** `sdk/ftp_bridge.js`, `test/test_ftp_bridge.mjs` (mock GdbxClient)
- `class GDBxFTP { constructor(gdbxClient) }`
  - `connect(gdbxUrl: "ftp://<addr>.gdbx") → {status, target}`
  - `put(localPath|Uint8Array, remotePath) → {success, path, manifest}` — chunker.process → putDelta(`sys/ftp/manifest/${remotePath}`, signedManifest) + stream chunks via `transport.streamChunks` (for MVP, put chunks as `sys/ftp/chunk/<hash>` deltas, pool-replicated)
  - `get(remotePath) → Uint8Array` — getDelta manifest → fetch chunks → assemble → verify hash
  - `sync(prefix, cb) → unsubscribe` — subscribeDeltas `sys/ftp/manifest/${prefix}/*`
- GDBX1 signed manifest: `sign({addr, action:"ftp.stor", ts, payload: JSON.stringify(manifest)}, pair)` — verified via `FirewallGuard`
- Tests: mock GdbxClient (no network), put→get roundtrip, sync callback, signed command verify

## Step 3 — CLI Gateway (Priority 3, TDD)
**Files:** `packages/gdbx-cli/lib/ftp.js`, `packages/gdbx-cli/bin/gdbx.js` (add `ftp` command), `packages/gdbx-cli/test/test_ftp_cli.mjs`
- `ftp.js` — `startGateway({port: 2121, api, identity})` — uses `ftp-srv@4.6.1`:
  ```js
  const FtpSrv = require("ftp-srv");
  const srv = new FtpSrv({url: `ftp://127.0.0.1:${port}`, pasv_url: "127.0.0.1", pasv_min: 1024, pasv_max: 1048, anonymous: false});
  srv.on("login", ({connection, username, password}, resolve, reject) => {
    // username = <addr>.gdbx, password = priv or session token
    // verify via GDBxCrypto, resolve({root: "/", cwd: "/"})
    // connection.on("STOR", (data, path) => ftp.put(data, path))
    // connection.on("RETR", (path) => ftp.get(path))
    // connection.on("LIST", (path) => ftp.sync(path))
  });
  ```
- `bin/gdbx.js` — `program.command("ftp").command("gateway").option("--port", "2121").action(...)`, plus `ftp put/get/ls/sync` commands wrapping `sdk/ftp_bridge.js`
- `package.json` — add `ftp-srv@4.6.1` (exact), `basic-ftp@5.0.5` for client tests
- Tests: mock ftp-srv, login resolver, STOR→putDelta, RETR→getDelta (no real FTP server)

## Step 4 — Worker & R2 (Priority 4)
**Files:** `worker/src/FtpBridge.js`, `functions/api/ftp/chunk.js` (or `worker/src/GDBxStorageDO.js` extension), `wrangler.toml` (R2 bucket)
- `FtpBridge` DO or Worker route: `POST /api/ftp/chunk` — store encrypted chunk in R2 `GDBX_FTP_BUCKET` (key = `chunks/<hash>`), `GET /api/ftp/chunk/<hash>` — serve
- Fallback: if R2 not configured, store chunks as `sys/ftp/chunk/<hash>` deltas in GDBxMirrorDO pool (sovereign, like playground chunked)
- Add `GDBX_FTP_BUCKET` binding in `wrangler.toml` (optional, graceful fallback)

## Step 5 — Playground UI (Priority 5)
**Files:** `public/js/gdbx-playground.js` (extend), `public/js/ftp-explorer.js` (new), `public/index.html` (#playground add FTP explorer)
- Add FTP explorer panel in `#playground` right side (or new `#ftp` section): file tree from `sys/ftp/manifest/*`, drag-drop upload → `ftp.put`, download button → `ftp.get`
- Reuse `GDBxFTP` SDK

## Step 6 — Integration & Deploy
- `npm run build` + `npm run check:supply-chain` + `node --test test/test_*.mjs` (88+ + new 10+)
- `npx wrangler deploy --config worker/wrangler.toml` (with R2 if configured)
- `npx wrangler pages deploy public --project-name gdbx --branch Dev --commit-dirty=true`
- Live verify: `gdbx ftp gateway --port 2121` + FileZilla `127.0.0.1:2121` with `<addr>.gdbx` → list/put/get via GDBx pool, `https://<preview>.gdbx.pages.dev/#ftp` drag-drop

## Test Commands
```powershell
node --test test/test_chunker.mjs
node --test test/test_ftp_bridge.mjs
node --test packages/gdbx-cli/test/test_ftp_cli.mjs
python -m pytest packages/gdbx-py/tests -q  # still 7
```
