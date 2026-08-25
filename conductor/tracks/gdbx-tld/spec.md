# Track: GDBx TLD Domain System — Short Links for Developers

> **Track ID:** `gdbx-tld` | **Phase:** 6.5 | **Status:** spec draft
> **Goal:** Bring GunX's domain system (gunx.pages.dev/#tld) to GDBx (gdbx.pages.dev) so links are not overly long and developer usage is easy.

## 1. Context

GunX TLD at `#tld` provides:
- TLDs: .gunx (public), .absup (ABsUP-only), .onion (unlimited)
- Claim: name 1-62 chars (a-z0-9, start alnum, dashes), target (node id / site / .onion)
- PoW: short premium names need more work (diff 6 for <=3, 4 for <=7, 2 for 8+)
- Pricing: 1-7 chars premium (payment Phase 4), 8+ chars 3 free per key, 4th onwards Price(N)=1×2^(N−3), 90 days without activity releases, 33% royalty to ABsUP
- UI: generate key, claim, lookup, your domains, registry status

GDBx needs same but sovereign, GDBx-native (GDBx envelope, not SEA), and integrated with GDBx's pool (no external DB).

## 2. Goals

### G1. GDBx TLD Registry (Short Links)
- Support TLDs: .gdbx (public, primary), .absup (ABsUP-only), .onion (unlimited, Tor v3 validation)
- Short name like `myapp.gdbx` maps to target (e.g., GDBx address, URL, site, .onion)
- Link short: `https://gdbx.pages.dev/r/myapp` or `https://gdbx.pages.dev/tld/myapp.gdbx` redirects to target — link not long
- Developer usage: `gdbx tld claim myapp --tld gdbx --target <addr>`

### G2. Sovereign Storage (GDBx Pool)
- TLD claims stored as GDBx deltas at `tld:<tld>:<name>` or `sys/tld/<tld>/<name>` in GDBxStorageDO (or dedicated TldDO)
- GDBx-signed (GDBx envelope, PoW, FirewallGuard), LWW, pool-replicated, 90d expiry
- No external DB, no Workers KV for TLD — pure GDBx mesh

### G3. UI Parity with GunX
- GDBx pages.dev/#tld section: generate key, claim, lookup, your domains, registry status — same UX as GunX but GDBx-native
- Use GDBxCrypto (window.GDBxCrypto) instead of SEA

### G4. Developer UX
- Short links: `gdbx.pages.dev/r/<name>` or `gdbx.pages.dev/tld/<name>.gdbx` — redirect to target
- CLI: `gdbx tld claim`, `gdbx tld resolve`, `gdbx tld ls`, `gdbx tld touch`, `gdbx tld gift`

## 3. Design

### 3.1 TLD Names
- Regex: `^[a-z0-9][a-z0-9-]{0,62}$` (max 63, like GunX)
- TLDs: gdbx (public), absup (root-only), onion (unlimited, target must be valid v3 onion)

### 3.2 PoW & Pricing (Same as GunX)
- Diff: <=3 chars → 6, <=7 → 4, else 2
- Pricing: 8+ chars 3 free per pubkey, 4th onwards Price(N)=1×2^(N−3) (in credits, not yet enforced — log only)
- Royalty: 33% to ABsUP (recorded in manifest)

### 3.3 Storage Model
- Key: `sys/tld/<tld>/<name>` (e.g., `sys/tld/gdbx/myapp`)
- Value: JSON string of manifest:
  ```json
  {
    "tld": "gdbx",
    "name": "myapp",
    "ownerPub": "x.y",
    "target": "aeaagiao64onmpxlv7bjgk4chnpvl5h77erwqq7gockpvm2kafwzwmzt3u.gdbx",
    "ts": 1234567890,
    "nonce": 123,
    "diff": 2,
    "hash": "00...",
    "sig": "GDBx{...}",
    "tier": "free",
    "status": "active",
    "lastActiveAt": 1234567890,
    "resolves": 0,
    "touches": 0,
    "beneficiary": "ABsUP_pub"
  }
  ```
- LWW: newest ts wins, with 90d expiry (worker checks lastActiveAt)

### 3.4 Worker Routes
- `POST /tld/claim` — claim name (PoW, GDBx sig, pricing, royalty)
- `GET /tld/resolve?name=<name>` — resolve (with optional .tld suffix, default gdbx)
- `GET /tld/list?owner=<pub>` — list your domains
- `POST /tld/touch` — keep-alive (reset 90d window)
- `POST /tld/transfer` — gift (signed transfer)
- `GET /tld/stats` — registry stats (total, free, premium, pending, expired)
- `GET /r/:name` — short link redirect (302 to target, with .onion handling)

### 3.5 Frontend
- `public/js/tld_ui.js` (new, GDBx version of GunX's tld_ui.js)
- Use `window.GDBxCrypto` (not SEA), `GDBxPoW` (mine with GDBx difficulty)
- Section `#tld` in `public/index.html` — same layout as GunX but GDBx-native

## 4. Non-Goals
- Payment for premium names (Phase 4) — log only
- Real DNS for .gdbx — virtual GDBx-level only
- Full FUSE/Drive mount

## 5. Acceptance
- [ ] Worker TLD registry: claim/resolve/list/touch/transfer/stats + short link redirect
- [ ] Frontend: generate key, claim, lookup, your domains, registry status — parity with GunX
- [ ] Short link `gdbx.pages.dev/r/myapp` redirects to target
- [ ] Developer can `gdbx tld claim myapp --target <addr>` and use short link
- [ ] 97/97 existing tests still pass + new TLD tests
