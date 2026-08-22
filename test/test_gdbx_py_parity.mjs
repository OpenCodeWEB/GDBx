/**
 * test_gdbx_py_parity.mjs — JS ↔ Python GDBx cross-verify
 *
 * Verifies that JS can verify Python-signed vectors and vice versa (via shared vectors).
 * Vectors in test/vectors/gdbx-vectors-js.json are JS-signed; Python test_js_vector verifies them.
 * This test verifies the reverse: Python-signed sample (generated on the fly via Python subprocess) is verifiable by JS.
 * For offline CI, we use a precomputed Python vector checked in as test/vectors/py_gdbx-vectors-js.json if present, otherwise skip.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { verify } from "../sdk/gdbx-crypto.js";

test("py parity: JS verifies JS vectors (sanity)", async () => {
  const vec = JSON.parse(readFileSync("test/vectors/gdbx-vectors-js.json", "utf8"));
  for (const v of vec.vectors) {
    const ok = await verify(v.body, v.sig, v.pub);
    assert.equal(ok, v.valid, v.name);
  }
});

test("py parity: JS verifies Python vector if present", async () => {
  const p = "test/vectors/py_gdbx-vectors-js.json";
  if (!existsSync(p)) {
    console.log("  (skip — no py vector, run `python test_cross.py` to generate)");
    return;
  }
  const py = JSON.parse(readFileSync(p, "utf8"));
  const ok = await verify(py.body, py.sig, py.pub);
  assert.equal(ok, true, "Python-signed GDBx must verify in JS");
});
