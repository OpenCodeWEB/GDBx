// Seed .gdbx names — one-time (fresh identity to match fresh worker namespace)
import { sign, pair as cryptoPair } from "../sdk/gdbx-crypto.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { minePoW } from "../sdk/gdbx-sdk.js";

const API = "https://gdbx.xup.workers.dev";

async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function b64uToHex(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
  return [...bin].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
}

// Generate fresh identity
const p = await cryptoPair();
const [x, y] = p.pub.split(".");
const hex = "04" + b64uToHex(x) + b64uToHex(y);
const addr = makeAddress(hex);
const pair = { pub: p.pub, priv: p.priv };
console.log("identity:", addr);

// Register
let ts = Date.now();
let pw = await minePoW(addr, pair.pub, "did.register", ts);
let sig = await sign({ addr, action: "did.register", ts, payload: null }, pair);
let r = await fetch(API + "/did", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ addr, pubkey: pair.pub, pubkeyHex: hex, ts, nonce: pw.nonce, diff: pw.diff, hash: pw.hash, sig }),
});
console.log("register:", r.status);

// Claim names
const names = [
  ["absup", "https://absup.org"],
  ["docs", "https://gdbx.pages.dev/Api"],
  ["mesh", "https://gdbx.pages.dev/GlobalMesh"],
  ["gunx", "https://gunx.pages.dev"],
];

for (const [name, target] of names) {
  const diff = name.length <= 4 ? 4 : name.length <= 8 ? 3 : 2;
  const t = Date.now();
  const input = `${name}:${pair.pub}:${target}:${t}:`;
  let nonce = 1, hash = "";
  for (; nonce < 2000000; nonce++) {
    hash = await sha256Hex(input + nonce);
    if (hash.startsWith("0".repeat(diff))) break;
  }

  const body = { name, target, ownerPub: pair.pub, ts: t };
  const claimSig = await sign(body, pair);
  const claimValue = JSON.stringify({ ...body, nonce, diff, hash, sig: claimSig });

  const ts2 = Date.now();
  const pw2 = await minePoW(addr, pair.pub, "sync.put", ts2);
  const envSig = await sign({ addr, action: "sync.put", ts: ts2, payload: JSON.stringify([{ key: `tld/gdbx/${name}`, value: claimValue, clock: ts2 }]) }, pair);

  r = await fetch(API + "/sync", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr, pubkey: pair.pub, pubkeyHex: hex, deltas: [{ key: `tld/gdbx/${name}`, value: claimValue, clock: ts2 }], ts: ts2, nonce: pw2.nonce, diff: pw2.diff, hash: pw2.hash, sig: envSig }),
  });
  console.log(`${name}.gdbx → ${target}: ${r.status}`);
}

// Resolve checks
console.log("\nResolves:");
for (const [name] of names) {
  const rr = await fetch(`${API}/name/${name}`);
  const dd = await rr.json();
  console.log(`  ${name}.gdbx: ${rr.status} ${dd.ok ? "→ " + dd.target : dd.error}`);
}
