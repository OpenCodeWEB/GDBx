# Track: GDBx Unified Interconnect â€” à¦¯à§‡à¦–à¦¾à¦¨à§‡à¦‡ à¦šà¦²à§à¦•, à¦à¦•à¦¸à¦¾à¦¥à§‡ à¦¸à§à¦°à¦•à§à¦·à¦¿à¦¤

> **Track ID:** `gdbx-interconnect` | **Phase:** 6.4 | **Status:** spec draft
> **Goal:** GDBx à¦¯à§‡à¦–à¦¾à¦¨à§‡à¦‡ à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦° à¦¹à§‹à¦• â€” à¦­à¦¿à¦¨à§à¦¨ à¦¸à¦¾à¦°à§à¦­à¦¾à¦°à§‡, à¦­à¦¿à¦¨à§à¦¨ à¦•à§à¦²à¦¾à¦‰à¦¡à§‡, à¦¬à¦¾ à¦•à¦¾à¦°à§‹ à¦²à§‹à¦•à¦¾à¦² à¦¡à¦¿à¦­à¦¾à¦‡à¦¸à§‡ â€” à¦¸à¦¬ à¦¨à§‹à¦¡ à¦à¦•à¦Ÿà¦¾à¦‡ sovereign mesh-à¦ à¦•à¦¾à¦¨à§‡à¦•à§à¦Ÿà§‡à¦¡ à¦¥à¦¾à¦•à¦¬à§‡; à¦¸à§à¦°à¦•à§à¦·à¦¿à¦¤ (GDBx-signed) à¦“ à¦¸à¦°à§à¦¬à¦¦à¦¾ à¦†à¦ªà¦¡à§‡à¦Ÿà§‡à¦¡ à¦­à¦¾à¦°à§à¦¸à¦¨ à¦ªà¦¾à¦¬à§‡à¥¤

## 1. Context

à¦¬à¦°à§à¦¤à¦®à¦¾à¦¨ GDBx hybrid mesh (WS + Nostr + WebRTC + pool) à¦‡à¦¤à¦¿à¦®à¦§à§à¦¯à§‡ à¦²à¦¾à¦‡à¦­ à¦¡à§‡à¦Ÿà¦¾ à¦†à¦¦à¦¾à¦¨-à¦ªà§à¦°à¦¦à¦¾à¦¨ à¦•à¦°à§‡ (GlobalMesh à¦ªà§‡à¦œà§‡ 37 DIDs, 646 deltas, pool OK live à¦¦à§‡à¦–à¦¾ à¦¯à¦¾à¦šà§à¦›à§‡)à¥¤ à¦•à¦¿à¦¨à§à¦¤à§ à¦à¦–à¦¨à§‹ à¦ªà§à¦°à¦¤à¦¿à¦Ÿà¦¿ deployment (à¦¯à§‡à¦®à¦¨ `gdbx.pages.dev`, à¦•à¦¾à¦°à§‹ `workers.dev`, à¦•à¦¾à¦°à§‹ `localhost:8787`) à¦†à¦²à¦¾à¦¦à¦¾ DO namespace-à¦ isolation-à¦ à¦šà¦²à¦¤à§‡ à¦ªà¦¾à¦°à§‡ â€” à¦¯à¦¦à¦¿ à¦¦à§à¦‡à¦œà¦¨ à¦†à¦²à¦¾à¦¦à¦¾ Cloudflare à¦…à§à¦¯à¦¾à¦•à¦¾à¦‰à¦¨à§à¦Ÿà§‡ deploy à¦•à¦°à§‡, à¦¤à¦¾à¦¦à§‡à¦° pool à¦†à¦²à¦¾à¦¦à¦¾à¥¤ à¦¬à§à¦¯à¦¬à¦¹à¦¾à¦°à¦•à¦¾à¦°à§€ à¦šà¦¾à¦¯à¦¼: **à¦¯à§‡à¦–à¦¾à¦¨à§‡à¦‡ à¦¹à§‹à¦¸à§à¦Ÿ à¦¹à§‹à¦•, à¦à¦•à¦Ÿà¦¾à¦‡ mesh**à¥¤

## 2. Goals

| Goal | Description |
|------|-------------|
| **G1. Universal Mesh Connector** | `sdk/interconnect.js` â€” à¦à¦• à¦²à¦¾à¦‡à¦¨à§‡ `GDBx.connect()` à¦•à¦°à¦²à§‡ global hub (`wss://gdbx.xup.workers.dev`), local hub (`ws://localhost:8787`), Nostr relays, à¦à¦¬à¦‚ WebRTC peers â€” à¦¸à¦¬ à¦à¦•à¦¸à¦¾à¦¥à§‡ try à¦•à¦°à§‡; à¦¯à§‡à¦Ÿà¦¾ à¦ªà¦¾à¦“à¦¯à¦¼à¦¾ à¦¯à¦¾à¦¯à¦¼ à¦¸à§‡à¦Ÿà¦¾ à¦¦à¦¿à¦¯à¦¼à§‡ sync, à¦¬à¦¾à¦•à¦¿à¦—à§à¦²à§‹ fallbackà¥¤ |
| **G2. Secure Version Distribution** | `sys/gdbx/version` â€” superadmin GDBx-signed manifest (semver, changelog, update URL, hash) pool-à¦à¥¤ à¦¸à¦¬ à¦¨à§‹à¦¡ à¦à¦‡ key subscribe à¦•à¦°à§‡; à¦¨à¦¤à§à¦¨ à¦­à¦¾à¦°à§à¦¸à¦¨ à¦à¦²à§‡ auto-notify + `If-None-Match` style update pullà¥¤ |
| **G3. Offline-First + Local Bridge** | `tools/gdbx-mesh-bridge` (Node) â€” à¦²à§‹à¦•à¦¾à¦² à¦¡à¦¿à¦­à¦¾à¦‡à¦¸à§‡ `node bridge.js` à¦šà¦¾à¦²à¦¾à¦²à§‡ à¦²à§‹à¦•à¦¾à¦² GDBx storage (`:8787`) â†” global hub â†” Nostr â†” WebRTC â€” à¦¸à¦¬ mesh-à¦ bridge à¦•à¦°à§‡à¥¤ Offline à¦¹à¦²à§‡ local LWW CRDT-à¦¤à§‡ queue, online à¦¹à¦²à§‡ auto-syncà¥¤ |
| **G4. Live Interconnect Status** | `GlobalMesh.html` à¦ "Interconnected Hosts" panel â€” real-time peer list (presence heartbeats `pocwu/presence/*` + `sys/gdbx/version` watcher) à¦¦à§‡à¦–à¦¾à¦¯à¦¼ à¦•à¦¤à¦—à§à¦²à§‹ hosted + local à¦¨à§‹à¦¡ mesh-à¦ à¦†à¦›à§‡à¥¤ |

## 3. Non-Goals

- Custom FUSE mount, WASM daemon (deferred)
- Tor/I2P transports (separate track)
- Breaking existing API â€” `sdk/gdbx-sdk.js`, `sdk/ftp_bridge.js`, `public/js/gdbx-playground.js` à¦…à¦•à§à¦·à¦¤ à¦¥à¦¾à¦•à¦¬à§‡

## 4. Design

### 4.1 Universal Connector (`sdk/interconnect.js`)
```js
import { GDBxInterconnect } from "./interconnect.js";
const mesh = new GDBxInterconnect({ pair, pubkeyHex, addrs: ["wss://gdbx.xup.workers.dev/ws", "ws://localhost:8787/ws"] });
await mesh.connect(); // tries global â†’ local â†’ Nostr â†’ WebRTC, keeps all open
mesh.onDelta((delta) => render(delta));
mesh.put({key: "myapp/data", value: "hello"}); // GDBx-signed + PoW + pool-replicated via open transports
```

### 4.2 Version Channel (`sys/gdbx/version`)
- Worker: `PUT sys/gdbx/version` only superadmin (GDBX1-signed + PoW) â€” FirewallGuard RBAC already enforces
- Value: `{"v":"1.2.3","hash":"blake3...","url":"https://gdbx.pages.dev","changelog":"...","ts":...}`
- Clients: `GET /sync/<addr>?prefix=sys/gdbx/version` poll every 60s + WS delta feed

### 4.3 Local Mesh Bridge (`tools/gdbx-mesh-bridge/`)
- Node script: `node bridge.js --global wss://gdbx.xup.workers.dev --local ws://localhost:8787`
- Uses `ws` npm + `GDBxFTP` chunker pattern to relay deltas bidirectionally

### 4.4 GlobalMesh UI
- New panel "Interconnected Hosts" â€” lists `pocwu/presence/*` entries (login, avatar, lastSeen, transport) + version badge

## 5. Acceptance

- [ ] `sdk/interconnect.js` + `sdk/utils/interconnect-helpers.js` â€” 5+ tests, `npm audit 0`
- [ ] `tools/gdbx-mesh-bridge` â€” starts, bridges globalâ†”local, offline queue works
- [ ] `GlobalMesh.html` â€” Interconnected Hosts panel live (fetches presence + version)
- [ ] Version distribution: superadmin put to `sys/gdbx/version` â†’ all connected clients receive within 5s via WS
- [ ] `99/99` existing tests still pass
