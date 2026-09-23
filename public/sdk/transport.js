/**
 * transport.js — Phase 5: hybrid mesh transport layer.
 *
 * GDBx speaks over FOUR transports in priority order:
 *
 *   1. ws      — primary: Durable Object WebSocket hub (lowest latency,
 *                strongest consistency — direct to the DO singleton)
 *   2. xmtp   — messaging: E2E-encrypted XMTP v3 (MLS) group rooms, one room
 *                per .gdbx address (`gdbx/<addr>`); carries the same signed
 *                GDBx envelope as Nostr — https://xmtp.org
 *   3. nostr   — relay: signed events on kind 23124 (GDBX custom kind),
 *                published to public/private relays; the worker's /relay
 *                endpoint ingests them through the same FirewallGuard
 *   4. webrtc  — p2p: direct peer-to-peer when the hub is unreachable
 *                (offline-first), signaling carried as signed JSON messages
 *
 * All four share one envelope format: the GDBx message produced by
 * gdbx-crypto.js (canonical body + base64url ECDSA P-256 signature).
 * The mesh is therefore transport-agnostic: whatever medium delivers the
 * envelope, the receiver verifies it identically.
 */

import { canonicalJson } from "./gdbx-crypto.js";

/** GDBX custom Nostr kind — mesh data envelopes. */
export const NOSTR_KIND = 23124;

/** XMTP group-room name prefix — one room per .gdbx address. */
export const XMTP_ROOM_PREFIX = "gdbx/";

/** Full XMTP room name for an address. */
export function xmtpRoomName(addr) {
  return `${XMTP_ROOM_PREFIX}${addr}`;
}

/**
 * Pick the best available transport.
 * @param {{ws?:boolean, xmtp?:boolean, nostr?:boolean, webrtc?:boolean}} availability
 * @returns {"ws"|"xmtp"|"nostr"|"webrtc"|null}
 */
export function pickTransport({ ws = false, xmtp = false, nostr = false, webrtc = false } = {}) {
  if (ws) return "ws";
  if (xmtp) return "xmtp";
  if (nostr) return "nostr";
  if (webrtc) return "webrtc";
  return null;
}

/**
 * Build a Nostr event carrying a GDBx envelope.
 * Kind 23124, tags: ["addr", <addr>], content = GDBx JSON string.
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
    content: "GDBx" + canonicalJson(envelope),
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
  if (typeof ev.content !== "string" || !ev.content.startsWith("GDBx")) {
    return { ok: false, error: "content not GDBx envelope" };
  }
  try {
    const envelope = JSON.parse(ev.content.slice(4));
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
 * Build an XMTP message carrying a GDBx envelope.
 * Same envelope as Nostr (action sync.put), serialized as the
 * "GDBx..." content string posted into the `gdbx/<addr>` group room.
 *
 * @param {{addr:string, pubkey:string, ts:number, nonce:number, diff:number,
 *          hash:string, deltas:object[], sig:string, pubkeyHex?:string}} o
 * @returns {{room:string, content:string, createdAt:number}}
 */
export async function buildXmtpMessage(o) {
  const body = {
    addr: o.addr,
    action: "sync.put",
    ts: o.ts,
    payload: JSON.stringify(o.deltas),
  };
  const envelope = {
    m: body,
    s: o.sig,
    // pubkey travels INSIDE the envelope for XMTP (no outer event fields
    // like Nostr) — the signature covers m only; the worker verifies each
    // field independently inside FirewallGuard.
    ...(o.pubkey ? { pubkey: o.pubkey } : {}),
    ...(o.pubkeyHex ? { pubkeyHex: o.pubkeyHex } : {}),
    ...(o.nonce !== undefined ? { nonce: o.nonce } : {}),
    ...(o.diff !== undefined ? { diff: o.diff } : {}),
    ...(o.hash ? { hash: o.hash } : {}),
  };
  return {
    room: xmtpRoomName(o.addr),
    content: "GDBx" + canonicalJson(envelope),
    createdAt: o.ts,
  };
}

/**
 * Parse an XMTP message into a mesh payload (or an error result).
 * Accepts the raw content string posted in a `gdbx/<addr>` room.
 * @param {string} content
 * @param {string} [room]
 * @returns {{ok:boolean, addr?:string, room?:string, action?:string, ts?:number,
 *            deltas?:object[], error?:string}}
 */
export function parseXmtpMessage(content, room = "") {
  if (typeof content !== "string" || !content.startsWith("GDBx")) {
    return { ok: false, error: "content not GDBx envelope" };
  }
  let addr = "";
  if (typeof room === "string" && room.startsWith(XMTP_ROOM_PREFIX)) {
    addr = room.slice(XMTP_ROOM_PREFIX.length);
  }
  try {
    const envelope = JSON.parse(content.slice(4));
    const m = envelope.m;
    if (!m || typeof m !== "object" || !m.addr || !m.action || !m.payload) {
      return { ok: false, error: "malformed envelope" };
    }
    if (addr && m.addr !== addr) return { ok: false, error: "room/envelope addr mismatch" };
    const deltas = JSON.parse(m.payload);
    if (!Array.isArray(deltas)) return { ok: false, error: "payload not deltas array" };
    return {
      ok: true,
      addr: m.addr,
      room: room || xmtpRoomName(m.addr),
      action: m.action,
      ts: Number(m.ts),
      deltas,
      sig: envelope.s,
      pubkey: envelope.pubkey,
      pubkeyHex: envelope.pubkeyHex,
      nonce: envelope.nonce,
      diff: envelope.diff,
      hash: envelope.hash,
      content,
    };
  } catch {
    return { ok: false, error: "malformed envelope" };
  }
}

/**
 * Build a WebRTC signaling message (offer/answer/candidate) carrying a
 * signed GDBx envelope so peers can authenticate each other.
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

export default { pickTransport, buildNostrEvent, parseNostrEvent, buildXmtpMessage, parseXmtpMessage, xmtpRoomName, buildSignal, parseSignal, NOSTR_KIND, XMTP_ROOM_PREFIX };