/**
 * /api/v1/* — GDBx public API (Pages Functions → GDBxStorageDO).
 *
 *   POST /api/v1/did/register  { addr, pubkey, didDoc?, ts, nonce, diff, hash, sig }
 *   GET  /api/v1/did/:addr              → DID document
 *   POST /api/v1/sync                  { addr, pubkey, deltas[], ts, nonce, diff, hash, sig }
 *   GET  /api/v1/sync/:addr?prefix=key  → signed state map
 *   POST /api/v1/peers                 { addr, pubkey, transports[] }  (presence)
 *   GET  /api/v1/stats                  → live ledger stats
 *   POST /api/v1/address                { pubkey (hex), network? } → address + DID
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

  /* ── health (no DO needed) ─────────────────────────────────────── */
  if (segments[0] === "health" && request.method === "GET") {
    return json({ ok: true, service: "gdbx", ts: Date.now() });
  }

  /* ── address codec (no DO needed) ──────────────────────────────── */
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

  /* ── DID ───────────────────────────────────────────────────────── */
  if (segments[0] === "did" && segments[1] === "register" && request.method === "POST") {
    return await storageFetch(env, "/did", request);
  }
  if (segments[0] === "did" && segments.length === 2 && request.method === "GET") {
    return await storageFetch(env, "/did/" + segments[1], request);
  }

  /* ── sync ──────────────────────────────────────────────────────── */
  if (segments[0] === "sync" && request.method === "POST") {
    return await storageFetch(env, "/sync", request);
  }
  if (segments[0] === "sync" && segments.length >= 2 && request.method === "GET") {
    const rest = segments.slice(1).join("/");
    return await storageFetch(env, "/sync/" + rest, request);
  }

  /* ── presence + stats ──────────────────────────────────────────── */
  if (segments[0] === "peers" && request.method === "POST") {
    return await storageFetch(env, "/peers", request);
  }
  if (segments[0] === "stats" && request.method === "GET") {
    return await storageFetch(env, "/stats", request);
  }

  return json({ error: "not found" }, 404);
}

/** Proxy to the GDBxStorageObject Durable Object. */
async function storageFetch(env, targetPath, request) {
  const id = env.GDBX_STORAGE.idFromName("default");
  const stub = env.GDBX_STORAGE.get(id);
  const target = new URL(request.url);
  target.pathname = targetPath;
  const proxy = new Request(target.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "POST" ? await request.text() : undefined,
  });
  return stub.fetch(proxy);
}

let _codec = null;
async function importCodec() {
  // Pages Functions bundler only resolves within the functions/ tree (plus
  // node_modules) — keep a synced copy at functions/_lib/gdbx-codec.js
  // (canonical source: sdk/gdbx-codec.js; tests assert equality).
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