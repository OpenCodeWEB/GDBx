/**
 * chunker.js — Sovereign FTP chunker for GDBx (Gemini Top 1, Priority 1)
 *
 * Splits file data into encrypted, BLAKE3-hashed chunks for GDBx pool/R2.
 * Uses WebCrypto AES-GCM (256-bit) + @noble/hashes blake3.
 * Works in browser, Node 20+, and Workers (globalThis.crypto.subtle).
 *
 * Manifest shape (stored as GDBx delta at sys/ftp/manifest/<filepath_hash>):
 * {
 *   path: "/docs/paper.pdf",
 *   size: 10485760,
 *   chunks: ["b3hash1","b3hash2", ...], // BLAKE3 hex of encrypted chunk
 *   iv: "base64url(12B iv)",
 *   keyB64: "base64url(32B raw key)",
 *   hash: "b3hash(manifest_without_hash)"
 * }
 */

import { blake3 } from "@noble/hashes/blake3.js";

export function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64ToBytes(b64) {
  const s = String(b64).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function blake3Hex(data) {
  return Array.from(blake3(data)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256KB like GunX's adaptive 64-256KB

export async function process(fileData, opts = {}) {
  const chunkSize = opts.chunkSize || DEFAULT_CHUNK_SIZE;
  const data = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
  const size = data.length;

  // per-file random key + iv
  const keyRaw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

  const encryptedChunks = [];
  const chunkHashes = [];

  for (let offset = 0; offset < size; offset += chunkSize) {
    const chunk = data.slice(offset, Math.min(offset + chunkSize, size));
    // Use iv + chunk index as additional data to avoid reuse (like GunX's chunk index)
    const ivWithIndex = new Uint8Array(12);
    ivWithIndex.set(iv, 0);
    // XOR last 4 bytes with chunk index (little endian)
    const idx = Math.floor(offset / chunkSize);
    ivWithIndex[8] ^= idx & 0xff;
    ivWithIndex[9] ^= (idx >> 8) & 0xff;
    ivWithIndex[10] ^= (idx >> 16) & 0xff;
    ivWithIndex[11] ^= (idx >> 24) & 0xff;

    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivWithIndex }, key, chunk);
    const encBytes = new Uint8Array(encrypted);
    const hash = blake3Hex(encBytes);
    encryptedChunks.push(encBytes);
    chunkHashes.push(hash);
  }

  // handle empty file
  if (encryptedChunks.length === 0) {
    const emptyEnc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(0));
    const encBytes = new Uint8Array(emptyEnc);
    encryptedChunks.push(encBytes);
    chunkHashes.push(blake3Hex(encBytes));
  }

  const manifestWithoutHash = {
    path: opts.path || "/unnamed",
    size,
    chunks: chunkHashes,
    iv: bytesToB64url(iv),
    keyB64: bytesToB64url(keyRaw),
  };
  const manifestHash = blake3Hex(new TextEncoder().encode(JSON.stringify(manifestWithoutHash)));
  const manifest = { ...manifestWithoutHash, hash: manifestHash };

  return { manifest, encryptedChunks, iv, keyB64: manifest.keyB64, chunkHashes };
}

export async function assemble(encryptedChunks, ivB64, keyB64) {
  const iv = b64ToBytes(ivB64);
  const keyRaw = b64ToBytes(keyB64);
  const key = await crypto.subtle.importKey("raw", keyRaw, { name: "AES-GCM" }, false, ["decrypt"]);
  const outParts = [];
  for (let i = 0; i < encryptedChunks.length; i++) {
    const enc = encryptedChunks[i];
    const ivWithIndex = new Uint8Array(12);
    ivWithIndex.set(iv, 0);
    ivWithIndex[8] ^= i & 0xff;
    ivWithIndex[9] ^= (i >> 8) & 0xff;
    ivWithIndex[10] ^= (i >> 16) & 0xff;
    ivWithIndex[11] ^= (i >> 24) & 0xff;
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivWithIndex }, key, enc);
    outParts.push(new Uint8Array(decrypted));
  }
  const total = outParts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of outParts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function verifyChunk(encryptedChunk, expectedHash) {
  return blake3Hex(encryptedChunk) === expectedHash;
}

export default { process, assemble, verifyChunk, bytesToB64url, b64ToBytes, blake3Hex };
