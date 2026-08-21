import { loadIdentity } from "./identity.js";

export async function putVector(key, text, vector, opts = {}) {
  const id = loadIdentity(opts.keyPath);
  const { putDeltas } = await import("../../../sdk/gdbx-sdk.js");
  const val = JSON.stringify({ text, vector }, null, 0);
  const res = await putDeltas({ pubkeyHex: id.pubkeyHex || id.pubkey_hex, pair: { pub: id.pub, priv: id.priv }, deltas: [{ key, value: val }] });
  return { ok: true, ...res, key };
}

export async function searchVector(queryVec, topK = 3, prefix = "aia/vectors/", opts = {}) {
  const id = loadIdentity(opts.keyPath);
  const { getDeltas } = await import("../../../sdk/gdbx-sdk.js");
  const data = await getDeltas(id.addr, prefix);
  const entries = data.entries || [];
  function cosine(a, b) {
    const dot = a.reduce((s, v, i) => s + v * b[i], 0);
    const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    if (na === 0 || nb === 0) return -1;
    return dot / (na * nb);
  }
  const scored = [];
  for (const e of entries) {
    try {
      const j = JSON.parse(e.value);
      if (!j.vector) continue;
      scored.push({ score: cosine(queryVec, j.vector), entry: e, text: j.text });
    } catch {}
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
