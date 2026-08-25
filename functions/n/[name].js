/**
 * GET /n/<name> — .gdbx short-link resolver.
 *
 * Resolves the verified claim for <name>.gdbx and:
 *   - target is http(s) URL → 302 redirect
 *   - otherwise             → JSON claim
 */
export async function onRequestGet(context) {
  const { params, env } = context;
  const name = String(params.name || "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) {
    return json({ ok: false, error: "invalid name" }, 400);
  }

  // Read raw claim from the pool via the storage DO
  const id = env.GDBX_STORAGE.idFromName("default");
  const stub = env.GDBX_STORAGE.get(id);
  const entryRes = await stub.fetch(new Request(`https://do.local/name/${name}`));
  const data = await entryRes.json().catch(() => ({}));
  if (!entryRes.ok || !data.ok) {
    return json({ ok: false, error: data.error || `HTTP ${entryRes.status}` }, entryRes.status === 404 ? 404 : 502);
  }

  const target = String(data.target || "");
  if (/^https?:\/\//i.test(target)) {
    return new Response(null, {
      status: 302,
      headers: { location: target, "access-control-allow-origin": "*" },
    });
  }
  return json(data);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}
