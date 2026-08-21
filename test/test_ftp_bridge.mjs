import { test } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair } from "../sdk/gdbx-crypto.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { GDBxFTP } from "../sdk/ftp_bridge.js";

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

function mockStore() {
  const store = new Map();
  return {
    async putDeltas({ deltas }) {
      for (const d of deltas) store.set(d.key, { key: d.key, value: d.value });
      return { ok: true };
    },
    async getDeltas(addr, prefix) {
      const entries = [];
      for (const [k, v] of store) {
        if (k.startsWith(prefix)) entries.push(v);
        // also handle exact key: prefix is key
        if (k === prefix) entries.push(v);
      }
      // also handle when prefix is exact key, our store keys are like sys/ftp/manifest/...
      // getDeltas in real impl does prefix search, so we simulate
      const all = [];
      for (const [k, v] of store) {
        if (k.startsWith(prefix)) all.push(v);
      }
      // dedup
      const uniq = new Map();
      for (const e of [...entries, ...all]) uniq.set(e.key, e);
      return { ok: true, entries: [...uniq.values()] };
    },
    _store: store,
  };
}

test("ftp: put/get roundtrip small file", async () => {
  const p = await cryptoPair();
  const hex = await hexOf(p);
  const addr = makeAddress(hex);
  const mock = mockStore();
  const ftp = new GDBxFTP({ pair: p, pubkeyHex: hex, addr, putDeltas: mock.putDeltas.bind(mock), getDeltas: mock.getDeltas.bind(mock) });
  const data = new TextEncoder().encode("hello ftp via GDBx");
  await ftp.put(data, "/test.txt");
  const out = await ftp.get("/test.txt");
  assert.deepEqual(out, data);
});

test("ftp: put/get large file 500KB (chunked)", async () => {
  const p = await cryptoPair();
  const hex = await hexOf(p);
  const addr = makeAddress(hex);
  const mock = mockStore();
  const ftp = new GDBxFTP({ pair: p, pubkeyHex: hex, addr, putDeltas: mock.putDeltas.bind(mock), getDeltas: mock.getDeltas.bind(mock) });
  const size = 500 * 1024;
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = i % 256;
  await ftp.put(data, "/large.bin");
  const out = await ftp.get("/large.bin");
  assert.deepEqual(out, data);
  // check manifest chunks count
  const ls = await ftp.ls("/");
  assert.ok(ls.length >= 1);
  const m = ls.find((e) => e.key.endsWith("/large.bin"));
  assert.ok(m);
  assert.equal(m.manifest.chunks.length, 2); // 500KB /256KB = 2
});

test("ftp: connect ftp://<addr>.gdbx", async () => {
  const p = await cryptoPair();
  const hex = await hexOf(p);
  const ftp = new GDBxFTP({ pair: p, pubkeyHex: hex });
  const res = await ftp.connect(`ftp://${makeAddress(hex)}.gdbx`);
  assert.equal(res.status, "CONNECTED");
});

test("ftp: ls and sync", async () => {
  const p = await cryptoPair();
  const hex = await hexOf(p);
  const addr = makeAddress(hex);
  const mock = mockStore();
  const ftp = new GDBxFTP({ pair: p, pubkeyHex: hex, addr, putDeltas: mock.putDeltas.bind(mock), getDeltas: mock.getDeltas.bind(mock) });
  await ftp.put(new TextEncoder().encode("a"), "/a.txt");
  await ftp.put(new TextEncoder().encode("b"), "/b.txt");
  const list = await ftp.ls("/");
  assert.equal(list.length, 2);
  let syncCalled = 0;
  const unsub = await ftp.sync("/", () => syncCalled++);
  await new Promise((r) => setTimeout(r, 3500));
  unsub();
  assert.ok(syncCalled >= 2);
});
