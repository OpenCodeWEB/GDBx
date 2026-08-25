/**
 * gdbx-name.js — .GDBx Name Registry (short human names → routing targets)
 *
 * Single network, single namespace:  <name>.gdbx
 *
 * A claim is a PoW-mined, GDBx-signed record stored in the public pool at
 * key `tld/gdbx/<name>`:
 *
 *   { name, target, ownerPub, ts, nonce, diff, hash, sig }
 *
 *   - name      lower-case label (a-z0-9-), 1–40 chars — this IS the domain
 *   - target    routing target (https URL, did:gdbx:<addr>, any string)
 *   - ownerPub  signer pubkey (x.y) — ownership proof
 *   - nonce/diff/hash  SHA-256 PoW mined over the name (anti-squatting;
 *                      difficulty scales with name length like addresses)
 *   - sig       GDBx envelope over the canonical claim body
 *
 * Conflict rule: LWW by clock, ties broken lexicographically by hash —
 * every reader re-verifies PoW + signature, so nothing is trusted blindly.
 *
 * Short links (no long URLs):
 *   https://gdbx.pages.dev/n/<name>          → redirect to target (if URL)
 *   https://gdbx.xup.workers.dev/name/<name> → verified claim JSON
 */

import { sign as gdbxSign } from "./gdbx-crypto.js";
import { minePoW, sha256Hex } from "./gdbx-sdk.js";
import { makeAddress } from "./gdbx-codec.js";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Difficulty bracket for a name: short names cost more (anti-squatting). */
export function getNameDifficulty(name) {
  const len = String(name || "").length;
  if (len <= 4) return 4;
  if (len <= 8) return 3;
  return 2;
}

export function isValidName(name) {
  return NAME_RE.test(String(name || "").toLowerCase());
}

/**
 * Verify a claim record end-to-end (standalone — no pool access needed).
 * @returns {Promise<{ok:boolean, error?:string, claim?:object}>}
 */
export async function verifyClaim(claim) {
  try {
    if (!claim || typeof claim !== "object") return { ok: false, error: "claim required" };
    if (!isValidName(claim.name)) return { ok: false, error: "invalid name" };
    if (!claim.ownerPub || !claim.sig) return { ok: false, error: "ownerPub + sig required" };

    // Rebuild signed body exactly as claimed
    const body = {
      name: claim.name,
      target: String(claim.target ?? ""),
      ownerPub: claim.ownerPub,
      ts: Number(claim.ts),
    };

    // 1. PoW re-verification (skip for ts=0 root-minted records)
    if (Number(claim.ts) > 0) {
      const diff = getNameDifficulty(claim.name);
      if (Number(claim.diff) !== diff) return { ok: false, error: "difficulty mismatch" };
      const input = `${claim.name}:${claim.ownerPub}:${String(claim.target)}:${claim.ts}:`;
      const hash = await sha256Hex(input + claim.nonce);
      if (!hash.startsWith("0".repeat(diff))) return { ok: false, error: "proof-of-work not satisfied" };
      if (claim.hash && claim.hash !== hash) return { ok: false, error: "hash mismatch" };
    }

    // 2. GDBx envelope signature
    const { verify } = await import("./gdbx-crypto.js");
    const ok = await verify(body, claim.sig, claim.ownerPub);
    if (!ok) return { ok: false, error: "signature invalid" };

    return { ok: true, claim };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * NameRegistry bound to a GDBx identity.
 * opts: { pair, pubkeyHex, addr?, api? }
 */
export class GDBxNames {
  constructor(opts = {}) {
    this.pair = opts.pair || null;
    this.pubkeyHex = opts.pubkeyHex || opts.pubkey_hex || null;
    this.addr = opts.addr || (this.pubkeyHex ? makeAddress(this.pubkeyHex) : null);
    this._putDeltas = opts.putDeltas || putDeltasShim;
    this._getDeltas = opts.getDeltas || getDeltasShim;
  }

  claimKey(name) {
    return `tld/gdbx/${String(name).toLowerCase()}`;
  }

  /**
   * Claim a name → target. Overwrites only by LWW clock (newer claim wins).
   */
  async claim(name, target, pairOverride = null) {
    const pair = pairOverride || this.pair;
    const pubkeyHex = pairOverride ? null : this.pubkeyHex;
    if (!pair || !this.pubkeyHex) throw new Error("pair/pubkeyHex required");
    name = String(name).toLowerCase();
    if (!isValidName(name)) throw new Error("invalid name (a-z0-9-, max 40)");

    const ts = Date.now();
    const diff = getNameDifficulty(name);
    const input = `${name}:${pair.pub}:${String(target)}:${ts}:`;
    let nonce = 1, hash = "";
    for (; nonce < 2_000_000; nonce++) {
      hash = await sha256Hex(input + nonce);
      if (hash.startsWith("0".repeat(diff))) break;
    }
    if (nonce >= 2_000_000) throw new Error("PoW timeout");

    const body = { name, target: String(target), ownerPub: pair.pub, ts };
    const sig = await gdbxSign(body, pair);

    await this._putDeltas({
      pubkeyHex: this.pubkeyHex,
      pair,
      deltas: [{ key: this.claimKey(name), value: JSON.stringify({ ...body, nonce, diff, hash, sig }), clock: ts }],
    });
    return { name, target: String(target), txKey: this.claimKey(name) };
  }

  /** Transfer: current owner signs a gift; the gift is stored beside the claim. */
  async transfer(name, pairCurrent, newOwnerPub) {
    name = String(name).toLowerCase();
    const gift = { name, tld: "gdbx", newOwnerPub };
    const sig = await gdbxSign(gift, pairCurrent);
    const record = { ...gift, sig, fromPub: pairCurrent.pub };
    await this._putDeltas({
      pubkeyHex: this.pubkeyHex,
      pair: pairCurrent,
      deltas: [{ key: this.claimKey(name) + "/gift", value: JSON.stringify(record), clock: Date.now() }],
    });
    return record;
  }

  /**
   * Resolve a name against the pool and verify it.
   * @returns {Promise<{ok:boolean, claim?:object, error?:string}>}
   */
  async resolve(name) {
    name = String(name).toLowerCase();
    const data = await this._getDeltas(this.addr, this.claimKey(name));
    const entry = (data.entries || []).find((e) => e.key === this.claimKey(name));
    if (!entry) return { ok: false, error: "not found" };
    let claim;
    try { claim = JSON.parse(String(entry.value)); } catch { return { ok: false, error: "corrupt claim" }; }
    return verifyClaim(claim);
  }

  /** Live-subscribe all claims (verified callback). Returns unsubscribe. */
  watch(cb) {
    let stop = false;
    const seen = new Set();
    const poll = async () => {
      if (stop) return;
      try {
        const data = await this._getDeltas(this.addr, "tld/gdbx/");
        for (const e of data.entries || []) {
          if (seen.has(e.key)) continue;
          seen.add(e.key);
          try {
            const res = await verifyClaim(JSON.parse(String(e.value)));
            cb(res, e.key);
          } catch {}
        }
      } catch {}
      setTimeout(poll, 5000);
    };
    poll();
    return () => { stop = true; };
  }
}

/* Lazy shims so the module works standalone (browser bundle / Node). */
async function putDeltasShim(opts) {
  const { putDeltas } = await import("./gdbx-sdk.js");
  return putDeltas(opts);
}
async function getDeltasShim(addr, prefix) {
  const { getDeltas } = await import("./gdbx-sdk.js");
  return getDeltas(addr, prefix);
}

export default { GDBxNames, verifyClaim, getNameDifficulty, isValidName };
