/**
 * ftp_bridge.js — GDBx FTP Bridge SDK (GDBx-native, sovereign)
 *
 * Maps FTP files to GDBx pool via chunker + GDBx-signed manifests.
 * Works in browser, Node, and Workers (WebCrypto + @noble/hashes).
 *
 * Usage:
 *   import { GDBxFTP } from "./ftp_bridge.js";
 *   const ftp = new GDBxFTP({ pair, pubkeyHex });
 *   await ftp.put(fileData, "/docs/paper.pdf");
 *   const data = await ftp.get("/docs/paper.pdf");
 *   await ftp.sync("/docs", (event) => console.log(event));
 */

import { process, assemble, bytesToB64url, b64ToBytes } from "./utils/chunker.js";
import { putDeltas, getDeltas, addressFromPubkey } from "./gdbx-sdk.js";

function pathToKey(remotePath) {
  let p = String(remotePath || "/").trim();
  if (!p.startsWith("/")) p = "/" + p;
  // keep slashes, GDBx key allows :/_-@.
  return `sys/ftp/manifest${p}`;
}
function chunkKey(hash) {
  return `sys/ftp/chunk/${hash}`;
}

export class GDBxFTP {
  constructor(opts = {}) {
    this.pair = opts.pair || null;
    this.pubkeyHex = opts.pubkeyHex || opts.pubkey_hex || null;
    this.addr = opts.addr || (this.pubkeyHex ? addressFromPubkey(this.pubkeyHex) : null);
    this.api = opts.api || null;
    this.targetAddr = null;
    // for tests: inject mock client {putDeltas, getDeltas}
    this._putDeltas = opts.putDeltas || putDeltas;
    this._getDeltas = opts.getDeltas || getDeltas;
  }

  async connect(gdbxUrl) {
    let addr = String(gdbxUrl || "").trim();
    addr = addr.replace(/^ftp:\/\//i, "").replace(/\.gdbx$/i, "");
    // normalize: if it looks like a .gdbx bare, keep, else try to resolve as addr
    // For MVP, just set targetAddr and return
    this.targetAddr = addr;
    return { status: "CONNECTED", target: addr };
  }

  async put(localData, remotePath) {
    if (!this.pair || !this.pubkeyHex) throw new Error("GDBxFTP: pair/pubkeyHex required");
    const data = localData instanceof Uint8Array ? localData : new Uint8Array(localData);
    const { manifest, encryptedChunks } = await process(data, { path: remotePath });
    // 1. Put manifest (signed via putDeltas which does PoW+GDBx)
    const manifestKey = pathToKey(remotePath);
    const manifestValue = JSON.stringify(manifest);
    await this._putDeltas({ pubkeyHex: this.pubkeyHex, pair: this.pair, deltas: [{ key: manifestKey, value: manifestValue }] });
    for (let i = 0; i < encryptedChunks.length; i++) {
      const hash = manifest.chunks[i];
      const b64 = bytesToB64url(encryptedChunks[i]);
      await this._putDeltas({ pubkeyHex: this.pubkeyHex, pair: this.pair, deltas: [{ key: chunkKey(hash), value: b64 }] });
    }
    return { success: true, path: remotePath, manifest };
  }

  async get(remotePath) {
    if (!this.pair || !this.pubkeyHex) throw new Error("GDBxFTP: pair/pubkeyHex required");
    const manifestKey = pathToKey(remotePath);
    const addr = this.addr;
    let manifestStr = null;
    const data = await this._getDeltas(addr, manifestKey);
    if (data.entries) {
      const found = data.entries.find((e) => e.key === manifestKey);
      if (found) manifestStr = String(found.value);
    }
    if (!manifestStr) {
      const all = await this._getDeltas(addr, "sys/ftp/manifest/");
      const found = (all.entries || []).find((e) => e.key === manifestKey);
      if (!found) throw new Error(`not found: ${remotePath}`);
      manifestStr = String(found.value);
    }
    const manifest = JSON.parse(manifestStr);
    const encryptedChunks = [];
    for (const hash of manifest.chunks) {
      const ck = chunkKey(hash);
      const cData = await this._getDeltas(addr, ck);
      let b64 = null;
      if (cData.entries) {
        const f = cData.entries.find((e) => e.key === ck);
        if (f) b64 = String(f.value);
      }
      if (!b64) {
        const allChunks = await this._getDeltas(addr, "sys/ftp/chunk/");
        const f = (allChunks.entries || []).find((e) => e.key === ck);
        if (!f) throw new Error(`chunk not found: ${hash}`);
        b64 = String(f.value);
      }
      encryptedChunks.push(b64ToBytes(b64));
    }
    const out = await assemble(encryptedChunks, manifest.iv, manifest.keyB64);
    return out;
  }

  async sync(prefix, cb) {
    const basePrefix = `sys/ftp/manifest${prefix.startsWith("/") ? prefix : "/" + prefix}`;
    let seen = new Set();
    let timer = null;
    const poll = async () => {
      try {
        const data = await this._getDeltas(this.addr, basePrefix);
        for (const e of data.entries || []) {
          if (seen.has(e.key)) continue;
          seen.add(e.key);
          try {
            const manifest = JSON.parse(String(e.value));
            cb({ key: e.key, manifest, path: e.key.replace("sys/ftp/manifest", "") });
          } catch {}
        }
      } catch {}
    };
    await poll();
    timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }

  async ls(prefix = "/") {
    const data = await this._getDeltas(this.addr, `sys/ftp/manifest${prefix}`);
    return (data.entries || []).map((e) => {
      try { return { key: e.key, manifest: JSON.parse(String(e.value)) }; } catch { return { key: e.key, raw: e.value }; }
    });
  }
}

export default GDBxFTP;
