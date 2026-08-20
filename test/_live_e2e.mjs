import { pair as cryptoPair } from "../sdk/gdbx-crypto.js";

import { makeAddress } from "../sdk/gdbx-codec.js";
import { registerDID, resolveDID, putDeltas, getDeltas, purgeIdentity } from "../sdk/gdbx-sdk.js";

const BASE = "https://gdbx.pages.dev";
const pair = await cryptoPair();
const jwk = await crypto.subtle.importKey(
  "jwk",
  { kty: "EC", crv: "P-256", x: pair.pub.split(".")[0], y: pair.pub.split(".")[1], ext: true },
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["verify"],
);
const ek = await crypto.subtle.exportKey("jwk", jwk);
const b64uToHex = (s) => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + (pad.length % 4 === 0 ? "" : "=".repeat(4 - (pad.length % 4))));
  return [...new Uint8Array(bin.length)].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
};
const pubkeyHex = "04" + b64uToHex(ek.x) + b64uToHex(ek.y);
const addr = makeAddress(pubkeyHex, 0);
console.log("DID:", "did:gdbx:" + addr);

const reg = await registerDID({
  addr, pubkey: pair.pub, pubkeyHex,
  didDoc: { services: [{ id: "did:gdbx#transport", type: "GDBxTransportRouting", serviceEndpoint: { webrtc: "peer-live", nostr: ["wss://relay.damus.io"] } }] },
  pair,
});
console.log("register:", reg.ok ? "OK" : "FAIL", reg.created, reg.error || "");

const res = await resolveDID(addr);
console.log("resolve:", res.ok, res.did?.id === `did:gdbx:${addr}` ? "OK" : JSON.stringify(res).slice(0, 120));

const put = await putDeltas({
  addr, pubkey: pair.pub, pubkeyHex, pair,
  deltas: [{ key: "profile/name", value: "LiveTest", clock: Date.now() }],
});
console.log("put:", put.ok, put.applied, put.error || "");

const get = await getDeltas(addr);
const name = get.entries?.find((e) => e.key === "profile/name")?.value;
console.log("get:", get.ok, "count:", get.count, "name:", name);

const stats = await fetch(BASE + "/api/v1/stats").then((r) => r.json());
console.log("stats:", JSON.stringify(stats).slice(0, 160));

const purge = await purgeIdentity({ addr, pubkey: pair.pub, pubkeyHex, pair });
console.log("purge:", purge.ok, "erased:", purge.erased, purge.error || "");

const after = await resolveDID(addr).catch((e) => ({ error: e.message }));
console.log("after purge resolve:", after.error || "still resolvable (BAD)");

console.log("LIVE E2E:", reg.ok && res.ok && put.ok && get.ok && purge.ok && after.error ? "PASS" : "FAIL");