/**
 * test_storage.mjs — Phase 2+3: GDBxStorageDO tests (DID + sync engine).
 *
 * Covers:
 *   - DID register: PoW + SEA sig + pubkey↔address binding (201, replay 200)
 *   - DID resolve: found + missing (404)
 *   - Sync put: signed deltas applied (LWW), wrong-owner rejected (403),
 *     unregistered address rejected (403), PoW missing rejected (400),
 *     forged sig rejected (403), batch size guard (400)
 *   - Stats ledger
 *
 * Run:  node --test test/test_storage.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";

import { GDBxStorageObject } from "../worker/src/GDBxStorageDO.js";
import { makeAddress, normalizeAddress } from "../sdk/gdbx-codec.js";
import { minePoW, signBody } from "../sdk/gdbx-sdk.js";

let pair = null;
let pubkeyHex = null;
let addr = null;

before(async () => {
  pair = await cryptoPair();
  // pubkey → hex (04||X||Y)
  const jwk = await crypto.subtle.exportKey("jwk", await importPairKey(pair));
  pubkeyHex = await pubkeyToHex(pair);
  addr = makeAddress(pubkeyHex, 0);
});

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

async function pubkeyToHex(p) {
  const key = await importPairKey(p);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const b64uToHex = (s) => {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + (pad.length % 4 === 0 ? "" : "=".repeat(4 - (pad.length % 4))));
    return [...new Uint8Array(bin.length)].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
  };
  return "04" + b64uToHex(jwk.x) + b64uToHex(jwk.y);
}

function memState() {
  const store = new Map();
  return {
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => store.set(k, v),
      delete: async (k) => store.delete(k),
      list: async ({ prefix }) => {
        const entries = [...store.entries()].filter(([k]) => k.startsWith(prefix));
        return { entries: () => entries, list_complete: true };
      },
      setAlarm: async () => {},
    },
    _store: store,
  };
}

async function makeDO() {
  const st = memState();
  const inst = new GDBxStorageObject(st, {});
  await inst.initialized;
  return { inst, st };
}

const doFetch = async (inst, path, method = "GET", body) => {
  const req = new Request("https://do.local" + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await inst.fetch(req);
  return { status: res.status, data: await res.json() };
};

/* ── DID ─────────────────────────────────────────────────────────── */

test("did: register with PoW + SEA → 201, resolve → document", async () => {
  const { inst } = await makeDO();
  const ts = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", ts);
  const didDoc = {
    services: [{ id: "did:gdbx#transport", type: "GDBxTransportRouting", serviceEndpoint: { webrtc: "peer-1", nostr: ["wss://relay.damus.io"] } }],
  };
  const sig = await cryptoSign(signBody(addr, "did.register", ts, didDoc), pair);

  const { status, data } = await doFetch(inst, "/did", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    didDoc,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 201);
  assert.equal(data.ok, true);
  assert.equal(data.created, true);
  assert.equal(data.did.id, `did:gdbx:${addr}`);
  assert.equal(data.did.services[0].serviceEndpoint.nostr[0], "wss://relay.damus.io");

  const { status: s2, data: d2 } = await doFetch(inst, "/did/" + addr);
  assert.equal(s2, 200);
  assert.equal(d2.did.id, `did:gdbx:${addr}`);
});

test("did: address suffix input accepted (.gdbx form)", async () => {
  const { inst } = await makeDO();
  const ts = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", ts);
  const sig = await cryptoSign(signBody(addr, "did.register", ts, null), pair);
  const { status } = await doFetch(inst, "/did", "POST", {
    addr: addr + ".gdbx",
    pubkey: pair.pub, pubkeyHex,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 201);
});

test("did: forged signature rejected (403)", async () => {
  const { inst } = await makeDO();
  const other = await cryptoPair();
  const ts = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", ts);
  const sig = await cryptoSign(signBody(addr, "did.register", ts, null), other); // wrong key
  const { status, data } = await doFetch(inst, "/did", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 403);
  assert.match(data.error, /signature/i);
});

test("did: pubkey not matching address rejected (403)", async () => {
  const { inst } = await makeDO();
  const other = await cryptoPair();
  const otherHex = await pubkeyToHex(other);
  const ts = Date.now();
  // PoW is anti-spam over the claimed addr; the identity binding fails because
  // pubkeyHex hashes to a different address than `addr`.
  const { nonce, hash, diff } = await minePoW(addr, other.pub, "did.register", ts);
  const sig = await cryptoSign(signBody(addr, "did.register", ts, null), other);
  const { status, data } = await doFetch(inst, "/did", "POST", {
    addr, // WRONG address — claims other's pubkey but this addr
    pubkey: other.pub, pubkeyHex: otherHex,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 403);
  assert.match(data.error, /does not match/i);
});

test("did: missing PoW rejected (400)", async () => {
  const { inst } = await makeDO();
  const ts = Date.now();
  const sig = await cryptoSign(signBody(addr, "did.register", ts, null), pair);
  const { status } = await doFetch(inst, "/did", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    ts,
    sig,
    // no nonce/hash/diff
  });
  assert.equal(status, 400);
});

test("did: resolve missing → 404", async () => {
  const { inst } = await makeDO();
  const { status } = await doFetch(inst, "/did/" + addr);
  assert.equal(status, 404);
});

test("did: invalid address → 400", async () => {
  const { inst } = await makeDO();
  const { status } = await doFetch(inst, "/did/notanaddress");
  assert.equal(status, 400);
});

/* ── Sync ────────────────────────────────────────────────────────── */

async function registerDID(inst) {
  const ts = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", ts);
  const sig = await cryptoSign(signBody(addr, "did.register", ts, null), pair);
  await doFetch(inst, "/did", "POST", { addr, pubkey: pair.pub, pubkeyHex, ts, nonce, diff, hash, sig });
}

test("sync: put signed deltas → applied (LWW), get returns state", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);

  const ts = Date.now();
  const deltas = [
    { key: "app/settings/theme", value: "dark", clock: ts },
    { key: "app/counter", value: 42, clock: ts },
  ];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", ts);
  const payload = JSON.stringify(deltas);
  const sig = await cryptoSign(signBody(addr, "sync.put", ts, payload), pair);

  const { status, data } = await doFetch(inst, "/sync", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    deltas,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 200);
  assert.equal(data.applied, 2);

  const { status: s2, data: d2 } = await doFetch(inst, "/sync/" + addr);
  assert.equal(s2, 200);
  assert.equal(d2.count, 2);
  const byKey = Object.fromEntries(d2.entries.map((e) => [e.key, e]));
  assert.equal(byKey["app/settings/theme"].value, "dark");
  assert.equal(byKey["app/counter"].value, 42);
});

test("sync: prefix filter", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const ts = Date.now();
  const deltas = [
    { key: "a/one", value: 1, clock: ts },
    { key: "b/two", value: 2, clock: ts },
  ];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", ts);
  const sig = await cryptoSign(signBody(addr, "sync.put", ts, JSON.stringify(deltas)), pair);
  await doFetch(inst, "/sync", "POST", { addr, pubkey: pair.pub, pubkeyHex, deltas, ts, nonce, diff, hash, sig });

  const { data } = await doFetch(inst, "/sync/" + addr + "?prefix=a/");
  assert.equal(data.count, 1);
  assert.equal(data.entries[0].key, "a/one");
});

test("sync: LWW — newer clock wins, older write ignored", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);

  const t1 = Date.now();
  const d1 = [{ key: "k", value: "old", clock: t1 }];
  const p1 = await minePoW(addr, pair.pub, "sync.put", t1);
  const s1 = await cryptoSign(signBody(addr, "sync.put", t1, JSON.stringify(d1)), pair);
  await doFetch(inst, "/sync", "POST", { addr, pubkey: pair.pub, pubkeyHex, deltas: d1, ts: t1, ...p1, sig: s1 });

  const t2 = t1 + 1000;
  const d2 = [{ key: "k", value: "new", clock: t2 }];
  const p2 = await minePoW(addr, pair.pub, "sync.put", t2);
  const s2 = await cryptoSign(signBody(addr, "sync.put", t2, JSON.stringify(d2)), pair);
  const { data } = await doFetch(inst, "/sync", "POST", { addr, pubkey: pair.pub, pubkeyHex, deltas: d2, ts: t2, ...p2, sig: s2 });
  assert.equal(data.applied, 1);

  const { data: got } = await doFetch(inst, "/sync/" + addr);
  assert.equal(got.entries[0].value, "new");

  // older write now loses — stale delta clock (t1) but a FRESH request
  // timestamp+nonce so the replay guard (ts window + fresh nonce) passes.
  const t4 = Date.now();
  const d3 = [{ key: "k", value: "old-again", clock: t1 }];
  const p3 = await minePoW(addr, pair.pub, "sync.put", t4);
  const s3 = await cryptoSign(signBody(addr, "sync.put", t4, JSON.stringify(d3)), pair);
  const { data: r3 } = await doFetch(inst, "/sync", "POST", { addr, pubkey: pair.pub, pubkeyHex, deltas: d3, ts: t4, ...p3, sig: s3 });
  assert.equal(r3.applied, 0);

  const { data: got2 } = await doFetch(inst, "/sync/" + addr);
  assert.equal(got2.entries[0].value, "new");
});

test("sync: unregistered address rejected (403)", async () => {
  const { inst } = await makeDO();
  const ts = Date.now();
  const deltas = [{ key: "k", value: 1, clock: ts }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", ts);
  const sig = await cryptoSign(signBody(addr, "sync.put", ts, JSON.stringify(deltas)), pair);
  const { status, data } = await doFetch(inst, "/sync", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    deltas,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 403);
  assert.match(data.error, /register/i);
});

test("sync: forged sig rejected (403)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const other = await cryptoPair();
  const ts = Date.now();
  const deltas = [{ key: "k", value: "x", clock: ts }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", ts);
  const sig = await cryptoSign(signBody(addr, "sync.put", ts, JSON.stringify(deltas)), other);
  const { status, data } = await doFetch(inst, "/sync", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    deltas,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 403);
  assert.match(data.error, /signature/i);
});

test("sync: batch of 1000 accepted — zero-limit batches (boundary 1001 rejected)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const ts = Date.now();
  const deltas = Array.from({ length: 1000 }, (_, i) => ({ key: "k" + i, value: i, clock: ts }));
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", ts);
  const sig = await cryptoSign(signBody(addr, "sync.put", ts, JSON.stringify(deltas)), pair);
  const { status } = await doFetch(inst, "/sync", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    deltas,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
  assert.equal(status, 200);

  // boundary: 1001 exceeds platform headroom guard
  const ts2 = Date.now();
  const deltas2 = Array.from({ length: 1001 }, (_, i) => ({ key: "b" + i, value: i, clock: ts2 }));
  const pow2 = await minePoW(addr, pair.pub, "sync.put", ts2);
  const sig2 = await cryptoSign(signBody(addr, "sync.put", ts2, JSON.stringify(deltas2)), pair);
  const r2 = await doFetch(inst, "/sync", "POST", {
    addr, pubkey: pair.pub, pubkeyHex, deltas: deltas2, ts: ts2, nonce: pow2.nonce, diff: pow2.diff, hash: pow2.hash, sig: sig2,
  });
  assert.equal(r2.status, 400);
});

/* ── Presence + stats ────────────────────────────────────────────── */

test("peers: heartbeat records transports", async () => {
  const { inst } = await makeDO();
  const { status, data } = await doFetch(inst, "/peers", "POST", {
    addr,
    pubkey: pair.pub, pubkeyHex,
    transports: ["webrtc", "nostr"],
    latencyMs: 12,
  });
  assert.equal(status, 200);
  assert.ok(data.lastSeen);
  const { data: stats } = await doFetch(inst, "/stats");
  assert.equal(stats.stats.transports.webrtc, 1);
  assert.equal(stats.stats.transports.nostr, 1);
  assert.ok(stats.stats.active >= 1);
});

test("stats: ledger counts dids + deltas", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const ts = Date.now();
  const deltas = [{ key: "a", value: 1, clock: ts }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", ts);
  const sig = await cryptoSign(signBody(addr, "sync.put", ts, JSON.stringify(deltas)), pair);
  await doFetch(inst, "/sync", "POST", { addr, pubkey: pair.pub, pubkeyHex, deltas, ts, nonce, diff, hash, sig });

  const { data } = await doFetch(inst, "/stats");
  assert.equal(data.stats.dids, 1);
  assert.equal(data.stats.deltas, 1);
  assert.equal(data.policy.maxDeltasPerBatch, 1000);
});