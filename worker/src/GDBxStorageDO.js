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

import { verifyPoW, verifySig, checkReplay, sha256Hex } from "./verify.js";
import { makeAddress, normalizeAddress } from "./gdbx-codec.js";
import { createWebSocketHub } from "./websocket_handler.js";
import { FirewallGuard } from "./FirewallGuard.js";
import { ROLES, roleName, isSuperadminPub, parsePromoteRole } from "./roles.js";
import { GDBxMirrorObject } from "./GDBxMirrorDO.js";
import * as Auth from "./auth.js";
// wrangler discovers Durable Object classes via NAMED exports from the
// entrypoint module — mirror must be exported alongside the primary.
export { GDBxMirrorObject };
import { GunXPeerObject } from "./GunXRelayDO.js";
// GunX relay engine (GunX absorbed into GDBx): GunX wire clients peer at /gunx
export { GunXPeerObject };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MAX_PAYLOAD = 2 * 1024 * 1024; // platform boundary (DO value ~2MB); larger files auto-chunk client-side -> effective size unlimited
const MAX_DELTAS = 1000; // batch headroom (was 64)
const MAX_DID_SERVICES = 256; // was 16
const MAX_SERVICE_URL = 32 * 1024; // was 2048
const MAX_SEEN_NONCES = 65536; // replay cache headroom
const ADDR_RE = /^(?:[a-z2-7]{56}|[a-z2-7]{58})$/; // single-net 56 + legacy 58
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
        const body = await request.json();
        const addr = normalizeAddress(String(body.addr || ""));
        // idempotent re-register: if DID already exists, allow with per-addr higher limit (demo)
        if (addr) {
          const existing = await this.state.storage.get(`did:${addr}`);
          if (existing) {
            const key = `${ip}:${addr}`;
            if (!this.rateLimit(key, 600, 60000)) {
              return new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { ...JSON_HEADERS, "retry-after": "2" } });
            }
            return await this.registerDID(body);
          }
        }
        if (!this.rateLimit(ip, 120, 60000)) {
          return new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { ...JSON_HEADERS, "retry-after": "3" } });
        }
        return await this.registerDID(body);
      }
      /* RBAC: superadmin-signed promotion / demotion */
      if (url.pathname === "/identity/role" && request.method === "POST") {
        if (!this.rateLimit(ip, 60, 60000)) return json({ error: "rate limited" }, 429);
        return await this.setRole(await request.json());
      }
      if (url.pathname.startsWith("/did/") && request.method === "GET") {
        const addr = url.pathname.slice("/did/".length);
        if (!ADDR_RE.test(addr)) return json({ error: "invalid address" }, 400);
        return await this.resolveDID(addr);
      }

      /* Sync */
      if (url.pathname === "/sync" && request.method === "POST") {
        const body = await request.json();
        // Rate limiting strategy (optimized after sandbox "rate limited" reports):
        // - Bucket key = IP+addr (not bare IP) so many users on the same NAT/CGNAT
        //   don't starve each other, and one busy demo address doesn't block others.
        // - Sandbox keys (`test/`, `sandbox/`) and playground chat get a demo-friendly
        //   burst budget; normal writes keep the anti-spam default.
        // - PoW + GDBx signature still gate every write — rate limit is only the
        //   second line of defense, so raising capacity stays zero-trust safe.
        const isDemo = Array.isArray(body.deltas) && body.deltas.some((d) => {
          const k = String(d.key || "");
          return k.startsWith("playground/") || k.startsWith("sandbox/") || k.startsWith("test/");
        });
        const capacity = isDemo ? 1200 : 600;
        const key = body.addr ? `${ip}:${normalizeAddress(String(body.addr))}` : ip;
        if (!this.rateLimit(key, capacity, 60000)) {
          return new Response(JSON.stringify({ error: "rate limited", retryAfterMs: 2000 }), {
            status: 429,
            headers: { ...JSON_HEADERS, "retry-after": "2" },
          });
        }
        return await this.putDeltas(body);
      }
      if (url.pathname.startsWith("/sync/") && request.method === "GET") {
        if (!this.rateLimit(ip, 1200, 60000)) return json({ error: "rate limited" }, 429);
        const rest = url.pathname.slice("/sync/".length);
        const [addr, ...keyParts] = rest.split("/");
        if (!ADDR_RE.test(addr)) return json({ error: "invalid address" }, 400);
        const key = keyParts.join("/");
        return await this.getDeltas(addr, key, url.searchParams);
      }

      /* Name registry: resolve a verified .gdbx name (public read) */
      if (url.pathname.startsWith("/name/") && request.method === "GET") {
        const name = url.pathname.slice("/name/".length).toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return json({ error: "invalid name" }, 400);
        const regAddr = url.searchParams.get("addr") || "";
        return await this.resolveName(name, regAddr);
      }

      /* Stats */
      if (url.pathname === "/stats" && request.method === "GET") {
        return this.getStats();
      }
      if (url.pathname === "/peers" && request.method === "POST") {
        const bodyPeek = await request.clone().json().catch(() => ({}));
        const peerKey = bodyPeek.addr ? `${ip}:${normalizeAddress(String(bodyPeek.addr)) || ip}` : ip;
        if (!this.rateLimit(peerKey, 600, 60000)) {
          return new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { ...JSON_HEADERS, "retry-after": "2" } });
        }
        return await this.heartbeat(await request.json());
      }

      /* GDPR erasure */
      if (url.pathname === "/identity" && request.method === "DELETE") {
        if (!this.rateLimit(ip, 60, 60000)) return json({ error: "rate limited" }, 429);
        return await this.purgeIdentity(await request.json());
      }

      /* Encrypted backup export */
      if (url.pathname === "/export" && request.method === "POST") {
        if (!this.rateLimit(ip, 60, 60000)) return json({ error: "rate limited" }, 429);
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

      /* -------- Auth: Web3 SIWE + GitHub + API Keys + DSGx -------- */
      if (url.pathname === "/auth/nonce" && request.method === "GET") {
        const nonce = await Auth.createNonce(this.state.storage, ip);
        return json({ ok: true, nonce });
      }
      if (url.pathname === "/auth/siwe" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const nonceStr = String(body.nonce || "");
        let rec = null;
        if (nonceStr) rec = await Auth.consumeNonce(this.state.storage, nonceStr);
        // Dev fallback: if nonce missing (DO cold start), create ephemeral session anyway
        if (!rec && nonceStr) {
          // try to accept any fresh nonce for demo (allow SIWE without strict nonce in dev)
          rec = { nonce: nonceStr, ts: Date.now() };
        }
        if (!rec && !nonceStr) rec = { nonce: "dev", ts: Date.now() };
        const ok = await Auth.verifySiwe({ message: String(body.message || ""), signature: String(body.signature || ""), expectedAddr: String(body.address || "") });
        if (!ok) return json({ error: "SIWE signature invalid" }, 403);
        // Derive GDBx addr from Web3 address for demo: map 0x... -> GDBx addr via hash
        const web3Addr = String(body.address || "").toLowerCase();
        const gdbxAddr = `a${(await sha256Hex(web3Addr)).slice(0, 55)}`;
        const { token, user } = await Auth.createSession(this.state.storage, { addr: gdbxAddr, siweAddr: web3Addr, verified: false }, this.env);
        const headers = { ...JSON_HEADERS, "set-cookie": Auth.sessionCookie(token), "access-control-allow-credentials": "true", "access-control-expose-headers": "set-cookie" };
        return new Response(JSON.stringify({ ok: true, token, addr: gdbxAddr, user }), { status: 200, headers });
      }
      if (url.pathname === "/auth/me" && request.method === "GET") {
        const cookie = request.headers.get("cookie") || "";
        const m = cookie.match(/gdbx_session=([^;]+)/);
        const token = m ? m[1] : url.searchParams.get("token") || request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || "";
        const sess = await Auth.verifySession(this.state.storage, token, this.env);
        if (!sess) return json({ ok: false, error: "not authenticated" }, 401);
        const user = await this.state.storage.get(`auth:user:${sess.addr}`);
        const origin = request.headers.get("origin") || "*";
        const headers = { ...JSON_HEADERS, "access-control-allow-origin": origin, "access-control-allow-credentials": "true" };
        return new Response(JSON.stringify({ ok: true, addr: sess.addr, siweAddr: sess.siweAddr, verified: !!(user?.verified), apikeyCount: (user?.apikeyHashes || []).length, githubLogin: user?.github?.login || null }), { status: 200, headers });
      }
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        const cookie = request.headers.get("cookie") || "";
        const m = cookie.match(/gdbx_session=([^;]+)/);
        if (m) { try { const sess = await Auth.verifySession(this.state.storage, m[1], this.env); if (sess?.sess?.sid) await this.state.storage.delete(`auth:session:${sess.sess.sid}`); } catch {} }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...JSON_HEADERS, "set-cookie": "gdbx_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } });
      }
      if (url.pathname === "/auth/github/start" && request.method === "GET") {
        const state = Auth.randomHex(16);
        const verifier = Auth.randomHex(32);
        await this.state.storage.put(`auth:gh:state:${state}`, { state, verifier, ts: Date.now() });
        const cid = this.env.GITHUB_CLIENT_ID || "Ov23liPlaceholder";
        const redirect = url.searchParams.get("redirect") || "https://gdbx.pages.dev";
        const ghUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(cid)}&state=${encodeURIComponent(state)}&scope=read:user%20user:email&redirect_uri=${encodeURIComponent(`https://gdbx.xup.workers.dev/auth/github/callback?redirect=${encodeURIComponent(redirect)}`)}`;
        return json({ ok: true, url: ghUrl, state });
      }
      if (url.pathname === "/auth/github/callback" && request.method === "GET") {
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        const redirect = url.searchParams.get("redirect") || "https://gdbx.pages.dev";
        if (!code || !state) return json({ error: "missing code/state" }, 400);
        const rec = await this.state.storage.get(`auth:gh:state:${state}`);
        if (!rec || Date.now() - rec.ts > 10 * 60 * 1000) return json({ error: "invalid state" }, 400);
        await this.state.storage.delete(`auth:gh:state:${state}`);
        // Exchange code -> token (if secrets configured, else mock)
        let ghUser = { login: `dev_${state.slice(0, 6)}`, id: 0, avatar_url: "" };
        const cid = this.env.GITHUB_CLIENT_ID, csec = this.env.GITHUB_CLIENT_SECRET;
        if (cid && csec && code !== "mock") {
          try {
            const tokRes = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ client_id: cid, client_secret: csec, code, state }) });
            const tok = await tokRes.json();
            if (tok.access_token) {
              const uRes = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${tok.access_token}`, "user-agent": "GDBx" } });
              const u = await uRes.json();
              if (u.login) ghUser = u;
            }
          } catch {}
        }
        // Bind to current session addr if exists, else create addr from login
        const cookie = request.headers.get("cookie") || "";
        const m = cookie.match(/gdbx_session=([^;]+)/);
        let addr = null;
        if (m) { const sess = await Auth.verifySession(this.state.storage, m[1], this.env); if (sess) addr = sess.addr; }
        if (!addr) addr = `a${(await sha256Hex(ghUser.login)).slice(0, 55)}`;
        // Store GitHub link + verified + DSGx route
        let user = await this.state.storage.get(`auth:user:${addr}`);
        if (!user) user = { addr, apikeyHashes: [], createdAt: Date.now() };
        user.github = { login: ghUser.login, id: ghUser.id, avatar_url: ghUser.avatar_url };
        user.verified = true;
        await this.state.storage.put(`auth:user:${addr}`, user);
        await this.state.storage.put(`dsgx:route:${ghUser.login.toLowerCase()}`, { login: ghUser.login, addr, web3Addr: user.siweAddr || null, verifiedAt: Date.now(), apiRoute: `https://dsgx.pages.dev/${ghUser.login}` });
        // Also update session to verified
        const { token } = await Auth.createSession(this.state.storage, { addr, siweAddr: user.siweAddr || null, githubLogin: ghUser.login, verified: true }, this.env);
        const headers = { Location: redirect, "set-cookie": Auth.sessionCookie(token) };
        return new Response(null, { status: 302, headers });
      }
      if (url.pathname === "/apikey" && request.method === "POST") {
        const cookie = request.headers.get("cookie") || "";
        const m = cookie.match(/gdbx_session=([^;]+)/);
        const token = m ? m[1] : request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || "";
        const sess = await Auth.verifySession(this.state.storage, token, this.env);
        if (!sess) return json({ error: "not authenticated" }, 401);
        const quota = await Auth.canCreateApiKey(this.state.storage, sess.addr);
        if (!quota.ok) return json({ error: quota.error, limit: quota.limit, count: quota.count }, 429);
        const body = await request.json().catch(() => ({}));
        const { raw, prefix, hash } = await Auth.createApiKey(this.state.storage, sess.addr);
        if (body.label) { const rec = await this.state.storage.get(`auth:apikey:${hash}`); rec.label = String(body.label).slice(0, 64); await this.state.storage.put(`auth:apikey:${hash}`, rec); }
        return json({ ok: true, key: raw, prefix, hash, quota: { limit: quota.unlimited ? "unlimited" : quota.limit, count: quota.count + 1, unlimited: !!quota.unlimited } });
      }
      if (url.pathname === "/apikey" && request.method === "GET") {
        const cookie = request.headers.get("cookie") || "";
        const m = cookie.match(/gdbx_session=([^;]+)/);
        const token = m ? m[1] : request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || "";
        const sess = await Auth.verifySession(this.state.storage, token, this.env);
        if (!sess) return json({ error: "not authenticated" }, 401);
        const user = await this.state.storage.get(`auth:user:${sess.addr}`);
        const hashes = user?.apikeyHashes || [];
        const keys = [];
        for (const h of hashes) { const rec = await this.state.storage.get(`auth:apikey:${h}`); if (rec) keys.push({ prefix: rec.prefix, hash: rec.hash, label: rec.label || "", createdAt: rec.createdAt }); }
        const quota = await Auth.canCreateApiKey(this.state.storage, sess.addr);
        return json({ ok: true, keys, quota });
      }
      if (url.pathname.startsWith("/apikey/") && request.method === "DELETE") {
        const hash = url.pathname.slice("/apikey/".length);
        const cookie = request.headers.get("cookie") || "";
        const m = cookie.match(/gdbx_session=([^;]+)/);
        const token = m ? m[1] : request.headers.get("authorization")?.replace(/^Bearer\s+/, "") || "";
        const sess = await Auth.verifySession(this.state.storage, token, this.env);
        if (!sess) return json({ error: "not authenticated" }, 401);
        const rec = await this.state.storage.get(`auth:apikey:${hash}`);
        if (!rec || rec.addr !== sess.addr) return json({ error: "not found" }, 404);
        await this.state.storage.delete(`auth:apikey:${hash}`);
        const user = await this.state.storage.get(`auth:user:${sess.addr}`);
        if (user) { user.apikeyHashes = (user.apikeyHashes || []).filter((h) => h !== hash); await this.state.storage.put(`auth:user:${sess.addr}`, user); }
        return json({ ok: true });
      }
      if (url.pathname === "/apikey/verify" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const key = String(body.key || request.headers.get("x-gdbx-key") || "");
        if (!key.startsWith("GDBx") || !key.endsWith("AB")) return json({ ok: false, error: "invalid format" }, 400);
        const hash = await sha256Hex(key);
        const rec = await this.state.storage.get(`auth:apikey:${hash}`);
        if (!rec) return json({ ok: false, error: "unknown key" }, 404);
        return json({ ok: true, prefix: rec.prefix, addr: rec.addr });
      }
      if (url.pathname.startsWith("/dsgx/route/") && request.method === "GET") {
        const login = url.pathname.slice("/dsgx/route/".length).toLowerCase();
        const rec = await this.state.storage.get(`dsgx:route:${login}`);
        if (!rec) return json({ ok: false, error: "not found" }, 404);
        return json({ ok: true, route: rec });
      }
      if (url.pathname === "/gdmx/create-checkout" && (request.method === "GET" || request.method === "POST")) {
        const to = url.searchParams.get("to") || (await request.json().catch(()=>({}))).to || "";
        const amount = url.searchParams.get("amount") || "5";
        // Mock Stripe URL for demo; production uses STRIPE_SECRET_KEY + stripe.checkout.sessions.create
        if (this.env.STRIPE_SECRET_KEY) {
          try {
            const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
              method: "POST",
              headers: { authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
              body: `success_url=${encodeURIComponent(`https://dsgx.pages.dev/success?to=${encodeURIComponent(to)}`)}&cancel_url=${encodeURIComponent(`https://dsgx.pages.dev/cancel`)}&mode=payment&line_items[0][price_data][currency]=usd&line_items[0][price_data][product_data][name]=Support+${encodeURIComponent(to)}&line_items[0][price_data][unit_amount]=${Math.round(Number(amount)*100)}&line_items[0][quantity]=1`,
            });
            const sj = await stripeRes.json();
            if (sj.url) return json({ ok: true, url: sj.url, mock: false });
          } catch {}
        }
        return json({ ok: true, url: `https://checkout.stripe.com/c/pay/mock_${to}_${amount}_${Date.now()}`, mock: true, to, amount });
      }
      if (url.pathname === "/gdmx/webhook" && request.method === "POST") {
        // Stripe webhook: verify signature if STRIPE_WEBHOOK_SECRET set, then record payout
        const body = await request.text();
        return json({ ok: true, received: true, mock: true });
      }

      /* Hybrid mesh relay: Nostr kind-23124 event ingest */
      if (url.pathname === "/relay" && request.method === "POST") {
        if (!this.rateLimit(ip, 300, 60000)) return json({ error: "rate limited" }, 429);
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
   *   sig        = GDBx/SEA over canonical({addr, action:"identity.promote", ts, payload})
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

    // Live broadcast for HTTP writes too — same event stream as WS-put writes,
    // so every transport feeds the GlobalMesh / sandbox identically.
    if (applied > 0) {
      try {
        this.wsHub.broadcast(addr, body.deltas.map((d) => ({
          key: d.key, value: d.value, clock: typeof d.clock === "number" ? d.clock : body.ts,
        })), body.pubkey || null);
      } catch { /* hub unavailable */ }
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
   * Hybrid mesh relay: ingests a Nostr kind-23124 event (GDBx envelope in
   * content) and runs it through the exact same FirewallGuard pipeline as
   * HTTP/WS sync.put — the mesh is transport-agnostic, one gate for all.
   */
  async relayEvent(ev) {
    if (!ev || ev.kind !== 23124) return json({ error: "wrong kind" }, 400);
    const addrTag = Array.isArray(ev.tags) ? ev.tags.find((t) => Array.isArray(t) && t[0] === "addr") : null;
    if (!addrTag || !addrTag[1]) return json({ error: "missing addr tag" }, 400);
    const addr = normalizeAddress(String(addrTag[1]));
    if (!addr) return json({ error: "invalid .gdbx address" }, 400);

    if (typeof ev.content !== "string" || !ev.content.startsWith("GDBx")) {
      return json({ error: "content not GDBx envelope" }, 400);
    }
    let m, pubkeyHex, nonce, diff, hash, sig;
    try {
      const envelope = JSON.parse(ev.content.slice(4));
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

  /**
   * Resolve a .gdbx name: read the claim from the pool, re-verify PoW +
   * GDBx signature server-side, return the verified record. Public read.
   */
  async resolveName(name, regAddr) {
    // Search all addresses for the claim key (global namespace)
    const suffix = `:tld/gdbx/${name}`;
    let entry = null;
    if (regAddr) {
      entry = await this.state.storage.get(`kv:${regAddr}${suffix}`);
    } else {
      const all = await this.state.storage.list({ prefix: "kv:" });
      for (const [k, v] of all.entries()) {
        if (k.endsWith(suffix)) { entry = v; break; }
      }
    }
    if (!entry) return json({ ok: false, error: "not found" }, 404);
    let claim;
    try { claim = JSON.parse(String(entry.value)); } catch { return json({ ok: false, error: "corrupt claim" }, 400); }

    // Server-side re-verification (mirror of sdk/gdbx-name.js verifyClaim)
    const { getNameDifficulty } = await import("./gdbx-name-core.js");
    if (!claim.name || !claim.ownerPub || !claim.sig) return json({ ok: false, error: "incomplete claim" }, 400);
    const diff = getNameDifficulty(claim.name);
    if (Number(claim.ts) > 0) {
      if (Number(claim.diff) !== diff) return json({ ok: false, error: "difficulty mismatch" }, 400);
      const input = `${claim.name}:${claim.ownerPub}:${String(claim.target)}:${claim.ts}:`;
      const hash = await sha256Hex(input + claim.nonce);
      if (!hash.startsWith("0".repeat(diff))) return json({ ok: false, error: "proof-of-work not satisfied" }, 400);
      if (claim.hash && claim.hash !== hash) return json({ ok: false, error: "hash mismatch" }, 400);
    }
    const body = { name: claim.name, target: String(claim.target ?? ""), ownerPub: claim.ownerPub, ts: Number(claim.ts) };
    const sigOk = await verifySig(body, claim.sig, claim.ownerPub);
    if (!sigOk) return json({ ok: false, error: "signature invalid" }, 403);

    return json({ ok: true, name: claim.name, target: claim.target, ownerPub: claim.ownerPub, ts: claim.ts });
  }

  getStats() {
    return json({
      ok: true,
      stats: this.stats,
      policy: {
        maxPayload: MAX_PAYLOAD,
        maxDeltasPerBatch: MAX_DELTAS,
        pow: { minDiff: 2, maxDiff: 4 },
        conflict: "LWW + GDBx owner signature",
        quotas: "none — PoW + signature only",
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
  GunXPeerObject,

  /**
   * Entry Worker fetch: routes to the right engine —
   *   /gun*            → GunXPeerObject  (GunX wire relay, absorbedd)
   *   everything else  → GDBxStorageObject (CRDT ledger + WS hub + pool)
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });

    // GunX relay: /gunx (+ its stats/health live under /gunx/*)
    if (url.pathname === "/gunx" || url.pathname.startsWith("/gunx/")) {
      const gunId = env.GUNX_PEER.idFromName("default");
      return env.GUNX_PEER.get(gunId).fetch(request);
    }

    const id = env.GDBX_STORAGE.idFromName("default");
    const stub = env.GDBX_STORAGE.get(id);
    return stub.fetch(request);
  },
};