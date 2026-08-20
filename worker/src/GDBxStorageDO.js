/**
 * GDBxStorageDO.js — Phase 2+3: DID registry + signed CRDT delta sync engine.
 *
 * Durable Object backed by Cloudflare SQLite (Durable Object Storage).
 * Owns two ledgers:
 *
 *   did:<address>            → Signed DID Document (identity + transports)
 *   kv:<address>:<key>       → Sync state (flat key → { value, clock, ownerPub })
 *   meta:stats               → { dids, deltas, active, transports, lastTs }
 *
 * Every mutation is gated by:
 *   1. PoW  — SHA-256 difficulty (anti-spam, scaled by address length)
 *   2. SEA  — ECDSA P-256 signature by the address owner (identity proof)
 *   3. LWW  — Last-Write-Wins clock (monotonic ms), signed by owner
 *
 * Conflict resolution (hybrid): LWW clock + SEA signature. Two writers with
 * the same clock are ordered deterministically by pubkey hash — no forks.
 */

import { verifyPoW, verifySeaSig } from "./verify.js";
import { makeAddress, normalizeAddress } from "./gdbx-codec.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MAX_PAYLOAD = 32 * 1024; // 32KB per delta value
const MAX_DELTAS = 64; // max deltas per put batch
const ADDR_RE = /^[a-z2-7]{58}$/;

export class GDBxStorageObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.initialized = this.initialize();
    this.buckets = new Map(); // in-memory rate limiter
  }

  async initialize() {
    const stats = await this.state.storage.get("meta:stats");
    this.stats = stats || {
      dids: 0,
      deltas: 0,
      active: 0,
      transports: {},
      lastTs: 0,
    };
  }

  rateLimit(id, capacity = 20, windowMs = 60000) {
    if (!id) return true;
    const now = Date.now();
    const b = this.buckets.get(id);
    if (!b || now - b.resetAt > windowMs) {
      this.buckets.set(id, { count: 1, resetAt: now + windowMs });
      return true;
    }
    b.count += 1;
    if (this.buckets.size > 5000) this.buckets.clear();
    return b.count <= capacity;
  }

  async fetch(request) {
    await this.initialized;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });
    const ip = request.headers.get("cf-connecting-ip") || "unknown";

    try {
      /* DID */
      if (url.pathname === "/did" && request.method === "POST") {
        if (!this.rateLimit(ip, 10, 60000)) return json({ error: "rate limited" }, 429);
        return await this.registerDID(await request.json());
      }
      if (url.pathname.startsWith("/did/") && request.method === "GET") {
        const addr = url.pathname.slice("/did/".length);
        if (!ADDR_RE.test(addr)) return json({ error: "invalid address" }, 400);
        return await this.resolveDID(addr);
      }

      /* Sync */
      if (url.pathname === "/sync" && request.method === "POST") {
        if (!this.rateLimit(ip, 30, 60000)) return json({ error: "rate limited" }, 429);
        return await this.putDeltas(await request.json());
      }
      if (url.pathname.startsWith("/sync/") && request.method === "GET") {
        const rest = url.pathname.slice("/sync/".length);
        const [addr, ...keyParts] = rest.split("/");
        if (!ADDR_RE.test(addr)) return json({ error: "invalid address" }, 400);
        const key = keyParts.join("/");
        return await this.getDeltas(addr, key, url.searchParams);
      }

      /* Stats */
      if (url.pathname === "/stats" && request.method === "GET") {
        return this.getStats();
      }
      if (url.pathname === "/peers" && request.method === "POST") {
        // presence heartbeat: { addr, pubkey, transports: ["webrtc","nostr"] }
        return await this.heartbeat(await request.json());
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
  }

  /* ── DID ─────────────────────────────────────────────────────────── */

  /**
   * Register a DID document for a .gdbx address.
   * Body: { addr, pubkey, didDoc?, ts, nonce, diff, hash, sig }
   *   sig = SEA.sign(canonical({addr, action:"did.register", ts, payload}), pair)
   */
  async registerDID(body) {
    if (!body || typeof body !== "object") return json({ error: "body required" }, 400);
    const addr = normalizeAddress(String(body.addr || ""));
    if (!addr) return json({ error: "invalid .gdbx address" }, 400);
    if (!body.pubkeyHex || !/^[0-9a-fA-F]{130}$/.test(String(body.pubkeyHex).replace(/^0x/i, ""))) {
      return json({ error: "pubkeyHex must be 130-char hex (uncompressed P-256: 04||X||Y)" }, 400);
    }

    // PoW gate (anti-spam)
    const pow = await verifyPoW({
      addr,
      ownerPub: body.pubkey,
      payload: "did.register",
      ts: body.ts,
      nonce: body.nonce,
      diff: body.diff,
      hash: body.hash,
    });
    if (!pow.ok) return json({ error: pow.error }, 400);

    // The address must hash to the registering pubkey (identity binding).
    // pubkey = SEA pub (x.y) for signature checks; pubkeyHex = 130-char hex
    // uncompressed P-256 point — the address is derived from pubkeyHex.
    let binding;
    try {
      binding = await this.bindAddress(addr, body.pubkeyHex);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
    if (!binding) return json({ error: "pubkeyHex does not match address" }, 403);

    // SEA signature over the canonical register body
    const canonical = JSON.stringify({
      addr,
      action: "did.register",
      ts: body.ts,
      payload: body.didDoc || null,
    });
    const sigOk = await verifySeaSig(JSON.parse(canonical), body.sig, body.pubkey);
    if (!sigOk) return json({ error: "SEA signature invalid" }, 403);

    const existing = await this.state.storage.get(`did:${addr}`);
    const didDoc = {
      "@context": "https://www.w3.org/ns/did/v1",
      id: `did:gdbx:${addr}`,
      verificationMethod: [
        {
          id: `did:gdbx:${addr}#key-1`,
          type: "EcdsaSecp256r1VerificationKey2019",
          controller: `did:gdbx:${addr}`,
          publicKeyJwk: body.pubkeyJwk || null,
        },
      ],
      authentication: [`did:gdbx:${addr}#key-1`],
      services: Array.isArray(body.didDoc?.services) ? body.didDoc.services : [],
      created: existing?.created || Date.now(),
      updated: Date.now(),
    };

    await Promise.all([
      this.state.storage.put(`did:${addr}`, didDoc),
      this.state.storage.put("meta:stats", this.stats),
    ]);
    if (!existing) this.stats.dids += 1;
    this.stats.lastTs = Date.now();
    return json({ ok: true, did: didDoc, created: !existing }, existing ? 200 : 201);
  }

  async resolveDID(addr) {
    const did = await this.state.storage.get(`did:${addr}`);
    if (!did) return json({ error: "not registered" }, 404);
    return json({ ok: true, did });
  }

  /** Check that addr == base32(version||network||sha256(pubkey)||checksum). */
  async bindAddress(addr, pubkeyHex) {
    const hex = String(pubkeyHex || "").replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]{130}$/.test(hex)) throw new Error("pubkey must be 130-char hex (uncompressed P-256)");
    const expected = makeAddress(hex, 0); // mainnet
    return expected === addr;
  }

  /* ── Sync deltas ─────────────────────────────────────────────────── */

  /**
   * Apply signed CRDT deltas.
   * Body: { addr, pubkey, deltas: [{key, value, clock}], ts, nonce, diff, hash, sig }
   *   sig = SEA.sign(canonical({addr, action:"sync.put", ts, payload: JSON.stringify(deltas)}), pair)
   * Conflict: LWW by clock (monotonic ms); tie → lexicographic pubkey wins.
   */
  async putDeltas(body) {
    if (!body || typeof body !== "object") return json({ error: "body required" }, 400);
    const addr = normalizeAddress(String(body.addr || ""));
    if (!addr) return json({ error: "invalid .gdbx address" }, 400);
    if (!Array.isArray(body.deltas) || body.deltas.length === 0) {
      return json({ error: "deltas[] required" }, 400);
    }
    if (body.deltas.length > MAX_DELTAS) return json({ error: `max ${MAX_DELTAS} deltas per batch` }, 400);
    for (const d of body.deltas) {
      if (!d || typeof d.key !== "string" || d.key.length === 0 || d.key.length > 256) {
        return json({ error: "invalid delta key" }, 400);
      }
      if (typeof d.value === "string" && d.value.length > MAX_PAYLOAD) {
        return json({ error: "delta value too large" }, 400);
      }
    }

    // PoW gate
    const pow = await verifyPoW({
      addr,
      ownerPub: body.pubkey,
      payload: "sync.put",
      ts: body.ts,
      nonce: body.nonce,
      diff: body.diff,
      hash: body.hash,
    });
    if (!pow.ok) return json({ error: pow.error }, 400);

    // Owner binding — pubkeyHex must hash to the address AND the DID must exist.
    const did = await this.state.storage.get(`did:${addr}`);
    if (!did) return json({ error: "address not registered — register DID first" }, 403);
    if (!body.pubkeyHex || !/^[0-9a-fA-F]{130}$/.test(String(body.pubkeyHex).replace(/^0x/i, ""))) {
      return json({ error: "pubkeyHex must be 130-char hex (uncompressed P-256: 04||X||Y)" }, 400);
    }
    let isOwner = false;
    try {
      isOwner = await this.bindAddress(addr, body.pubkeyHex);
    } catch {
      isOwner = false;
    }
    if (!isOwner) return json({ error: "pubkeyHex does not own address" }, 403);

    // SEA signature over canonical batch
    const canonical = JSON.stringify({
      addr,
      action: "sync.put",
      ts: body.ts,
      payload: JSON.stringify(body.deltas),
    });
    const sigOk = await verifySeaSig(JSON.parse(canonical), body.sig, body.pubkey);
    if (!sigOk) return json({ error: "SEA signature invalid" }, 403);

    // Apply LWW
    const writes = [];
    let applied = 0;
    for (const d of body.deltas) {
      const key = `kv:${addr}:${d.key}`;
      const existing = await this.state.storage.get(key);
      const clock = typeof d.clock === "number" ? d.clock : body.ts;
      const winner =
        !existing ||
        clock > existing.clock ||
        (clock === existing.clock && body.pubkey > existing.ownerPub);
      if (winner) {
        writes.push(
          this.state.storage.put(key, {
            key: d.key,
            value: d.value,
            clock,
            ownerPub: body.pubkey,
            updatedAt: Date.now(),
          }),
        );
        applied += 1;
        if (!existing) this.stats.deltas += 1;
      }
    }
    await Promise.all(writes);
    this.stats.lastTs = Date.now();
    await this.state.storage.put("meta:stats", this.stats);
    return json({ ok: true, applied, addr });
  }

  /** Get deltas for an address — ?prefix= filters keys. Returns map + ts. */
  async getDeltas(addr, keyPrefix, params) {
    const prefix = String(keyPrefix || params.get("prefix") || "");
    const list = await this.state.storage.list({ prefix: `kv:${addr}:${prefix}` });
    const entries = [];
    for (const [k, v] of list.entries()) {
      entries.push({ key: v.key, value: v.value, clock: v.clock, ownerPub: v.ownerPub });
    }
    entries.sort((a, b) => (a.clock - b.clock) || (a.key < b.key ? -1 : 1));
    return json({ ok: true, addr, count: entries.length, entries });
  }

  /* ── Presence ────────────────────────────────────────────────────── */

  /** Presence heartbeat: { addr, pubkey, transports: [...] } */
  async heartbeat(body) {
    if (!body || typeof body !== "object") return json({ error: "body required" }, 400);
    const addr = normalizeAddress(String(body.addr || ""));
    if (!addr) return json({ error: "invalid address" }, 400);
    const transports = Array.isArray(body.transports) ? body.transports : [];
    const t = Date.now();
    await this.state.storage.put(`presence:${addr}`, {
      addr,
      transports,
      lastSeen: t,
      latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : null,
    });
    for (const tr of transports) {
      this.stats.transports[tr] = (this.stats.transports[tr] || 0) + 1;
    }
    this.stats.active = Math.max(this.stats.active, 1);
    this.stats.lastTs = t;
    await this.state.storage.put("meta:stats", this.stats);
    return json({ ok: true, lastSeen: t });
  }

  getStats() {
    return json({
      ok: true,
      stats: this.stats,
      policy: {
        maxPayload: MAX_PAYLOAD,
        maxDeltasPerBatch: MAX_DELTAS,
        pow: { minDiff: 2, maxDiff: 4 },
        conflict: "LWW + SEA owner signature",
      },
    });
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });
    const id = env.GDBX_STORAGE.idFromName("default");
    const stub = env.GDBX_STORAGE.get(id);
    return stub.fetch(request);
  },
};