# Plan — gdbx-interconnect

> Track: `gdbx-interconnect` | Spec: `./spec.md` | Status: plan ready
> Order: interconnect SDK → version channel → local bridge → UI

## Step 1 — Universal Connector SDK
**Files:** `sdk/interconnect.js`, `sdk/utils/interconnect-helpers.js`, `test/test_interconnect.mjs`
- `interconnect.js`: class `GDBxInterconnect` with `connect()`, `put()`, `onDelta()`, `getVersion()`, `watchVersion()`
- Helpers: multi-transport fan-out (try global WS, local WS, Nostr relay, WebRTC), fallback to HTTP
- Tests: mock transports, verify fan-out, version watch callback

## Step 2 — Version Distribution Channel
**Files:** `worker/src/GDBxStorageDO.js` (add `sys/gdbx/version` superadmin-only guard if not already via FirewallGuard), `sdk/interconnect.js` version helpers, `test/test_version.mjs`
- Worker already has FirewallGuard RBAC for `sys/gdbx/version`? Add explicit check: only superadmin can put to `sys/gdbx/version`
- SDK: `publishVersion({v, changelog, url})`, `watchVersion(cb)`
- Tests: superadmin can publish, guest cannot, all subscribers receive

## Step 3 — Local Mesh Bridge
**Files:** `tools/gdbx-mesh-bridge/{package.json,bridge.js,README.md}`
- Node bridge: connects to global hub + local hub, relays deltas both ways
- Offline queue: LWW CRDT local file (`./mesh-queue.json`), sync on reconnect

## Step 4 — GlobalMesh UI
**Files:** `public/GlobalMesh.html` (add Interconnected Hosts panel), `public/js/globalmesh-interconnect.js` (optional)
- Panel fetches `pocwu/presence/*` + `sys/gdbx/version`, renders live
- Uses existing `sdk/interconnect.js` if available, else direct fetch

## Step 5 — Integration & Deploy
- `npm run build` + `npm run check:supply-chain` + `node --test`
- `npx wrangler deploy --config worker/wrangler.toml`
- `npx wrangler pages deploy public --project-name gdbx --branch Dev`
- Live verify: two separate hosted previews + one local bridge all see same `sys/gdbx/version` update within 5s
- `conductor/tracks.md` → `gdbx-interconnect` completed
