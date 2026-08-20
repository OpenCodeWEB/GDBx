/**
 * test_firewall.mjs — Phase 5: Zero-trust Firewall (RBAC + ACL + gate).
 *
 * Covers:
 *   - Roles: guest default, promotion signed by superadmin only
 *   - Forged promotion (non-superadmin signer) rejected
 *   - FirewallGuard pipeline: PoW → replay → signature → RBAC → ACL
 *   - Guest (write-blocked) sync.put rejected
 *   - User role can write own addr
 *   - ACL: non-collaborator cannot write a shared key, collaborator can
 *   - Superadmin set from ROOT_PUBKEYS
 *
 * Run:  node --test test/test_firewall.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pair as cryptoPair, sign as cryptoSign } from "../sdk/gdbx-crypto.js";
import { makeAddress } from "../sdk/gdbx-codec.js";
import { minePoW } from "../sdk/gdbx-sdk.js";
import { verifyPoW, checkReplay, verifySig, canonicalJson } from "../worker/src/verify.js";
import { ROLES, roleName, canWrite, isSuperadminPub } from "../worker/src/roles.js";
import { FirewallGuard } from "../worker/src/FirewallGuard.js";
import { makeAddress as makeAddr2, normalizeAddress } from "../sdk/gdbx-codec.js";

async function hexOf(p) {
  const jwk = await crypto.subtle.exportKey("jwk", await importPairKey(p));
  const b64uToHex = (s) => {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + (pad.length % 4 === 0 ? "" : "=".repeat(4 - (pad.length % 4))));
    return [...new Uint8Array(bin.length)].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
  };
  return "04" + b64uToHex(jwk.x) + b64uToHex(jwk.y);
}

async function importPairKey(p) {
  const [x, y] = p.pub.split(".");
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
}

/* ── roles ──────────────────────────────────────────────────────── */

test("roles: constants + names", () => {
  assert.equal(ROLES.guest, 0);
  assert.equal(ROLES.user, 1);
  assert.equal(ROLES.manager, 2);
  assert.equal(ROLES.admin, 3);
  assert.equal(ROLES.superadmin, 4);
  assert.equal(roleName(0), "guest");
  assert.equal(roleName(4), "superadmin");
  assert.equal(roleName(99), "unknown");
});

test("roles: canWrite — guest blocked, user+ allowed", () => {
  assert.equal(canWrite(ROLES.guest), false);
  assert.equal(canWrite(ROLES.user), true);
  assert.equal(canWrite(ROLES.manager), true);
  assert.equal(canWrite(ROLES.admin), true);
  assert.equal(canWrite(ROLES.superadmin), true);
});

test("roles: isSuperadminPub matches ROOT_PUBKEYS list", () => {
  const root = "rootpubkey1, rootpubkey2";
  assert.equal(isSuperadminPub("rootpubkey1", root), true);
  assert.equal(isSuperadminPub("rootpubkey2", root), true);
  assert.equal(isSuperadminPub("someone.else", root), false);
  assert.equal(isSuperadminPub("rootpubkey1", undefined), false);
  assert.equal(isSuperadminPub("rootpubkey1", ""), false);
});

/* ── promotion (signed by superadmin) ───────────────────────────── */

test("promotion: superadmin-signed promote upgrades role", async () => {
  const root = await cryptoPair();
  const target = await cryptoPair();
  const addr = makeAddress(await hexOf(target), 0);
  const ts = Date.now();
  const body = { addr, action: "identity.promote", ts, payload: JSON.stringify({ role: "manager", target: target.pub }) };
  const sig = await cryptoSign(body, root);
  const { nonce, hash, diff } = await minePoW(addr, root.pub, "identity.promote", ts);

  const seen = new Set();
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: root.pub,
    pubkeyHex: await hexOf(root),
    ts,
    nonce,
    diff,
    hash,
    env: { ROOT_PUBKEYS: root.pub },
    seenNonces: seen,
    action: "identity.promote",
    payload: JSON.stringify({ role: "manager", target: target.pub }),
  });
  assert.equal(check.ok, true, JSON.stringify(check));
});

test("promotion: non-superadmin signer rejected by FirewallGuard", async () => {
  const attacker = await cryptoPair();
  const target = await cryptoPair();
  const addr = makeAddress(await hexOf(target), 0);
  const ts = Date.now();
  const body = { addr, action: "identity.promote", ts, payload: JSON.stringify({ role: "admin", target: target.pub }) };
  const sig = await cryptoSign(body, attacker);
  const { nonce, hash, diff } = await minePoW(addr, attacker.pub, "identity.promote", ts);

  const seen = new Set();
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: attacker.pub,
    pubkeyHex: await hexOf(attacker),
    ts,
    nonce,
    diff,
    hash,
    env: { ROOT_PUBKEYS: "the-real-root" },
    seenNonces: seen,
    action: "identity.promote",
    payload: JSON.stringify({ role: "admin", target: target.pub }),
  });
  assert.equal(check.ok, false);
  assert.match(check.error, /superadmin/i);
});

/* ── pipeline: PoW / replay / signature / RBAC / ACL ────────────── */

test("gate: guest (write-blocked) cannot sync.put", async () => {
  const owner = await cryptoPair();
  const addr = makeAddress(await hexOf(owner), 0);
  const ts = Date.now();
  const deltas = JSON.stringify([{ key: "k", value: "v", clock: ts }]);
  const body = { addr, action: "sync.put", ts, payload: deltas };
  const sig = await cryptoSign(body, owner);
  const { nonce, hash, diff } = await minePoW(addr, owner.pub, "sync.put", ts);

  const seen = new Set();
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: owner.pub,
    pubkeyHex: await hexOf(owner),
    ts,
    nonce,
    diff,
    hash,
    env: {},
    seenNonces: seen,
    action: "sync.put",
    payload: deltas,
    powPayload: "sync.put",
    role: ROLES.guest,
    ownerPub: owner.pub,
    collaborators: [],
  });
  assert.equal(check.ok, false);
  assert.match(check.error, /role|guest/i);
});

test("gate: user role writes own addr — allowed", async () => {
  const owner = await cryptoPair();
  const addr = makeAddress(await hexOf(owner), 0);
  const ts = Date.now();
  const deltas = JSON.stringify([{ key: "k", value: "v", clock: ts }]);
  const body = { addr, action: "sync.put", ts, payload: deltas };
  const sig = await cryptoSign(body, owner);
  const { nonce, hash, diff } = await minePoW(addr, owner.pub, "sync.put", ts);

  const seen = new Set();
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: owner.pub,
    pubkeyHex: await hexOf(owner),
    ts,
    nonce,
    diff,
    hash,
    env: {},
    seenNonces: seen,
    action: "sync.put",
    payload: deltas,
    powPayload: "sync.put",
    role: ROLES.user,
    ownerPub: owner.pub,
    collaborators: [],
  });
  assert.equal(check.ok, true, JSON.stringify(check));
});

test("gate: non-collaborator cannot write shared key", async () => {
  const owner = await cryptoPair();
  const intruder = await cryptoPair();
  const addr = makeAddress(await hexOf(owner), 0);
  const ts = Date.now();
  const deltas = JSON.stringify([{ key: "shared/doc", value: "x", clock: ts }]);
  const body = { addr, action: "sync.put", ts, payload: deltas };
  const sig = await cryptoSign(body, intruder);
  const { nonce, hash, diff } = await minePoW(addr, intruder.pub, "sync.put", ts);

  const seen = new Set();
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: intruder.pub,
    pubkeyHex: await hexOf(intruder),
    ts,
    nonce,
    diff,
    hash,
    env: {},
    seenNonces: seen,
    action: "sync.put",
    payload: deltas,
    powPayload: "sync.put",
    role: ROLES.user,
    ownerPub: owner.pub,
    collaborators: ["someone-else.pub"],
  });
  assert.equal(check.ok, false);
  assert.match(check.error, /collaborator/i);
});

test("gate: collaborator can write shared key", async () => {
  const owner = await cryptoPair();
  const collab = await cryptoPair();
  const addr = makeAddress(await hexOf(owner), 0);
  const ts = Date.now();
  const deltas = JSON.stringify([{ key: "shared/doc", value: "x", clock: ts }]);
  const body = { addr, action: "sync.put", ts, payload: deltas };
  const sig = await cryptoSign(body, collab);
  const { nonce, hash, diff } = await minePoW(addr, collab.pub, "sync.put", ts);

  const seen = new Set();
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: collab.pub,
    pubkeyHex: await hexOf(collab),
    ts,
    nonce,
    diff,
    hash,
    env: {},
    seenNonces: seen,
    action: "sync.put",
    payload: deltas,
    powPayload: "sync.put",
    role: ROLES.user,
    ownerPub: owner.pub,
    collaborators: [collab.pub],
  });
  assert.equal(check.ok, true, JSON.stringify(check));
});

test("gate: invalid PoW → rejected before signature", async () => {
  const owner = await cryptoPair();
  const addr = makeAddress(await hexOf(owner), 0);
  const ts = Date.now();
  const deltas = JSON.stringify([{ key: "k", value: "v", clock: ts }]);
  const body = { addr, action: "sync.put", ts, payload: deltas };
  const sig = await cryptoSign(body, owner);

  const seen = new Set();
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: owner.pub,
    pubkeyHex: await hexOf(owner),
    ts,
    nonce: 1,
    diff: 2,
    hash: "0".repeat(64),
    env: {},
    seenNonces: seen,
    action: "sync.put",
    payload: deltas,
    powPayload: "sync.put",
    role: ROLES.user,
    ownerPub: owner.pub,
    collaborators: [],
  });
  assert.equal(check.ok, false);
  assert.match(check.error, /proof-of-work/i);
});

test("gate: replay nonce rejected", async () => {
  const owner = await cryptoPair();
  const addr = makeAddress(await hexOf(owner), 0);
  const ts = Date.now();
  const deltas = JSON.stringify([{ key: "k", value: "v", clock: ts }]);
  const body = { addr, action: "sync.put", ts, payload: deltas };
  const sig = await cryptoSign(body, owner);
  const { nonce, hash, diff } = await minePoW(addr, owner.pub, "sync.put", ts);

  const seen = new Set([nonce]);
  const check = await FirewallGuard.check({
    body,
    sig,
    pubkey: owner.pub,
    pubkeyHex: await hexOf(owner),
    ts,
    nonce,
    diff,
    hash,
    env: {},
    seenNonces: seen,
    action: "sync.put",
    payload: deltas,
    powPayload: "sync.put",
    role: ROLES.user,
    ownerPub: owner.pub,
    collaborators: [],
  });
  assert.equal(check.ok, false);
  assert.match(check.error, /replay/i);
});