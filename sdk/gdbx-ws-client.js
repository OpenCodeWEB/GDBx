/**
 * gdbx-ws-client.js â€” Real-time WebSocket sync client for GDBx.
 *
 *   const gdbx = new GDBxWS({ pubkeyHex, pair, addr?, api: "wss://gdbx.xup.workers.dev/ws" });
 *   await gdbx.connect();
 *   gdbx.on("delta", (e) => ...);   // live updates broadcast by the edge
 *   gdbx.on("applied", (e) => ...); // your own write confirmation
 *   await gdbx.put([{ key, value, clock? }]);
 *   await gdbx.getSnapshot(prefix?);
 *   gdbx.close();
 *
 * Pure ESM â€” works in browsers and Node 18+ (global WebSocket required in
 * Node; browsers have it natively).
 */
import { makeAddress } from "./gdbx-codec.js";
import { minePoW, signBody, getDifficulty } from "./gdbx-sdk.js";
import { sign as cryptoSign } from "./gdbx-crypto.js";

export class GDBxWS {
  /**
   * @param {object} opts
   * @param {string} opts.pubkeyHex  130-char uncompressed P-256 hex (owner)
   * @param {object} opts.pair       SEA pair { pub, priv } (owner)
   * @param {string} [opts.addr]     optional explicit .gdbx address
   * @param {string} [opts.api]      websocket endpoint (default gdbx worker â€” Pages does not proxy WS upgrades)
   */
  constructor(opts) {
    if (!opts || !opts.pubkeyHex || !opts.pair) throw new Error("pubkeyHex and pair required");
    this.pubkeyHex = opts.pubkeyHex;
    this.pair = opts.pair;
    this.addr = opts.addr || makeAddress(opts.pubkeyHex, 0);
    this.api = opts.api || "wss://gdbx.xup.workers.dev/ws";
    this.ws = null;
    this._listeners = new Map();
    this._seq = 0;
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
    return this;
  }

  _emit(type, data) {
    for (const fn of this._listeners.get(type) || []) {
      try { fn(data); } catch (e) { console.error("gdbx-ws listener error", e); }
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.api}?addr=${this.addr}`);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "hello", addr: this.addr }));
        resolve(this);
      };
      ws.onerror = (e) => reject(new Error("websocket error: " + (e?.message || "unknown")));
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg.type === "welcome") this._emit("welcome", msg);
        else if (msg.type === "applied") this._emit("applied", msg);
        else if (msg.type === "delta") this._emit("delta", msg);
        else if (msg.type === "snapshot") this._emit("snapshot", msg);
        else if (msg.type === "error") this._emit("error", msg);
        else if (msg.type === "pong") this._emit("pong", msg);
      };
      ws.onclose = () => this._emit("close", {});
    });
  }

  /** Put signed deltas over the wire (same payload as POST /sync). */
  async put(deltas) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
    const ts = Date.now();
    const list = deltas.map((d) => ({ key: d.key, value: d.value, clock: d.clock ?? ts }));
    const { nonce, hash, diff } = await minePoW(this.addr, this.pair.pub, "sync.put", ts);
    const sig = await cryptoSign(signBody(this.addr, "sync.put", ts, JSON.stringify(list)), this.pair);
    this.ws.send(JSON.stringify({
      type: "put",
      addr: this.addr,
      pubkey: this.pair.pub,
      pubkeyHex: this.pubkeyHex,
      deltas: list,
      ts,
      nonce,
      diff,
      hash,
      sig,
    }));
    return { sent: list.length, ts };
  }

  /** Ask for a snapshot of the current state (prefix optional). */
  getSnapshot(prefix) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
    this.ws.send(JSON.stringify({ type: "get", addr: this.addr, prefix: prefix || "" }));
  }

  ping() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
    this.ws.send(JSON.stringify({ type: "ping" }));
  }

  close() {
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }
}

export default GDBxWS;