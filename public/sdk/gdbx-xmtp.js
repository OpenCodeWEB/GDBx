/**
 * gdbx-xmtp.js — XMTP v3 transport adapter for the GDBx mesh.
 *
 * XMTP (https://xmtp.org, https://github.com/xmtp) is a decentralized,
 * E2E-encrypted messaging network. GDBx uses it as mesh transport #2:
 * one MLS group room per `.gdbx` address (`gdbx/<addr>`), carrying the
 * SAME signed GDBx envelope as Nostr — so whatever medium delivers the
 * envelope, the receiver (and the worker FirewallGuard) verifies it
 * identically.
 *
 * The XMTP SDK is lazy-loaded from CDN at runtime (no npm dependency):
 * `@xmtp/browser-sdk` via esm.sh. Identity = your EVM wallet
 * (MetaMask / any injected provider) or any EOA signer you pass in.
 *
 * Usage:
 *
 *   import { GDBxXMTP, ethereumSigner } from "./gdbx-xmtp.js";
 *   const mesh = new GDBxXMTP();
 *   await mesh.connect({ signer: await ethereumSigner() }); // or { address, signer }
 *   const room = await mesh.openRoom(addr);                 // find/create gdbx/<addr>
 *   await mesh.send({ addr, pubkey, pubkeyHex, ts, nonce, diff, hash, deltas, sig });
 *   mesh.stream((parsed) => console.log(parsed.deltas));   // live GDBx messages
 */

import { buildXmtpMessage, parseXmtpMessage, xmtpRoomName } from "./transport.js?v=1";

/** Pinned XMTP browser SDK (MLS / v3 protocol) loaded at runtime. */
export const XMTP_SDK_URL = "https://esm.sh/@xmtp/browser-sdk@4.1.0";

/** XMTP network environment. */
export const XMTP_ENV = "production";

function hexToBytes(hex) {
  const h = String(hex).replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build an XMTP-compatible EOA signer from the injected EVM wallet.
 * No ethers dependency — raw `window.ethereum` JSON-RPC only.
 * @returns {Promise<{type:string, getAddress:Function, signMessage:Function, address:string}>}
 */
export async function ethereumSigner() {
  const eth = typeof window !== "undefined" ? window.ethereum : null;
  if (!eth) throw new Error("No EVM wallet — install MetaMask or pass your own signer to connect()");
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  const address = accounts && accounts[0];
  if (!address) throw new Error("Wallet returned no accounts");
  return {
    type: "EOA",
    address,
    getAddress: async () => address,
    getIdentifier: () => ({ identifier: address.toLowerCase(), identifierKind: "Ethereum" }),
    signMessage: async (message) => {
      const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
      const sig = await eth.request({
        method: "personal_sign",
        params: [bytesToHex(bytes), address],
      });
      return hexToBytes(sig);
    },
  };
}

export class GDBxXMTP {
  /**
   * @param {{env?:string, sdkUrl?:string, worker?:string}} [o]
   */
  constructor(o = {}) {
    this.env = o.env || XMTP_ENV;
    this.sdkUrl = o.sdkUrl || XMTP_SDK_URL;
    this.worker = (o.worker || "https://gdbx.pages.dev").replace(/\/$/, "");
    this.Client = null;
    this.client = null;
    this.address = "";
    this.room = null;
    this.roomName = "";
    this._streaming = false;
  }

  get connected() {
    return !!this.client;
  }

  async _loadSdk() {
    if (this.Client) return this.Client;
    let mod = null;
    try {
      mod = await import(/* @vite-ignore */ this.sdkUrl);
    } catch (e) {
      throw new Error(`XMTP SDK load failed (${this.sdkUrl}): ${e.message} — check network / CSP`);
    }
    const Client = mod.Client || (mod.default && mod.default.Client) || mod.default;
    if (!Client || typeof Client.create !== "function") {
      throw new Error("XMTP SDK has no Client.create — pinned version may have changed, see https://docs.xmtp.org");
    }
    this.Client = Client;
    return Client;
  }

  /**
   * Connect an XMTP client.
   * @param {{signer?:object, address?:string}} [o] — signer from ethereumSigner()
   *   or your own EOA signer; address overrides display identity.
   */
  async connect(o = {}) {
    const Client = await this._loadSdk();
    const signer = o.signer || (await ethereumSigner());
    this.address = o.address || signer.address || (await signer.getAddress());
    try {
      this.client = await Client.create(signer, { env: this.env });
    } catch (e) {
      throw new Error(`XMTP Client.create failed: ${e.message}`);
    }
    return { address: this.address, env: this.env };
  }

  /** List group rooms previously used as GDBx mesh rooms. */
  async listRooms() {
    if (!this.client) throw new Error("Not connected — call connect() first");
    const convos = this.client.conversations;
    if (!convos || typeof convos.list !== "function") return [];
    const all = await convos.list();
    return (all || []).filter((c) => typeof c.name === "string" && c.name.startsWith("gdbx/"));
  }

  /**
   * Find the `gdbx/<addr>` room or create it (self-only MLS group).
   * @param {string} addr — 58-char `.gdbx` address
   */
  async openRoom(addr) {
    if (!this.client) throw new Error("Not connected — call connect() first");
    if (!addr || typeof addr !== "string") throw new Error("addr required");
    const name = xmtpRoomName(addr);
    const existing = await this.listRooms();
    const found = existing.find((c) => c.name === name);
    if (found) {
      this.room = found;
      this.roomName = name;
      return found;
    }
    const convos = this.client.conversations;
    if (!convos || typeof convos.newGroup !== "function") {
      throw new Error("XMTP SDK has no conversations.newGroup — see https://docs.xmtp.org");
    }
    // Self-only room: members = [] lets the owner sync this address's
    // envelopes across their own devices; peers join via invite/DM flow.
    this.room = await convos.newGroup([], {
      groupName: name,
      groupDescription: `GDBx mesh room for ${addr} — signed LWW-CRDT envelopes`,
    });
    this.roomName = name;
    return this.room;
  }

  /**
   * Post a signed GDBx delta batch into the address room.
   * Same fields as the worker `/sync` endpoint + Nostr relay events.
   */
  async send(o) {
    if (!o || !o.addr) throw new Error("addr required");
    const msg = await buildXmtpMessage(o);
    const room = this.room && this.roomName === msg.room ? this.room : await this.openRoom(o.addr);
    if (typeof room.send !== "function") throw new Error("XMTP conversation has no send()");
    const id = await room.send(msg.content);
    return { ok: true, transport: "xmtp", room: msg.room, id: id ?? null };
  }

  /**
   * Stream live GDBx envelopes from the open room.
   * @param {(parsed:object)=>void} onMessage — receives parseXmtpMessage() output
   * @param {(err:Error)=>void} [onError]
   */
  async stream(onMessage, onError) {
    if (!this.room) throw new Error("No room open — call openRoom(addr) first");
    if (typeof this.room.stream !== "function") throw new Error("XMTP conversation has no stream()");
    if (this._streaming) return;
    this._streaming = true;
    const roomName = this.roomName;
    try {
      for await (const msg of this.room.stream()) {
        const content = typeof msg === "string" ? msg : msg?.content;
        if (typeof content !== "string" || !content.startsWith("GDBx")) continue;
        const parsed = parseXmtpMessage(content, roomName);
        if (parsed.ok) {
          try {
            await onMessage(parsed);
          } catch (e) {
            if (onError) onError(e);
          }
        }
      }
    } catch (e) {
      this._streaming = false;
      if (onError) onError(e);
      else throw e;
    }
  }

  /**
   * Ingest a parsed XMTP envelope into the edge (same FirewallGuard as
   * HTTP/WS/Nostr) so the mesh state actually merges.
   */
  async syncViaHttp(parsed, fetchFn) {
    const f = fetchFn || fetch;
    const r = await f(`${this.worker}/api/v1/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addr: parsed.addr,
        pubkey: parsed.pubkey,
        pubkeyHex: parsed.pubkeyHex,
        ts: parsed.ts,
        nonce: parsed.nonce,
        diff: parsed.diff,
        hash: parsed.hash,
        deltas: parsed.deltas,
        sig: parsed.sig,
      }),
    });
    return r.json();
  }
}

export default { GDBxXMTP, ethereumSigner, XMTP_SDK_URL, XMTP_ENV };
