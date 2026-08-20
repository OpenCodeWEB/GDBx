/**
 * test_websocket.mjs — Phase 4: real-time WebSocket sync protocol tests.
 *
 * Covers:
 *   - hello/welcome handshake
 *   - put (signed deltas) → applied confirmation
 *   - put failure (bad sig) → error frame
 *   - get → snapshot frame
 *   - ping → pong
 *   - broadcast: delta from one subscriber reaches another on same addr
 *
 * Run:  node --test test/test_websocket.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";

import { GDBxStorageObject } from "../worker/src/GDBxStorageDO.js";
import { handleProtocolMessage, subscribeTestSocket, unsubscribeTestSocket, testSocketList } from "../worker/src/websocket_handler.js";
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

/** Minimal fake websocket that captures sent frames. */
function fakeSocket() {
  const sent = [];
  return {
    sent,
    send: (s) => sent.push(typeof s === "string" ? JSON.parse(s) : s),
    close: () => {},
  };
}

async function registerDID(inst) {
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", t);
  const sig = await cryptoSign(signBody(addr, "did.register", t, null), pair);
  const req = new Request("https://do.local/did", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig }),
  });
  const res = await inst.fetch(req);
  assert.equal(res.status, 201);
}

/* ── Tests ──────────────────────────────────────────────────────── */

test("ws: hello → welcome", async () => {
  const { inst } = await makeDO();
  const sock = fakeSocket();
  const state = { addr, alive: true, lastPing: Date.now() };
  subscribeTestSocket(sock, state);
  await handleProtocolMessage({ type: "hello", addr }, sock, state, inst);
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].type, "welcome");
  assert.equal(sock.sent[0].addr, addr);
  unsubscribeTestSocket(sock);
});

test("ws: put signed deltas → applied", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const sock = fakeSocket();
  const state = { addr, alive: true, lastPing: Date.now() };
  subscribeTestSocket(sock, state);

  const t = Date.now();
  const deltas = [{ key: "live/status", value: "online", clock: t }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign(signBody(addr, "sync.put", t, JSON.stringify(deltas)), pair);
  await handleProtocolMessage({
    type: "put", addr, pubkey: pair.pub, pubkeyHex,
    deltas, ts: t, nonce, diff, hash, sig,
  }, sock, state, inst);

  const applied = sock.sent.find((m) => m.type === "applied");
  assert.ok(applied);
  assert.equal(applied.addr, addr);
  assert.equal(applied.applied, 1);
  unsubscribeTestSocket(sock);
});

test("ws: put with bad sig → error frame", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const sock = fakeSocket();
  const state = { addr, alive: true, lastPing: Date.now() };
  subscribeTestSocket(sock, state);

  const other = await cryptoPair();
  const t = Date.now();
  const deltas = [{ key: "live/status", value: "hacked", clock: t }];
  // PoW mined with the real owner pub, but signed with a DIFFERENT key
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign(signBody(addr, "sync.put", t, JSON.stringify(deltas)), other);
  await handleProtocolMessage({
    type: "put", addr, pubkey: pair.pub, pubkeyHex,
    deltas, ts: t, nonce, diff, hash, sig,
  }, sock, state, inst);

  const err = sock.sent.find((m) => m.type === "error");
  assert.ok(err, "expected error frame, got: " + JSON.stringify(sock.sent));
  assert.ok(err.status === 403 || err.error);
  unsubscribeTestSocket(sock);
});

test("ws: get → snapshot", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const t = Date.now();
  const deltas = [{ key: "snap/one", value: 1, clock: t }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign(signBody(addr, "sync.put", t, JSON.stringify(deltas)), pair);
  const req = new Request("https://do.local/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr, pubkey: pair.pub, pubkeyHex, deltas, ts: t, nonce, diff, hash, sig }),
  });
  await inst.fetch(req);

  const sock = fakeSocket();
  const state = { addr, alive: true, lastPing: Date.now() };
  subscribeTestSocket(sock, state);
  await handleProtocolMessage({ type: "get", addr, prefix: "snap/" }, sock, state, inst);

  const snap = sock.sent.find((m) => m.type === "snapshot");
  assert.ok(snap);
  assert.equal(snap.addr, addr);
  assert.equal(snap.count, 1);
  assert.equal(snap.entries[0].key, "snap/one");
  unsubscribeTestSocket(sock);
});

test("ws: ping → pong", async () => {
  const { inst } = await makeDO();
  const sock = fakeSocket();
  const state = { addr, alive: true, lastPing: Date.now() };
  subscribeTestSocket(sock, state);
  await handleProtocolMessage({ type: "ping" }, sock, state, inst);
  assert.equal(sock.sent[0].type, "pong");
  unsubscribeTestSocket(sock);
});

test("ws: delta broadcast reaches second subscriber on same addr", async () => {
  const { inst } = await makeDO();
  await registerDID(inst);
  const a = fakeSocket();
  const b = fakeSocket();
  const stateA = { addr, alive: true, lastPing: Date.now() };
  const stateB = { addr, alive: true, lastPing: Date.now() };
  subscribeTestSocket(a, stateA);
  subscribeTestSocket(b, stateB);

  const t = Date.now();
  const deltas = [{ key: "mesh/msg", value: "hello-peer", clock: t }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign(signBody(addr, "sync.put", t, JSON.stringify(deltas)), pair);
  await handleProtocolMessage({
    type: "put", addr, pubkey: pair.pub, pubkeyHex,
    deltas, ts: t, nonce, diff, hash, sig,
  }, a, stateA, inst);

  // socket `a` gets applied; socket `b` gets the delta broadcast
  const applied = a.sent.find((m) => m.type === "applied");
  assert.ok(applied);
  const delta = b.sent.find((m) => m.type === "delta");
  assert.ok(delta);
  assert.equal(delta.key, "mesh/msg");
  assert.equal(delta.value, "hello-peer");
  assert.equal(delta.addr, addr);

  unsubscribeTestSocket(a);
  unsubscribeTestSocket(b);
});

test("ws: no sockets remain subscribed after cleanup", () => {
  assert.equal(testSocketList().length, 0);
});