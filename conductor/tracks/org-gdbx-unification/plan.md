# Plan â€” org-gdbx-unification (Phase 6)

> Track: `org-gdbx-unification` | Spec: `./spec.md` | Status: plan ready
> Order: shared lib â†’ Python SDK â†’ AiA bridge â†’ OS bridge â†’ org rollout & live verify

---

## Step 0 â€” Shared Vectors & Test Harness (1h)

**Files:** `test/vectors/gdbx-vectors-js.json`, `test/test_gdbx_py_parity.mjs` stub
- Extract 2-3 GDBx sign vectors from `sdk/gdbx-crypto.js` (addr, body, sig, pub, pubkeyHex) into `test/vectors/gdbx-vectors-js.json`
- This unblocks Python parity without live network

## Step 1 â€” Python SDK `gdbx-py` (TDD, 4h)

**Files:** `packages/gdbx-py/pyproject.toml`, `packages/gdbx-py/gdbx_py/{__init__.py,crypto.py,codec.py,client.py,pow.py}`, `packages/gdbx-py/tests/test_*.py`
**Test:** `pytest packages/gdbx-py -q` + `node test/test_gdbx_py_parity.mjs` (red first)

- `crypto.py` â€” `pair()`, `sign(body, priv_jwk)`, `verify(body, sig, pub)` â€” ECDSA P-256 via `cryptography` (preferred) or `ecdsa` + `hashlib` â€” GDBx envelope `"GDBx"+canonical_json{m,s}` (key-sorted, same as JS `canonicalJson`)
- `codec.py` â€” `make_address(pubkey_hex, network)`, `normalize_address()`, `base32_encode/decode`, `pubkey_hash` â€” BLAKE3 via `hashlib.blake2b` or `blake3` pip, vectors from `sdk/gdbx-codec.js`
- `pow.py` â€” `get_difficulty(addr)`, `hash_input()`, `mine_pow(addr, pub, payload, ts, diff)` â€” SHA256, same as `worker/src/verify.js`
- `client.py` â€” `GdbxClient(base_url, pair, pubkey_hex)` â€” `register_did()`, `put_deltas()`, `get_deltas()`, `put_vector()`, `search_vector()` (vector stub: kv with cosine in Python)
- `pyproject.toml` â€” deps pinned exact: `cryptography==42.*` or `ecdsa==0.18.*`, `blake3==0.4.*`, `httpx==0.27.*`, no install scripts
- Tests: unit (crypto roundtrip, codec vectors, pow) + cross-verify (JS vector â†’ Python verify, Python sign â†’ JS verify via Node subprocess or precomputed)

## Step 2 â€” AiA Bridge (3h)

**Files:** `D:\OpenCodeWEBsUI\OpenCodeWEB\AiA\core\gdbx_bridge.py`, `AiA\core\brain\memory_gdbx.py` (or patch `memory.py`), `AiA\tests\test_gdbx_bridge.py`, `AiA\conductor\tracks\aia-gdbx\{spec.md,plan.md,metadata.json}` stub
**Test:** `pytest AiA/tests/test_gdbx_bridge.py -q` (mock client)

- `core/gdbx_bridge.py` â€” thin wrapper over `gdbx_py.client.GdbxClient` â€” reads `GDBX_API`, `GDBX_ADDR`, `GDBX_PUB`, `GDBX_PRIV`, `GDBX_PUBKEY_HEX` (or generates via `gdbx_py.crypto.pair()` and derives addr via `codec`), auto `register_did()` on first use, `put_event(kind, payload)` â†’ `put_deltas([{key: f"aia/events/{ts}-{uuid}", value: payload, clock: ts}])`
- `brain/memory_gdbx.py` â€” `store_memory(text, vector=None)` â†’ `put_deltas` + `put_vector`; `recall(query_vector)` â†’ `search_vector` (cosine, top_k)
- Env fallback: if `GDBX_API` missing, import legacy `gun_bridge` and delegate (log `using legacy gun bridge â€” set GDBX_* to migrate`)
- `tests/test_gdbx_bridge.py` â€” mock `GdbxClient` (no network), verify `put_event` key shape, vector store shape, fallback path
- `AiA/conductor/tracks/aia-gdbx/` â€” one-page spec linking to GDBX spec, status `in_progress`

## Step 3 â€” OS Bridge (3h)

**Files:** `D:\OpenCodeWEBsUI\OpenCodeWEB\OS\gdbx-relay\{package.json,bridge.js,lib\rpc.js}`, `OS\gdbx-relay\test\test_bridge.mjs`, `OS\portal\src\lib\gdbx.ts` (or patch), `OS\conductor\tracks\os-gdbx\{spec.md,plan.md,metadata.json}` stub
**Test:** `node OS/gdbx-relay/test/test_bridge.mjs` (mock SDK) + `node --test GDBX/test/test_org_integration.mjs`

- `OS/gdbx-relay/package.json` â€” `type: module`, deps: no `gun`, only `ws` (if needed) â€” use `../../GDBX/sdk/gdbx-sdk.js` via file import or copy `sdk/` (prefer symlink/file dep to keep single source)
- `bridge.js` â€” Express/fastify-free minimal HTTP RPC: `POST /gdbx/put {addr, deltas}`, `GET /gdbx/get?addr=&prefix=`, `WS /gdbx/watch` â€” each handler calls `sdk/gdbx-sdk.js` `putDeltas`/`getDeltas` (via `GDBX_API` env), WS hub forwards `gdbx-ws-client` events
- `portal/src/lib/gdbx.ts` â€” `import { putDeltas, getDeltas } from '../../../GDBX/sdk/gdbx-sdk.js'` (or `dist/gdbx.mjs`) â€” feature flag `USE_GDBX` (Vite `import.meta.env.USE_GDBX`) â€” when `1`, community `/C/` reads from GDBx pool, else gun
- Tests: RPC round-trip with mocked `fetch` (like `test_transport.mjs` `fakeFetch` pattern), no live network

## Step 4 â€” Org-Wide Docs & Example (1h)

**Files:** `GDBX/examples/gdbx-hello/{index.mjs,hello.py,README.md}`, `GDBX/conductor/tracks.md` update, `AiA/README.md` + `OS/README.md` patches
- `examples/gdbx-hello/index.mjs` â€” `makePair() â†’ registerDID â†’ putDeltas â†’ getDeltas` against `https://gdbx.xup.workers.dev` (live, or mock if offline)
- `examples/gdbx-hello/hello.py` â€” same via `gdbx_py`
- `README.md` â€” one-line: `did:gdbx:<addr>` is canonical identity across OpenCodeWEB

## Step 5 â€” Integration Tests & Live Verify (2h)

**Files:** `GDBX/test/test_org_integration.mjs`, `scripts/check-supply-chain.mjs` (extend to check `packages/gdbx-py`), `GDBX/test/vectors/gdbx-vectors-js.json` final

- `test_org_integration.mjs` â€” uses `GdbxStorageObject` + `GDBxMirrorObject` mocks + `gdbx_py` vectors to verify AiAâ†’OS convergence: AiA `put_deltas` (`aia/memory/test`) â†’ OS `get_deltas` sees it (pool merge semantics)
- Add `test_gdbx_py_parity` to `package.json` `test:all` (`pytest packages/gdbx-py -q && node --test ...`)
- Live verify (manual, requires `GDBX_API` env):
  ```powershell
  python AiA/core/gdbx_bridge.py --demo  # writes aia/demo/<ts>
  node OS/gdbx-relay/bridge.js --demo     # reads same key via GDBx
  curl.exe https://gdbx.xup.workers.dev/pool
  curl.exe https://gdbx.xup.workers.dev/stats
  node GDBX/test/_live_e2e.mjs
  ```

## Step 6 â€” Deploy & Commit (1h)

- `npx wrangler deploy --config worker/wrangler.toml` (no schema change, just docs â€” but verify pool still healthy)
- `git` commits per step (conventional: `feat(gdbx-py): ...`, `feat(aia): gdbx bridge`, `feat(os): gdbx relay`, `docs(org): ...`)
- Update `GDBX/conductor/tracks.md` â†’ `org-gdbx-unification` `completed`, `AiA/conductor/tracks.md` + `OS/conductor/tracks.md` entries

---

## Test Commands (Windows)

```powershell
# Python SDK
pip install -e packages/gdbx-py
pytest packages/gdbx-py -q
python -m gdbx_py --help

# JS parity
node --test test/test_gdbx_py_parity.mjs
node --test test/test_org_integration.mjs

# Full GDBX suite (must stay 84/84 + new)
node --test test/test_codec.mjs test/test_crypto.mjs test/test_storage.mjs test/test_security_hardening.mjs test/test_websocket.mjs test/test_phase4.mjs test/test_firewall.mjs test/test_pool.mjs test/test_transport.mjs

# AiA
pytest AiA/tests/test_gdbx_bridge.py -q

# OS relay
node --test OS/gdbx-relay/test/test_bridge.mjs

# Supply-chain
npm run check:supply-chain
```

## Risks / Notes

- **Python `cryptography` vs WebCrypto** â€” use `cryptography.hazmat.primitives.asymmetric.ec` with `SECP256R1` + `SHA256` + `DER`â†’raw conversion to match JS `raw` signature (base64url). Test vectors lock this.
- **BLAKE3 in Python** â€” `blake3` pip is Rust-backed, exact; fallback `hashlib.blake2b` not compatible â€” must use `blake3`.
- **File imports across repos** â€” `OS/gdbx-relay` importing `../../GDBX/sdk/*` via relative path works locally but breaks when OS repo alone is cloned. Mitigation: copy `sdk/gdbx-sdk.js` + `sdk/gdbx-crypto.js` into `OS/gdbx-relay/vendor/` at build time (script `sync-vendor.mjs`), or publish `gdbx` as git submodule.
- **Vector stub** â€” worker `/vector/*` not yet in DO, so Python does brute-force cosine over `kv:aia/vectors/*` â€” acceptable for <10k vectors, migrate to `sqlite-vec` next track.
