/**
 * verify.js — GDBx write verification (pure Web Crypto: Workers / Node 18+ / browser).
 *
 * Every mutation to GDBx state (DID register, sync delta) is gated by:
 *   1. PoW  — SHA-256 difficulty (anti-spam, scaled by address length)
 *   2. SEA  — gun SEA v1 ECDSA P-256 signature by the address owner
 *
 * SEA envelope: "SEA" + JSON.stringify({m, s}) where m is the signed message
 * (object → canonical key-sorted JSON) and s a base64 ECDSA signature.
 * Public key: JWK-style `x.y` (two base64url coordinates, no padding).
 */

const ADDR_RE = /^[a-z2-7]{58}$/;

/** Max clock skew between client and server (ms) — replay window. */
export const TS_WINDOW_MS = 60_000;
/** Minimum nonce value accepted (0 is reserved). */
export const MIN_NONCE = 1;

/** Difficulty bracket for a .gdbx address: long (free) 2, mid 3, short 4. */
export function getDifficulty(input) {
  const len = String(input || "").length;
  if (len <= 4) return 4;
  if (len <= 8) return 3;
  return 2;
}

/** Canonical hash input — must match sdk/gdbx-sdk.js exactly. */
export function hashInput(addr, ownerPub, payload, ts, nonce) {
  return `${addr}:${ownerPub}:${payload}:${ts}:${nonce}`;
}

/** SHA-256 hex digest via Web Crypto (async, works everywhere). */
export async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a PoW claim.
 * @returns {{ok:boolean, error?:string}}
 */
export async function verifyPoW(claim) {
  if (!claim || typeof claim !== "object") return { ok: false, error: "claim required" };
  const addr = String(claim.addr || "").toLowerCase();
  if (!ADDR_RE.test(addr)) return { ok: false, error: "invalid .gdbx address" };
  const expected = getDifficulty(addr);
  const diff = typeof claim.diff === "number" ? claim.diff : expected;
  if (diff !== expected) return { ok: false, error: "difficulty mismatch" };
  const ownerPub = typeof claim.ownerPub === "string" ? claim.ownerPub : String(claim.ownerPub ?? "");
  const payload = typeof claim.payload === "string" ? claim.payload : String(claim.payload ?? "");
  const nonce = typeof claim.nonce === "number" ? claim.nonce : Number(claim.nonce);
  if (!Number.isFinite(nonce) || nonce < MIN_NONCE) return { ok: false, error: "invalid nonce" };
  const ts = typeof claim.ts === "number" ? claim.ts : Number(claim.ts);
  if (!Number.isFinite(ts)) return { ok: false, error: "invalid ts" };
  const hash = await sha256Hex(hashInput(addr, ownerPub, payload, ts, nonce));
  const prefix = "0".repeat(diff);
  if (!hash.startsWith(prefix)) return { ok: false, error: "proof-of-work not satisfied" };
  if (claim.hash && claim.hash !== hash) return { ok: false, error: "hash mismatch" };
  return { ok: true, hash };
}

/**
 * Anti-replay check: timestamp must be inside the sliding window and the
 * nonce must be fresh (caller keeps the seen-nonce set in the DO).
 * Returns { ok:false, error, status } on failure, { ok:true } on pass.
 */
export function checkReplay({ ts, nonce, seenNonces, now = Date.now() }) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    return { ok: false, error: "invalid timestamp", status: 400 };
  }
  if (typeof nonce !== "number" || !Number.isFinite(nonce) || nonce < MIN_NONCE) {
    return { ok: false, error: "invalid nonce", status: 400 };
  }
  if (Math.abs(now - ts) > TS_WINDOW_MS) {
    return { ok: false, error: "expired timestamp window — request rejected", status: 401 };
  }
  if (seenNonces.has(nonce)) {
    return { ok: false, error: "replay attack detected — nonce reused", status: 401 };
  }
  return { ok: true };
}

/** Canonical JSON string for message comparison — recursively key-sorted. */
export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/** base64 / base64url → Uint8Array (padding-tolerant). */
export function b64ToBytes(b64) {
  const s = String(b64).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verify a gun SEA v1 signature (ECDSA P-256 / SHA-256) with the bare public
 * key — the same verification SEA.verify performs client-side.
 *
 * @param {object} body   canonical message object (sig excluded)
 * @param {string} sig    SEA envelope: "SEA" + JSON.stringify({m, s})
 * @param {string} pub    SEA public key: base64url x . base64url y
 * @returns {Promise<boolean>}
 */
export async function verifySeaSig(body, sig, pub) {
  try {
    const raw = typeof sig === "string" && sig.slice(0, 4) === "SEA{" ? sig.slice(3) : sig;
    const env = JSON.parse(raw);
    if (!env || typeof env !== "object" || typeof env.s !== "string") return false;
    const mStr = typeof env.m === "string" ? env.m : JSON.stringify(env.m);
    if (canonicalJson(env.m) !== canonicalJson(body)) return false;

    const [x, y] = String(pub).split(".");
    if (!x || !y) return false;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x, y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mStr));
    const sigBytes = b64ToBytes(env.s);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes,
      hash,
    );
  } catch {
    return false;
  }
}

export default { getDifficulty, hashInput, sha256Hex, verifyPoW, canonicalJson, b64ToBytes, verifySeaSig };