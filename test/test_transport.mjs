/**
 * test_transport.mjs — Phase 5: hybrid mesh transports.
 *
 * Covers:
 *   - transport router picks ws → nostr → webrtc by availability
 *   - nostr event builder: kind 23124, signed GDBx content, addr tag
 *   - nostr event parser round-trips
 *   - webrtc signal builder (offer/answer/candidate) round-trips
 *   - worker /relay ingests a signed nostr event through FirewallGuard
 *   - relay rejects bad-signature events
 *
 * Run:  node --test test/test_transport.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { minePoW } from "../sdk/gdbx-sdk.js";
import {
  pickTransport,
  buildNostrEvent,
  parseNostrEvent,
  buildSignal,
  parseSignal,
} from "../sdk/transport.js";
import { putDeltasHybrid } from "../sdk/gdbx-sdk.js";
import { GDBxStorageObject } from "../worker/src/GDBxStorageDO.js";

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

function makeDO() {
  const st = memState();
  const doObj = new GDBxStorageObject(
    { storage: st.storage, id: "primary", waitUntil() {} },
    { GDBX_MIRROR: undefined, ROOT_PUBKEYS: "" },
  );
  return { doObj, st };
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

before(async () => {
  pair = await cryptoPair();
  pubkeyHex = await hexOf(pair);
  addr = makeAddress(pubkeyHex, 0);
});

/* ── router ─────────────────────────────────────────────────────── */

test("mesh: router picks ws when available", () => {
  assert.equal(pickTransport({ ws: true, nostr: false, webrtc: false }), "ws");
  assert.equal(pickTransport({ ws: true, nostr: true, webrtc: true }), "ws");
});

test("mesh: router falls back ws → nostr → webrtc", () => {
  assert.equal(pickTransport({ ws: false, nostr: true, webrtc: true }), "nostr");
  assert.equal(pickTransport({ ws: false, nostr: false, webrtc: true }), "webrtc");
  assert.equal(pickTransport({ ws: false, nostr: false, webrtc: false }), null);
});

/* ── nostr envelope ─────────────────────────────────────────────── */

test("mesh: nostr event builder — kind 23124, signed content, addr tag", async () => {
  const t = Date.now();
  const event = await buildNostrEvent({
    addr,
    pubkey: pair.pub,
    ts: t,
    nonce: 1,
    diff: 2,
    hash: "abc",
    deltas: [{ key: "k", value: "v", clock: t }],
    sig: "sig",
  });
  assert.equal(event.kind, 23124);
  assert.equal(event.pubkey, pair.pub);
  assert.ok(event.tags.some((tag) => tag[0] === "addr" && tag[1] === addr));
  assert.ok(event.created_at > 0);
  assert.equal(typeof event.content, "string");
  // content is the GDBx envelope: "GDBx{...}"
  assert.ok(event.content.startsWith("GDBx"));
  const parsed = JSON.parse(event.content.slice(4));
  assert.equal(parsed.m.addr, addr);
  assert.equal(parsed.m.action, "sync.put");
  assert.equal(parsed.s, "sig");
});

test("mesh: nostr event parser round-trips", () => {
  const content = "GDBx" + JSON.stringify({
    m: { addr, action: "sync.put", ts: 1234, payload: JSON.stringify([{ key: "k", value: "v", clock: 1234 }]) },
    s: "sig",
  });
  const parsed = parseNostrEvent({
    kind: 23124,
    pubkey: pair.pub,
    tags: [["addr", addr]],
    created_at: 1234,
    content,
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.addr, addr);
  assert.equal(parsed.action, "sync.put");
  assert.equal(parsed.deltas.length, 1);
  assert.equal(parsed.deltas[0].key, "k");
});

test("mesh: nostr parser rejects wrong kind / missing addr tag", () => {
  const content = JSON.stringify({ m: { addr, action: "sync.put", ts: 1, payload: "[]" }, s: "x" });
  assert.equal(parseNostrEvent({ kind: 1, tags: [["addr", addr]], created_at: 1, content }).ok, false);
  assert.equal(parseNostrEvent({ kind: 23124, tags: [], created_at: 1, content }).ok, false);
});

/* ── webrtc signaling ───────────────────────────────────────────── */

test("mesh: webrtc signal builder round-trips offer/answer/candidate", async () => {
  const t = Date.now();
  for (const type of ["offer", "answer", "candidate"]) {
    const payload = type === "candidate" ? { candidate: "c0:1 1 UDP 1 1.2.3.4 5000 typ host" } : { sdp: "v=0..." };
    const sig = await cryptoSign({ addr, action: "webrtc.signal", ts: t, payload: JSON.stringify({ type, ...payload }) }, pair);
    const signal = await buildSignal({ type, addr, payload, pubkey: pair.pub, ts: t, sig });
    const parsed = parseSignal(signal);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.type, type);
    assert.equal(parsed.addr, addr);
    if (type === "candidate") assert.equal(parsed.payload.candidate, payload.candidate);
  }
});

test("mesh: webrtc signal parser rejects malformed", () => {
  assert.equal(parseSignal(JSON.stringify({ type: "offer" })).ok, false);
  assert.equal(parseSignal("not json").ok, false);
});

/* ── worker relay ingest ────────────────────────────────────────── */

test("mesh: worker /relay ingests signed nostr event through firewall", async () => {
  const { doObj } = makeDO();
  await register(doObj);

  const t = Date.now();
  const deltas = [{ key: "mesh/k", value: "relayed", clock: t }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign({ addr, action: "sync.put", ts: t, payload: JSON.stringify(deltas) }, pair);
  const event = await buildNostrEvent({
    addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, deltas, sig,
  });

  const req = new Request("https://do.local/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const res = await doObj.fetch(req);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.applied, 1);

  // verify the delta landed
  const getReq = new Request(`https://do.local/sync/${addr}`);
  const getRes = await doObj.fetch(getReq);
  const snap = await getRes.json();
  const entry = snap.entries.find((e) => e.key === "mesh/k");
  assert.equal(entry.value, "relayed");
});

test("mesh: /relay rejects bad signature", async () => {
  const { doObj } = makeDO();
  await register(doObj);

  const t = Date.now();
  const deltas = [{ key: "mesh/bad", value: "x", clock: t }];
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const event = await buildNostrEvent({
    addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, deltas,
    sig: "GDBxbad",
  });
  const req = new Request("https://do.local/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const res = await doObj.fetch(req);
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.ok(/signature/i.test(data.error));
});

test("mesh: SDK putDeltasHybrid falls back to nostr relay", async () => {
  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ ok: true, applied: 1 }), { status: 200 });
  };
  const res = await putDeltasHybrid(
    { pubkeyHex, pair, deltas: [{ key: "hybrid/k", value: "mesh" }] },
    { transport: "nostr", fetch: fakeFetch },
  );
  assert.equal(res.ok, true);
  assert.equal(res.transport, "nostr");
  assert.ok(captured.url.endsWith("/relay"));
  const event = JSON.parse(captured.init.body);
  assert.equal(event.kind, 23124);
  assert.equal(event.pubkey, pair.pub);
  assert.ok(event.content.startsWith("GDBx"));
});