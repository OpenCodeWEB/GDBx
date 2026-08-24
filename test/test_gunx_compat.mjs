/**
 * test_gun_compat.mjs — Gun wire-protocol compatibility test for GDBx.
 *
 * Speaks the raw gun protocol over WebSocket against wss://…/gun:
 *   1. put   → expect ack  {"@":id,"ok":1}
 *   2. get   → expect node back
 *   3. relay → second socket receives broadcast put
 *   4. HTTP POST fallback works too
 */
import { WebSocket } from "ws";

const BASE = process.env.GUN_URL || "wss://gdbx.xup.workers.dev/gunx";
const ok = (name, cond) => {
  console.log(`${cond ? "✔" : "✖"} ${name}`);
  if (!cond) process.exitCode = 1;
};

function gunSend(ws, msg) {
  msg["#"] = "req" + Math.random().toString(36).slice(2, 8);
  ws.send(JSON.stringify(msg));
  return msg["#"];
}

function waitFor(ws, predicate, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      let data;
      try { data = JSON.parse(String(raw)); } catch { return; }
      const list = Array.isArray(data) ? data : [data];
      for (const m of list) {
        if (predicate(m)) { ws.off("message", handler); resolve(m); return; }
      }
    };
    ws.on("message", handler);
    setTimeout(() => { ws.off("message", handler); resolve(null); }, timeoutMs);
  });
}

// ── 1+2+3: WS put / get / relay ────────────────────────────────────
const soul = `gdbx-test/${Date.now()}`;
const wsA = new WebSocket(BASE);
await new Promise((res, rej) => { wsA.on("open", res); wsA.on("error", rej); });

// listener socket FIRST so it catches the relay broadcast
const wsB = new WebSocket(BASE);
await new Promise((res, rej) => { wsB.on("open", res); wsB.on("error", rej); });
const relayPromise = waitFor(wsB, (m) => m.put && m.put[soul]);

const ts = Date.now();
gunSend(wsA, {
  put: {
    [soul]: {
      _: { "#": soul, ">": { message: ts } },
      message: "hello from GDBx GunX-compat",
    },
  },
});

const ack = await waitFor(wsA, (m) => m["@@"] || (m["@@"] === undefined && m["@"] && m.ok === 1));
ok("put ack {ok:1}", !!ack);

const relayed = await relayPromise;
ok("relay broadcast reaches second peer", !!relayed);

gunSend(wsA, { get: { "#": soul } });
const readBack = await waitFor(wsA, (m) => m.put && m.put[soul] && m.put[soul].message);
ok("get returns merged node with message field", !!readBack && readBack.put[soul].message === "hello from GDBx GunX-compat");

wsA.close();
wsB.close();

// ── 4: HTTP POST fallback ──────────────────────────────────────────
const HTTP = BASE.replace(/^wss:/, "https:");
const httpSoul = `gdbx-test/http-${Date.now()}`;
const r = await fetch(HTTP, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    put: { [httpSoul]: { _: { "#": httpSoul, ">": { v: Date.now() } }, v: "http-fallback-ok" } },
  }),
});
const rd = await r.json().catch(() => ({}));
ok(`HTTP POST put ack (status ${r.status})`, r.ok && rd.ok === 1);

const g = await fetch(HTTP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ get: { "#": httpSoul } }) });
const gd = await g.json().catch(() => ({}));
ok("HTTP POST get returns node", !!(gd.put && gd.put[httpSoul] && gd.put[httpSoul].v === "http-fallback-ok"));

console.log(process.exitCode ? "\nGUN-COMPAT: FAIL" : "\nGUN-COMPAT: PASS");
