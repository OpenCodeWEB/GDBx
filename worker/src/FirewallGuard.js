/**
 * FirewallGuard.js — GDBx protocol-level firewall (unified gate pipeline).
 *
 * Every mutation runs through the SAME ordered checks on ANY transport
 * (HTTP, WebSocket, future Nostr/WebRTC):
 *
 *   1. PoW          — SHA-256 difficulty (anti-spam)
 *   2. Replay       — ts window + fresh nonce
 *   3. Signature    — GDBx or legacy SEA v1 (owner identity proof)
 *   4. RBAC         — role ≥ user to write; promote needs superadmin
 *   5. ACL          — node-level: owner or collaborator may write a key
 *
 * Returns { ok:true } or { ok:false, error, status }.
 */
import { verifyPoW, checkReplay, verifySig } from "./verify.js";
import { ROLES, canWrite, isSuperadminPub, parsePromoteRole } from "./roles.js";

export const FirewallGuard = {
  /**
   * Run the full gate pipeline for a mutation request.
   * @param {object} p
   * @param {object} p.body       canonical signed body {addr, action, ts, payload}
   * @param {string} p.sig        GDBx or SEA v1 envelope
   * @param {string} p.pubkey     signer public key (x.y)
   * @param {string} p.pubkeyHex  130-char hex (binding proof)
   * @param {number} p.ts         client timestamp
   * @param {number} p.nonce      PoW nonce (replay guard)
   * @param {number} p.diff       PoW difficulty
   * @param {string|null} p.hash  PoW hash
   * @param {object} p.env        worker env (ROOT_PUBKEYS)
   * @param {Set}    p.seenNonces  shared seen-nonce set (per DO instance)
   * @param {Function} [p.consumeNonce] optional callback (nonce, ts) to record
   *   a consumed nonce AFTER the replay check passes (DOs record here; the
   *   check itself never mutates the set, keeping the guard pure/testable)
   * @param {string} p.action     expected action ("sync.put", "identity.promote", ...)
   * @param {string} p.payload    expected payload string (signed body payload)
   * @param {string} p.powPayload PoW hash-input payload (the ACTION string — e.g. "sync.put")
   * @param {number} [p.role]     current role of the addr (RBAC)
   * @param {string} [p.ownerPub] addr owner pubkey (ACL)
   * @param {string[]} [p.collaborators] ACL allowlist
   * @returns {Promise<{ok:boolean, error?:string, status?:number}>}
   */
  async check(p) {
    // 1. PoW (powPayload = action string — matches SDK minePoW usage)
    const pow = await verifyPoW({
      addr: p.body?.addr,
      ownerPub: p.pubkey,
      payload: p.powPayload ?? p.action,
      ts: p.ts,
      nonce: p.nonce,
      diff: p.diff,
      hash: p.hash,
    });
    if (!pow.ok) return { ok: false, error: pow.error, status: 400 };

    // 2. Replay (check only — caller records the nonce via consumeNonce)
    const replay = checkReplay({ ts: p.ts, nonce: p.nonce, seenNonces: p.seenNonces });
    if (!replay.ok) return replay;
    if (typeof p.consumeNonce === "function") p.consumeNonce(p.nonce, p.ts);

    // 3. Signature (GDBx | SEA v1)
    const sigOk = await verifySig(p.body, p.sig, p.pubkey);
    if (!sigOk) return { ok: false, error: "signature invalid", status: 403 };

    // 4. RBAC
    if (p.action === "identity.promote") {
      // Only superadmins may promote — the SIGNER must be in ROOT_PUBKEYS
      if (!isSuperadminPub(p.pubkey, p.env?.ROOT_PUBKEYS)) {
        return { ok: false, error: "only superadmin may promote roles", status: 403 };
      }
      let targetRole;
      try {
        const payload = JSON.parse(p.payload || "{}");
        targetRole = parsePromoteRole(payload.role);
      } catch {
        return { ok: false, error: "invalid promote payload", status: 400 };
      }
      if (targetRole === null) {
        return { ok: false, error: "invalid target role", status: 400 };
      }
      return { ok: true, role: targetRole };
    }

    if (p.action === "did.register") {
      // Registering is allowed for anyone (creates a guest) — PoW already gated.
      return { ok: true };
    }

    // Other mutations (sync.put, identity.purge, identity.export) need role ≥ user
    if (!canWrite(p.role ?? ROLES.guest)) {
      return { ok: false, error: `role '${p.role ?? ROLES.guest}' is write-blocked (guest) — ask a superadmin to promote`, status: 403 };
    }

    // 5. ACL — node-level: owner or collaborator
    if (p.action === "sync.put" && p.ownerPub) {
      const isOwner = p.pubkey === p.ownerPub;
      const isCollab = Array.isArray(p.collaborators) && p.collaborators.includes(p.pubkey);
      if (!isOwner && !isCollab) {
        return { ok: false, error: "not an owner or collaborator of this address", status: 403 };
      }
    }

    return { ok: true };
  },
};

export default FirewallGuard;