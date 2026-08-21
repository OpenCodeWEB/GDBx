/**
 * POST /api/imgbb — server-side proxy for api.imgbb.com (GDBx playground, GunX parity)
 *
 * Same protection as GunX: origin allowlist, size cap, type check, rate limit.
 * Key lives ONLY in Pages secret `IMGBB_KEY`. GDBx-native but reuses imgbb host for
 * large images (sovereign chunked fallback if key not configured).
 */

const ALLOWED_ORIGIN_SUFFIXES = [
  "https://gdbx.pages.dev",
  ".gdbx.pages.dev",
  "http://localhost:8788",
  "http://localhost:8787",
  "http://localhost:5173",
];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}

function json(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-gdbx-key",
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const origin = request.headers.get("origin") || "";
  const allowlisted = ALLOWED_ORIGIN_SUFFIXES.some((s) => origin.endsWith(s));
  const uploadKey = env.GDBX_UPLOAD_KEY;
  const hasKey = uploadKey && request.headers.get("x-gdbx-key") === uploadKey;
  if (!allowlisted && !hasKey) return json({ error: "origin not allowed" }, 403);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (rateLimited(ip)) return json({ error: "rate limited" }, 429);

  const imgbbKey = env.IMGBB_KEY;
  if (!imgbbKey) return json({ error: "imgbb key not configured — use chunked GDBx delta fallback" }, 500);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "invalid multipart form" }, 400); }
  const file = form.get("image");
  if (!file || typeof file === "string") return json({ error: "image file required (field 'image')" }, 400);
  if (!(file.type || "").startsWith("image/")) return json({ error: "only image/* allowed" }, 415);
  if (file.size > MAX_IMAGE_BYTES) return json({ error: "image too large (max 10 MB)" }, 413);

  const imgbb = new FormData();
  imgbb.append("key", imgbbKey);
  imgbb.append("image", file, file.name || "upload.png");

  let res;
  try { res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: imgbb }); } catch { return json({ error: "imgbb unreachable" }, 502); }

  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data || !data.data) {
    const msg = (data && data.error && (data.error.message || data.error.code)) || `imgbb upload failed (${res.status})`;
    return json({ error: String(msg) }, 502);
  }
  const d = data.data;
  return json({ url: d.url, display_url: d.display_url, delete_url: d.delete_url, thumb: d.thumb, width: d.width, height: d.height, size: d.size, time: d.time });
}
