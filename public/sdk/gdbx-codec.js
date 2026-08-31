/**
 * gdbx-codec.js — `.GDBx` address codec (pure ESM, browser+worker+node).
 *
 * Format (single GDBx network — simple for developers):
 *
 *   payload    = Version(1B) + PubKeyHash(32B) + Checksum(2B)
 *   Checksum   = BLAKE3(Version + PubKeyHash)[0..2]
 *   Address    = base32(payload) + ".gdbx"
 *
 *   Version byte: 0x01
 *   PubKeyHash  : 32 bytes — SHA-256(uncompressed P-256 public key point)
 *   Checksum    : first 2 bytes of BLAKE3 — typo/forgery detection (like onion v3)
 *
 *   Length: 35B payload → 56 base32 chars (RFC4648, lowercase, no padding) + ".gdbx"
 *   DID    : did:gdbx:<56-char-address>
 *   Note: Legacy 58-char addresses (Version+Network+Hash+Checksum, 36B) are still
 *         validated for backward compat, but new addresses are always 56-char single network.
 */

import { blake3 } from "https://esm.sh/@noble/hashes@1.7.0/blake3.js";
import { sha256 } from "https://esm.sh/@noble/hashes@1.7.0/sha2.js";

export const SUFFIX = "gdbx";
export const VERSION = 0x01;
// Single GDBx network — no mainnet/testnet/local split, easy for developers
export const NETWORKS = { gdbx: 0x00 };
export const NETWORK_NAMES = { 0x00: "gdbx" };
// Legacy constants for backward compat validation (old 58-char addresses)
export const LEGACY_ADDR_LEN = 58;
export const ADDR_LEN = 56; // base32 chars, no padding — single network
export const FULL_LEN = ADDR_LEN + 1 + SUFFIX.length; // 61 with ".gdbx"

const B32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const B32_REVERSE = (() => {
  const m = {};
  for (let i = 0; i < B32_ALPHABET.length; i++) m[B32_ALPHABET[i]] = i;
  return m;
})();
const ADDR_RE = /^[a-z2-7]{56}$/;
const LEGACY_ADDR_RE = /^[a-z2-7]{58}$/;
const FULL_RE = /^[a-z2-7]{56}\.gdbx$/;
const LEGACY_FULL_RE = /^[a-z2-7]{58}\.gdbx$/;

/* ── base32 (RFC 4648, lowercase, no padding) ─────────────────────── */

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toLowerCase().replace(/[^a-z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32_REVERSE[ch];
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/* ── pubkey hash ──────────────────────────────────────────────────── */

/**
 * Hash an uncompressed P-256 public key point (65 bytes: 0x04||X||Y)
 * to the 32-byte PubKeyHash used in the address.
 * Accepts: Uint8Array(65) · {x, y} as 32-byte arrays · hex string (130 chars)
 */
export function pubKeyHash(pubkey) {
  let bytes;
  if (pubkey instanceof Uint8Array) bytes = pubkey;
  else if (typeof pubkey === "string") {
    const hex = pubkey.replace(/^0x/i, "");
    bytes = Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
  } else if (pubkey && pubkey.x && pubkey.y) {
    const x = normalize32(pubkey.x);
    const y = normalize32(pubkey.y);
    bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    bytes.set(x, 1);
    bytes.set(y, 33);
  } else {
    throw new Error("pubkey must be Uint8Array(65), hex string, or {x,y}");
  }
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error("pubkey must be an uncompressed P-256 point (65 bytes, 0x04 prefix)");
  }
  return sha256(bytes);
}

function normalize32(v) {
  if (v instanceof Uint8Array) {
    if (v.length === 32) return v;
    const out = new Uint8Array(32);
    out.set(v.slice(0, 32));
    return out;
  }
  const hex = String(v).replace(/^0x/i, "");
  const bytes = Uint8Array.from(hex.padStart(64, "0").match(/../g) || [], (h) => parseInt(h, 16));
  return bytes;
}

/* ── address ──────────────────────────────────────────────────────── */

/** Make a `.gdbx` address from a public key. Returns WITHOUT suffix. Single GDBx network. */
export function makeAddress(pubkey, _network) {
  const hash = pubKeyHash(pubkey);
  const payload = new Uint8Array(1 + 32 + 2);
  payload[0] = VERSION;
  payload.set(hash, 1);
  const checksum = blake3(payload.subarray(0, 33)).subarray(0, 2);
  payload.set(checksum, 33);
  return base32Encode(payload);
}

/** Full validation — returns { ok } or { ok:false, error }. Supports new 56-char and legacy 58-char. */
export function validateAddress(input) {
  if (typeof input !== "string") return { ok: false, error: "address must be a string" };
  const str = input.trim().toLowerCase();
  if (FULL_RE.test(str)) return validatePayload(base32Decode(str.slice(0, ADDR_LEN)));
  if (ADDR_RE.test(str)) return validatePayload(base32Decode(str));
  // Legacy 58-char backward compat
  if (LEGACY_FULL_RE.test(str)) return validatePayload(base32Decode(str.slice(0, LEGACY_ADDR_LEN)));
  if (LEGACY_ADDR_RE.test(str)) return validatePayload(base32Decode(str));
  return {
    ok: false,
    error: `invalid .gdbx address — expected 56 base32 chars (a-z2-7)${SUFFIX ? " + '.gdbx'" : ""}`,
  };
}

function validatePayload(payload) {
  // New single-network: 35B payload (Version + Hash + Checksum)
  if (payload.length === 35) {
    if (payload[0] !== VERSION) return { ok: false, error: `unsupported version ${payload[0]}` };
    const expect = blake3(payload.subarray(0, 33)).subarray(0, 2);
    if (payload[33] !== expect[0] || payload[34] !== expect[1]) {
      return { ok: false, error: "checksum mismatch — address is invalid or corrupted" };
    }
    return { ok: true };
  }
  // Legacy 36B (Version + Network + Hash + Checksum)
  if (payload.length === 36) {
    if (payload[0] !== VERSION) return { ok: false, error: `unsupported version ${payload[0]}` };
    const expect = blake3(payload.subarray(0, 34)).subarray(0, 2);
    if (payload[34] !== expect[0] || payload[35] !== expect[1]) {
      return { ok: false, error: "checksum mismatch — address is invalid or corrupted" };
    }
    return { ok: true };
  }
  return { ok: false, error: "decoded length must be 35 or 36 bytes" };
}

/** Normalize user input → canonical lowercase form (with or without suffix input). */
export function normalizeAddress(input) {
  const str = String(input || "").trim().toLowerCase();
  const bare = str.endsWith(`.${SUFFIX}`) ? str.slice(0, -SUFFIX.length - 1) : str;
  const v = validateAddress(bare);
  if (!v.ok) return null;
  return bare;
}

export function networkOf(input) {
  const bare = normalizeAddress(input);
  if (!bare) return null;
  const payload = base32Decode(bare);
  // Single GDBx network — always "gdbx"
  if (payload.length === 35) return "gdbx";
  if (payload.length === 36) {
    const legacyNames = { 0x00: "gdbx", 0x01: "gdbx", 0x02: "gdbx" };
    return legacyNames[payload[1]] || "gdbx";
  }
  return null;
}

export function versionOf(input) {
  const bare = normalizeAddress(input);
  if (!bare) return null;
  return base32Decode(bare)[0];
}

export function toDID(address) {
  const bare = normalizeAddress(address);
  return bare ? `did:gdbx:${bare}` : null;
}

export default { makeAddress, validateAddress, normalizeAddress, networkOf, versionOf, toDID, SUFFIX, NETWORKS };