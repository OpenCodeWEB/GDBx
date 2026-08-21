import { writeFileSync, readFileSync } from "node:fs";
import { loadIdentity } from "./identity.js";

export async function exportSnapshot(outPath, opts = {}) {
  const id = loadIdentity(opts.keyPath);
  const { getDeltas } = await import("../../../sdk/gdbx-sdk.js");
  // export all deltas for this addr
  const data = await getDeltas(id.addr, "");
  const snap = { addr: id.addr, did: id.did, exportedAt: Date.now(), count: data.count, entries: data.entries };
  writeFileSync(outPath, JSON.stringify(snap, null, 2));
  return { ok: true, out: outPath, count: snap.count };
}

export async function importSnapshot(inPath, opts = {}) {
  const id = loadIdentity(opts.keyPath);
  const { putDeltas } = await import("../../../sdk/gdbx-sdk.js");
  const snap = JSON.parse(readFileSync(inPath, "utf8"));
  if (!snap.entries || !Array.isArray(snap.entries)) throw new Error("invalid snapshot");
  const deltas = snap.entries.map((e) => ({ key: e.key, value: e.value, clock: e.clock }));
  const res = await putDeltas({ pubkeyHex: id.pubkeyHex || id.pubkey_hex, pair: { pub: id.pub, priv: id.priv }, deltas });
  return { ok: true, imported: res.applied ?? deltas.length };
}
