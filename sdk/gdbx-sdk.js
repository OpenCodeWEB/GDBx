/**
 * gdbx-sdk.js — GDBx client SDK (pure ESM, browser + Node 18+).
 *
 *   makePair()            → SEA pair {pub, priv} (P-256)
 *   minePoW(addr, pub, payload, ts, diff) → {nonce, hash}
 *   registerDID(...)      → POST /api/v1/did/register
 *   resolveDID(addr)      → GET  /api/v1/did/:addr
 *   putDeltas(...)        → POST /api/v1/sync  (signed CRDT batch)
 *   getDeltas(addr, prefix) → GET /api/v1/sync/:addr?prefix=
 *   heartbeat(...)        → POST /api/v1/peers
 *   stats()               → GET  /api/v1/stats
 *
 * Every write is signed with SEA (ECDSA P-256) and gated by PoW — the
 * exact same rules enforced server-side in worker/src/verify.js.
 */

import { makeAddress, validateAddress, normalizeAddress, toDID } from "./gdbx-codec.js";

export const API = "https://gdbx.pages.dev/api/v1";

/* ── PoW (mirror of worker/src/verify.js) ────────────────────────── */

export function getDifficulty(addr) {
  const len = String(addr || "").length;
  if (len <= 4) return 4;
  if (len <= 8) return 3;
  return 2;
}

export function hashInput(addr, ownerPub, payload, ts, nonce) {
  return `${addr}:${ownerPub}:${payload}:${ts}:${nonce}`;
}

export async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function minePoW(addr, ownerPub, payload, ts, diff) {
  const required = diff ?? getDifficulty(addr);
  const prefix = "0".repeat(required);
  let nonce = 0;
  for (;;) {
    const h = await sha256Hex(hashInput(addr, ownerPub, payload, ts, nonce));
    if (h.startsWith(prefix)) return { nonce, hash: h, diff: required };
    nonce += 1;
    if (nonce > 5_000_000) throw new Error("PoW timeout");
  }
}

/* ── SEA helpers ─────────────────────────────────────────────────── */

let _SEA = null;
async function sea() {
  if (!_SEA) _SEA = (await import("gun/sea.js")).default;
  return _SEA;
}

export async function makePair() {
  const SEA = await sea();
  const pair = await SEA.pair();
  return { pub: pair.pub, priv: pair.priv, epub: pair.epub, epriv: pair.epriv };
}

/** Canonical message object a signature covers (key order matters for SEA). */
export function signBody(addr, action, ts, payload) {
  return { addr, action, ts, payload };
}

/* ── HTTP ────────────────────────────────────────────────────────── */

async function post(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Public API ──────────────────────────────────────────────────── */

/** Generate a .gdbx address from a hex pubkey (uncompressed P-256). */
export function addressFromPubkey(pubkeyHex, network = 0) {
  return makeAddress(pubkeyHex, network);
}

/**
 * Register a DID document.
 * @param {object} opts { pubkeyHex, pair, services?, didDoc? }
 * @returns {Promise<{ok, did, created}>}
 */
export async function registerDID(opts) {
  const addr = addressFromPubkey(opts.pubkeyHex);
  const SEA = await sea();
  const ts = Date.now();
  const payload = opts.didDoc || null;
  const { nonce, hash, diff } = await minePoW(addr, opts.pair.pub, "did.register", ts);
  const sig = await SEA.sign(signBody(addr, "did.register", ts, payload), opts.pair);
  return post("/did/register", {
    addr,
    pubkey: opts.pair.pub,
    pubkeyHex: opts.pubkeyHex,
    didDoc: payload,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
}

export async function resolveDID(addr) {
  const bare = normalizeAddress(addr);
  const res = await fetch(`${API}/did/${bare}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Apply signed CRDT deltas.
 * @param {object} opts { pubkeyHex, pair, deltas: [{key, value, clock?}] }
 */
export async function putDeltas(opts) {
  const addr = addressFromPubkey(opts.pubkeyHex);
  const SEA = await sea();
  const ts = Date.now();
  const deltas = opts.deltas.map((d) => ({ key: d.key, value: d.value, clock: d.clock ?? ts }));
  const payload = JSON.stringify(deltas);
  const { nonce, hash, diff } = await minePoW(addr, opts.pair.pub, "sync.put", ts);
  const sig = await SEA.sign(signBody(addr, "sync.put", ts, payload), opts.pair);
  return post("/sync", {
    addr,
    pubkey: opts.pair.pub,
    pubkeyHex: opts.pubkeyHex,
    deltas,
    ts,
    nonce,
    diff,
    hash,
    sig,
  });
}

export async function getDeltas(addr, prefix = "") {
  const bare = normalizeAddress(addr);
  const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  const res = await fetch(`${API}/sync/${bare}${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function heartbeat(opts) {
  return post("/peers", {
    addr: addressFromPubkey(opts.pubkeyHex),
    pubkey: opts.pair.pub,
    transports: opts.transports || [],
    latencyMs: opts.latencyMs ?? null,
  });
}

export async function stats() {
  const res = await fetch(`${API}/stats`);
  return res.json();
}

export default {
  API,
  makePair,
  makeAddress,
  validateAddress,
  normalizeAddress,
  toDID,
  getDifficulty,
  minePoW,
  addressFromPubkey,
  registerDID,
  resolveDID,
  putDeltas,
  getDeltas,
  heartbeat,
  stats,
};