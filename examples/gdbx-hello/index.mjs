#!/usr/bin/env node
// GDBx Hello — JS (works against live worker or mock)
// Usage: node examples/gdbx-hello/index.mjs [--live]
import { pair } from "../../sdk/gdbx-crypto.js";
import { makeAddress } from "../../sdk/gdbx-codec.js";
import { minePow, registerDid, putDeltas, getDeltas } from "../../sdk/gdbx-sdk.js";

const LIVE = process.argv.includes("--live");
const API = LIVE ? "https://gdbx-do.xup.workers.dev" : null;

async function hexOf(p) {
  const [x, y] = p.pub.split(".");
  const b64uToHex = (s) => {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
    return [...bin].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
  };
  return "04" + b64uToHex(x) + b64uToHex(y);
}

async function main() {
  const p = await pair();
  const hex = await hexOf(p);
  const addr = makeAddress(hex);
  console.log(`Generated .GDBx: ${addr}.gdbx`);
  console.log(`DID: did:gdbx:${addr}`);
  if (!LIVE) {
    console.log("(mock mode — add --live to hit worker)");
    console.log("GDBx is ready. Copy this address to AiA/OS as GDBX_ADDR.");
    return;
  }
  // live: register + put + get
  const { default: sdk } = await import("../../sdk/gdbx-sdk.js");
  // hack: override API for live? sdk uses pages.dev proxy, but we want direct worker
  // For demo, call worker directly via fetch
  console.log("Registering DID on live worker...");
  // use sdk's internal? simplified: direct fetch
  const ts = Date.now();
  const { minePoW } = await import("../../sdk/gdbx-sdk.js");
  const { sign } = await import("../../sdk/gdbx-crypto.js");
  const pow = await minePoW(addr, p.pub, "did.register", ts);
  const sig = await sign({ addr, action: "did.register", ts, payload: null }, p);
  const reg = await fetch(`https://gdbx-do.xup.workers.dev/did`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addr, pubkey: p.pub, pubkeyHex: hex, ts, nonce: pow.nonce, diff: pow.diff, hash: pow.hash, sig }),
  });
  console.log("register:", reg.status, await reg.text().then((t) => t.slice(0,200)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
