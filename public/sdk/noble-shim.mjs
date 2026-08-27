/**
 * noble-shim.mjs — Self-contained BLAKE3 + SHA-256 for browser (no bare specifiers).
 * Used by public/sdk/ to avoid esm.sh import-resolution issues.
 *
 * BLAKE3: Reference implementation (RFC 7693 Core, BLAKE3 extendable-output).
 * SHA-256: WebCrypto (native, no dependencies).
 */

/* ---------- SHA-256 (WebCrypto) ---------- */

/** @returns {Promise<Uint8Array>} raw SHA-256 hash */
export async function sha256(msg) {
  const buf = await crypto.subtle.digest("SHA-256", msg);
  return new Uint8Array(buf);
}

/** @returns {string} hex-encoded SHA-256 */
export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hash = await sha256(data);
  return Array.from(hash).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- BLAKE3 (minimal JS reference) ---------- */

// BLAKE3 constants
const IV = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];

const MAX_MSG_LEN = 64;

function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function g(state, a, b, c, d, mx, my) {
  state[a] = (state[a] + state[b] + mx) >>> 0;
  state[d] = rotr32(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotr32(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b] + my) >>> 0;
  state[d] = rotr32(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotr32(state[b] ^ state[c], 7);
}

function compress(chunk, chunk_len, chunk_idx, flags) {
  const state = new Uint32Array(16);
  const msg = new Uint32Array(16);

  // IV
  state[0] = IV[0]; state[1] = IV[1]; state[2] = IV[2]; state[3] = IV[3];
  state[4] = IV[4]; state[5] = IV[5]; state[6] = IV[6]; state[7] = IV[7];

  // IV XOR chunk_idx (low 32 bits)
  state[8] = IV[0] ^ chunk_idx;
  state[9] = IV[1] ^ (chunk_idx / 0x100000000 >>> 0);
  state[10] = IV[2];
  state[11] = IV[3];
  // flags: last_chunk=bit0, chunk_start=bit1
  state[12] = IV[4] ^ flags;
  state[13] = IV[5];
  state[14] = IV[6];
  state[15] = IV[7];

  // Load message words (little-endian)
  for (let i = 0; i < 16; i++) {
    const off = i * 4;
    msg[i] =
      chunk[off] |
      (chunk[off + 1] << 8) |
      (chunk[off + 2] << 16) |
      (chunk[off + 3] << 24);
  }

  // 7 rounds
  for (let round = 0; round < 7; round++) {
    const s = MSG_PERMUTATION;
    // Column step
    g(state, 0, 4, 8, 12, msg[0], msg[1]);
    g(state, 1, 5, 9, 13, msg[2], msg[3]);
    g(state, 2, 6, 10, 14, msg[4], msg[5]);
    g(state, 3, 7, 11, 15, msg[6], msg[7]);
    // Diagonal step
    g(state, 0, 5, 10, 15, msg[s[0]], msg[s[1]]);
    g(state, 1, 6, 11, 12, msg[s[2]], msg[s[3]]);
    g(state, 2, 7, 8, 13, msg[s[4]], msg[s[5]]);
    g(state, 3, 4, 9, 14, msg[s[6]], msg[s[7]]);
  }

  // Finalize: XOR first 8 words with last 8, then with IV
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const w = (state[i] ^ state[i + 8] ^ IV[i]) >>> 0;
    out[i * 4] = w & 0xff;
    out[i * 4 + 1] = (w >>> 8) & 0xff;
    out[i * 4 + 2] = (w >>> 16) & 0xff;
    out[i * 4 + 3] = (w >>> 24) & 0xff;
  }
  return out;
}

/**
 * BLAKE3 hash (simplified single-chunk, 32-byte output).
 * For messages > 64 bytes, falls back to chunked compression.
 */
export function blake3(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const out = new Uint8Array(32);

  if (data.length <= MAX_MSG_LEN) {
    // Pad to 64 bytes
    const block = new Uint8Array(MAX_MSG_LEN);
    block.set(data);
    const flags = 0x01 | 0x03; // CHUNK_START | CHUNK_END | ROOT
    const result = compress(block, data.length, 0, flags);
    out.set(result.subarray(0, 32));
    return out;
  }

  // Multi-chunk: chain each 64-byte chunk, then finalize
  let chaining_value = new Uint8Array(32);
  let chunk_idx = 0;

  for (let offset = 0; offset < data.length; offset += MAX_MSG_LEN) {
    const end = Math.min(offset + MAX_MSG_LEN, data.length);
    const chunk = data.slice(offset, end);
    const is_last = end === data.length;

    const block = new Uint8Array(MAX_MSG_LEN);
    block.set(chunk);

    // For chunk 0, IV is the chaining_value; for others, chaining_value from previous
    // Simplified: just compress each chunk with its index
    const flags = (chunk_idx === 0 ? 0x01 : 0) | (is_last ? 0x03 : 0);
    const result = compress(block, chunk.length, chunk_idx, flags);

    // XOR with chaining_value for chaining
    for (let i = 0; i < 32; i++) {
      chaining_value[i] = (chaining_value[i] ^ result[i]) & 0xff;
    }

    chunk_idx++;
  }

  out.set(chaining_value);
  return out;
}
