# Track: GDBx Live P2P Playground

> **Track ID:** `gdbx-playground` | **Phase:** 6.2 | **Status:** spec draft
> **Goal:** `gunx.pages.dev` à¦à¦° Live P2P playground à¦à¦° à¦®à¦¤à§‹ à¦¬à§ˆà¦¶à¦¿à¦·à§à¦Ÿà§à¦¯ `gdbx.pages.dev` à¦ à¦¯à§à¦•à§à¦¤ à¦•à¦°à¦¾ â€” real-time chat + room + presence + file share, à¦•à¦¿à¦¨à§à¦¤à§ GDBx-à¦à¦° sovereign mesh (GDBx + FirewallGuard + pool + hybrid mesh) à¦¦à¦¿à¦¯à¦¼à§‡à¥¤

## 1. Context

GunX playground (653 lines, `public/index.html` #playground):
- Header: roomPill (room: public), roomLockPill (ðŸ”’ e2e), onlinePill (0 online), new private, join, clear view
- Left: messages (h-72), msgForm (imgBtn, fileBtn, msgInput, Send), hidden img/file inputs, note: two tabs sync via `wss://gunx.pages.dev/gun`
- Right: How it works (appKey, LWW, IndexedDB), Relay status (uptime, messages, bytes, backend)
- Logic: `GunXRooms`, `gunx.get(root).map().on`, `rooms.send`, `gunx.uploadImage` (imgbb proxy), `gunx.shareFile` (WebRTC 64-256KB chunks, signaling via Gun souls), presence `gunx.joinPresence`, `gunx.onPeers`, `gunx.onTransferProgress`

GDBx current (`gdbx.pages.dev`):
- Hero (sovereign), Live Mesh (stats/leaderboard), Dual-pane Sandbox (Node A/B, key/value, WS `wss://gdbx.xup.workers.dev/ws?addr=`), Codec Demo, Inspector
- No chat-style playground. Sandbox is key/value, not room-based chat. No private rooms, no image/file, no presence, no relay status for playground.

## 2. Goals

### G1. Playground Section (#playground) â€” Parity with GunX
- **Layout:** Same 3-column grid? GunX uses `md:grid-cols-3` (2/3 chat + 1/3 how-it-works/relay status). GDBx should use `violet/cyan` theme (not teal), `rounded-2xl border border-slate-800 bg-slate-900/60 glow`
- **Header:** `Live P2P Playground` + `room: public` pill, `ðŸ”’ e2e` hidden, `0 online`, `new private`, `join`, `clear view`
- **Left:** `messages` (h-72), `msgForm` (imgBtn, fileBtn, msgInput, Send), note: `Open in two tabs â€” messages sync via GDBx pool (WS + mirror + hybrid-mesh)`
- **Right:** `How it works` (4 steps: connect `wss://gdbx.../ws?addr=`, namespace `.GDBx`, FirewallGuard, IndexedDB/offline), `Playground status` (uptime, deltas, pool health, backend) polling `GET /pool` + `GET /stats`
- **Behavior:** Messages sync real-time across tabs via shared demo address `aeaagiao64onmpxlv7bjgk4chnpvl5h77erwqq7gockpvm2kafwzwmzt3u` (hardcoded demo keypair, gun-free GDBx). Each message is a signed delta `playground/<room>/msg/<ts>-<rand>` with flat JSON string value.

### G2. Room Management (GDBx-native)
- Public room: `playground/public` (default)
- Private rooms: `playground/private/<roomId>` derived from `invite link` `https://gdbx.pages.dev/#r=<roomId>&k=<base64url AES key>` â€” messages AES-GCM encrypted with room key before put, decrypted on receive. `roomLockPill` visible when private.
- `new private` â†’ generate `roomId` (nanoid) + AES key (256-bit, `crypto.getRandomValues`), store in URL hash, copy invite link
- `join` â†’ prompt invite link, parse `r` & `k`, switch room, decrypt
- `clear view` â†’ only DOM clear, no relay delete (like GunX)
- Rooms use same demo address but isolated by key prefix â€” no extra DID.

### G3. Presence & Stats
- Heartbeat: `POST /api/v1/peers` (or `POST /peers` via worker) with `{addr: DEMO_ADDR, transports: ["playground", "ws"]}` every 10s, visitor ID `visitor-xxxx` in localStorage
- Online count: poll `GET /api/v1/leaderboard` or `GET /stats` â†’ `active` or `peers.length`, update `onlinePill`
- Relay status: poll `GET /stats` (dids, deltas) + `GET /pool` (mirror health) every 5s, update `stUptime`, `stMessages`, `stPool`, `stBackend` (like GunX's `stUptime`, `stMessages`, `stBytes`, `stBackend`)

### G4. Attachments (lite)
- **Image:** For MVP, if <32KB, base64 data URL stored as delta value (flat string, within GDBx 32KB limit), rendered as `<img>` in chat. Larger â†’ show "too large for GDBx delta (32KB) â€” use P2P file"
- **File:** P2P via GDBx hybrid mesh WebRTC direct channel (reuse `sdk/transport.js` `buildSignal`/`parseSignal` + `GDBxWS` DataChannel? For MVP, fallback to same delta method if file <32KB, else WebRTC stub showing "P2P file â€” open in second tab")
- For full file P2P (like GunX's `shareFile`), reuse `public/js/direct_rtc.js` logic but adapted for GDBx (signaling via GDBx souls `playground/sig/<from>`?) â€” deferred to phase 2, show tooltip.

## 3. Non-Goals
- Full Direct Pair QR flow (already exists as separate Direct Pair section in GunX â€” GDBx has Inspector, not needed now)
- Nostr Mesh section (GDBx already has hybrid mesh Nostr kind 23124 â€” playground will optionally sync via `/relay` if `wss://relay.damus.io` connected â€” deferred)
- .gunx TLD registry (not applicable to GDBx â€” GDBx has .GDBx address codec)

## 4. Design Constraints
- **No gun:** All writes via `GDBxCrypto.sign` (GDBx) + PoW (diff 2) + `FirewallGuard` â€” same as `gdbx-live.js` sandbox
- **Supply-chain clean:** No new runtime deps (reuse `@noble/hashes`, `commander` not needed)
- **Offline-first:** Messages queued if WS offline, replayed on reconnect (like sandbox's `ensureRegistered` + WS retry)
- **Flat-primitive:** `value` must be string (JSON string of `{text, from, ts, room, img?}`) â€” 32KB cap

## 5. Files
- `public/js/gdbx-playground.js` (new, ~400 lines, module, exports `initPlayground`)
- `public/index.html` â€” add `#playground` section after `#live` (before `#sandbox`), add nav link `Playground`, include script `type="module" src="/js/gdbx-playground.js"`
- `public/js/gdbx-live.js` â€” no changes (keep sandbox)

## 6. Acceptance
- [ ] `gdbx.pages.dev/#playground` shows chat, `room: public`, `0 online`, `new private/join/clear view` buttons
- [ ] Two tabs, same room, text syncs in <500ms via WS (or <3s via poll fallback)
- [ ] Private room invite link `https://gdbx.pages.dev/#r=...&k=...` opens same room, lock pill visible, messages isolated by room prefix, E2E encrypted
- [ ] Online count updates (heartbeat â†’ leaderboard)
- [ ] Image <32KB renders in chat, file >32KB shows WebRTC placeholder
- [ ] `GET /pool` + `GET /stats` polling updates relay status cards
- [ ] No `gun` import, `GDBxCrypto` only, `npm audit 0`
