/**
 * gdbx-inspector.js â€” Visual Mesh & Topology Inspector (lite)
 * Fetches /pool, /stats, and live WS deltas; renders plain table.
 * Future: D3 force graph.
 */
export async function renderInspector(rootEl, opts = {}) {
  const api = opts.api || "https://gdbx.xup.workers.dev";
  const addr = opts.addr || new URLSearchParams(location.search).get("addr") || "";
  rootEl.innerHTML = `<h3>GDBx Inspector</h3><div id="gdbx-pool">loading pool...</div><div id="gdbx-stats">loading stats...</div><div id="gdbx-live">live: connecting...</div>`;
  const poolEl = rootEl.querySelector("#gdbx-pool");
  const statsEl = rootEl.querySelector("#gdbx-stats");
  const liveEl = rootEl.querySelector("#gdbx-live");

  try {
    const pool = await fetch(`${api}/pool`).then((r) => r.json());
    poolEl.innerHTML = `<h4>Pool</h4><pre>${JSON.stringify(pool, null, 2)}</pre>`;
  } catch (e) {
    poolEl.textContent = "pool error: " + e.message;
  }
  try {
    const stats = await fetch(`${api}/stats`).then((r) => r.json());
    statsEl.innerHTML = `<h4>Stats</h4><pre>${JSON.stringify(stats, null, 2)}</pre>`;
  } catch (e) {
    statsEl.textContent = "stats error: " + e.message;
  }
  if (addr) {
    liveEl.textContent = `live: watching ${addr.slice(0, 12)}...`;
    try {
      const { GDBxWS } = await import("/js/gdbx-ws-client.js");
      // need pair? inspector is read-only, just show presence
      liveEl.textContent += " (WS hub " + api + "/ws)";
    } catch {}
  } else {
    liveEl.textContent = "live: add ?addr=<58-char> to watch deltas";
  }
}

if (typeof window !== "undefined" && document.currentScript) {
  // auto-render if inspector.html includes <div id="gdbx-inspector">
  document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("gdbx-inspector");
    if (el) renderInspector(el);
  });
}
