/**
 * test_gun_client.mjs — REAL stock gun.js clients peering with GDBx /gun.
 * Proves the GunX engine absorbed into GDBx works with unmodified gun apps.
 *
 * Findings encoded here (all verified empirically):
 * - axe/multicast must be disabled in Node (LAN discovery breaks remote writes).
 * - `.once()` fires undefined after ~99ms without waiting for network → use .on().
 * - gun.js shares ONE WebSocket across instances within a process (peer cache),
 *   so cross-instance broadcast tests MUST span processes (real clients do).
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import Gun from "gun";
import "gun/sea.js";

const PEER = process.env.GUN_URL || "https://gdbx-do.xup.workers.dev/gun";
const OPTS = { peers: [PEER], radisk: false, localStorage: false, axe: false, multicast: false };
// Capture BEFORE any Gun() construction — gun mutates its options object
// (attaches circular mesh refs), which would break later JSON.stringify.
const OPTS_JSON = JSON.stringify(OPTS);

const ok = (name, cond) => { console.log(`${cond ? "✔" : "✖"} ${name}`); if (!cond) process.exitCode = 1; };

/** Spawn an independent gun subscriber process (like another browser/device). */
function spawnSubscriber(soul, matchValue, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const lines = [
      'import Gun from "gun";',
      `const g = new Gun(${OPTS_JSON});`,
      "setTimeout(() => {",
      `  g.get(${JSON.stringify(soul)}).on((d) => {`,
      '    if (d && d.message) { console.log("CHILD-GOT:" + d.message); process.exit(0); }',
      "  });",
      "}, 2500);",
      `setTimeout(() => process.exit(2), ${timeoutMs});`,
    ];
    const path = "_gun_child_test.mjs";
    writeFileSync(path, lines.join("\n"));
    let out = "";
    const c = spawn(process.execPath, [path], { cwd: process.cwd() });
    c.stdout.on("data", (d) => { out += String(d); });
    const finish = (result) => { try { c.kill(); } catch {}; resolve(result); };
    c.stdout.on("data", () => {
      if (out.includes("CHILD-GOT:" + matchValue)) finish(true);
    });
    c.on("exit", () => resolve(out.includes("CHILD-GOT:" + matchValue)));
    setTimeout(() => finish(false), timeoutMs + 2000);
  });
}

/* ── 1. put + ack over WebSocket ─────────────────────────────────── */
const soul = `gdbx-client-test/${Date.now()}`;
const marker = "written-by-stock-gunjs-" + Date.now();
const g1 = new Gun(OPTS);
const ack = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), 20000);
  g1.get(soul).put({ message: marker }, (a) => { clearTimeout(t); resolve(a); });
});
ok(`stock gun.js put ack {ok:1} via GDBx relay`, !!ack && ack.ok === 1);

/* ── 2. local graph read-back (.on fires instantly from cache) ───── */
const localRead = await new Promise((resolve) => {
  g1.get(soul).on((d) => { if (d && d.message) resolve(d); });
});
ok("local graph read-back (.on)", !!localRead && localRead.message === marker);

/* ── 3. independent PROCESS reads back (server GET path) ─────────── */
const childRead = await spawnSubscriber(soul, marker);
ok("independent process reads back via GDBx relay", !!childRead);

/* ── 4. live broadcast reaches an independent PROCESS ────────────── */
const soulLive = `${soul}-live`;
const liveMsg = "live-broadcast-works-" + Date.now();

// subscriber first (its WS window opens at +2.5s), put after
setTimeout(() => { try { g1.get(soulLive).put({ message: liveMsg }); } catch {} }, 6000);
const childLive = await spawnSubscriber(soulLive, liveMsg, 35000);
ok("live broadcast reaches independent process", !!childLive);

console.log(process.exitCode ? "\nGUN.JS CLIENT: FAIL" : "\nGUN.JS CLIENT: PASS");
process.exit(process.exitCode || 0);
