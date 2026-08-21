/**
 * test_org_integration.mjs — org-gdbx-unification integration (AiA→OS via GDBx pool)
 *
 * Verifies: AiA put_deltas (aia/memory) is visible to OS get_deltas through
 * the GDBx pool merge path (primary+mirror). Mocked DOs, no live network.
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
  const [x, y] = p.pub.split(".");
  const b64uToHex = (s) => {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
    return [...new Uint8Array(bin.length)].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
  };
  // use subtle export for correct hex
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return "04" + b64uToHex(jwk.x) + b64uToHex(jwk.y);
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

function makePool() {
  const primaryState = memState();
  const mirrorState = memState();
  const primary = new GDBxStorageObject(
    { storage: primaryState.storage, id: "primary", waitUntil() {} },
    {
      GDBX_MIRROR: {
        idFromName: () => ({ name: "mirror" }),
        get: async () => new GDBxMirrorObject({ storage: mirrorState.storage, id: "mirror", waitUntil() {} }, {}),
      },
      ROOT_PUBKEYS: "",
    }
  );
  const mirror = new GDBxMirrorObject({ storage: mirrorState.storage, id: "mirror", waitUntil() {} }, {});
  return { primary, mirror };
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
  const deltas = [{ key, value, clock: clock ?? t }];
  const { nonce, hash, diff } = await minePoW(a, p.pub, "sync.put", t);
  const sig = await cryptoSign({ addr: a, action: "sync.put", ts: t, payload: JSON.stringify(deltas) }, p);
  const req = new Request("https://do.local/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr: a, pubkey: p.pub, pubkeyHex: hex, deltas, ts: t, nonce, diff, hash, sig }),
  });
  return (await doObj.fetch(req)).json();
}

before(async () => {
  pair = await cryptoPair();
  pubkeyHex = await hexOf(pair);
  addr = makeAddress(pubkeyHex, 0);
});

test("org: AiA put aia/memory is visible to OS get via pool merge", async () => {
  const { primary, mirror } = makePool();
  await register(primary);
  // AiA writes memory
  const r = await put(primary, "aia/memory/session1", "learned: use GDBx pool", Date.now());
  assert.equal(r.ok, true);
  // OS reads same prefix (through pool merge)
  const req = new Request(`https://do.local/sync/${addr}?prefix=aia/memory`);
  const res = await primary.fetch(req);
  const data = await res.json();
  assert.equal(data.ok, true);
  const entry = data.entries.find((e) => e.key === "aia/memory/session1");
  assert.ok(entry, "OS should see AiA memory");
  assert.equal(entry.value, "learned: use GDBx pool");
  // mirror also has it (replication)
  const mRes = await mirror.fetch(new Request(`https://do.local/sync/${addr}?prefix=aia/memory`));
  const mData = await mRes.json();
  assert.equal(mData.entries.find((e) => e.key === "aia/memory/session1").value, "learned: use GDBx pool");
});

test("org: AiA vector + OS recall (brute-force cosine via kv)", async () => {
  const { primary } = makePool();
  await register(primary);
  // store two vectors as deltas (Python client does via put_vector -> kv)
  await put(primary, "aia/vectors/1", JSON.stringify({ text: "dark mode", vector: [1, 0, 0] }), Date.now());
  await put(primary, "aia/vectors/2", JSON.stringify({ text: "light mode", vector: [0, 1, 0] }), Date.now());
  const req = new Request(`https://do.local/sync/${addr}?prefix=aia/vectors/`);
  const res = await primary.fetch(req);
  const data = await res.json();
  assert.equal(data.count, 2);
  // simple recall: query [1,0,0] should match first
  const q = [1, 0, 0];
  function cosine(a, b) {
    const dot = a.reduce((s, v, i) => s + v * b[i], 0);
    const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    return dot / (na * nb);
  }
  let best = null, bestScore = -1;
  for (const e of data.entries) {
    const val = JSON.parse(e.value);
    const score = cosine(q, val.vector);
    if (score > bestScore) { bestScore = score; best = e; }
  }
  assert.equal(JSON.parse(best.value).text, "dark mode");
});
