import { loadIdentity } from "./identity.js";

export async function put(key, value, opts = {}) {
  const id = loadIdentity(opts.keyPath);
  const { putDeltas } = await import("../../../sdk/gdbx-sdk.js");
  const clock = Date.now();
  const res = await putDeltas({ pubkeyHex: id.pubkeyHex || id.pubkey_hex, pair: { pub: id.pub, priv: id.priv }, deltas: [{ key, value, clock }] });
  return { ok: true, ...res, key, value };
}

export async function get(prefix = "", opts = {}) {
  const id = loadIdentity(opts.keyPath);
  const { getDeltas } = await import("../../../sdk/gdbx-sdk.js");
  const res = await getDeltas(id.addr, prefix);
  return res;
}

export async function watch(prefix = "", cb, opts = {}) {
  const id = loadIdentity(opts.keyPath);
  const { GDBxWS } = await import("../../../sdk/gdbx-ws-client.js");
  const ws = new GDBxWS({ addr: id.addr, pair: { pub: id.pub, priv: id.priv }, pubkeyHex: id.pubkeyHex || id.pubkey_hex });
  ws.onDelta = cb;
  await ws.connect();
  return ws;
}
