/**
 * test_name_registry.mjs — .gdbx Name Registry (claim → resolve, PoW + sig)
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { minePoW, sha256Hex } from "../sdk/gdbx-sdk.js";
import { GDBxStorageObject } from "../worker/src/GDBxStorageDO.js";
import { verifyClaim, getNameDifficulty } from "../sdk/gdbx-name.js";

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
    _store: store,
  };
}

function makeDO() {
  const st = memState();
  const inst = new GDBxStorageObject(
    { storage: st.storage, id: "t", waitUntil() {} },
    { GDBX_MIRROR: undefined, ROOT_PUBKEYS: "" },
  );
  return { inst, st };
}

async function register(inst) {
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "did.register", t);
  const sig = await cryptoSign({ addr, action: "did.register", ts: t, payload: null }, pair);
  await inst.fetch(new Request("https://do.local/did", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr, pubkey: pair.pub, pubkeyHex, ts: t, nonce, diff, hash, sig }),
  }));
}

/** Build a valid claim object (PoW + sig) without touching the pool. */
async function buildClaim(name, target) {
  const ts = Date.now();
  const diff = getNameDifficulty(name);
  const input = `${name}:${pair.pub}:${String(target)}:${ts}:`;
  let nonce = 1, hash = "";
  for (; nonce < 2_000_000; nonce++) {
    hash = await sha256Hex(input + nonce);
    if (hash.startsWith("0".repeat(diff))) break;
  }
  const body = { name, target: String(target), ownerPub: pair.pub, ts };
  const sig = await cryptoSign(body, pair);
  return { ...body, nonce, diff, hash, sig };
}

before(async () => {
  pair = await cryptoPair();
  pubkeyHex = await hexOf(pair);
  addr = makeAddress(pubkeyHex, 0);
});

test("names: difficulty bracket by length (short=harder)", () => {
  assert.equal(getNameDifficulty("ab"), 4);
  assert.equal(getNameDifficulty("abcdef"), 3);
  assert.equal(getNameDifficulty("abcdefghij"), 2);
});

test("names: verifyClaim accepts a well-mined claim", async () => {
  const claim = await buildClaim("myapp", "https://myapp.dev");
  const res = await verifyClaim(claim);
  assert.equal(res.ok, true, res.error);
});

test("names: verifyClaim rejects bad PoW / tampered target", async () => {
  const claim = await buildClaim("tamper", "https://good.dev");
  const bad = { ...claim, target: "https://evil.dev" };
  const res = await verifyClaim(bad);
  assert.equal(res.ok, false);
});

test("names: worker /name/:name resolves verified claim end-to-end", async () => {
  const { inst } = makeDO();
  await register(inst);

  // put the claim into the pool via standard signed sync
  const claim = await buildClaim("myapp", "https://myapp.dev");
  const key = `tld/gdbx/myapp`;
  const value = JSON.stringify(claim);
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign({ addr, action: "sync.put", ts: t, payload: JSON.stringify([{ key, value, clock: t }]) }, pair);
  const putRes = await inst.fetch(new Request("https://do.local/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr, pubkey: pair.pub, pubkeyHex, deltas: [{ key, value, clock: t }], ts: t, nonce, diff, hash, sig }),
  }));
  assert.equal(putRes.status, 200);

  // resolve through the public route
  const res = await inst.fetch(new Request("https://do.local/name/myapp"));
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.name, "myapp");
  assert.equal(data.target, "https://myapp.dev");
});

test("names: worker rejects unverified claim (bad sig)", async () => {
  const { inst } = makeDO();
  await register(inst);
  const claim = await buildClaim("evilapp", "https://evil.dev");
  claim.sig = "GDBx{\"m\":\"x\",\"s\":\"AAAA\"}";
  const key = "tld/gdbx/evilapp";
  const t = Date.now();
  const { nonce, hash, diff } = await minePoW(addr, pair.pub, "sync.put", t);
  const sig = await cryptoSign({ addr, action: "sync.put", ts: t, payload: JSON.stringify([{ key, value: JSON.stringify(claim), clock: t }]) }, pair);
  await inst.fetch(new Request("https://do.local/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr, pubkey: pair.pub, pubkeyHex, deltas: [{ key, value: JSON.stringify(claim), clock: t }], ts: t, nonce, diff, hash, sig }),
  }));
  const res = await inst.fetch(new Request("https://do.local/name/evilapp"));
  // 403 = claim landed but sig invalid; 404 = sync rejected before landing.
  // Both are correct rejections of the unverified claim.
  assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);
  const data = await res.json();
  assert.match(data.error || "", /signature|not found/i);
});
