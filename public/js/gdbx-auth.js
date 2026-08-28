/**
 * gdbx-auth.js — Hybrid Web3 Auth for gdbx.pages.dev + dsgx.pages.dev
 * - SIWE (EVM) primary + GDBx ECDSA ephemeral fallback
 * - GitHub verify, API keys GDBx****AB
 */
const WORKER = "https://gdbx.xup.workers.dev";
let _session = null;

function getToken() { return localStorage.getItem("gdbx_token") || ""; }
function setToken(t) { if (t) localStorage.setItem("gdbx_token", t); }
async function fetchMe() {
  const tok = getToken();
  const headers = tok ? { authorization: `Bearer ${tok}` } : {};
  const r = await fetch(`${WORKER}/auth/me`, { headers, credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (j.ok) _session = j;
  return j;
}
async function fetchNonce() {
  const r = await fetch(`${WORKER}/auth/nonce`);
  const j = await r.json();
  return j.nonce;
}
function siweMessage({ domain, address, nonce }) {
  return `${domain} wants you to sign in with Ethereum:\n${address}\n\nSign in to GDBx — sovereign mesh\n\nURI: https://${domain}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
}

export async function connectWallet() {
  if (!window.ethereum) { alert("No wallet found — install MetaMask"); return null; }
  const [addr] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const nonce = await fetchNonce();
  const msg = siweMessage({ domain: location.host, address: addr, nonce });
  const sig = await window.ethereum.request({ method: "personal_sign", params: [msg, addr] });
  const r = await fetch(`${WORKER}/auth/siwe`, {
    method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
    body: JSON.stringify({ address: addr, message: msg, signature: sig, nonce }),
  });
  const j = await r.json();
  if (j.ok) { setToken(j.token); _session = { ok: true, addr: j.addr, siweAddr: addr, verified: false }; renderAuth(); return j; }
  alert(j.error || "SIWE failed");
  return null;
}

export async function connectGithub() {
  const r = await fetch(`${WORKER}/auth/github/start?redirect=${encodeURIComponent(location.href)}`, { credentials: "include" });
  const j = await r.json();
  if (j.ok && j.url) location.href = j.url;
}

export async function logout() {
  const tok = getToken();
  await fetch(`${WORKER}/auth/logout`, { method: "POST", headers: tok ? { authorization: `Bearer ${tok}` } : {}, credentials: "include" });
  localStorage.removeItem("gdbx_token"); _session = null; renderAuth();
  location.reload();
}

// API Keys
export async function listKeys() {
  const tok = getToken();
  const r = await fetch(`${WORKER}/apikey`, { headers: tok ? { authorization: `Bearer ${tok}` } : {}, credentials: "include" });
  return r.json();
}
export async function createKey(label) {
  const tok = getToken();
  const r = await fetch(`${WORKER}/apikey`, { method: "POST", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, credentials: "include", body: JSON.stringify({ label }) });
  return r.json();
}
export async function revokeKey(hash) {
  const tok = getToken();
  const r = await fetch(`${WORKER}/apikey/${hash}`, { method: "DELETE", headers: tok ? { authorization: `Bearer ${tok}` } : {}, credentials: "include" });
  return r.json();
}

function renderAuth() {
  const bar = document.getElementById("auth-bar");
  if (!bar) return;
  if (!_session || !_session.ok) {
    bar.innerHTML = `<button id="btn-connect" class="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold">Connect Wallet</button> <button id="btn-github" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs">Verify GitHub</button>`;
    bar.querySelector("#btn-connect")?.addEventListener("click", connectWallet);
    bar.querySelector("#btn-github")?.addEventListener("click", connectGithub);
    return;
  }
  const { addr, siweAddr, verified, apikeyCount, githubLogin } = _session;
  const shortAddr = (siweAddr || addr || "").slice(0, 10) + "…";
  bar.innerHTML = `<span class="mono text-xs text-emerald-300">${shortAddr}</span> ${verified ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">✓ @${githubLogin || "verified"}</span>` : `<button id="btn-github2" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs">Verify GitHub</button>`} <button id="btn-apikeys" class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold">API Keys (${apikeyCount||0})</button> <button id="btn-logout" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs">Logout</button>`;
  bar.querySelector("#btn-github2")?.addEventListener("click", connectGithub);
  bar.querySelector("#btn-logout")?.addEventListener("click", logout);
  bar.querySelector("#btn-apikeys")?.addEventListener("click", openApiPanel);
}

async function openApiPanel() {
  const data = await listKeys();
  if (!data.ok) { alert(data.error); return; }
  const quota = data.quota;
  const limitStr = quota.unlimited ? "unlimited" : quota.limit;
  const html = `<div class="fixed inset-0 bg-slate-950/80 backdrop-blur flex items-center justify-center z-50 p-4" id="apikey-modal"><div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg"><h3 class="font-bold text-lg mb-2">API Keys <span class="text-xs text-slate-500">(${data.keys.length}/${limitStr}) ${quota.unlimited ? "· unlimited (verified)" : "· 3 max"}</span></h3><div id="key-list" class="space-y-2 max-h-64 overflow-y-auto mb-4">${data.keys.map(k => `<div class="flex items-center gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800"><span class="mono text-xs text-amber-300">${k.prefix}</span><span class="text-xs text-slate-500">${k.label||""}</span><button data-hash="${k.hash}" class="revoke ml-auto px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs">Revoke</button></div>`).join("") || "<div class=text-xs text-slate-600>No keys yet</div>"}</div><div class="flex gap-2"><input id="new-key-label" placeholder="label (optional)" class="flex-1 mono text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200"><button id="create-key" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-sm font-bold">Create GDBx****AB</button></div><div id="new-key-result" class="mt-3 mono text-xs"></div><button id="close-modal" class="mt-4 w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm">Close</button></div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("close-modal").onclick = () => document.getElementById("apikey-modal").remove();
  document.getElementById("create-key").onclick = async () => {
    const label = document.getElementById("new-key-label").value;
    const r = await createKey(label);
    if (!r.ok) { document.getElementById("new-key-result").textContent = "✗ " + r.error; return; }
    document.getElementById("new-key-result").innerHTML = `<span class="text-emerald-300">✓ ${r.prefix}</span><br><span class="text-amber-300 break-all">${r.key}</span> <button onclick="navigator.clipboard.writeText('${r.key}')" class="px-2 py-0.5 rounded bg-slate-800 text-xs">Copy</button><br><span class="text-slate-500">Save now — won't be shown again</span>`;
    setTimeout(() => openApiPanel(), 2000);
  };
  document.querySelectorAll(".revoke").forEach(b => b.onclick = async () => { await revokeKey(b.dataset.hash); document.getElementById("apikey-modal").remove(); openApiPanel(); });
}

// Init on load
document.addEventListener("DOMContentLoaded", async () => {
  await fetchMe();
  renderAuth();
  // Expose for console
  window.GDBxAuth = { connectWallet, connectGithub, logout, listKeys, createKey, fetchMe };
});
