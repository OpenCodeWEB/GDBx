// Seed sys/gdbx/version manifest (one-time)
import { sign } from "../sdk/gdbx-crypto.js";
import { minePoW } from "../sdk/gdbx-sdk.js";

const ID = {
  pub: "xb_tjiMr6afzWikmd6yyNjPSaLkWoj_jDBEB-TqgJio.AR_uV6kJN1Re4STtyUH92_3jGH3GaVAPnTi4yNEyLaY",
  priv: "3LES18Y1yLNIyshQ7eEb0ZAIO1sRbuXoImaJ1dKVJKc",
  hex: "04c5bfed8e232be9a7f35a292677acb23633d268b916a23fe30c1101f93aa0262a011fee57a90937545ee124edc941fddbfde3187dc669500f9d38b8c8d1322da6",
  addr: "aeaagiao64onmpxlv7bjgk4chnpvl5h77erwqq7gockpvm2kafwzwmzt3u",
};
const API = "https://gdbx.xup.workers.dev";
const pair = { pub: ID.pub, priv: ID.priv };

// ensure DID exists on this hub (idempotent)
{
  const chk = await fetch(`${API}/did/${ID.addr}`);
  if (!chk.ok) {
    const ts0 = Date.now();
    const pow0 = await minePoW(ID.addr, ID.pub, "did.register", ts0);
    const sig0 = await sign({ addr: ID.addr, action: "did.register", ts: ts0, payload: null }, pair);
    const r0 = await fetch(API + "/did", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addr: ID.addr, pubkey: ID.pub, pubkeyHex: ID.hex,
        ts: ts0, nonce: pow0.nonce, diff: pow0.diff, hash: pow0.hash, sig: sig0,
      }),
    });
    console.log("register:", r0.status);
  }
}

const manifest = {
  version: "6.3.0",
  releasedAt: new Date().toISOString(),
  notes:
    "Zero-limit policy; GDBx envelope single brand; GlobalMesh live page; Gun-compat engine absorbed",
  hubs: ["wss://gdbx.pages.dev/ws", "wss://gdbx.xup.workers.dev/ws"],
  local: "ws://absup:8787/ws",
  versionKey: "sys/gdbx/version",
};

const ts = Date.now();
const valuePayload = JSON.stringify(manifest);
const deltas = [{ key: "sys/gdbx/version", value: valuePayload, clock: ts }];
const pow = await minePoW(ID.addr, ID.pub, "sync.put", ts);
const sig = await sign(
  { addr: ID.addr, action: "sync.put", ts, payload: JSON.stringify(deltas) },
  pair,
);
const r = await fetch(API + "/sync", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    addr: ID.addr, pubkey: ID.pub, pubkeyHex: ID.hex,
    deltas,
    ts, nonce: pow.nonce, diff: pow.diff, hash: pow.hash, sig,
  }),
});
console.log("seed sys/gdbx/version:", r.status, JSON.stringify(await r.json()).slice(0, 60));

const g = await fetch(API + "/sync/" + ID.addr + "?prefix=sys/gdbx/version");
const gd = await g.json();
console.log("read-back:", gd.entries?.[0]?.value.slice(0, 90));
