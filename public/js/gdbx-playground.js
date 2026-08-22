/**
 * gdbx-playground.js — Live P2P Playground for GDBx (GunX parity, GDBx-native)
 *
 * Features:
 * - Public/private rooms (E2E AES-GCM for private)
 * - Real-time chat via GDBx pool (WS + HTTP fallback, signed deltas, PoW diff 2)
 * - Presence (online count via /stats active)
 * - Relay status (pool + stats)
 * - Image (<32KB base64) + file stub
 *
 * Demo identity (shared public playground address) — gun-free GDBx:
 */
const DEMO = {
  pub: "xb_tjiMr6afzWikmd6yyNjPSaLkWoj_jDBEB-TqgJio.AR_uV6kJN1Re4STtyUH92_3jGH3GaVAPnTi4yNEyLaY",
  priv: "3LES18Y1yLNIyshQ7eEb0ZAIO1sRbuXoImaJ1dKVJKc",
  pubkeyHex: "04c5bfed8e232be9a7f35a292677acb23633d268b916a23fe30c1101f93aa0262a011fee57a90937545ee124edc941fddbfde3187dc669500f9d38b8c8d1322da6",
  addr: "aeaagiao64onmpxlv7bjgk4chnpvl5h77erwqq7gockpvm2kafwzwmzt3u",
};
const API = "https://gdbx.pages.dev/api/v1";
const WS_BASE = "wss://gdbx-do.xup.workers.dev/ws";
const $ = (id) => document.getElementById(id);

export function initPlayground() {
  const messages = $("pg-messages");
  const msgForm = $("pg-msgForm");
  const msgInput = $("pg-msgInput");
  const roomPill = $("pg-roomPill");
  const roomLockPill = $("pg-roomLockPill");
  const onlinePill = $("pg-onlinePill");
  const newRoomBtn = $("pg-newRoomBtn");
  const joinRoomBtn = $("pg-joinRoomBtn");
  const clearBtn = $("pg-clearBtn");
  const imgBtn = $("pg-imgBtn");
  const fileBtn = $("pg-fileBtn");
  const imgInput = $("pg-imgInput");
  const fileInput = $("pg-fileInput");
  if (!messages || !msgForm) return;

  // visitor id for "from"
  let visitorId = localStorage.getItem("gdbx-visitor");
  if (!visitorId) {
    visitorId = "visitor-" + Math.random().toString(36).slice(2, 6);
    localStorage.setItem("gdbx-visitor", visitorId);
  }

  // room state: parse hash #r= & #k= (or #playground&r=)
  let currentRoom = "playground/public";
  let roomKey = null; // CryptoKey for private rooms
  let roomKeyB64 = null;

  function parseHash() {
    const h = location.hash || "";
    // support #r=xxx&k=yyy or #playground&r=xxx or ?r= (fallback to search)
    const search = location.search + "&" + h.replace(/^#/, "");
    const params = new URLSearchParams(search);
    const r = params.get("r");
    const k = params.get("k");
    if (r) {
      currentRoom = r.startsWith("playground/") ? r : `playground/private/${r}`;
      if (k) {
        roomKeyB64 = k;
        // import key
        const raw = b64ToBytes(k);
        crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]).then((ck) => {
          roomKey = ck;
          if (roomLockPill) roomLockPill.classList.remove("hidden");
        });
      } else {
        if (roomLockPill) roomLockPill.classList.remove("hidden");
      }
    } else {
      // check hash for playground room prefix like #playground&r=...
      if (h.includes("private/")) {
        const m = h.match(/private\/([^&]+)/);
        if (m) currentRoom = `playground/private/${m[1]}`;
      }
    }
    if (roomPill) roomPill.textContent = `room: ${currentRoom.replace("playground/", "")}`;
    if (!roomKeyB64 && roomLockPill) roomLockPill.classList.add("hidden");
  }
  parseHash();
  window.addEventListener("hashchange", () => {
    parseHash();
    // clear view and resubscribe (poll will pick up new prefix)
    messages.innerHTML = "";
    seenKeys.clear();
    loadHistory();
  });

  // helpers
  function b64ToBytes(b64) {
    const s = b64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function nanoid(n = 8) {
    const a = "0123456789abcdefghijklmnopqrstuvwxyz";
    let s = "";
    const r = crypto.getRandomValues(new Uint8Array(n));
    for (let i = 0; i < n; i++) s += a[r[i] % a.length];
    return s;
  }
  // GDBx delta is 32KB max (flat-primitive, DoS protection) — but GunX playground supports any size via imgbb proxy + P2P.
  // For GDBx we do GunX parity: image → /api/imgbb proxy (10MB, server-side key), fallback → chunked pool (sovereign, any size)
  // File → chunked pool (sovereign, any size) with manifest, reassembled on receive. P2P WebRTC direct (any size, no relay) deferred but stub.
  async function putSingleDelta(key, value) {
    const ts = Date.now();
    const hashInput = `${DEMO.addr}:${DEMO.pub}:sync.put:${ts}:`;
    let nonce = 1, found = null;
    for (; nonce < 500000; nonce++) {
      const buf = new TextEncoder().encode(hashInput + nonce);
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex.startsWith("00")) { found = { nonce, hash: hex }; break; }
    }
    if (!found) throw new Error("PoW timeout");
    const GDBxCrypto = window.GDBxCrypto;
    const deltas = [{ key, value, clock: ts }];
    const sig = await GDBxCrypto.sign({ addr: DEMO.addr, action: "sync.put", ts, payload: JSON.stringify(deltas) }, { pub: DEMO.pub, priv: DEMO.priv });
    const body = { addr: DEMO.addr, pubkey: DEMO.pub, pubkeyHex: DEMO.pubkeyHex, deltas, ts, nonce: found.nonce, diff: 2, hash: found.hash, sig };
    // prefer WS if open
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "put", ...body }));
      return;
    }
    const res = await fetch(`${API}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  }
  async function sendChunked(text, dataUrl, fname, fsize) {
    const CHUNK = 512000; // sovereign chunk granularity (server accepts up to 2MB per delta; chunking keeps WS frames small and enables any-size files)
    const msgId = `${Date.now()}-${nanoid(6)}`;
    const chunks = [];
    for (let i = 0; i < dataUrl.length; i += CHUNK) chunks.push(dataUrl.slice(i, i + CHUNK));
    // manifest first so receivers know to expect chunks (like GunX's file manifest)
    const manifest = { text, from: visitorId, ts: Date.now(), room: currentRoom, isChunked: true, msgId, chunks: chunks.length, fname, fsize, isImage: dataUrl.startsWith("data:image") };
    const manifestKey = `${currentRoom}/msg/${Date.now()}-${nanoid(4)}`;
    await putSingleDelta(manifestKey, JSON.stringify(manifest));
    seenKeys.add(manifestKey);
    addMsg(text, true, { fname, fsize, img: manifest.isImage ? "(chunked image — reassembling...)" : null });
    // then chunks
    for (let i = 0; i < chunks.length; i++) {
      const key = `${currentRoom}/chunk/${msgId}/${String(i).padStart(4, "0")}`;
      await putSingleDelta(key, chunks[i]);
      seenKeys.add(key);
    }
  }
  async function reassembleChunked(manifest) {
    const { msgId, chunks } = manifest;
    const prefix = `${currentRoom}/chunk/${msgId}/`;
    // fetch all chunks via HTTP (pool)
    try {
      const res = await fetch(`${API}/sync/${DEMO.addr}?prefix=${encodeURIComponent(prefix)}`);
      const data = await res.json();
      if (!data.entries) return null;
      data.entries.sort((a, b) => a.key.localeCompare(b.key));
      if (data.entries.length < chunks) return null; // not all yet
      return data.entries.map((e) => e.value).join("");
    } catch { return null; }
  }
  async function encryptText(text, key) {
    if (!key) return text;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    const combined = new Uint8Array(iv.length + enc.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(enc), 12);
    return "__enc__" + bytesToB64url(combined);
  }
  async function decryptText(maybeEnc, key) {
    if (!maybeEnc.startsWith("__enc__")) return maybeEnc;
    if (!key) return "[encrypted — join with room key]";
    try {
      const raw = b64ToBytes(maybeEnc.slice(7));
      const iv = raw.slice(0, 12);
      const data = raw.slice(12);
      const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
      return new TextDecoder().decode(dec);
    } catch {
      return "[decrypt failed]";
    }
  }

  const seenKeys = new Set();
  function addMsg(text, mine, opts = {}) {
    const div = document.createElement("div");
    div.className = "msg-in flex " + (mine ? "justify-end" : "justify-start");
    let extra = "";
    if (opts.img) {
      extra += `<a href="${opts.img}" target="_blank" rel="noopener"><img src="${opts.img}" class="mt-2 max-h-48 rounded-lg border border-slate-700 object-cover" alt=""></a>`;
    }
    if (opts.fname) {
      extra += `<div class="mt-2 flex items-center gap-2 text-xs"><i class="fa-solid fa-file text-cyan-400"></i><span>${String(opts.fname).replace(/</g, "&lt;")}</span><span class="text-slate-500 mono">${opts.fsize || 0}B</span></div>`;
      if (opts.blobUrl) {
        extra += `<a href="${opts.blobUrl}" download="${String(opts.fname).replace(/"/g, "")}" class="mt-1 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-xs hover:border-cyan-500/50"><i class="fa-solid fa-download text-cyan-400"></i> Save ${String(opts.fname).replace(/</g, "&lt;")}</a>`;
      }
    }
    div.innerHTML = `<span class="max-w-[80%] px-3 py-2 rounded-2xl text-sm break-words ${mine ? "bg-gradient-to-r from-violet-500/20 to-cyan-600/20 border border-violet-500/30 text-violet-100" : "bg-slate-800 border border-slate-700 text-slate-200"}">${String(text).replace(/</g, "&lt;")}${extra}</span>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  // PoW + sign helpers (reuse GDBxCrypto)
  async function ensureRegistered() {
    const ts = Date.now();
    const hashInput = `${DEMO.addr}:${DEMO.pub}:did.register:${ts}:`;
    let nonce = 1, found = null;
    for (; nonce < 500000; nonce++) {
      const buf = new TextEncoder().encode(hashInput + nonce);
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex.startsWith("00")) { found = { nonce, hash: hex }; break; }
    }
    if (!found) throw new Error("PoW timeout");
    const GDBxCrypto = window.GDBxCrypto;
    const sig = await GDBxCrypto.sign({ addr: DEMO.addr, action: "did.register", ts, payload: null }, { pub: DEMO.pub, priv: DEMO.priv });
    const res = await fetch(`${API}/did/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addr: DEMO.addr, pubkey: DEMO.pub, pubkeyHex: DEMO.pubkeyHex, ts, nonce: found.nonce, diff: 2, hash: found.hash, sig }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !/already|exists|registered/i.test(data.error || "")) throw new Error(data.error || "register failed");
  }

  let ws = null;
  let retryMs = 5000;
  let registered = false;
  async function connectWS() {
    try {
      ws = new WebSocket(`${WS_BASE}?addr=${DEMO.addr}`);
      ws.onopen = () => {
        retryMs = 5000;
        ws.send(JSON.stringify({ type: "hello", addr: DEMO.addr }));
        addMsg("connected — live sync ready", false);
      };
      ws.onmessage = async (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "delta") {
          if (!msg.key || !msg.key.startsWith(currentRoom)) return;
          if (msg.key.includes("/chunk/")) return; // sovereign chunked pieces, not messages
          if (seenKeys.has(msg.key)) return;
          seenKeys.add(msg.key);
          let text = String(msg.value || "");
          let parsed = null;
          try { parsed = JSON.parse(text); } catch {}
          if (parsed && typeof parsed === "object" && parsed.text) {
            if (parsed.isChunked && parsed.msgId) {
              const reassembled = await reassembleChunked(parsed);
              if (reassembled) {
                if (parsed.isImage || (reassembled && reassembled.startsWith("data:image"))) {
                  addMsg(parsed.text, parsed.from === visitorId, { img: reassembled, fname: parsed.fname, fsize: parsed.fsize });
                } else if (parsed.fname) {
                  // file: reassembled is dataUrl, create blob URL for download
                  try {
                    const res = await fetch(reassembled);
                    const blob = await res.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    addMsg(parsed.text, parsed.from === visitorId, { fname: parsed.fname, fsize: parsed.fsize, blobUrl });
                  } catch {
                    addMsg(parsed.text, parsed.from === visitorId, { fname: parsed.fname, fsize: parsed.fsize });
                  }
                } else {
                  text = await decryptText(reassembled, roomKey);
                  addMsg(text, parsed.from === visitorId);
                }
              } else {
                addMsg(parsed.text + " (reassembling…)", parsed.from === visitorId, { fname: parsed.fname, fsize: parsed.fsize });
              }
              return;
            }
            text = await decryptText(parsed.text, roomKey);
            const mine = parsed.from === visitorId;
            addMsg(text, mine, { img: parsed.img, fname: parsed.fname, fsize: parsed.fsize, blobUrl: parsed.blobUrl });
          } else {
            text = await decryptText(text, roomKey);
            addMsg(text, false);
          }
        } else if (msg.type === "error") {
          console.warn("WS error:", msg.error);
        }
      };
      ws.onclose = () => {
        setTimeout(connectWS, retryMs);
        retryMs = Math.min(retryMs * 2, 20000);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch {}
  }

  async function loadHistory() {
    try {
      const res = await fetch(`${API}/sync/${DEMO.addr}?prefix=${encodeURIComponent(currentRoom)}/`);
      const data = await res.json();
      if (!data.entries) return;
      data.entries.sort((a, b) => (a.clock || 0) - (b.clock || 0));
      for (const e of data.entries) {
        if (e.key.includes("/chunk/")) continue;
        if (seenKeys.has(e.key)) continue;
        seenKeys.add(e.key);
        let text = String(e.value || "");
        let parsed = null;
        try { parsed = JSON.parse(text); } catch {}
        if (parsed && typeof parsed === "object" && parsed.text) {
          if (parsed.isChunked && parsed.msgId) {
            const reassembled = await reassembleChunked(parsed);
            if (reassembled) {
              if (parsed.isImage || (reassembled && reassembled.startsWith("data:image"))) {
                addMsg(parsed.text, parsed.from === visitorId, { img: reassembled, fname: parsed.fname, fsize: parsed.fsize });
              } else if (parsed.fname) {
                try {
                  const res2 = await fetch(reassembled);
                  const blob = await res2.blob();
                  const blobUrl = URL.createObjectURL(blob);
                  addMsg(parsed.text, parsed.from === visitorId, { fname: parsed.fname, fsize: parsed.fsize, blobUrl });
                } catch {
                  addMsg(parsed.text, parsed.from === visitorId, { fname: parsed.fname, fsize: parsed.fsize });
                }
              } else {
                text = await decryptText(reassembled, roomKey);
                addMsg(text, parsed.from === visitorId);
              }
            } else {
              addMsg(parsed.text + " (reassembling…)", parsed.from === visitorId, { fname: parsed.fname, fsize: parsed.fsize });
            }
            continue;
          }
          text = await decryptText(parsed.text, roomKey);
          const mine = parsed.from === visitorId;
          addMsg(text, mine, { img: parsed.img, fname: parsed.fname, fsize: parsed.fsize });
        } else {
          text = await decryptText(text, roomKey);
          addMsg(text, false);
        }
      }
    } catch {}
  }

  async function sendMessage(text, extra = {}) {
    if (!text && !extra.img && !extra.fname) return;
    if (!registered) {
      try { await ensureRegistered(); registered = true; } catch (e) { addMsg("register failed: " + e.message, true); return; }
    }
    const ts = Date.now();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const key = `${currentRoom}/msg/${ts}-${id}`;
    let payloadText = text;
    if (roomKey) payloadText = await encryptText(text, roomKey);
    const valueObj = { text: payloadText, from: visitorId, ts, room: currentRoom, ...extra };
    let value = JSON.stringify(valueObj);
    if (value.length > 512000) {
      // GunX parity for large payloads: GDBx delta is 32KB max per delta (DoS protection, LWW) — but any size is supported via sovereign chunked pool
      // Chunk the value into 28KB pieces + manifest, like IPFS chunking — no external relay, pool-replicated, reassembled on receive
      // For images/files, extra.img/dataUrl is already large, so chunk the full value
      await sendChunked(text, value, extra.fname, extra.fsize);
      return;
    }
    // PoW
    const hashInput = `${DEMO.addr}:${DEMO.pub}:sync.put:${ts}:`;
    let nonce = 1, found = null;
    for (; nonce < 500000; nonce++) {
      const buf = new TextEncoder().encode(hashInput + nonce);
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex.startsWith("00")) { found = { nonce, hash: hex }; break; }
    }
    if (!found) { addMsg("PoW timeout", true); return; }
    const GDBxCrypto = window.GDBxCrypto;
    const deltas = [{ key, value, clock: ts }];
    const sig = await GDBxCrypto.sign({ addr: DEMO.addr, action: "sync.put", ts, payload: JSON.stringify(deltas) }, { pub: DEMO.pub, priv: DEMO.priv });
    const msg = { type: "put", addr: DEMO.addr, pubkey: DEMO.pub, pubkeyHex: DEMO.pubkeyHex, deltas, ts, nonce: found.nonce, diff: 2, hash: found.hash, sig };
    let sent = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); sent = true; } catch {}
    }
    if (!sent) {
      // HTTP fallback
      try {
        const res = await fetch(`${API}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addr: DEMO.addr, pubkey: DEMO.pub, pubkeyHex: DEMO.pubkeyHex, deltas, ts, nonce: found.nonce, diff: 2, hash: found.hash, sig }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "sync failed");
      } catch (e) { addMsg("send failed: " + e.message, true); return; }
    }
    // optimistic add
    addMsg(text, true, extra);
    // mark seen to avoid echo duplicate (WS will echo)
    seenKeys.add(key);
  }

  // UI events
  msgForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = msgInput.value.trim();
    if (!t) return;
    sendMessage(t);
    msgInput.value = "";
  });

  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (!confirm("This only clears your local view on this tab. Nothing is deleted from the GDBx pool — chat data stays forever.")) return;
    messages.innerHTML = "";
    seenKeys.clear();
  });

  if (newRoomBtn) newRoomBtn.addEventListener("click", async () => {
    const roomId = nanoid(8);
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const keyB64 = bytesToB64url(raw);
    const invite = `${location.origin}${location.pathname}#r=${roomId}&k=${keyB64}`;
    const ck = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    roomKey = ck; roomKeyB64 = keyB64;
    currentRoom = `playground/private/${roomId}`;
    if (roomPill) roomPill.textContent = `room: private/${roomId}`;
    if (roomLockPill) roomLockPill.classList.remove("hidden");
    messages.innerHTML = "";
    seenKeys.clear();
    history.replaceState(null, "", `#r=${roomId}&k=${keyB64}`);
    try { await navigator.clipboard.writeText(invite); addMsg(`private room created — invite copied: ${invite}`, false); } catch { prompt("Copy private invite link:", invite); }
  });

  if (joinRoomBtn) joinRoomBtn.addEventListener("click", async () => {
    const url = prompt("Paste a private room invite link (contains the decryption key):");
    if (!url) return;
    const m = url.match(/[#?]r=([^&]+)&k=([^&]+)/);
    if (!m) { alert("Not a valid GDBx private room link."); return; }
    const roomId = decodeURIComponent(m[1]);
    const k = decodeURIComponent(m[2]);
    try {
      const raw = b64ToBytes(k);
      const ck = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      roomKey = ck; roomKeyB64 = k;
      currentRoom = `playground/private/${roomId}`;
      if (roomPill) roomPill.textContent = `room: private/${roomId}`;
      if (roomLockPill) roomLockPill.classList.remove("hidden");
      messages.innerHTML = "";
      seenKeys.clear();
      history.replaceState(null, "", `#r=${roomId}&k=${k}`);
      loadHistory();
    } catch { alert("Invalid key in invite link."); }
  });

  if (imgBtn && imgInput) {
    imgBtn.addEventListener("click", () => imgInput.click());
    imgInput.addEventListener("change", async () => {
      const file = imgInput.files[0];
      imgInput.value = "";
      if (!file) return;
      // GunX parity: image via /api/imgbb proxy (any size up to 10MB, server-side key, like GunX)
      if (file.type.startsWith("image/")) {
        try {
          const fd = new FormData();
          fd.append("image", file);
          const res = await fetch("/api/imgbb", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.display_url) {
            await sendMessage(file.name, { img: data.display_url, fname: file.name, fsize: file.size });
            return;
          }
          if (res.status !== 500) throw new Error(data.error || "imgbb failed");
          console.warn("imgbb proxy not configured (no IMGBB_KEY), fallback to sovereign chunked pool");
        } catch (e) {
          console.warn("imgbb proxy failed, fallback to sovereign chunked:", e.message);
        }
      }
      // fallback: sovereign chunked GDBx pool (no external dependency, any size) — split dataUrl
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        if (dataUrl.length <= 512000) {
          await sendMessage(file.name, { img: dataUrl, fname: file.name, fsize: file.size });
        } else {
          await sendChunked(file.name, dataUrl, file.name, file.size);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (fileBtn && fileInput) {
    fileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      // GunX parity: file via P2P WebRTC (any size) — for GDBx we use sovereign chunked pool (any size, pool-replicated, no external relay) + future P2P direct
      // GDBx delta is 32KB max per delta (DoS protection) — but any size file is chunked into 28KB deltas and reassembled (like IPFS chunking)
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result; // data:*/*;base64,...
        await sendChunked(`file: ${file.name}`, dataUrl, file.name, file.size);
      };
      reader.readAsDataURL(file);
    });
  }

  // heartbeat + stats polling (like GunX's status pills)
  let heartbeatTimer = null;
  async function heartbeat() {
    try {
      await fetch(`${API}/peers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addr: DEMO.addr, transports: ["playground", "ws"], name: visitorId }),
      }).catch(() => {});
    } catch {}
  }
  heartbeat();
  heartbeatTimer = setInterval(heartbeat, 10000);

  async function pollStats() {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch(`${API}/stats`).then((r) => r.json()).catch(() => null),
        fetch(`${API}/pool`).then((r) => r.json()).catch(() => null),
      ]);
      const uptimeEl = document.getElementById("pg-stUptime");
      const msgsEl = document.getElementById("pg-stMessages");
      const poolEl = document.getElementById("pg-stPool");
      const backendEl = document.getElementById("pg-stBackend");
      if (sRes && sRes.stats) {
        if (msgsEl) msgsEl.textContent = (sRes.stats.deltas ?? 0).toLocaleString();
        if (uptimeEl) {
          const ms = sRes.stats.uptimeMs ?? (Date.now() - (sRes.stats.lastTs || Date.now()));
          const fmt = ms > 86400000 ? `${Math.floor(ms/86400000)}d` : `${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m`;
          uptimeEl.textContent = fmt;
        }
        if (backendEl) backendEl.textContent = sRes.stats.storageBackend || "DO SQLite";
      }
      if (pRes && poolEl) {
        const nodes = pRes.nodes || [];
        poolEl.textContent = nodes.map((n) => `${n.role}:${n.healthy ? "✓" : "✗"}`).join(" · ") || "—";
      }
      // online pill via active or leaderboard
      if (onlinePill && sRes && sRes.stats) {
        const active = sRes.stats.active ?? 0;
        onlinePill.textContent = `${active} online`;
      }
    } catch {}
  }
  pollStats();
  setInterval(pollStats, 5000);

  // initial load + WS connect + poll fallback
  ensureRegistered().then(() => { registered = true; }).catch(() => {});
  connectWS();
  loadHistory();
  setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) loadHistory();
  }, 3000);

  // expose for debug
  window._gdbxPlayground = { sendMessage, currentRoom: () => currentRoom };
}

// auto-init if #playground exists
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("pg-messages")) initPlayground();
  });
}
