/**
 * /api/v1/* — GDBx public API (Pages Functions → Worker Durable Objects).
 *
 *   POST /api/v1/address   { pubkey (hex), network? } → { address, did, network }
 *   GET  /api/v1/address/:addr          → validate + describe
 *   GET  /api/v1/health                 → liveness
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  const path = url.pathname.replace(/^\/api\/v1\/?/, "");
  const segments = path.split("/").filter(Boolean);

  if (segments[0] === "health" && request.method === "GET") {
    return json({ ok: true, service: "gdbx", ts: Date.now() });
  }

  if (segments[0] === "address" && request.method === "POST" && segments.length === 1) {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
    const hex = String(body?.pubkey || "").replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
      return json({ error: "pubkey must be 130-char hex (uncompressed P-256: 04||X||Y)" }, 400);
    }
    const network = body?.network ?? 0;
    if (![0, 1, 2].includes(network)) return json({ error: "network must be 0|1|2" }, 400);
    try {
      const codec = await importCodec();
      const address = codec.makeAddress(hex, network);
      return json({
        ok: true,
        address: address + ".gdbx",
        bare: address,
        did: codec.toDID(address),
        network: codec.networkOf(address),
        version: codec.versionOf(address),
      }, 201);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
  }

  if (segments[0] === "address" && segments.length === 2 && request.method === "GET") {
    const codec = await importCodec();
    const v = codec.validateAddress(segments[1]);
    if (!v.ok) return json({ ok: false, error: v.error }, 400);
    const bare = codec.normalizeAddress(segments[1]);
    return json({
      ok: true,
      address: bare + ".gdbx",
      did: codec.toDID(bare),
      network: codec.networkOf(bare),
      version: codec.versionOf(bare),
    });
  }

  return json({ error: "not found" }, 404);
}

let _codec = null;
async function importCodec() {
  // Pages Functions bundler only resolves within the functions/ tree (plus
  // node_modules) — keep a synced copy at functions/_lib/gdbx-codec.js
  // (canonical source: sdk/gdbx-codec.js; test_codec.mjs asserts equality).
  if (!_codec) _codec = await import("../../_lib/gdbx-codec.js");
  return _codec;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}