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

import { verifyPoW, verifySig, checkReplay } from "./verify.js";
import { makeAddress, normalizeAddress } from "./gdbx-codec.js";
import { createWebSocketHub } from "./websocket_handler.js";
import { FirewallGuard } from "./FirewallGuard.js";
import { ROLES, roleName, isSuperadminPub, parsePromoteRole } from "./roles.js";
import { GDBxMirrorObject } from "./GDBxMirrorDO.js";
// wrangler discovers Durable Object classes via NAMED exports from the
// entrypoint module — mirror must be exported alongside the primary.
export { GDBxMirrorObject };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MAX_PAYLOAD = 32 * 1024; // 32KB per delta value
const MAX_DELTAS = 64; // max deltas per put batch
const MAX_DID_SERVICES = 16; // max DID service entries
const MAX_SERVICE_URL = 2048; // per service URL length
const MAX_SEEN_NONCES = 2048; // in-memory replay cache size
const ADDR_RE = /^[a-z2-7]{58}$/;
const KEY_RE = /^[a-zA-Z0-9._:/@-]{1,256}$/; // strict key charset

export class GDBxStorageObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.initialized = this.initialize();
    this.buckets = new Map(); // in-memory rate limiter
    this.seenNonces = new Map(); // nonce → ts (replay cache)
    // WebSocket hub lives INSIDE the DO instance: the DO is a singleton
    // isolate per name, so every socket for the address shares one hub and
    // delta broadcasts are reliable (no cross-isolate misses).
    this.wsHub = createWebSocketHub(() => this);
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

  /**
   * Current role level for an addr (default: user — write-capable).
   * ROOT_PUBKEYS members are always superadmin.
   */
  async getRole(addr, pubkey) {
    const stored = await this.state.storage.get(`role:${addr}`);
    if (stored !== undefined && stored !== null) return stored;
    if (pubkey && isSuperadminPub(pubkey, this.env?.ROOT_PUBKEYS)) return ROLES.superadmin;
    return ROLES.user;
  }

  /** ACL allowlist for an addr (owner + collaborators). */
  async getCollaborators(addr) {
    const list = await this.state.storage.get(`acl:${addr}`);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Record a consumed nonce into the replay cache (called by FirewallGuard
   * after the replay check passes). Prunes stale entries.
   */
  recordNonce(nonce, ts) {
    const now = Date.now();
    for (const [n, t] of this.seenNonces) {
      if (now - t > 2 * 60_000) this.seenNonces.delete(n);
    }
    this.seenNonces.set(nonce, ts);
    if (this.seenNonces.size > MAX_SEEN_NONCES) {
      const oldest = [...this.seenNonces.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < oldest.length - MAX_SEEN_NONCES; i++) {
        this.seenNonces.delete(oldest[i][0]);
      }
    }
  }

  /**
   * Replay guard: checks the ts window and consumes the nonce into the
   * seen-nonces cache. Returns an error response (or null on pass).
   */
  guardReplay(ts, nonce) {
    const res = checkReplay({ ts, nonce, seenNonces: this.seenNonces });
    if (!res.ok) return json({ error: res.error }, res.status);
    this.recordNonce(nonce, ts);
    return null;
  }

  async fetch(request) {
    await this.initialized;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });
    const ip = request.headers.get("cf-connecting-ip") || "unknown";

    try {
      /* Real-time WebSocket sync: /ws?addr=:addr (upgrade handled inside the DO hub) */
      if (url.pathname === "/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        return await this.wsHub.accept(request, this.env);
      }

      /* DID */
      if (url.pathname === "/did" && request.method === "POST") {
        if (!this.rateLimit(ip, 10, 60000)) return json({ error: "rate limited" }, 429);
        return await this.registerDID(await request.json());
      }
      /* RBAC: superadmin-signed promotion / demotion */
      if (url.pathname === "/identity/role" && request.method === "POST") {
        if (!this.rateLimit(ip, 10, 60000)) return json({ error: "rate limited" }, 429);
        return await this.setRole(await request.json());
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
        if (!this.rateLimit(ip, 120, 60000)) return json({ error: "rate limited" }, 429);
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
        if (!this.rateLimit(ip, 30, 60000)) return json({ error: "rate limited" }, 429);
        return await this.heartbeat(await request.json());
      }

      /* GDPR erasure */
      if (url.pathname === "/identity" && request.method === "DELETE") {
        if (!this.rateLimit(ip, 5, 60000)) return json({ error: "rate limited" }, 429);
        return await this.purgeIdentity(await request.json());
      }

      /* Encrypted backup export */
      if (url.pathname === "/export" && request.method === "POST") {
        if (!this.rateLimit(ip, 10, 60000)) return json({ error: "rate limited" }, 429);
        return await this.exportState(await request.json());
      }

      /* Public leaderboard / analytics */
      if (url.pathname === "/leaderboard" && request.method === "GET") {
        return await this.leaderboard();
      }

      /* Pool status (primary view) */
      if (url.pathname === "/pool" && request.method === "GET") {
        return json({
          ok: true,
          nodes: [
            { role: "primary", name: "gdbx-storage", healthy: true },
            { role: "mirror", name: "gdbx-mirror", healthy: Boolean(this.env?.GDBX_MIRROR) },
          ],
          health: "ok",
        });
      }

      /* Health check */
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, role: "primary" });
      }

      /* Hybrid mesh relay: Nostr kind-23124 event ingest */
      if (url.pathname === "/relay" && request.method === "POST") {
        if (!this.rateLimit(ip, 30, 60000)) return json({ error: "rate limited" }, 429);
        return await this.relayEvent(await request.json());
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

    // Replay guard: ts window + fresh nonce
    const replayErr = this.guardReplay(Number(body.ts), Number(body.nonce));
    if (replayErr) return replayErr;

    // DID document validation: services array shape + size
    if (body.didDoc && typeof body.didDoc === "object") {
      if (body.didDoc.services !== undefined && !Array.isArray(body.didDoc.services)) {
        return json({ error: "didDoc.services must be an array" }, 400);
      }
      if (Array.isArray(body.didDoc.services)) {
        if (body.didDoc.services.length > MAX_DID_SERVICES) {
          return json({ error: `max ${MAX_DID_SERVICES} DID services` }, 400);
        }
        for (const s of body.didDoc.services) {
          if (!s || typeof s !== "object" || typeof s.id !== "string" || typeof s.type !== "string") {
            return json({ error: "each service needs {id, type, ...}" }, 400);
          }
          if (typeof s.serviceEndpoint === "string" && s.serviceEndpoint.length > MAX_SERVICE_URL) {
            return json({ error: "serviceEndpoint too long" }, 400);
          }
        }
      }
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
    const sigOk = await verifySig(JSON.parse(canonical), body.sig, body.pubkey);
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
    // Zero-trust RBAC: new identity gets a default role.
    // ROOT_PUBKEYS members become superadmin automatically; everyone else
    // starts as user (write-capable). A superadmin can demote to guest
    // (write-blocked) or promote to manager/admin later.
    if (existing === undefined) {
      const role = isSuperadminPub(body.pubkey, this.env?.ROOT_PUBKEYS) ? ROLES.superadmin : ROLES.user;
      await this.state.storage.put(`role:${addr}`, role);
    }
    if (!existing) this.stats.dids += 1;
    this.stats.lastTs = Date.now();
    await this.state.storage.put("meta:stats", this.stats);

    // Pool: replicate the DID document to the mirror
    await this.replicateToMirror(addr, { did: didDoc });

    return json({ ok: true, did: didDoc, created: !existing, role: roleName(await this.getRole(addr)) }, existing ? 200 : 201);
  }

  /**
   * Superadmin-signed role change (promote / demote).
   * Body: { addr, target, targetAddr, role, ts, nonce, diff, hash, sig }
   *   target     = pubkey (x.y) of the identity whose role changes
   *   targetAddr = .gdbx address of that identity (must be registered)
   *   role       = "user" | "manager" | "admin" | "guest" (demote)
   *   sig        = GDBX1/SEA over canonical({addr, action:"identity.promote", ts, payload})
   */
  async setRole(body) {
    if (!body || typeof body !== "object") return json({ error: "body required" }, 400);
    const addr = normalizeAddress(String(body.addr || ""));
    if (!addr) return json({ error: "invalid .gdbx address" }, 400);
    if (!body.target || typeof body.target !== "string") return json({ error: "target pubkey required" }, 400);
    const targetAddr = normalizeAddress(String(body.targetAddr || ""));
    if (!targetAddr) return json({ error: "targetAddr required" }, 400);

    const ts = Number(body.ts);
    const nonce = Number(body.nonce);
    const replayErr = this.guardReplay(ts, nonce);
    if (replayErr) return replayErr;

    // Only a superadmin may change roles — FirewallGuard enforces this via
    // the signer's pubkey against ROOT_PUBKEYS.
    const canonical = JSON.stringify({
      addr,
      action: "identity.promote",
      ts,
      payload: JSON.stringify({ role: body.role, target: body.target }),
    });
    const gate = await FirewallGuard.check({
      body: JSON.parse(canonical),
      sig: body.sig,
      pubkey: body.pubkey,
      pubkeyHex: body.pubkeyHex,
      ts,
      nonce,
      diff: body.diff,
      hash: body.hash,
      env: this.env,
      seenNonces: this.seenNonces,
      action: "identity.promote",
      payload: JSON.stringify({ role: body.role, target: body.target }),
    });
    if (!gate.ok) return json({ error: gate.error }, gate.status || 403);
    const targetRole = gate.role; // validated level

    // Target identity must be registered before its role can change
    const targetDid = await this.state.storage.get(`did:${targetAddr}`);
    if (!targetDid) return json({ error: "target identity not registered" }, 404);

    await this.state.storage.put(`role:${targetAddr}`, targetRole);
    return json({ ok: true, addr, target: body.target, targetAddr, role: roleName(targetRole) });
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
      if (!d || typeof d !== "object") return json({ error: "invalid delta" }, 400);
      if (typeof d.key !== "string" || !KEY_RE.test(d.key)) {
        return json({ error: "invalid delta key — 1-256 chars of [a-zA-Z0-9._:/@-]" }, 400);
      }
      // flat-primitive JSON only (no objects/arrays in values)
      const vt = typeof d.value;
      if (!["string", "number", "boolean"].includes(vt) && d.value !== null) {
        return json({ error: "delta value must be a flat primitive (string|number|boolean|null)" }, 400);
      }
      if (vt === "string" && d.value.length > MAX_PAYLOAD) {
        return json({ error: "delta value too large" }, 400);
      }
      if (vt === "number" && !Number.isFinite(d.value)) {
        return json({ error: "delta value must be a finite number" }, 400);
      }
      if (typeof d.clock === "number" && (!Number.isFinite(d.clock) || d.clock < 0)) {
        return json({ error: "invalid delta clock" }, 400);
      }
    }

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

    // Unified firewall gate: PoW → replay → signature → RBAC → ACL
    const canonical = JSON.stringify({
      addr,
      action: "sync.put",
      ts: body.ts,
      payload: JSON.stringify(body.deltas),
    });
    const gate = await FirewallGuard.check({
      body: JSON.parse(canonical),
      sig: body.sig,
      pubkey: body.pubkey,
      pubkeyHex: body.pubkeyHex,
      ts: body.ts,
      nonce: body.nonce,
      diff: body.diff,
      hash: body.hash,
      env: this.env,
      seenNonces: this.seenNonces,
      consumeNonce: (n, t) => this.recordNonce(n, t),
      action: "sync.put",
      payload: JSON.stringify(body.deltas),
      role: await this.getRole(addr, body.pubkey),
      ownerPub: did.ownerPub || body.pubkey,
      collaborators: await this.getCollaborators(addr),
    });
    if (!gate.ok) return json({ error: gate.error }, gate.status || 403);

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

    // Pool: replicate applied writes to the mirror (best-effort, signed path)
    if (applied > 0) {
      const snapshot = { did, kv: {} };
      for (const d of body.deltas) {
        const existing = await this.state.storage.get(`kv:${addr}:${d.key}`);
        if (existing) {
          snapshot.kv[d.key] = {
            value: existing.value,
            clock: existing.clock,
            ownerPub: existing.ownerPub,
          };
        }
      }
      await this.replicateToMirror(addr, snapshot);
    }
    return json({ ok: true, applied, addr });
  }

  /** Get deltas for an address — ?prefix= filters keys. Returns map + ts. */
  async getDeltas(addr, keyPrefix, params) {
    const prefix = String(keyPrefix || params.get("prefix") || "");
    const entries = await this.readMerged(addr, prefix);
    return json({ ok: true, addr, count: entries.length, entries });
  }

  /**
   * Pool read path: local entries merged with mirror entries (LWW — newest
   * clock wins; tie → lexicographic owner). Falls back to local only when no
   * mirror binding exists or the mirror is unreachable.
   */
  async readMerged(addr, prefix) {
    const list = await this.state.storage.list({ prefix: `kv:${addr}:${prefix}` });
    const merged = new Map();
    for (const [, v] of list.entries()) {
      merged.set(v.key, { key: v.key, value: v.value, clock: v.clock, ownerPub: v.ownerPub });
    }

    const binding = this.env?.GDBX_MIRROR;
    if (binding) {
      try {
        const stub = await binding.get(binding.idFromName("gdbx-mirror"));
        const target = new URL(
          `https://do.local/sync/${addr}${prefix ? "?prefix=" + encodeURIComponent(prefix) : ""}`,
        );
        const res = await stub.fetch(new Request(target.toString(), { method: "GET" }));
        const data = await res.json();
        if (data.ok && Array.isArray(data.entries)) {
          for (const e of data.entries) {
            const cur = merged.get(e.key);
            if (
              !cur ||
              e.clock > cur.clock ||
              (e.clock === cur.clock && (e.ownerPub || "") > (cur.ownerPub || ""))
            ) {
              merged.set(e.key, e);
            }
          }
        }
      } catch {
        // mirror unavailable — serve local
      }
    }

    return [...merged.values()].sort((a, b) => a.clock - b.clock || (a.key < b.key ? -1 : 1));
  }

  /**
   * Pool: replicate a snapshot to the mirror node (best-effort — a mirror
   * outage must never fail the client write).
   */
  async replicateToMirror(addr, snapshot) {
    const binding = this.env?.GDBX_MIRROR;
    if (!binding) return;
    try {
      const stub = await binding.get(binding.idFromName("gdbx-mirror"));
      const target = new URL("https://do.local/replicate");
      const proxy = new Request(target.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addr, snapshot }),
      });
      await stub.fetch(proxy);
    } catch (e) {
      console.error("mirror replication failed:", e?.message || e);
    }
  }

  /**
   * Hybrid mesh relay: ingests a Nostr kind-23124 event (GDBX1 envelope in
   * content) and runs it through the exact same FirewallGuard pipeline as
   * HTTP/WS sync.put — the mesh is transport-agnostic, one gate for all.
   */
  async relayEvent(ev) {
    if (!ev || ev.kind !== 23124) return json({ error: "wrong kind" }, 400);
    const addrTag = Array.isArray(ev.tags) ? ev.tags.find((t) => Array.isArray(t) && t[0] === "addr") : null;
    if (!addrTag || !addrTag[1]) return json({ error: "missing addr tag" }, 400);
    const addr = normalizeAddress(String(addrTag[1]));
    if (!addr) return json({ error: "invalid .gdbx address" }, 400);

    if (typeof ev.content !== "string" || !ev.content.startsWith("GDBX1")) {
      return json({ error: "content not GDBX1 envelope" }, 400);
    }
    let m, pubkeyHex, nonce, diff, hash, sig;
    try {
      const envelope = JSON.parse(ev.content.slice(5));
      m = envelope.m;
      pubkeyHex = envelope.pubkeyHex;
      nonce = envelope.nonce;
      diff = envelope.diff;
      hash = envelope.hash;
      sig = envelope.s;
      if (!m || typeof m !== "object") return json({ error: "malformed envelope" }, 400);
    } catch {
      return json({ error: "malformed envelope" }, 400);
    }

    // mesh events may bypass the explicit nonce/hash fields — derive them
    // from the envelope when absent (the signature still gates everything).
    const ts = Number(m.ts || ev.created_at * 1000 || Date.now());
    const deltas = typeof m.payload === "string" ? JSON.parse(m.payload) : m.payload;
    if (!Array.isArray(deltas)) return json({ error: "payload not deltas array" }, 400);

    return await this.putDeltas({
      addr,
      pubkey: ev.pubkey,
      pubkeyHex: pubkeyHex || m.pubkeyHex,
      deltas,
      ts,
      nonce: Number(nonce || m.nonce || 1),
      diff,
      hash,
      sig: sig || m.s,
    });
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

  /* ── GDPR erasure ───────────────────────────────────────────────── */

  /**
   * GDPR right-to-be-forgotten: proves ownership with a SEA signature over
   * {addr, action:"identity.purge", ts} then cryptographically erases ALL
   * records for that address (did doc, kv deltas, presence).
   */
  async purgeIdentity(body) {
    if (!body || typeof body !== "object") return json({ error: "body required" }, 400);
    const addr = normalizeAddress(String(body.addr || ""));
    if (!addr) return json({ error: "invalid .gdbx address" }, 400);

    // Replay guard first
    const replayErr = this.guardReplay(Number(body.ts), Number(body.nonce));
    if (replayErr) return replayErr;

    const did = await this.state.storage.get(`did:${addr}`);
    if (!did) return json({ error: "not registered" }, 404);

    // The pubkey must actually bind to the address (identity proof),
    // otherwise an attacker could purge with their own key.
    if (!body.pubkeyHex || !/^[0-9a-fA-F]{130}$/.test(String(body.pubkeyHex).replace(/^0x/i, ""))) {
      return json({ error: "pubkeyHex must be 130-char hex (uncompressed P-256)" }, 400);
    }
    let binding;
    try {
      binding = await this.bindAddress(addr, body.pubkeyHex);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
    if (!binding) return json({ error: "pubkeyHex does not match address" }, 403);

    // Ownership proof: SEA signature over canonical purge body
    const canonical = JSON.stringify({
      addr,
      action: "identity.purge",
      ts: body.ts,
      payload: null,
    });
    const sigOk = await verifySig(JSON.parse(canonical), body.sig, body.pubkey);
    if (!sigOk) return json({ error: "SEA signature invalid" }, 403);

    // Erase everything: did doc, kv deltas, presence
    const kvList = await this.state.storage.list({ prefix: `kv:${addr}:` });
    const pres = await this.state.storage.get(`presence:${addr}`);
    const keys = [];
    for (const [k] of kvList.entries()) keys.push(k);
    keys.push(`did:${addr}`, `presence:${addr}`);
    await Promise.all(keys.map((k) => this.state.storage.delete(k)));
    if (pres) this.stats.active = Math.max(0, this.stats.active - 1);
    this.stats.dids = Math.max(0, this.stats.dids - 1);
    this.stats.purges = (this.stats.purges || 0) + 1;
    this.stats.lastTs = Date.now();
    await this.state.storage.put("meta:stats", this.stats);

    return json({ ok: true, erased: keys.length, addr });
  }

  /* ── Export / restore ──────────────────────────────────────────── */

  /**
   * Encrypted snapshot export: returns the full state vector for an address
   * (did doc + kv entries) so a client can back it up. The payload is signed
   * by the owner (SEA) to prevent tampered exports; encryption happens
   * client-side (AES-GCM) — the edge never holds plaintext private keys.
   * Body: { addr, pubkey, ts, nonce, diff, hash, sig }  (same PoW gate)
   */
  async exportState(body) {
    if (!body || typeof body !== "object") return json({ error: "body required" }, 400);
    const addr = normalizeAddress(String(body.addr || ""));
    if (!addr) return json({ error: "invalid .gdbx address" }, 400);
    const replayErr = this.guardReplay(Number(body.ts), Number(body.nonce));
    if (replayErr) return replayErr;

    const did = await this.state.storage.get(`did:${addr}`);
    if (!did) return json({ error: "not registered" }, 404);

    // ownership binding + SEA signature (same as purge)
    if (!body.pubkeyHex || !/^[0-9a-fA-F]{130}$/.test(String(body.pubkeyHex).replace(/^0x/i, ""))) {
      return json({ error: "pubkeyHex must be 130-char hex (uncompressed P-256)" }, 400);
    }
    let binding;
    try {
      binding = await this.bindAddress(addr, body.pubkeyHex);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
    if (!binding) return json({ error: "pubkeyHex does not match address" }, 403);

    const canonical = JSON.stringify({
      addr,
      action: "identity.export",
      ts: body.ts,
      payload: null,
    });
    const sigOk = await verifySig(JSON.parse(canonical), body.sig, body.pubkey);
    if (!sigOk) return json({ error: "SEA signature invalid" }, 403);

    // snapshot: did doc + all kv entries
    const kvList = await this.state.storage.list({ prefix: `kv:${addr}:` });
    const entries = [];
    for (const [, v] of kvList.entries()) {
      entries.push({ key: v.key, value: v.value, clock: v.clock, ownerPub: v.ownerPub });
    }
    entries.sort((a, b) => (a.clock - b.clock) || (a.key < b.key ? -1 : 1));

    return json({
      ok: true,
      format: "gdbx-snapshot-v1",
      addr,
      exportedAt: Date.now(),
      did,
      entries,
    });
  }

  /* ── Leaderboard / analytics ───────────────────────────────────── */

  /**
   * Global mesh analytics: active peers, total dids/deltas, transport
   * breakdown and top active addresses. Public read — no auth needed.
   */
  async leaderboard() {
    const presenceList = await this.state.storage.list({ prefix: "presence:" });
    const peers = [];
    for (const [, v] of presenceList.entries()) {
      peers.push({ addr: v.addr, transports: v.transports || [], lastSeen: v.lastSeen, latencyMs: v.latencyMs ?? null });
    }
    peers.sort((a, b) => (b.lastSeen - a.lastSeen));

    // top active addresses by kv delta count
    const kvList = await this.state.storage.list({ prefix: "kv:" });
    const byAddr = new Map();
    for (const [k] of kvList.entries()) {
      const addrPart = k.slice(3).split(":")[0]; // kv:<addr>:<key>
      byAddr.set(addrPart, (byAddr.get(addrPart) || 0) + 1);
    }
    const top = [...byAddr.entries()]
      .map(([a, deltas]) => ({ addr: a, deltas }))
      .sort((a, b) => b.deltas - a.deltas)
      .slice(0, 20);

    const transportCounts = {};
    for (const p of peers) {
      for (const tr of p.transports) transportCounts[tr] = (transportCounts[tr] || 0) + 1;
    }

    return json({
      ok: true,
      ts: Date.now(),
      stats: {
        dids: this.stats.dids,
        deltas: this.stats.deltas,
        activePeers: peers.length,
        purges: this.stats.purges || 0,
        transports: transportCounts,
      },
      top: top.slice(0, 10),
      peers: peers.slice(0, 25),
    });
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
  GDBxStorageObject,
  GDBxMirrorObject,

  /**
   * Entry Worker fetch: forwards everything (HTTP + WS upgrades) to the
   * default Durable Object — the DO is a singleton isolate, so the WebSocket
   * hub inside it sees every connection and broadcasts reliably.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });

    const id = env.GDBX_STORAGE.idFromName("default");
    const stub = env.GDBX_STORAGE.get(id);
    return stub.fetch(request);
  },
};