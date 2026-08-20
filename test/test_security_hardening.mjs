/**
 * test_security_hardening.mjs — Phase 4: replay protection, strict
 * validation and abuse prevention (OWASP-inspired).
 *
 * Covers:
 *   - Expired timestamp window → 401 (ts older than 60s)
 *   - Replayed nonce → 401 (same signed delta sent twice)
 *   - Invalid PoW → 400
 *   - Oversized delta value → 400
 *   - Non-primitive (nested object) delta value → 400
 *   - Bad key charset → 400
 *   - Oversized DID services array → 400
 *   - GDPR erasure: DELETE /identity wipes did + kv + presence
 *   - GDPR erasure: forged owner sig → 403
 *   - GDPR erasure: replay of purge nonce → 401
 *
 * Run:  node --test test/test_security_hardening.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (!globalThis.Gun) globalThis.Gun = require("gun");
const SEA = require("gun/sea.js");

import { GDBxStorageObject } from "../worker/src/GDBxStorageDO.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { minePoW, signBody } from "../sdk/gdbx-sdk.js";

let pair = null;
let pubkeyHex = null;
let addr = null;

before(async () => {
  pair = await SEA.pair();
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

/* ── Helpers ─────────────────────────────────────────────────────── */

async function registerDID(inst, t = Date.now()) {
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", t);
  const sig = await SEA.sign(signBody(addr, "did.register", t, null), pair);
  return doFetch(inst, "/did", "POST", { addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig });
}

async function putDelta(inst, t = Date.now(), extra = {}) {
  const deltas = [{ key: "k", value: "v", clock: t, ...extra }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await SEA.sign(signBody(addr, "sync.put", t, JSON.stringify(deltas)), pair);
  return doFetch(inst, "/sync", "POST", { addr, pubkey: pair.pub, pubkeyHex, deltas, ts: t, nonce, diff, hash, sig });
}

/* ── Replay protection ───────────────────────────────────────────── */

test("security: expired timestamp window rejected (401)", async () => {
  const { inst } = await makeDO();
  const tOld = Date.now() - 90_000; // 90s in the past — outside 60s window
  const { status, data } = await registerDID(inst, tOld);
  assert.equal(status, 401);
  assert.match(data.error, /timestamp/i);
});

test("security: replayed nonce rejected (401)", async () => {
  const { inst } = await makeDO();
  // Build one signed register body, send it twice — the 2nd is an exact replay.
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", t);
  const sig = await SEA.sign(signBody(addr, "did.register", t, null), pair);
  const body = { addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig };
  const first = await doFetch(inst, "/did", "POST", body);
  assert.equal(first.status, 201);
  const second = await doFetch(inst, "/did", "POST", body); // exact replay
  assert.equal(second.status, 401);
  assert.match(second.data.error, /replay/i);
});

test("security: invalid PoW rejected (400)", async () => {
  const { inst } = await makeDO();
  const t = Date.now();
  const { nonce, diff } = await minePoW(addr, pair.pub, "did.register", t);
  const sig = await SEA.sign(signBody(addr, "did.register", t, null), pair);
  const { status, data } = await doFetch(inst, "/did", "POST", {
    addr,
    pubkey: pair.pub,
    pubkeyHex,
    ts: t,
    nonce,
    diff,
    hash: "deadbeef", // bogus hash → PoW fails
    sig,
  });
  assert.equal(status, 400);
  assert.match(data.error, /hash|proof|PoW|pow/i);
});

/* ── Strict input validation ─────────────────────────────────────── */

test("validation: oversized delta value rejected (400)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const big = "x".repeat(33 * 1024); // > 32KB
  const { status } = await putDelta(inst, Date.now(), { value: big });
  assert.equal(status, 400);
  const { data: stats } = await doFetch(inst, "/stats");
  assert.equal(stats.policy.maxPayload, 32 * 1024);
});

test("validation: nested object delta value rejected (400)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const { status, data } = await putDelta(inst, Date.now(), { value: { evil: true } });
  assert.equal(status, 400);
  assert.match(data.error, /primitive/i);
});

test("validation: bad key charset rejected (400)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const t = Date.now();
  const deltas = [{ key: "bad key with spaces!", value: 1, clock: t }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await SEA.sign(signBody(addr, "sync.put", t, JSON.stringify(deltas)), pair);
  const { status, data } = await doFetch(inst, "/sync", "POST", {
    addr, pubkey: pair.pub, pubkeyHex, deltas, ts: t, nonce, diff, hash, sig,
  });
  assert.equal(status, 400);
  assert.match(data.error, /key/i);
});

test("validation: oversized DID services array rejected (400)", async () => {
  const { inst } = await makeDO();
  const t = Date.now();
  const services = Array.from({ length: 17 }, (_, i) => ({
    id: `svc-${i}`,
    type: "GDBxTransportRouting",
    serviceEndpoint: "https://example.com/" + i,
  }));
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", t);
  const sig = await SEA.sign(signBody(addr, "did.register", t, { services }), pair);
  const { status, data } = await doFetch(inst, "/did", "POST", {
    addr, pubkey: pair.pub, pubkeyHex, didDoc: { services }, ts: t, nonce, diff, hash, sig,
  });
  assert.equal(status, 400);
  assert.match(data.error, /services/i);
});

/* ── GDPR erasure ────────────────────────────────────────────────── */

test("gdpr: purgeIdentity wipes did + kv + presence", async () => {
  const { inst, st } = await makeDO();
  await registerDID(inst);
  await putDelta(inst);
  const hb = await doFetch(inst, "/peers", "POST", {
    addr, pubkey: pair.pub, pubkeyHex, transports: ["webrtc"], latencyMs: 5,
  });
  assert.equal(hb.status, 200);
  assert.ok(st._store.has(`did:${addr}`));
  assert.ok(st._store.has(`kv:${addr}:k`));
  assert.ok(st._store.has(`presence:${addr}`));

  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "identity.purge", t);
  const sig = await SEA.sign(signBody(addr, "identity.purge", t, null), pair);
  const { status, data } = await doFetch(inst, "/identity", "DELETE", {
    addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig,
  });
  assert.equal(status, 200);
  assert.equal(data.erased >= 3, true);
  assert.equal(st._store.has(`did:${addr}`), false);
  assert.equal(st._store.has(`kv:${addr}:k`), false);
  assert.equal(st._store.has(`presence:${addr}`), false);
});

test("gdpr: forged owner signature rejected (403)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const other = await SEA.pair();
  const otherHex = await pubkeyToHex(other);
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, other.pub, "identity.purge", t);
  const sig = await SEA.sign(signBody(addr, "identity.purge", t, null), other); // wrong key
  const { status, data } = await doFetch(inst, "/identity", "DELETE", {
    addr, pubkey: other.pub, pubkeyHex: otherHex, ts: t, nonce, diff, hash, sig,
  });
  assert.equal(status, 403);
});

test("gdpr: purge nonce replay rejected (401)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "identity.purge", t);
  const sig = await SEA.sign(signBody(addr, "identity.purge", t, null), pair);
  const body = { addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig };
  const first = await doFetch(inst, "/identity", "DELETE", body);
  assert.equal(first.status, 200);
  // re-register so the address exists again, then replay the purge
  const reg = await registerDID(inst, Date.now());
  assert.equal(reg.status, 201);
  const replay = await doFetch(inst, "/identity", "DELETE", body);
  assert.equal(replay.status, 401);
  assert.match(replay.data.error, /replay/i);
});