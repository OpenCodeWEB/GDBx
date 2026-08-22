/**
 * gdbx-live.js — live mesh diagnostics + WebSocket sandbox for GDBx.
 *
 *  - Animated node-topology canvas in the hero (transports pulsing)
 *  - Live stats from GET /api/v1/stats (REAL data — no demo numbers)
 *  - Leaderboard + transport breakdown from GET /api/v1/leaderboard
 *  - Dual-pane sandbox: Node A writes signed deltas over WebSocket,
 *    Node B receives the live delta broadcast.
 */
const API = "https://gdbx.pages.dev/api/v1";
// WebSocket live sync is served directly by the gdbx-do Worker (Pages Functions
// cannot forward the WS upgrade handshake — Cloudflare limitation).
const WS_BASE = "wss://gdbx-do.xup.workers.dev/ws";
const $ = (id) => document.getElementById(id);

/* ── Hero: animated mesh topology ─────────────────────────────── */
(function meshTopology() {
  const canvas = $("mesh-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;
  const nodes = [];
  const N = 26;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = canvas.width = rect.width;
    H = canvas.height = rect.height;
  }
  resize();
  window.addEventListener("resize", resize);

  for (let i = 0; i < N; i++) {
    nodes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: 1.5 + Math.random() * 2.5,
      hue: [265, 190, 300, 160][i % 4], // violet/cyan/fuchsia/emerald
      pulse: Math.random() * Math.PI * 2,
    });
  }

  function tick() {
    ctx.clearRect(0, 0, W, H);
    const t = Date.now() / 1000;
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    }
    // edges
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 130 * 130) {
          const alpha = (1 - Math.sqrt(d2) / 130) * 0.14;
          ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2}, 80%, 65%, ${alpha})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    // nodes with transport pulse
    for (const n of nodes) {
      const pulseR = 3 + Math.sin(t + n.pulse) * 1.2;
      ctx.fillStyle = `hsla(${n.hue}, 85%, 65%, .9)`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (Math.sin(t * 1.4 + n.pulse) > 0.6) {
        ctx.strokeStyle = `hsla(${n.hue}, 85%, 65%, .35)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, pulseR + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

/* ── Live stats strip (REAL data) ─────────────────────────────── */
async function loadStats() {
  try {
    const t0 = performance.now();
    const res = await fetch(`${API}/stats`);
    const latency = Math.round(performance.now() - t0);
    const { stats } = await res.json();
    if ($("stat-dids")) $("stat-dids").textContent = (stats.dids ?? 0).toLocaleString();
    if ($("stat-deltas")) $("stat-deltas").textContent = (stats.deltas ?? 0).toLocaleString();
    if ($("stat-active")) $("stat-active").textContent = (stats.active ?? 0).toLocaleString();
    if ($("stat-latency")) $("stat-latency").textContent = latency;
  } catch (e) {
    for (const id of ["stat-dids", "stat-deltas", "stat-active"]) {
      const el = $(id);
      if (el) el.textContent = "—";
    }
    if ($("stat-latency")) $("stat-latency").textContent = "—";
  }
}

/* ── Leaderboard + transports + peers (REAL data) ─────────────── */
async function loadLeaderboard() {
  try {
    const res = await fetch(`${API}/leaderboard`);
    const data = await res.json();
    const lb = $("leaderboard");
    if (lb) {
      if (!data.top || data.top.length === 0) {
        lb.innerHTML = `<div class="text-slate-600 text-xs">no active addresses yet — be the first to sync</div>`;
      } else {
        lb.innerHTML = data.top
          .map(
            (t, i) => `<div class="flex items-center gap-3 py-1.5 border-b border-slate-800/60 last:border-0">
            <span class="w-5 text-slate-500">#${i + 1}</span>
            <span class="text-cyan-300 truncate flex-1">${t.addr.slice(0, 18)}…${t.addr.slice(-6)}</span>
            <span class="text-emerald-300 font-bold">${t.deltas}</span>
            <span class="text-slate-500 text-xs">deltas</span>
          </div>`,
          )
          .join("");
      }
    }

    const tl = $("transports-live");
    if (tl) {
      const tr = data.stats?.transports || {};
      const entries = Object.entries(tr);
      if (entries.length === 0) {
        tl.innerHTML = `<div class="text-slate-600 text-xs">no transport heartbeats yet</div>`;
      } else {
        const max = Math.max(...entries.map(([, v]) => v), 1);
        tl.innerHTML = entries
          .map(
            ([name, count]) => `<div>
            <div class="flex justify-between text-xs mb-1"><span class="text-slate-300 mono">${name}</span><span class="text-cyan-300 mono">${count}</span></div>
            <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div class="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500" style="width:${Math.round((count / max) * 100)}%"></div></div>
          </div>`,
          )
          .join("");
      }
    }

    const pl = $("peers-live");
    if (pl) {
      if (!data.peers || data.peers.length === 0) {
        pl.innerHTML = `<div class="text-slate-600 text-xs">no peers online right now</div>`;
      } else {
        pl.innerHTML = data.peers
          .slice(0, 6)
          .map(
            (p) => `<div class="flex items-center gap-2 text-xs">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span class="text-slate-300 truncate">${p.addr.slice(0, 14)}…${p.addr.slice(-4)}</span>
            <span class="text-slate-600 ml-auto">${(p.transports || []).join(" · ") || "—"}</span>
          </div>`,
          )
          .join("");
      }
    }
  } catch (e) {
    const lb = $("leaderboard");
    if (lb) lb.innerHTML = `<div class="text-rose-400 text-xs">live data unavailable</div>`;
  }
}

/* ── Dual-pane WebSocket sandbox ──────────────────────────────── */
(async function sandbox() {
  const termA = $("term-a");
  const termB = $("term-b");
  const keyInput = $("sandbox-key");
  const valInput = $("sandbox-value");
  const sendBtn = $("sandbox-send");
  const statusEl = $("sandbox-status");
  const addrEl = $("node-a-addr");
  if (!termA || !termB || !sendBtn) return;

  const log = (el, text, cls = "log-info") => {
    const line = document.createElement("div");
    line.className = cls;
    line.textContent = text;
    // remove caret placeholder
    const caret = el.querySelector(".type-caret");
    if (caret) caret.remove();
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  };

  // Sandbox identity — reuse from localStorage to avoid 10/min DID rate limit (like GunX's persistent pair)
  let pair = null;
  let pubkeyHex = null;
  let addr = null;
  try {
    const GDBxCrypto = window.GDBxCrypto;
    if (!GDBxCrypto || !GDBxCrypto.pair) throw new Error("GDBxCrypto not loaded");
    const STORAGE_KEY = "gdbx-sandbox-identity-v1";
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
    if (stored && stored.pub && stored.priv && stored.pubkeyHex && stored.addr) {
      pair = { pub: stored.pub, priv: stored.priv };
      pubkeyHex = stored.pubkeyHex;
      addr = stored.addr;
    } else {
      pair = await GDBxCrypto.pair();
      const [x, y] = pair.pub.split(".");
      const key = await crypto.subtle.importKey(
        "jwk", { kty: "EC", crv: "P-256", x, y, ext: true },
        { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"],
      );
      const jwk = await crypto.subtle.exportKey("jwk", key);
      const b64uToHex = (s) => {
        const pad = s.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(pad + (pad.length % 4 === 0 ? "" : "=".repeat(4 - (pad.length % 4))));
        return [...new Uint8Array(bin.length)].map((_, i) => bin.charCodeAt(i).toString(16).padStart(2, "0")).join("");
      };
      pubkeyHex = "04" + b64uToHex(jwk.x) + b64uToHex(jwk.y);
      const ar = await fetch(`${API}/address`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubkey: pubkeyHex, network: 0 }),
      });
      const ad = await ar.json();
      addr = ad.bare;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ pub: pair.pub, priv: pair.priv, pubkeyHex, addr })); } catch {}
    }
    if (addrEl) addrEl.textContent = addr.slice(0, 10) + "…";
    // quick check: if DID already exists, mark registered (avoid 429)
    try {
      const chk = await fetch(`${API}/did/${addr}`);
      if (chk.ok) registered = true;
    } catch {}
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span class="text-rose-400">identity setup failed: ${e.message}</span>`;
    return;
  }

  let ws = null; // single sandbox socket — Node A writes, delta echoes feed Node B pane
  let registered = false;
  let retryMs = 5000; // backoff: 5s → 10s → 20s (cap)

  const ensureRegistered = async () => {
    if (registered) return true;
    const ts = Date.now();
    // minimal PoW (diff 2 — server accepts ≥2 for long addresses)
    const hashInput = `${addr}:${pair.pub}:did.register:${ts}:`;
    let nonce = 1, found = null;
    for (;;) {
      const buf = new TextEncoder().encode(hashInput + nonce);
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex.startsWith("00")) { found = { nonce, hash: hex }; break; }
      nonce += 1;
      if (nonce > 500000) return false;
    }
    // sign canonical body with GDBxCrypto (self-sovereign, no gun)
    const GDBxCrypto = window.GDBxCrypto;
    const canonical = { addr, action: "did.register", ts, payload: null };
    const seaSig = await GDBxCrypto.sign(canonical, pair);

    const res = await fetch(`${API}/did/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addr,
        pubkey: pair.pub,
        pubkeyHex,
        ts,
        nonce: found.nonce,
        diff: 2,
        hash: found.hash,
        sig: seaSig,
      }),
    });
    const data = await res.json();
    if (!res.ok && !/already|exists|registered/i.test(data.error || "")) {
      throw new Error(data.error || "register failed");
    }
    registered = true;
    return true;
  };

  const connect = () => {
    try {
      ws = new WebSocket(`${WS_BASE}?addr=${addr}`);
      ws.onopen = () => {
        retryMs = 5000;
        ws.send(JSON.stringify({ type: "hello", addr }));
        if (statusEl) statusEl.innerHTML = `<span class="text-emerald-400"><i class="fa-solid fa-circle text-[6px] mr-1"></i>connected — live sync ready</span>`;
        log(termB, `[Node B] subscribed to ${addr.slice(0, 12)}… via WebSocket`, "log-ok");
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "delta") {
          log(termB, `[Node B] Δ ${msg.key} = ${JSON.stringify(msg.value)} (clock ${msg.clock})`, "log-ok");
        } else if (msg.type === "applied") {
          log(termA, `[Node A] ✓ applied ${msg.applied} delta(s) — broadcast live`, "log-ok");
        } else if (msg.type === "error") {
          log(termA, `[Node A] ✗ ${msg.error}`, "log-err");
        }
      };
      ws.onclose = () => {
        if (statusEl) statusEl.innerHTML = `<span class="text-slate-500">disconnected — retrying…</span>`;
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 20000);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch {
      if (statusEl) statusEl.innerHTML = `<span class="text-rose-400">WebSocket unavailable in this browser</span>`;
    }
  };

  // 429 auto-retry with backoff (sandbox optimization): if the DO rate limiter
  // rejects a burst, retry the same put after a short wait instead of failing —
  // the bucket refills every minute and demo capacity is now 120/min.
  let sendRetryTimer = null;
  function scheduleRetry(key, value, attempt = 1) {
    if (attempt > 3) {
      log(termA, "[Node A] ✗ still rate limited after 3 retries — try again in ~30s", "log-warn");
      return;
    }
    const waitMs = attempt * 3000;
    if (sendRetryTimer) clearTimeout(sendRetryTimer);
    log(termA, `[Node A] ↻ rate limited — retrying in ${waitMs / 1000}s (attempt ${attempt}/3)…`, "log-warn");
    sendRetryTimer = setTimeout(() => doSend(key, value, attempt + 1), waitMs);
  }

  async function doSend(key, value, retryAttempt = 0) {
    if (!key) { log(termA, "[Node A] ✗ key required", "log-warn"); return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) { log(termA, "[Node A] ✗ not connected", "log-warn"); return; }
    try {
      await ensureRegistered();
      const ts = Date.now();
      // PoW for sync.put (diff 2)
      const hashInput = `${addr}:${pair.pub}:sync.put:${ts}:`;
      let nonce = 1, found = null;
      for (;;) {
        const buf = new TextEncoder().encode(hashInput + nonce);
        const digest = await crypto.subtle.digest("SHA-256", buf);
        const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
        if (hex.startsWith("00")) { found = { nonce, hash: hex }; break; }
        nonce += 1;
        if (nonce > 500000) { log(termA, "[Node A] ✗ PoW timeout", "log-err"); return; }
      }
      const SEA = window.GDBxCrypto;
      const deltas = [{ key: `sandbox/${key.replace(/^\/+/, "")}`, value, clock: ts }];
      const sig = await SEA.sign({ addr, action: "sync.put", ts, payload: JSON.stringify(deltas) }, pair);
      log(termA, `[Node A] → put sandbox/${key} = ${JSON.stringify(value)} (signed, PoW ✓)`, "log-info");

      // send and await ack/error so we can auto-retry on 429
      const resp = await new Promise((resolve) => {
        const handler = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch { return; }
          const isOurs = m.type === "applied" || m.type === "error";
          if (!isOurs) return;
          ws.removeEventListener("message", handler);
          resolve(m);
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({
          type: "put", addr, pubkey: pair.pub, pubkeyHex,
          deltas, ts, nonce: found.nonce, diff: 2, hash: found.hash, sig,
        }));
        setTimeout(() => { ws.removeEventListener("message", handler); resolve({ type: "timeout" }); }, 10000);
      });

      if (resp.type === "applied") {
        log(termA, `[Node A] ✓ applied ${resp.applied} delta(s) — broadcast live`, "log-ok");
      } else if (resp.type === "error") {
        if (/rate limited/i.test(resp.error || "")) {
          scheduleRetry(key, value, Math.max(retryAttempt, 1));
          return;
        }
        log(termA, `[Node A] ✗ ${resp.error}`, "log-err");
      } else {
        log(termA, "[Node A] ⚠ no ack from hub (timeout)", "log-warn");
      }
    } catch (e) {
      log(termA, `[Node A] ✗ ${e.message}`, "log-err");
    }
  }

  sendBtn.addEventListener("click", () => {
    const key = keyInput.value.trim();
    const value = valInput.value.trim();
    doSend(key, value, 0);
  });

  connect();
})();

/* ── Boot ─────────────────────────────────────────────────────── */
loadStats();
loadLeaderboard();
setInterval(() => {
  loadStats();
  loadLeaderboard();
}, 30_000);