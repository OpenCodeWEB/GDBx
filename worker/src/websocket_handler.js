/**
 * websocket_handler.js — Real-time WebSocket sync for GDBx.
 *
 * Endpoint: /ws?addr=:addr (plain HTTP worker path, proxied from Pages)
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
 * Broadcast scope: all sockets subscribed to the same addr (edge-local).
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const PING_INTERVAL_MS = 30_000;
const MAX_SOCKETS = 256;

const sockets = new Set(); // all open websockets (single isolate — edge-local)
const socketStates = new WeakMap(); // server socket → { addr, alive, lastPing }

export function registerWebSocketHandler(getStorageStub) {
  return async function onWebSocket(request, env) {
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
        await handleMessage(msg, server, state, getStorageStub, env);
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
  };
}

async function handleMessage(msg, server, state, getStorageStub, env) {
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
      // reuse the exact same validation path as POST /sync
      const stub = await getStorageStub(env);
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
      // live broadcast to other subscribers of the same addr
      const appliedDeltas = Array.isArray(msg.deltas) ? msg.deltas : [];
      for (const s of sockets) {
        if (s === server) continue;
        const otherState = socketState(s);
        if (otherState && otherState.addr === data.addr) {
          for (const d of appliedDeltas) {
            s.send(JSON.stringify({
              type: "delta",
              addr: data.addr,
              key: d.key,
              value: d.value,
              clock: d.clock,
              ownerPub: msg.pubkey || null,
            }));
          }
        }
      }
      return;
    }

    case "get": {
      if (!state.addr) {
        server.send(JSON.stringify({ type: "error", error: "send hello first" }));
        return;
      }
      const stub = await getStorageStub(env);
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

/** Track addr per socket (weakly) for broadcast targeting. */
function socketState(socket) {
  return socketStates.get(socket) || null;
}

/** Exposed for tests: process one protocol message against a fake socket. */
export async function handleProtocolMessage(msg, socket, state, storageStub) {
  await handleMessage(msg, socket, state, () => Promise.resolve(storageStub), {});
}

/** Exposed for tests: subscribe a fake socket to broadcast addr. */
export function subscribeTestSocket(socket, state) {
  sockets.add(socket);
  socketStates.set(socket, state);
}

/** Exposed for tests: unsubscribe. */
export function unsubscribeTestSocket(socket) {
  sockets.delete(socket);
  socketStates.delete(socket);
}

/** Exposed for tests: list currently subscribed fake sockets. */
export function testSocketList() {
  return [...sockets];
}