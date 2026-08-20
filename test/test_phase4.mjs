/**
 * test_phase4.mjs — Phase 4: export/backup + leaderboard + GDPR SDK surface.
 *
 * Covers:
 *   - export: signed snapshot returns did + kv entries (200)
 *   - export: forged owner → 403
 *   - export: replay nonce → 401
 *   - leaderboard: public analytics with top addresses + peers
 *   - leaderboard: empty state returns ok
 *
 * Run:  node --test test/test_phase4.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";

import { GDBxStorageObject } from "../worker/src/GDBxStorageDO.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { minePoW, signBody } from "../sdk/gdbx-sdk.js";

let pair = null;
let pubkeyHex = null;
let addr = null;

before(async () => {
  pair = await cryptoPair();
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

async function registerDID(inst) {
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", t);
  const sig = await cryptoSign(signBody(addr, "did.register", t, null), pair);
  await doFetch(inst, "/did", "POST", { addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig });
}

async function putDelta(inst, key = "k", value = "v") {
  const t = Date.now();
  const deltas = [{ key, value, clock: t }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign(signBody(addr, "sync.put", t, JSON.stringify(deltas)), pair);
  await doFetch(inst, "/sync", "POST", { addr, pubkey: pair.pub, pubkeyHex, deltas, ts: t, nonce, diff, hash, sig });
}

/* ── Export ─────────────────────────────────────────────────────── */

test("export: signed snapshot returns did + kv entries (200)", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  await putDelta(inst, "profile/name", "gdbx-user");

  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "identity.export", t);
  const sig = await cryptoSign(signBody(addr, "identity.export", t, null), pair);
  const { status, data } = await doFetch(inst, "/export", "POST", {
    addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig,
  });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.format, "gdbx-snapshot-v1");
  assert.equal(data.did.id, `did:gdbx:${addr}`);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].key, "profile/name");
  assert.equal(data.entries[0].value, "gdbx-user");
});

test("export: forged owner → 403", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const other = await cryptoPair();
  const otherHex = await pubkeyToHex(other);
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, other.pub, "identity.export", t);
  const sig = await cryptoSign(signBody(addr, "identity.export", t, null), other);
  const { status } = await doFetch(inst, "/export", "POST", {
    addr, pubkey: other.pub, pubkeyHex: otherHex, ts: t, nonce, diff, hash, sig,
  });
  assert.equal(status, 403);
});

test("export: replay nonce → 401", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "identity.export", t);
  const sig = await cryptoSign(signBody(addr, "identity.export", t, null), pair);
  const body = { addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig };
  const first = await doFetch(inst, "/export", "POST", body);
  assert.equal(first.status, 200);
  const replay = await doFetch(inst, "/export", "POST", body);
  assert.equal(replay.status, 401);
  assert.match(replay.data.error, /replay/i);
});

/* ── Leaderboard ────────────────────────────────────────────────── */

test("leaderboard: public analytics with top addresses + peers", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  await putDelta(inst, "a/one", 1);
  await putDelta(inst, "a/two", 2);
  await doFetch(inst, "/peers", "POST", {
    addr, pubkey: pair.pub, pubkeyHex, transports: ["webrtc"], latencyMs: 8,
  });

  const { status, data } = await doFetch(inst, "/leaderboard");
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.stats.dids, 1);
  assert.equal(data.stats.deltas, 2);
  assert.equal(data.stats.activePeers, 1);
  assert.equal(data.stats.transports.webrtc, 1);
  assert.ok(data.top.length >= 1);
  assert.equal(data.top[0].addr, addr);
  assert.equal(data.top[0].deltas, 2);
  assert.equal(data.peers[0].addr, addr);
});

test("leaderboard: empty state returns ok", async () => {
  const { inst } = await makeDO();
  const { status, data } = await doFetch(inst, "/leaderboard");
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.stats.dids, 0);
  assert.equal(data.top.length, 0);
});