/**
 * test_xmtp.mjs — XMTP transport for the GDBx mesh.
 *
 * Covers:
 *   - transport router order ws → xmtp → nostr → webrtc
 *   - xmtp room naming (gdbx/<addr>)
 *   - xmtp message builder: same signed GDBx envelope as Nostr
 *   - xmtp message parser round-trips + rejects bad input
 *
 * Run:  node --test test/test_xmtp.mjs
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import {
  pickTransport,
  buildXmtpMessage,
  parseXmtpMessage,
  xmtpRoomName,
  XMTP_ROOM_PREFIX,
} from "../sdk/transport.js";

let pair = null;
let addr = null;

async function hexOf(p) {
  const [x, y] = p.pub.split(".");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const b64uToHex = (s) => {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + (pad.length % 4 === 0 ? "" : "=".repeat(4 - (pad.length % 4))));
    return [...bin].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  };
  return "04" + b64uToHex(jwk.x) + b64uToHex(jwk.y);
}

before(async () => {
  pair = await cryptoPair();
  addr = makeAddress(await hexOf(pair), 0);
});

/* ── router ───────────────────────────────────────────────────────── */

test("xmtp: router order ws → xmtp → nostr → webrtc", () => {
  assert.equal(pickTransport({ ws: true, xmtp: true }), "ws");
  assert.equal(pickTransport({ ws: false, xmtp: true, nostr: true, webrtc: true }), "xmtp");
  assert.equal(pickTransport({ ws: false, xmtp: false, nostr: true }), "nostr");
  assert.equal(pickTransport({}), null);
});

test("xmtp: room name prefixes address", () => {
  assert.equal(xmtpRoomName(addr), `${XMTP_ROOM_PREFIX}${addr}`);
  assert.equal(XMTP_ROOM_PREFIX, "gdbx/");
});

/* ── envelope ─────────────────────────────────────────────────────── */

test("xmtp: message builder — same signed GDBx envelope", async () => {
  const t = Date.now();
  const deltas = [{ key: "chat/msg", value: "hello mesh", clock: t }];
  const sig = await cryptoSign({ addr, action: "sync.put", ts: t, payload: JSON.stringify(deltas) }, pair);
  const msg = await buildXmtpMessage({
    addr, pubkey: pair.pub, ts: t, nonce: 7, diff: 2, hash: "0000ab", deltas, sig,
  });
  assert.equal(msg.room, `gdbx/${addr}`);
  assert.ok(msg.content.startsWith("GDBx"));
  const parsed = JSON.parse(msg.content.slice(4));
  assert.equal(parsed.m.addr, addr);
  assert.equal(parsed.m.action, "sync.put");
  assert.equal(parsed.s, sig);
  assert.equal(parsed.pubkey, pair.pub);
});

test("xmtp: parser round-trips builder output", async () => {
  const t = Date.now();
  const deltas = [{ key: "k", value: "v", clock: t }];
  const sig = await cryptoSign({ addr, action: "sync.put", ts: t, payload: JSON.stringify(deltas) }, pair);
  const msg = await buildXmtpMessage({ addr, pubkey: pair.pub, ts: t, deltas, sig });
  const parsed = parseXmtpMessage(msg.content, msg.room);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.addr, addr);
  assert.equal(parsed.room, msg.room);
  assert.equal(parsed.action, "sync.put");
  assert.equal(parsed.deltas.length, 1);
  assert.equal(parsed.deltas[0].key, "k");
});

test("xmtp: parser rejects non-GDBx content / room mismatch / malformed", () => {
  assert.equal(parseXmtpMessage("hello", "gdbx/abc").ok, false);
  assert.equal(parseXmtpMessage("GDBx{bad json", "gdbx/abc").ok, false);
  const other = "GDBx" + JSON.stringify({
    m: { addr: "other", action: "sync.put", ts: 1, payload: "[]" }, s: "x",
  });
  assert.equal(parseXmtpMessage(other, `gdbx/${addr}`).ok, false);
});
