# Plan — gdbx-playground

> Track: `gdbx-playground` | Spec: `./spec.md` | Status: plan ready
> Order: scaffold → room → sync → presence → attachments

## Step 1 — Scaffold Playground Section (TDD-lite)
**Files:** `public/index.html` (add #playground), `public/js/gdbx-playground.js` (stub)
- Add nav `Playground` link after `Live Mesh`
- Add section `#playground` HTML mirroring GunX structure (header with pills, left messages+form, right how-it-works+status), but themed `violet/cyan` (GDBx) not `teal`
- `gdbx-playground.js` stub: `export function initPlayground()` logs `GDBx playground stub` and renders `onlinePill` with `0 online`

## Step 2 — Shared Demo Identity + Room Management
**Files:** `public/js/gdbx-playground.js`
- Hardcode demo identity (generated via `sdk/gdbx-crypto.js`): `pub`, `priv`, `pubkeyHex`, `addr = aeaagiao64onmpxlv7bjgk4chnpvl5h77erwqq7gockpvm2kafwzwmzt3u`
- Room state: `currentRoom = "playground/public"` (default), `roomKey = null` for public, AES key for private
- `new private` → `roomId = nanoid(8)` + `roomKey = base64url(crypto.getRandomValues(32))`, `location.hash = #r=<roomId>&k=<key>`, `room = playground/private/<roomId>`, show `roomLockPill`, copy invite `https://gdbx.pages.dev/#playground&r=...&k=...`
- `join` → `prompt(invite link)` → parse `r` & `k` → switch room
- `clear view` → `messages.innerHTML = ""` only
- On room switch: `messages.innerHTML = ""`, resubscribe (WS `hello` with new prefix filter? For MVP, WS subscribes to `addr` but client filters by `key` prefix on `delta` events)

## Step 3 — Live Sync (GDBx-native, Gun-free)
**Files:** `public/js/gdbx-playground.js`
- `ensureRegistered()` — `POST /api/v1/did/register` with PoW diff 2 + GDBx sign (reuse `gdbx-live.js` logic)
- WS: `new WebSocket(wss://gdbx-do.xup.workers.dev/ws?addr=DEMO_ADDR)` → `send hello`, `onmessage delta` → if `msg.key.startsWith(currentRoom)` then `addMsg(decrypted(text), !mine)`
- HTTP put: `POST /api/v1/sync` (or WS `put`) with signed delta `playground/<room>/msg/<ts>-<rand>` → value `JSON.stringify({text, from: visitorId, ts, room, img?})` (flat string)
- Poll fallback: `GET /api/v1/sync/<addr>?prefix=playground/<room>/` every 3s if WS not open, deduplicate via `seenKeys` Set
- E2E: For private rooms, `encrypt(text, roomKey)` via `crypto.subtle.encrypt AES-GCM` before put, `decrypt` on receive

## Step 4 — Presence & Relay Status
**Files:** `public/js/gdbx-playground.js`
- `visitorId = localStorage.getItem("gdbx-visitor") || "visitor-"+Math.random().toString(36).slice(2,6)`
- Heartbeat: `fetch POST /api/v1/peers` with `{addr: DEMO_ADDR, transports: ["playground","ws"], name: visitorId}` every 10s (like GunX's `joinPresence`)
- Online: poll `GET /api/v1/leaderboard` or `GET /api/v1/stats` every 5s → `onlinePill.textContent = peers.length + " online"` or `active`
- Relay status: poll `GET /api/v1/stats` + `GET /api/v1/pool` → update `stUptime`, `stMessages`, `stPool`, `stBackend`

## Step 5 — Attachments (lite)
**Files:** `public/js/gdbx-playground.js`
- `imgBtn` → `imgInput.click()` → `FileReader.readAsDataURL` → if `dataUrl.length < 32768` then `sendMessage` with `img: dataUrl`, else alert "too large"
- `fileBtn` → `fileInput.click()` → if file.size < 32768 then read as base64 and send as `fname/fsize` in value (render download link), else show `P2P file — open second tab` placeholder (WebRTC direct deferred)

## Step 6 — Integration & Deploy
- `npm run build` (no change) + `node --test test/...` (must stay 88+)
- `npx wrangler pages deploy public --project-name gdbx --branch Dev --commit-dirty=true`
- Live verify: `https://<preview>.gdbx.pages.dev/#playground` — two tabs sync, private room invite, clear view, online count
- `conductor/tracks.md` → `gdbx-playground` completed

## Test Commands
```powershell
# local preview (no deploy)
npx wrangler pages dev public --port 8788
# then open http://localhost:8788/#playground in two tabs

# unit (no network)
node --test test/test_*.mjs
```
