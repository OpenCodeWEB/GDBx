/**
 * gdbx-crypto.js — GDBx self-sovereign crypto core (zero runtime dependencies).
 *
 * Pure Web Crypto (browser / Node 20+ / Cloudflare Workers). No gun, no SEA
 * package, no third-party runtime deps — the whole identity/signature layer
 * is owned by GDBx.
 *
 * Signature envelope (GDBx):
 *   "GDBx" + JSON.stringify({ m, s })
 *   m = canonical key-sorted JSON of the signed body
 *   s = base64url raw ECDSA P-256 / SHA-256 signature
 *
 * Public key format: `x.y` — two base64url EC point coordinates (no padding),
 * compatible with the SEA public key shape so legacy pubkeys keep working.
 *
 * verifyCompat() also accepts legacy SEA v1 envelopes
 * ("SEA" + JSON.stringify({m, s})) for backward compatibility with clients
 * that were built on gun/sea before GDBx went self-sovereign.
 */

/* ── canonical JSON (must match worker/src/verify.js) ─────────────────── */

export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/* ── encoding helpers ─────────────────────────────────────────────────── */

/** bytes → base64url (no padding) */
export function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64 / base64url → Uint8Array (padding-tolerant) */
export function b64ToBytes(b64) {
  const s = String(b64).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── WebCrypto helpers ────────────────────────────────────────────────── */

function subtle() {
  return globalThis.crypto?.subtle;
}

async function sha256Hex(input) {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ── identity ─────────────────────────────────────────────────────────── */

/**
 * Generate an ECDSA P-256 key pair.
 * @returns {Promise<{pub: string, priv: string}>} priv = base64url raw private
 *   key bytes; pub = `x.y` base64url coordinates (SEA-shape compatible).
 */
export async function pair() {
  const keyPair = await subtle().generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await subtle().exportKey("jwk", keyPair.privateKey);
  const privBytes = b64ToBytes(jwk.d);
  const pub = `${jwk.x}.${jwk.y}`;
  const priv = bytesToB64url(privBytes);
  return { pub, priv };
}

/**
 * Rebuild { pub, priv } from a stored JSON bundle (jwk private key).
 * @param {string} json  JSON of { pub, privJwk } as produced by exportPair()
 */
export function restorePair(json) {
  const { pub, privJwk } = JSON.parse(json);
  return { pub, privJwk };
}

/**
 * Serialize a pair for durable storage.
 * @returns {Promise<string>} JSON of { pub, privJwk }
 */
export async function exportPair(p) {
  const jwk = typeof p.privJwk === "object" ? p.privJwk : JSON.parse(p.privJwk);
  return JSON.stringify({ pub: p.pub, privJwk: jwk });
}

/**
 * Build a CryptoKey pair from either { priv } (compact) or { privJwk } (full).
 * To keep the module self-contained we always re-import from JWK.
 */
async function signKey(pair) {
  let jwk;
  if (pair.privJwk) {
    jwk = typeof pair.privJwk === "string" ? JSON.parse(pair.privJwk) : pair.privJwk;
  } else {
    // compact priv (raw d) — reconstruct x/y from the public coordinate
    const [x, y] = String(pair.pub).split(".");
    jwk = { kty: "EC", crv: "P-256", x, y, d: bytesToB64url(b64ToBytes(pair.priv)) };
  }
  return await subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/* ── signing ──────────────────────────────────────────────────────────── */

/**
 * Sign a canonical body with GDBx envelope.
 * @param {object} body  message object (key order irrelevant — canonicalized)
 * @param {{pub:string, priv?:string, privJwk?:object|string}} keyPair
 * @returns {Promise<string>} "GDBx" + JSON.stringify({m, s})
 */
export async function sign(body, keyPair) {
  const m = canonicalJson(body);
  const key = await signKey(keyPair);
  const hash = await subtle().digest("SHA-256", new TextEncoder().encode(m));
  const rawSig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, hash);
  return "GDBx" + JSON.stringify({ m, s: bytesToB64url(new Uint8Array(rawSig)) });
}

/**
 * Verify a GDBx envelope (pure).
 * @param {object} body  the expected canonical message
 * @param {string} sig   "GDBx" envelope
 * @param {string} pub   `x.y` base64url public key
 * @returns {Promise<boolean>}
 */
export async function verify(body, sig, pub) {
  try {
    if (typeof sig !== "string" || !sig.startsWith("GDBx")) return false;
    const env = JSON.parse(sig.slice(5));
    if (!env || typeof env !== "object" || typeof env.s !== "string") return false;
    // GDBx stores m as canonical string; legacy shapes may store the object
    const mStr = typeof env.m === "string" ? env.m : canonicalJson(env.m);
    if (mStr !== canonicalJson(body)) return false;

    const [x, y] = String(pub).split(".");
    if (!x || !y) return false;
    const key = await subtle().importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x, y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const hash = await subtle().digest("SHA-256", new TextEncoder().encode(mStr));
    return await subtle().verify({ name: "ECDSA", hash: "SHA-256" }, key, b64ToBytes(env.s), hash);
  } catch {
    return false;
  }
}

/**
 * Verify GDBx OR legacy SEA v1 envelope (backward compatible).
 * @param {object} body
 * @param {string} sig
 * @param {string} pub
 * @returns {Promise<boolean>}
 */
export async function verifyCompat(body, sig, pub) {
  if (typeof sig === "string" && sig.startsWith("GDBx")) return verify(body, sig, pub);
  // legacy SEA v1: "SEA" + JSON.stringify({m, s})
  try {
    const raw = typeof sig === "string" && sig.slice(0, 4) === "SEA{" ? sig.slice(3) : sig;
    const env = JSON.parse(raw);
    if (!env || typeof env !== "object" || typeof env.s !== "string") return false;
    const mStr = typeof env.m === "string" ? env.m : canonicalJson(env.m);
    if (mStr !== canonicalJson(body)) return false;

    const [x, y] = String(pub).split(".");
    if (!x || !y) return false;
    const key = await subtle().importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x, y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const hash = await subtle().digest("SHA-256", new TextEncoder().encode(mStr));
    return await subtle().verify({ name: "ECDSA", hash: "SHA-256" }, key, b64ToBytes(env.s), hash);
  } catch {
    return false;
  }
}

/* ── body builder (mirrors sdk signBody usage) ────────────────────────── */

/** Canonical request body for worker-compatible signatures. */
export function signBody(addr, action, ts, payload) {
  return { addr, action, ts, payload };
}

export default { pair, restorePair, exportPair, sign, verify, verifyCompat, canonicalJson, signBody, bytesToB64url, b64ToBytes, sha256Hex };