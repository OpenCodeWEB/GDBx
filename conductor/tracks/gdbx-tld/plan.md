# Plan — gdbx-tld (Phase 6.5)

> Track: `gdbx-tld` | Spec: `./spec.md` | Status: plan ready
> Order: worker registry → frontend UI → short link → CLI → docs

## Step 1 — Worker TLD Registry (TDD)
**Files:** `worker/src/TldDO.js` (or extend GDBxStorageDO with TLD keyspace), `worker/src/tld.js` (PoW, pricing, royalty), `test/test_tld.mjs` (red first)
- TldDO: separate namespace `tld` or reuse GDBxStorageDO with `sys/tld/` prefix + dedicated methods: claim, resolve, list, touch, transfer, stats
- PoW: getDifficulty(name) same as GunX (<=3:6, <=7:4, else 2)
- Pricing: 8+ chars 3 free per pubkey, 4th onwards Price(N)=1×2^(N−3) (log, not enforce payment yet)
- Royalty: 33% to ABsUP (record beneficiary)
- Expiry: 90 days without touch → status expired, re-claimable
- Routes: POST /tld/claim, GET /tld/resolve?name=, GET /tld/list?owner=, POST /tld/touch, POST /tld/transfer, GET /tld/stats, GET /r/:name (redirect)

## Step 2 — Frontend UI (GunX Parity)
**Files:** `public/js/tld_ui.js` (new, GDBx version), `public/index.html` (#tld section)
- Copy GunX tld_ui.js structure (initTldUI) but replace SEA with GDBxCrypto, GunXPoW with GDBxPoW, API = "/tld"
- Generate key: `GDBxCrypto.pair()` + `GDBxCrypto.savePair` (localStorage `gdbx_tld_pair`)
- Claim: mine PoW (diff based on name length), sign with GDBxCrypto.sign, POST /tld/claim
- Resolve: GET /tld/resolve?name=, with web3.bio enrichment (optional)
- List: GET /tld/list?owner=, with touch/gift buttons
- Stats: GET /tld/stats

## Step 3 — Short Link Redirect
**Files:** `public/_redirects` or `functions/r/[name].js` or worker route `GET /r/:name`
- Implement `GET /r/:name` and `GET /tld/:name.gdbx` → 302 to target (with .onion handling: if target is .onion, show Tor link)
- For GDBx, short link is `gdbx.pages.dev/r/myapp` or `myapp.gdbx` virtual

## Step 4 — CLI
**Files:** `packages/gdbx-cli/lib/tld.js`, `packages/gdbx-cli/bin/gdbx.js` (add `tld` command), `packages/gdbx-cli/test/test_tld_cli.mjs`
- `gdbx tld claim <name> --tld gdbx --target <target>`
- `gdbx tld resolve <name>`
- `gdbx tld ls`
- `gdbx tld touch <name>`
- `gdbx tld gift <name> <newOwnerPub>`

## Step 5 — Integration & Deploy
- `npm run build` + `node --test test/test_tld.mjs` (new) + existing 97/97
- `npx wrangler deploy --config worker/wrangler.toml` (with TldDO namespace)
- `npx wrangler pages deploy public --project-name gdbx --branch Dev --commit-dirty=true`
- Live verify: claim `test123.gdbx` → resolve → short link redirect → list → touch → gift

## Test Commands
```powershell
node --test test/test_tld.mjs
node --test test/test_tld_cli.mjs
curl -X POST http://localhost:8787/tld/claim -d '{...}'
curl http://localhost:8787/tld/resolve?name=test123
```
