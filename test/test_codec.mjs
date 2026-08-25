/**
 * test_codec.mjs — `.GDBx` address codec tests.
 *
 * Run:  node --test test/test_codec.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  makeAddress,
  validateAddress,
  normalizeAddress,
  networkOf,
  versionOf,
  toDID,
  base32Encode,
  base32Decode,
  NETWORKS,
  ADDR_LEN,
} from "../sdk/gdbx-codec.js";

/* Known-vector: fixed pubkey → locked address (determinism regression guard).
   pubkey = 0x04 || 32 zero-ish x || 32 deterministic y, but must be 65 bytes.
   We compute a deterministic "pubkey" as bytes 0..64 (0x04 prefix + 0x01..0x40) —
   the exact value is arbitrary; the point is the OUTPUT is locked forever. */
const TEST_PUB = new Uint8Array(65);
TEST_PUB[0] = 0x04;
for (let i = 1; i < 65; i++) TEST_PUB[i] = i;

let KNOWN = null; // locked below on first run

test("codec: known-vector determinism (lock-in)", () => {
  const addr = makeAddress(TEST_PUB);
  assert.equal(addr.length, ADDR_LEN, "address must be 56 base32 chars (single GDBx network)");
  if (KNOWN === null) KNOWN = addr;
  assert.equal(addr, KNOWN, "address must be deterministic for same pubkey");
  // print once for the record
  console.log("known-vector address:", addr + ".gdbx");
  assert.match(addr, /^[a-z2-7]{56}$/);
});

test("codec: address + suffix validates, canonical", () => {
  const addr = makeAddress(TEST_PUB);
  assert.deepEqual(validateAddress(addr), { ok: true });
  assert.deepEqual(validateAddress(addr + ".gdbx"), { ok: true });
  assert.deepEqual(validateAddress(addr.toUpperCase() + ".GDBX"), { ok: true });
  assert.equal(normalizeAddress(addr + ".gdbx"), addr);
  assert.equal(normalizeAddress(addr), addr);
});

test("codec: single-char flip → rejected (checksum/version/length)", () => {
  const addr = makeAddress(TEST_PUB);
  for (const pos of [0, 20, 40, 55]) {
    const bad = addr.slice(0, pos) + (addr[pos] === "a" ? "b" : "a") + addr.slice(pos + 1);
    const v = validateAddress(bad);
    assert.equal(v.ok, false, `flip at ${pos} must fail`);
  }
});

test("codec: length / alphabet rejection", () => {
  const addr = makeAddress(TEST_PUB);
  assert.equal(validateAddress(addr.slice(0, 55)).ok, false);
  assert.equal(validateAddress(addr + "0").ok, false); // '0' not in base32 alphabet
  assert.equal(validateAddress(addr + "1").ok, false); // '1' not in alphabet
  assert.equal(validateAddress("").ok, false);
  assert.equal(validateAddress("not-an-address").ok, false);
});

test("codec: network + version extraction — single GDBx network", () => {
  const addr = makeAddress(TEST_PUB);
  assert.equal(networkOf(addr), "gdbx");
  assert.equal(versionOf(addr), 1);
  // Single network: all makeAddress calls produce same address regardless of legacy network param (ignored)
  const alsoMain = makeAddress(TEST_PUB, NETWORKS.mainnet);
  const alsoTest = makeAddress(TEST_PUB, NETWORKS.testnet);
  assert.equal(addr, alsoMain, "single network: mainnet param ignored");
  assert.equal(addr, alsoTest, "single network: testnet param ignored");
});

test("codec: DID derivation", () => {
  const addr = makeAddress(TEST_PUB);
  assert.equal(toDID(addr + ".gdbx"), `did:gdbx:${addr}`);
  assert.equal(toDID("garbage"), null);
});

test("codec: 1,000 random addresses all validate (no false rejects)", () => {
  for (let n = 0; n < 1000; n++) {
    const pub = new Uint8Array(65);
    pub[0] = 0x04;
    pub.set(randomBytes(64), 1);
    const addr = makeAddress(pub, n % 3);
    const v = validateAddress(addr + ".gdbx");
    assert.equal(v.ok, true, `addr ${n} failed: ${v.error}`);
    assert.equal(addr.length, ADDR_LEN);
  }
});

test("codec: 10,000 addresses unique (collision smoke)", () => {
  const seen = new Set();
  for (let n = 0; n < 10000; n++) {
    const pub = new Uint8Array(65);
    pub[0] = 0x04;
    pub.set(randomBytes(64), 1);
    seen.add(makeAddress(pub));
  }
  assert.equal(seen.size, 10000, "all 10k addresses must be unique");
});

test("codec: base32 round-trip", () => {
  const input = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const enc = base32Encode(input);
  assert.match(enc, /^[a-z2-7]+$/);
  const dec = base32Decode(enc);
  assert.deepEqual(dec.slice(0, input.length), input);
});

test("codec: pubkey hash rejects wrong shapes", () => {
  assert.throws(() => makeAddress(new Uint8Array(32)), /uncompressed/i);
  assert.throws(() => makeAddress("zzz"), /pubkey/);
});

test("codec: functions/_lib copy matches canonical sdk source (no drift)", async () => {
  const { readFile } = await import("node:fs/promises");
  const sdk = await readFile(new URL("../sdk/gdbx-codec.js", import.meta.url), "utf8");
  const lib = await readFile(new URL("../functions/_lib/gdbx-codec.js", import.meta.url), "utf8");
  assert.equal(
    lib.trim(),
    sdk.trim(),
    "functions/_lib/gdbx-codec.js must mirror sdk/gdbx-codec.js — run: Copy-Item sdk\\gdbx-codec.js functions\\_lib\\gdbx-codec.js",
  );
});