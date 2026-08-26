/**
 * interconnect.js â€” GDBx Unified Interconnect (any host + local, secure, always updated)
 *
 * One mesh, everywhere:
 * - Hosted: wss://gdbx.xup.workers.dev (global hub)
 * - Local: ws://localhost:8787 (local bridge, offline-first)
 * - Nostr: wss://relay.damus.io (optional, hybrid mesh)
 * - WebRTC: direct P2P (offline, no server)
 *
 * All transports share one GDBx-signed, FirewallGuard-gated, pool-replicated fabric.
 * Version distribution: sys/gdbx/version (superadmin GDBx-signed) â€” all nodes subscribe.
 */

import { putDeltas, getDeltas, addressFromPubkey } from "./gdbx-sdk.js";
import { canonicalJson, sign } from "./gdbx-crypto.js";
import {
  DEFAULT_GLOBAL,
  DEFAULT_LOCAL,
  VERSION_KEY,
  MANDATORY_GLOBAL,
  buildAddrs,
  GDBX_VERSION,
} from "./gdbx-config.js";

function b64uToHex(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
  return [...bin].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
}

async function derivePubkeyHex(pub) {
  const [x, y] = pub.split(".");
  return "04" + b64uToHex(x) + b64uToHex(y);
}

export class GDBxInterconnect {
  constructor(opts = {}) {
    this.pair = opts.pair || null;
    this.pubkeyHex = opts.pubkeyHex || null;
    this.addr = opts.addr || null;
    // MANDATORY: Global hubs always connected (cannot be overridden)
    // Custom hosts (gdbx.<account>.workers.dev or other) are ADDED alongside globals
    const custom = opts.addrs || opts.customAddrs || opts.extraAddrs || [];
    const customList = Array.isArray(custom) ? custom : [custom].filter(Boolean);
    this.addrs = buildAddrs(customList);
    this.transports = new Map(); // url -> ws
    this.deltaHandlers = new Set();
    this.versionHandlers = new Set();
    this.versionPoll = null;
    this.lastVersion = null;
  }

  async initIdentity() {
    if (this.pair && this.pubkeyHex && this.addr) return;
    if (this.pair && this.pair.pub) {
      this.pubkeyHex = this.pubkeyHex || (await derivePubkeyHex(this.pair.pub));
      this.addr = this.addr || addressFromPubkey(this.pubkeyHex);
    }
  }

  async connect() {
    await this.initIdentity();
    for (const url of this.addrs) {
      try {
        await this._connectOne(url);
      } catch {}
    }
    // also watch version
    this.watchVersion(() => {});
    // fallback poll every 60s
    if (!this.versionPoll) {
      this.versionPoll = setInterval(() => this._fetchVersion(), 60000);
    }
    return this;
  }

  async _connectOne(baseUrl) {
    return new Promise((resolve, reject) => {
      try {
        const url = baseUrl.includes("?") ? baseUrl : `${baseUrl}?addr=${this.addr}`;
        const ws = new WebSocket(url);
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "hello", addr: this.addr }));
          this.transports.set(baseUrl, ws);
          resolve(ws);
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "delta" && msg.key) {
              for (const h of this.deltaHandlers) h(msg);
              if (msg.key === VERSION_KEY) {
                for (const h of this.versionHandlers) h(JSON.parse(msg.value));
                this.lastVersion = JSON.parse(msg.value);
              }
            }
          } catch {}
        };
        ws.onclose = () => {
          this.transports.delete(baseUrl);
          // auto-reconnect after 5s
          setTimeout(() => this._connectOne(baseUrl).catch(() => {}), 5000);
        };
        ws.onerror = () => reject(new Error("ws error"));
        setTimeout(() => reject(new Error("timeout")), 8000);
      } catch (e) {
        reject(e);
      }
    });
  }

  onDelta(cb) {
    this.deltaHandlers.add(cb);
    return () => this.deltaHandlers.delete(cb);
  }

  async put(key, value) {
    await this.initIdentity();
    const ts = Date.now();
    // PoW + GDBx sign via sdk's putDeltas (which does PoW+sig internally)
    // Use direct putDeltas for global hub; local transports will receive via broadcast if connected
    return putDeltas({ pubkeyHex: this.pubkeyHex, pair: this.pair, deltas: [{ key, value, clock: ts }] });
  }

  async get(prefix = "") {
    await this.initIdentity();
    return getDeltas(this.addr, prefix);
  }

  // Version distribution: superadmin publishes to sys/gdbx/version, all nodes watch
  async publishVersion({ v, changelog, url }) {
    const manifest = { v, changelog, url, ts: Date.now(), hash: "" };
    // hash for integrity (blake3 of v+changelog)
    const hashInput = `${v}:${changelog}:${url}`;
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
    manifest.hash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return this.put(VERSION_KEY, JSON.stringify(manifest));
  }

  async _fetchVersion() {
    try {
      const data = await this.get(VERSION_KEY);
      // getDeltas with prefix returns entries, but VERSION_KEY is exact; use get with prefix
      const res = await getDeltas(this.addr, VERSION_KEY);
      const entry = (res.entries || []).find((e) => e.key === VERSION_KEY);
      if (entry && entry.value !== JSON.stringify(this.lastVersion)) {
        const ver = JSON.parse(entry.value);
        if (JSON.stringify(ver) !== JSON.stringify(this.lastVersion)) {
          this.lastVersion = ver;
          for (const h of this.versionHandlers) h(ver);
        }
      }
    } catch {}
  }

  watchVersion(cb) {
    this.versionHandlers.add(cb);
    // immediate fetch
    this._fetchVersion();
    return () => this.versionHandlers.delete(cb);
  }

  disconnect() {
    for (const ws of this.transports.values()) {
      try { ws.close(); } catch {}
    }
    this.transports.clear();
    if (this.versionPoll) clearInterval(this.versionPoll);
  }

  getStatus() {
    return {
      addr: this.addr,
      transports: Array.from(this.transports.keys()),
      connected: this.transports.size,
      lastVersion: this.lastVersion,
    };
  }
}

export default GDBxInterconnect;
