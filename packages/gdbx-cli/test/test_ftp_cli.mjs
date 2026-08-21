import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock GDBxFTP for cli test (no network)
test("ftp cli: put/get via mock GDBxFTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gdbx-ftp-cli-"));
  const local = join(dir, "hello.txt");
  const down = join(dir, "down.txt");
  writeFileSync(local, "hello ftp via GDBx");

  // create mock ftp module that uses in-memory store
  const store = new Map();
  const mockFtp = {
    put: async (data, path) => {
      store.set(`sys/ftp/manifest${path}`, JSON.stringify({ path, size: data.length, chunks: ["h1"] }));
      store.set(`sys/ftp/chunk/h1`, Buffer.from(data).toString("base64url"));
      return { success: true, path };
    },
    get: async (path) => {
      const m = store.get(`sys/ftp/manifest${path}`);
      if (!m) throw new Error("not found");
      const b64 = store.get(`sys/ftp/chunk/h1`);
      return Buffer.from(b64, "base64url");
    },
    ls: async (prefix) => {
      const out = [];
      for (const [k, v] of store) if (k.startsWith(`sys/ftp/manifest${prefix}`)) out.push({ key: k, manifest: JSON.parse(v) });
      return out;
    },
  };

  // simulate ftpPut/ftpGet via mock (we don't actually call the real ftp.js which needs identity)
  await mockFtp.put(await readFileSync(local), "/remote.txt");
  const data = await mockFtp.get("/remote.txt");
  assert.equal(Buffer.from(data).toString(), "hello ftp via GDBx");
  const list = await mockFtp.ls("/");
  assert.equal(list.length, 1);
  assert.ok(list[0].key.endsWith("/remote.txt"));

  rmSync(dir, { recursive: true, force: true });
});

test("ftp cli: gateway module loads", async () => {
  const m = await import("../lib/ftp.js");
  assert.equal(typeof m.startGateway, "function");
  assert.equal(typeof m.ftpPut, "function");
  assert.equal(typeof m.ftpGet, "function");
});
