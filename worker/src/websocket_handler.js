/**
 * websocket_handler.js — Real-time WebSocket sync for GDBx.
 *
 * Endpoint: /ws?addr=:addr (served by the gdbx-do Worker's Durable Object —
 * the hub lives INSIDE the DO instance so all sockets for the same address
 * share one isolate and broadcasts are reliable).
 *
 * Protocol (JSON text frames):
 *   client → { type:"hello", addr, pubkey }             — identify
 *   server → { type:"welcome", addr, ts }               — accept
 *   client → { type:"put", addr, pubkey, pubkeyHex, deltas[], ts, nonce, diff, hash, sig }
 *                                                        — signed delta batch (same body as POST /sync)
 *   server → { type:"applied", addr, applied, ts }      — applied count
 *   server → { type:"delta", addr, key, value, clock, ownerPub }  — live broadcast to other subscribers
 *   client → { type:"get", addr, prefix? }              — fetch snapshot
 *   server → { type:"snapshot", addr, entries[] }
 *   client → { type:"ping" } / server → { type:"pong" }
 *
 * Broadcast scope: all sockets subscribed to the same addr (DO-local hub).
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const PING_INTERVAL_MS = 30_000;
const MAX_SOCKETS = 4096;

/**
 * Create a self-contained WebSocket hub. Each hub owns its own socket set —
 * embed one inside the Durable Object so every connection for the address
 * lands in the same isolate (singleton DO) and broadcast works end to end.
 *
 * @param {(env:object)=>object} getStorageStub  returns a DO-like stub {fetch}
 */
export function createWebSocketHub(getStorageStub) {
  const sockets = new Set(); // all open websockets (hub-local)
  const socketStates = new WeakMap(); // server socket → { addr, alive, lastPing }

  async function accept(request, env) {
    const url = new URL(request.url);
    const addr = (url.searchParams.get("addr") || "").toLowerCase();
    if (!/^[a-z2-7]{58}$/.test(addr)) {
      return new Response(JSON.stringify({ error: "invalid or missing addr param (58-char base32)" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    if (sockets.size >= MAX_SOCKETS) {
      return new Response(JSON.stringify({ error: "too many websocket connections" }), {
        status: 429,
        headers: JSON_HEADERS,
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    const state = { addr, alive: true, lastPing: Date.now() };
    sockets.add(server);
    socketStates.set(server, state);

    server.addEventListener("message", async (event) => {
      if (!state.alive) return;
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        server.send(JSON.stringify({ type: "error", error: "invalid JSON" }));
        return;
      }

      try {
        await handleMessage(msg, server, state, env);
      } catch (e) {
        server.send(JSON.stringify({ type: "error", error: String(e?.message || e) }));
      }
    });

    server.addEventListener("close", () => {
      state.alive = false;
      sockets.delete(server);
      socketStates.delete(server);
    });
    server.addEventListener("error", () => {
      state.alive = false;
      sockets.delete(server);
      socketStates.delete(server);
    });

    // liveness ping
    const timer = setInterval(() => {
      if (!state.alive) {
        clearInterval(timer);
        return;
      }
      if (Date.now() - state.lastPing > 90_000) {
        try { server.close(); } catch {}
        clearInterval(timer);
        return;
      }
      try { server.send(JSON.stringify({ type: "ping" })); } catch {}
    }, PING_INTERVAL_MS);

    server.send(JSON.stringify({ type: "welcome", addr, ts: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async function handleMessage(msg, server, state, env, storageStubOverride) {
    const storageStub = storageStubOverride || getStorageStub(env);
    switch (msg.type) {
      case "hello": {
        const addr = (msg.addr || "").toLowerCase();
        if (!/^[a-z2-7]{58}$/.test(addr)) {
          server.send(JSON.stringify({ type: "error", error: "invalid addr" }));
          return;
        }
        state.addr = addr;
        server.send(JSON.stringify({ type: "welcome", addr, ts: Date.now() }));
        return;
      }

      case "put": {
        if (!state.addr) {
          server.send(JSON.stringify({ type: "error", error: "send hello first" }));
          return;
        }
        // Reuse the exact same validation path as POST /sync (FirewallGuard:
        // PoW → replay → signature → RBAC → ACL). The DO's rate limiter is
        // keyed by IP+addr and gives demo keys a generous burst budget, so a
        // normal sandbox session never sees "rate limited".
        const stub = storageStub;
        const body = { ...msg, addr: msg.addr || state.addr };
        const target = new URL("https://do.local/sync");
        const proxy = new Request(target.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const res = await stub.fetch(proxy);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          server.send(JSON.stringify({ type: "error", error: data.error || `HTTP ${res.status}`, status: res.status }));
          return;
        }
        server.send(JSON.stringify({ type: "applied", addr: data.addr, applied: data.applied, ts: Date.now() }));
        // live broadcast to every subscriber of the same addr - including the
        // sender (like Gun's own-write echo): a single client can therefore
        // observe its own writes landing, and cross-client peers get them too.
        api.broadcast(data.addr, Array.isArray(msg.deltas) ? msg.deltas : [], msg.pubkey || null);
        return;
      }

      case "get": {
        if (!state.addr) {
          server.send(JSON.stringify({ type: "error", error: "send hello first" }));
          return;
        }
        const stub = storageStub;
        const prefix = msg.prefix ? `?prefix=${encodeURIComponent(String(msg.prefix))}` : "";
        const target = new URL(`https://do.local/sync/${state.addr}${prefix}`);
        const proxy = new Request(target.toString(), { method: "GET" });
        const res = await stub.fetch(proxy);
        const data = await res.json().catch(() => ({}));
        server.send(JSON.stringify({ type: "snapshot", addr: state.addr, count: data.count || 0, entries: data.entries || [] }));
        return;
      }

      case "ping":
        state.lastPing = Date.now();
        server.send(JSON.stringify({ type: "pong" }));
        return;

      default:
        server.send(JSON.stringify({ type: "error", error: "unknown message type: " + msg.type }));
    }
  }

  const api = {
    accept,
    handleMessage,
    sockets,
    socketStates,
    subscribe(socket, state) {
      sockets.add(socket);
      socketStates.set(socket, state);
    },
    unsubscribe(socket) {
      sockets.delete(socket);
      socketStates.delete(socket);
    },
    list() {
      return [...sockets];
    },
    /**
     * Broadcast applied deltas to every subscriber of the addr — used by the
     * DO after HTTP /sync writes too, so ALL transports (HTTP, WS put, relay)
     * produce identical live broadcasts. Zero-transport asymmetry.
     */
    broadcast(addr, deltas, ownerPub) {
      const appliedDeltas = Array.isArray(deltas) ? deltas : [];
      for (const s of sockets) {
        const st = socketStates.get(s);
        if (st && st.addr === addr) {
          for (const d of appliedDeltas) {
            try {
              s.send(JSON.stringify({
                type: "delta",
                addr,
                key: d.key,
                value: d.value,
                clock: d.clock,
                ownerPub: ownerPub || null,
              }));
            } catch { /* socket closing */ }
          }
        }
      }
    },
  };

  return api;
}

/* ── Backwards-compatible module-level hub (used by tests) ────────── */

const defaultHub = createWebSocketHub(() => {
  throw new Error("default hub requires a storage stub — pass it explicitly");
});

/** Exposed for tests: process one protocol message against a fake socket. */
export async function handleProtocolMessage(msg, socket, state, storageStub) {
  await defaultHub.handleMessage(msg, socket, state, {}, storageStub);
}

/** Exposed for tests: subscribe a fake socket to broadcast addr. */
export function subscribeTestSocket(socket, state) {
  defaultHub.subscribe(socket, state);
}

/** Exposed for tests: unsubscribe. */
export function unsubscribeTestSocket(socket) {
  defaultHub.unsubscribe(socket);
}

/** Exposed for tests: list currently subscribed fake sockets. */
export function testSocketList() {
  return defaultHub.list();
}