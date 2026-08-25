/**
 * GDBxMirrorDO.js — Phase 5: replication pool mirror node.
 *
 * A second Durable Object class (separate namespace `gdbx-mirror`) holding a
 * replica of every address's state. The primary GDBxStorageDO replicates
 * writes here asynchronously (signed, best-effort); reads fall back to the
 * mirror when the primary is unavailable; rejoin heals by CRDT merge
 * (LWW — newest clock wins, ties break by owner pubkey).
 *
 * The mirror intentionally exposes only READ + heal endpoints (no external
 * mutation): writes always enter through the primary's FirewallGuard.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const ADDR_RE = /^(?:[a-z2-7]{56}|[a-z2-7]{58})$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

export class GDBxMirrorObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.initialized = this.initialize();
  }

  async initialize() {
    const stats = await this.state.storage.get("meta:stats");
    this.stats = stats || { dids: 0, deltas: 0, active: 0, transports: {}, lastTs: 0 };
  }

  async fetch(request) {
    await this.initialized;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });

    try {
      /* Replication endpoint (primary → mirror). Body: { addr, snapshot } */
      if (url.pathname === "/replicate" && request.method === "POST") {
        const body = await request.json();
        if (!body || !body.addr || !ADDR_RE.test(String(body.addr))) {
          return json({ error: "invalid addr" }, 400);
        }
        const snapshot = body.snapshot;
        if (!snapshot || typeof snapshot !== "object") {
          return json({ error: "snapshot required" }, 400);
        }
        await this.applySnapshot(body.addr, snapshot);
        return json({ ok: true, addr: body.addr, replicated: true });
      }

      /* Read: DID resolve */
      if (url.pathname.startsWith("/did/") && request.method === "GET") {
        const addr = url.pathname.slice("/did/".length);
        if (!ADDR_RE.test(addr)) return json({ error: "invalid address" }, 400);
        const did = await this.state.storage.get(`did:${addr}`);
        if (!did) return json({ error: "not registered" }, 404);
        return json({ ok: true, did, source: "mirror" });
      }

      /* Read: sync deltas */
      if (url.pathname.startsWith("/sync/") && request.method === "GET") {
        const rest = url.pathname.slice("/sync/".length);
        const [addr, ...keyParts] = rest.split("/");
        if (!ADDR_RE.test(addr)) return json({ error: "invalid address" }, 400);
        const key = keyParts.join("/");
        const prefix = String(url.searchParams.get("prefix") || "");
        const list = await this.state.storage.list({ prefix: `kv:${addr}:${prefix}` });
        const entries = [];
        for (const [, v] of list.entries()) {
          entries.push({ key: v.key, value: v.value, clock: v.clock, ownerPub: v.ownerPub });
        }
        entries.sort((a, b) => (a.clock - b.clock) || (a.key < b.key ? -1 : 1));
        return json({ ok: true, addr, count: entries.length, entries, source: "mirror" });
      }

      /* Pool status (read-only mirror view) */
      if (url.pathname === "/pool" && request.method === "GET") {
        return json({ ok: true, nodes: [{ role: "mirror", name: "gdbx-mirror", healthy: true }], health: "ok" });
      }

      /* Stats */
      if (url.pathname === "/stats" && request.method === "GET") {
        return json({ ok: true, stats: this.stats, source: "mirror" });
      }

      /* Health check */
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, role: "mirror" });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 400);
    }
  }

  /**
   * Apply a replicated snapshot with CRDT merge semantics.
   * Snapshot shape: { did, kv: { key: {value, clock, ownerPub} }, stats }
   * LWW merge: keep the entry with the HIGHER clock; tie → lexicographic owner.
   */
  async applySnapshot(addr, snapshot) {
    const writes = [];

    if (snapshot.did) {
      const existing = await this.state.storage.get(`did:${addr}`);
      if (!existing || (snapshot.did.updated || 0) >= (existing.updated || 0)) {
        writes.push(this.state.storage.put(`did:${addr}`, snapshot.did));
      }
      if (!existing) this.stats.dids += 1;
    }

    if (snapshot.kv && typeof snapshot.kv === "object") {
      for (const [key, v] of Object.entries(snapshot.kv)) {
        const storageKey = `kv:${addr}:${key}`;
        const existing = await this.state.storage.get(storageKey);
        const clock = typeof v.clock === "number" ? v.clock : 0;
        const winner =
          !existing ||
          clock > existing.clock ||
          (clock === existing.clock && (v.ownerPub || "") > (existing.ownerPub || ""));
        if (winner) {
          writes.push(
            this.state.storage.put(storageKey, {
              key,
              value: v.value,
              clock,
              ownerPub: v.ownerPub || null,
              updatedAt: Date.now(),
            }),
          );
          if (!existing) this.stats.deltas += 1;
        }
      }
    }

    writes.push(this.state.storage.put("meta:stats", this.stats));
    await Promise.all(writes);
  }
}

export default GDBxMirrorObject;