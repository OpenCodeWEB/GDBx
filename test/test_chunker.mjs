import { test } from "node:test";
import assert from "node:assert/strict";
import { process, assemble, verifyChunk } from "../sdk/utils/chunker.js";

test("chunker: small file roundtrip", async () => {
  const data = new TextEncoder().encode("hello GDBx FTP");
  const { manifest, encryptedChunks } = await process(data, { path: "/test.txt" });
  assert.equal(manifest.size, data.length);
  assert.equal(manifest.chunks.length, 1);
  assert.ok(manifest.iv);
  assert.ok(manifest.keyB64);
  assert.ok(manifest.hash);
  const out = await assemble(encryptedChunks, manifest.iv, manifest.keyB64);
  assert.deepEqual(out, data);
});

test("chunker: large file 1MB (256KB chunks) roundtrip", async () => {
  const size = 1024 * 1024;
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = i % 256;
  const { manifest, encryptedChunks } = await process(data, { path: "/large.bin" });
  assert.equal(manifest.chunks.length, 4); // 1MB / 256KB = 4
  for (let i = 0; i < encryptedChunks.length; i++) {
    assert.ok(verifyChunk(encryptedChunks[i], manifest.chunks[i]));
  }
  const out = await assemble(encryptedChunks, manifest.iv, manifest.keyB64);
  assert.deepEqual(out, data);
});

test("chunker: empty file", async () => {
  const { manifest, encryptedChunks } = await process(new Uint8Array(0), { path: "/empty" });
  assert.equal(manifest.size, 0);
  assert.equal(encryptedChunks.length, 1);
  const out = await assemble(encryptedChunks, manifest.iv, manifest.keyB64);
  assert.equal(out.length, 0);
});

test("chunker: tamper detection", async () => {
  const data = new TextEncoder().encode("tamper test");
  const { manifest, encryptedChunks } = await process(data, { path: "/tamper.txt" });
  const tampered = new Uint8Array(encryptedChunks[0]);
  tampered[0] ^= 1;
  assert.equal(verifyChunk(tampered, manifest.chunks[0]), false);
  // assemble with tampered should throw
  let threw = false;
  try {
    await assemble([tampered], manifest.iv, manifest.keyB64);
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

test("chunker: manifest hash", async () => {
  const data = new TextEncoder().encode("hash test");
  const { manifest } = await process(data, { path: "/hash.txt" });
  assert.ok(manifest.hash);
  assert.equal(typeof manifest.hash, "string");
  assert.equal(manifest.hash.length, 64); // blake3 hex 32B = 64 hex
});
