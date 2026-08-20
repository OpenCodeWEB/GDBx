/**
 * transport.js — Phase 5: hybrid mesh transport layer.
 *
 * GDBx speaks over THREE transports in priority order:
 *
 *   1. ws      — primary: Durable Object WebSocket hub (lowest latency,
 *                strongest consistency — direct to the DO singleton)
 *   2. nostr   — relay: signed events on kind 23124 (GDBX custom kind),
 *                published to public/private relays; the worker's /relay
 *                endpoint ingests them through the same FirewallGuard
 *   3. webrtc  — p2p: direct peer-to-peer when the hub is unreachable
 *                (offline-first), signaling carried as signed JSON messages
 *
 * All three share one envelope format: the GDBX1 message produced by
 * gdbx-crypto.js (canonical body + base64url ECDSA P-256 signature).
 * The mesh is therefore transport-agnostic: whatever medium delivers the
 * envelope, the receiver verifies it identically.
 */

import { canonicalJson } from "./gdbx-crypto.js";

/** GDBX custom Nostr kind — mesh data envelopes. */
export const NOSTR_KIND = 23124;

/**
 * Pick the best available transport.
 * @param {{ws?:boolean, nostr?:boolean, webrtc?:boolean}} availability
 * @returns {"ws"|"nostr"|"webrtc"|null}
 */
export function pickTransport({ ws = false, nostr = false, webrtc = false } = {}) {
  if (ws) return "ws";
  if (nostr) return "nostr";
  if (webrtc) return "webrtc";
  return null;
}

/**
 * Build a Nostr event carrying a GDBX1 envelope.
 * Kind 23124, tags: ["addr", <addr>], content = GDBX1 JSON string.
 *
 * @param {{addr:string, pubkey:string, ts:number, nonce:number, diff:number,
 *          hash:string, deltas:object[], sig:string}} o
 */
export async function buildNostrEvent(o) {
  const body = {
    addr: o.addr,
    action: "sync.put",
    ts: o.ts,
    payload: JSON.stringify(o.deltas),
  };
  const envelope = {
    m: body,
    s: o.sig,
    // Owner-binding proof + PoW fields travel OUTSIDE the signed body —
    // the signature covers m only; the worker still verifies each field
    // independently inside FirewallGuard.
    ...(o.pubkeyHex ? { pubkeyHex: o.pubkeyHex } : {}),
    ...(o.nonce !== undefined ? { nonce: o.nonce } : {}),
    ...(o.diff !== undefined ? { diff: o.diff } : {}),
    ...(o.hash ? { hash: o.hash } : {}),
  };
  return {
    kind: NOSTR_KIND,
    pubkey: o.pubkey,
    created_at: Math.floor(o.ts / 1000),
    tags: [["addr", o.addr]],
    content: "GDBX1" + canonicalJson(envelope),
  };
}

/**
 * Parse a Nostr event into a mesh payload (or an error result).
 * @returns {{ok:boolean, addr?:string, action?:string, ts?:number,
 *            deltas?:object[], error?:string}}
 */
export function parseNostrEvent(ev) {
  if (!ev || ev.kind !== NOSTR_KIND) return { ok: false, error: "wrong kind" };
  const addrTag = Array.isArray(ev.tags) ? ev.tags.find((t) => Array.isArray(t) && t[0] === "addr") : null;
  if (!addrTag || !addrTag[1]) return { ok: false, error: "missing addr tag" };
  const addr = addrTag[1];
  if (typeof ev.content !== "string" || !ev.content.startsWith("GDBX1")) {
    return { ok: false, error: "content not GDBX1 envelope" };
  }
  try {
    const envelope = JSON.parse(ev.content.slice(5));
    const m = envelope.m;
    if (!m || typeof m !== "object" || !m.addr || !m.action || !m.payload) {
      return { ok: false, error: "malformed envelope" };
    }
    const deltas = JSON.parse(m.payload);
    if (!Array.isArray(deltas)) return { ok: false, error: "payload not deltas array" };
    return {
      ok: true,
      addr,
      action: m.action,
      ts: Number(m.ts),
      deltas,
      sig: envelope.s,
      pubkey: ev.pubkey,
      pubkeyHex: envelope.pubkeyHex,
      nonce: envelope.nonce,
      diff: envelope.diff,
      hash: envelope.hash,
      content: ev.content,
    };
  } catch {
    return { ok: false, error: "malformed envelope" };
  }
}

/**
 * Build a WebRTC signaling message (offer/answer/candidate) carrying a
 * signed GDBX1 envelope so peers can authenticate each other.
 */
export async function buildSignal({ type, addr, payload, pubkey, ts, sig }) {
  const m = {
    addr,
    action: "webrtc.signal",
    ts,
    payload: JSON.stringify({ type, ...payload }),
  };
  return {
    type: "webrtc-signal",
    addr,
    m,
    s: sig,
    pubkey,
  };
}

/**
 * Parse a WebRTC signaling message.
 * @returns {{ok:boolean, type?:string, addr?:string, payload?:object, error?:string}}
 */
export function parseSignal(msg) {
  try {
    if (typeof msg === "string") msg = JSON.parse(msg);
  } catch {
    return { ok: false, error: "not json" };
  }
  if (!msg || msg.type !== "webrtc-signal" || !msg.m || typeof msg.m !== "object") {
    return { ok: false, error: "malformed signal" };
  }
  try {
    const payload = JSON.parse(msg.m.payload);
    if (!payload || typeof payload !== "object" || !["offer", "answer", "candidate"].includes(payload.type)) {
      return { ok: false, error: "malformed payload" };
    }
    return { ok: true, type: payload.type, addr: msg.m.addr, payload, sig: msg.s, pubkey: msg.pubkey };
  } catch {
    return { ok: false, error: "malformed payload" };
  }
}

export default { pickTransport, buildNostrEvent, parseNostrEvent, buildSignal, parseSignal, NOSTR_KIND };