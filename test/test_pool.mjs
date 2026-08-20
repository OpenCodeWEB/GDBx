/**
 * test_pool.mjs — Phase 5: replication pool (multi-node durability).
 *
 * Covers:
 *   - write on primary replicates to mirror (key present on both)
 *   - replication carries DID + deltas (full state)
 *   - mirror serves reads when primary is unavailable (failover)
 *   - rejoin heals via CRDT merge (LWW — newer clock wins)
 *   - pool status lists nodes + health
 *
 * Run:  node --test test/test_pool.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { minePoW } from "../sdk/gdbx-sdk.js";
import { GDBxStorageObject } from "../worker/src/GDBxStorageDO.js";
import { GDBxMirrorObject } from "../worker/src/GDBxMirrorDO.js";

let pair = null;
let pubkeyHex = null;
let addr = null;

async function hexOf(p) {
  const jwk = await crypto.subtle.exportKey("jwk", await importPairKey(p));
  const b64uToHex = (s) => {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + (pad.length % 4 === 0 ? "" : "=".repeat(4 - (pad.length % 4))));
    return [...new Uint8Array(bin.length)].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
  };
  return "04" + b64uToHex(jwk.x) + b64uToHex(jwk.y);
}

async function importPairKey(p) {
  const [x, y] = p.pub.split(".");
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
}

/** In-memory DO storage (same shape as test_storage.mjs). */
function memState() {
  const store = new Map();
  return {
    storage: {
      async get(k) { return store.has(k) ? store.get(k) : undefined; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
      async list(opts) {
        const prefix = opts?.prefix || "";
        const out = new Map();
        for (const [k, v] of store) if (k.startsWith(prefix)) out.set(k, v);
        return out;
      },
    },
  };
}

/** Shared in-memory bus so primary and mirror DOs can talk. */
function makePool() {
  const primaryState = memState();
  const mirrorState = memState();
  const primary = new GDBxStorageObject(
    { storage: primaryState.storage, id: "primary", waitUntil() {} },
    {
      // env: mirror binding → replicate here
      GDBX_MIRROR: {
        idFromName: () => ({ name: "mirror" }),
        get: async () => new GDBxMirrorObject({ storage: mirrorState.storage, id: "mirror", waitUntil() {} }, {}),
      },
      ROOT_PUBKEYS: "",
    },
  );
  const mirror = new GDBxMirrorObject({ storage: mirrorState.storage, id: "mirror", waitUntil() {} }, {});
  return { primary, mirror, primaryState, mirrorState };
}

async function register(doObj, p = pair, hex = pubkeyHex, a = addr) {
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(a, p.pub, "did.register", t);
  const sig = await cryptoSign({ addr: a, action: "did.register", ts: t, payload: null }, p);
  const req = new Request("https://do.local/did", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr: a, pubkey: p.pub, pubkeyHex: hex, ts: t, nonce, diff, hash, sig }),
  });
  return (await doObj.fetch(req)).json();
}

async function put(doObj, key, value, clock, p = pair, hex = pubkeyHex, a = addr) {
  const t = Date.now();
  const deltas = [{ key, value, clock }];
  const { nonce, hash, diff } = await minePoW(a, p.pub, "sync.put", t);
  const sig = await cryptoSign({ addr: a, action: "sync.put", ts: t, payload: JSON.stringify(deltas) }, p);
  const req = new Request("https://do.local/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr: a, pubkey: p.pub, pubkeyHex: hex, deltas, ts: t, nonce, diff, hash, sig }),
  });
  return (await doObj.fetch(req)).json();
}

async function get(doObj, a = addr) {
  const req = new Request(`https://do.local/sync/${a}`);
  const res = await doObj.fetch(req);
  return res.json();
}

before(async () => {
  pair = await cryptoPair();
  pubkeyHex = await hexOf(pair);
  addr = makeAddress(pubkeyHex, 0);
});

/* ── replication ────────────────────────────────────────────────── */

test("pool: write on primary replicates DID + deltas to mirror", async () => {
  const { primary, mirror } = makePool();
  const reg = await register(primary);
  assert.equal(reg.ok, true);
  const put1 = await put(primary, "profile/name", "pool-user", Date.now());
  assert.equal(put1.ok, true);

  // Mirror has both the DID and the delta (replicated)
  const mDid = await mirror.fetch(new Request("https://do.local/did/" + addr));
  const mDidData = await mDid.json();
  assert.equal(mDidData.ok, true, "mirror has DID");
  const mSync = await get(mirror);
  assert.equal(mSync.count, 1);
  assert.equal(mSync.entries[0].key, "profile/name");
  assert.equal(mSync.entries[0].value, "pool-user");
});

test("pool: failover — mirror serves reads when primary unavailable", async () => {
  const { primary, mirror } = makePool();
  await register(primary);
  await put(primary, "k", "v1", Date.now());

  // primary gone: mirror still answers reads
  const mSync = await get(mirror);
  assert.equal(mSync.ok, true);
  assert.equal(mSync.count, 1);
  assert.equal(mSync.entries[0].value, "v1");
});

test("pool: rejoin heals via CRDT merge — newer clock wins", async () => {
  const { primary, mirror } = makePool();
  await register(primary);
  const t1 = Date.now();
  await put(primary, "k", "old", t1);

  // mirror gets a NEWER write (as if written elsewhere in the pool)
  await mirror.applySnapshot(addr, {
    kv: { k: { value: "new", clock: t1 + 1000, ownerPub: pubkeyHex } },
  });

  // primary re-joins: reading through pool path merges → newest clock wins
  const pSync = await get(primary);
  const entry = pSync.entries.find((e) => e.key === "k");
  assert.equal(entry.value, "new");
});

test("pool: status lists nodes + health", async () => {
  const { primary, mirror } = makePool();
  await register(primary);
  const res = await primary.fetch(new Request("https://do.local/pool"));
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.nodes));
  assert.ok(data.nodes.length >= 1);
  assert.equal(data.nodes[0].role, "primary");
  assert.equal(data.health, "ok");
});

test("pool: unknown route on mirror falls through to storage semantics", async () => {
  const { mirror } = makePool();
  const req = new Request("https://do.local/stats");
  const res = await mirror.fetch(req);
  const data = await res.json();
  assert.equal(data.ok, true);
});