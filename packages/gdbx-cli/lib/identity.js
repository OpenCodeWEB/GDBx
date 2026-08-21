import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pair } from "../../../sdk/gdbx-crypto.js";
import { makeAddress } from "../../../sdk/gdbx-codec.js";

function b64uToHex(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + (pad.length % 4 ? "=".repeat(4 - (pad.length % 4)) : ""));
  return [...bin].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
}

export async function hexOf(pub) {
  const [x, y] = pub.split(".");
  return "04" + b64uToHex(x) + b64uToHex(y);
}

export function defaultKeyPath() {
  return join(homedir(), ".gdbx", "key.json");
}

export async function createIdentity(net = "mainnet", outPath = null) {
  const p = await pair();
  const pubkeyHex = await hexOf(p.pub);
  const networkMap = { mainnet: 0, testnet: 1, local: 2 };
  const netCode = networkMap[net] ?? 0;
  const addr = makeAddress(pubkeyHex, netCode);
  const bundle = { pub: p.pub, priv: p.priv, pubkey_hex: pubkeyHex, pubkeyHex, addr, network: net, did: `did:gdbx:${addr}` };
  const dest = outPath || defaultKeyPath();
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(bundle, null, 2));
  return bundle;
}

export function loadIdentity(inPath = null) {
  const p = inPath || process.env.GDBX_KEY || defaultKeyPath();
  if (!existsSync(p)) {
    // try env vars
    const pub = process.env.GDBX_PUB;
    const priv = process.env.GDBX_PRIV;
    const hex = process.env.GDBX_PUBKEY_HEX;
    if (pub && priv && hex) {
      const addr = process.env.GDBX_ADDR || makeAddress(hex);
      return { pub, priv, pubkey_hex: hex, pubkeyHex: hex, addr, did: `did:gdbx:${addr}` };
    }
    throw new Error(`no identity at ${p} — run 'gdbx identity create' or set GDBX_* env`);
  }
  const j = JSON.parse(readFileSync(p, "utf8"));
  return {
    pub: j.pub,
    priv: j.priv,
    pubkey_hex: j.pubkey_hex || j.pubkeyHex,
    pubkeyHex: j.pubkey_hex || j.pubkeyHex,
    addr: j.addr,
    did: j.did || `did:gdbx:${j.addr}`,
  };
}
