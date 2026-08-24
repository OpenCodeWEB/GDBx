/**
 * /gunx â€” Gun wire-protocol compatible relay (GunX engine absorbed into GDBx).
 *
 *   wss://gdbx.xup.workers.dev/gunx   â†’ native WebSocket gun peer (primary)
 *   POST https://gdbx.pages.dev/gunx     â†’ HTTP wire fallback (proxied here)
 *   GET  https://gdbx.pages.dev/gunx     â†’ 426 probe + peer hint
 *
 * Cloudflare Pages Functions cannot forward WebSocket upgrades, so GunX clients
 * should use the worker domain for live peering; this proxy covers the HTTP
 * transport (gun's `radisk: false` HTTP fallback and simple REST-style puts).
 */

const WORKER_GUN = "https://gdbx.xup.workers.dev/gunx";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const upgrade = request.headers.get("upgrade");
  if (upgrade && upgrade.toLowerCase() === "websocket") {
    // Pages cannot forward WS upgrades â€” point clients at the worker domain.
    return new Response(
      JSON.stringify({
        err: "websocket-upgrade-not-proxied",
        hint: "use wss://gdbx.xup.workers.dev/gunx for live gun peering",
      }),
      { status: 426, headers: { ...CORS, "content-type": "application/json", upgrade: "websocket" } },
    );
  }

  if (request.method === "POST") {
    const body = await request.text();
    return fetch(WORKER_GUN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  }

  // Probe: describe the relay like the worker does.
  try {
    const stats = await fetch("https://gdbx.xup.workers.dev/gunx/stats").then((r) => r.json());
    return new Response(
      JSON.stringify({
        status: "websocket required",
        peer: "/gunx",
        ws: "wss://gdbx.xup.workers.dev/gunx",
        http: "POST https://gdbx.pages.dev/gunx",
        engine: "GunX-compat (GunX absorbed into GDBx)",
        stats,
      }),
      { status: 426, headers: { ...CORS, "content-type": "application/json", upgrade: "websocket" } },
    );
  } catch {
    return new Response(
      JSON.stringify({ status: "websocket required", ws: "wss://gdbx.xup.workers.dev/gunx" }),
      { status: 426, headers: { ...CORS, "content-type": "application/json", upgrade: "websocket" } },
    );
  }
}
