# Plan — gdbx-cli-visual

> Track: `gdbx-cli-visual` | Spec: `./spec.md` | Status: plan ready
> Order: CLI core → vector → watch → backup → inspector stub

## Step 1 — CLI scaffold (TDD)
**Files:** `packages/gdbx-cli/{package.json,bin/gdbx.js,lib/identity.js,lib/sync.js,lib/vector.js,lib/backup.js}`, `packages/gdbx-cli/test/test_cli.mjs`
- `package.json` — `bin: {gdbx: "bin/gdbx.js"}`, deps `commander@11.1.0` exact
- `bin/gdbx.js` — `#!/usr/bin/env node`, commander program, commands: `identity`, `sync`, `vector`, `backup`
- `lib/identity.js` — `createIdentity(net, outPath)`, `loadIdentity()`, uses `sdk/gdbx-crypto.js` + `sdk/gdbx-codec.js`
- Tests: mock identity create, sync put/get, vector put/search (fakeFetch pattern like `test_transport.mjs`)

## Step 2 — Sync + Vector impl
- `lib/sync.js` — `put(key,value)` / `get(prefix)` / `watch(prefix, cb)` — wraps `sdk/gdbx-sdk.js` + `sdk/gdbx-ws-client.js`
- `lib/vector.js` — `putVector(key,text,vector)` / `search(queryVec)` — JSON string value, cosine in JS (mirror of `gdbx_py.client`)

## Step 3 — Backup (export/import)
- `lib/backup.js` — `exportSnapshot(out)` via `POST /export` (signed), `importSnapshot(path)` replays deltas via `putDeltas`

## Step 4 — Inspector stub
**Files:** `public/js/gdbx-inspector.js`, `public/inspector.html` (minimal)
- Fetch `/pool`, `/stats`, `GET /sync/<addr>?prefix=` and render `primary/mirror health`, `live peer count`, `vector count` (no D3 yet, plain table + WS live)

## Step 5 — Integration & commit
- `node packages/gdbx-cli/test/test_cli.mjs` + `node --test test/test_*.mjs` (must stay 88+)
- Live verify: `node packages/gdbx-cli/bin/gdbx.js identity create --net local` → `addr`, then `sync put`→`get` against live `gdbx-do`
- `conductor/tracks.md` → `gdbx-cli-visual` completed

## Test Commands
```powershell
node packages/gdbx-cli/test/test_cli.mjs
node packages/gdbx-cli/bin/gdbx.js identity create --net local --out /tmp/gdbx-test.json
node packages/gdbx-cli/bin/gdbx.js sync put hello world --prefix test/
node packages/gdbx-cli/bin/gdbx.js sync get --prefix test/
```
