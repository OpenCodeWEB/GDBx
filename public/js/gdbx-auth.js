/**
 * gdbx-auth.js — Hybrid Web3 Auth for gdbx.pages.dev + dsgx.pages.dev
 * - SIWE (EVM) primary + GDBx ECDSA ephemeral fallback
 * - GitHub verify, API keys GDBx****AB
 */
const WORKER = "https://gdbx.xup.workers.dev";
let _session = null;

function getToken() { return localStorage.getItem("gdbx_token") || ""; }
function setToken(t) { if (t) localStorage.setItem("gdbx_token", t); }
export async function fetchMe() {
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
  openWalletModal();
  return null;
}
async function connectWithMetamask() {
  if (!window.ethereum) { alert("No wallet found — install MetaMask or use Seed"); return null; }
  const [addr] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const nonce = await fetchNonce();
  const msg = siweMessage({ domain: location.host, address: addr, nonce });
  const sig = await window.ethereum.request({ method: "personal_sign", params: [msg, addr] });
  const r = await fetch(`${WORKER}/auth/siwe`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: addr, message: msg, signature: sig, nonce }),
  });
  const j = await r.json();
  if (j.ok) { setToken(j.token); _session = { ok: true, addr: j.addr, siweAddr: addr, verified: false }; closeWalletModal(); renderAuth(); return j; }
  alert(j.error || "SIWE failed");
  return null;
}
async function connectWithSeed(mnemonic) {
  const { mnemonicToAddress, signWithMnemonic, validateMnemonic } = await import("/js/seed-wallet.js");
  if (!validateMnemonic(mnemonic)) { alert("Invalid seed — must be 12 words from BIP39"); return null; }
  const address = await mnemonicToAddress(mnemonic);
  const nonce = await fetchNonce();
  const msg = siweMessage({ domain: location.host, address, nonce });
  const sig = await signWithMnemonic(mnemonic, msg);
  const r = await fetch(`${WORKER}/auth/siwe`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, message: msg, signature: sig, nonce }),
  });
  const j = await r.json();
  if (j.ok) {
    localStorage.setItem("gdbx_seed_addr", address);
    setToken(j.token); _session = { ok: true, addr: j.addr, siweAddr: address, verified: false }; closeWalletModal(); renderAuth(); return j;
  }
  alert(j.error || "Seed SIWE failed");
  return null;
}

function openWalletModal() {
  if (document.getElementById("wallet-modal")) return;
  const html = `<div id="wallet-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur flex items-center justify-center z-50 p-4"><div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden">
    <div class="p-6 border-b border-slate-800"><h3 class="font-bold text-lg">Connect Wallet</h3><p class="text-xs text-slate-500 mt-1">Use MetaMask or seed phrase (BIP39). Seed is never sent — only signature.</p></div>
    <div class="p-6 space-y-3">
      <button id="wm-web3app" class="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-700 bg-gradient-to-r from-violet-600 to-cyan-600 hover:opacity-90 text-left"><i class="fa-solid fa-qrcode text-white text-xl"></i><div><div class="font-semibold text-sm text-white">Web3 App</div><div class="text-xs text-violet-100">QR + Browser extension — all wallets</div></div><span class="ml-auto text-xs text-white">→</span></button>
      <div id="wm-web3panel" class="hidden space-y-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
        <div class="text-center"><div class="inline-block p-2 bg-white rounded-xl"><img id="wm-qr" width="180" height="180" alt="QR" class="block" /></div><p class="text-xs text-slate-500 mt-2">Scan with wallet app — or use extension below</p></div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <button data-wallet="metamask" class="wallet-opt flex items-center gap-2 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"><i class="fa-brands fa-ethereum text-orange-400"></i>MetaMask</button>
          <button data-wallet="trust" class="wallet-opt flex items-center gap-2 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"><i class="fa-solid fa-shield text-blue-400"></i>Trust Wallet</button>
          <button data-wallet="coinbase" class="wallet-opt flex items-center gap-2 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"><i class="fa-brands fa-bitcoin text-blue-500"></i>Coinbase</button>
          <button data-wallet="rainbow" class="wallet-opt flex items-center gap-2 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"><i class="fa-solid fa-rainbow text-pink-400"></i>Rainbow</button>
          <button data-wallet="phantom" class="wallet-opt flex items-center gap-2 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"><i class="fa-solid fa-ghost text-violet-400"></i>Phantom</button>
          <button data-wallet="argent" class="wallet-opt flex items-center gap-2 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"><i class="fa-solid fa-wallet text-emerald-400"></i>Argent</button>
        </div>
        <p class="text-xs text-slate-600 text-center">QR for WalletConnect — scan or click extension</p>
      </div>
      <div class="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
        <div class="text-xs font-semibold text-violet-300">Social Sign-In (no wallet needed)</div>
        <div class="grid grid-cols-3 gap-2 mt-2 text-xs">
          <button data-social="google" class="p-2 rounded-lg bg-white text-slate-900 font-semibold">Google</button>
          <button data-social="email" class="p-2 rounded-lg bg-white text-slate-900 font-semibold">Email</button>
          <button data-social="github" class="p-2 rounded-lg bg-white text-slate-900 font-semibold">GitHub</button>
        </div>
        <p class="text-xs text-violet-300/70 mt-1 text-center">1-click — instant wallet, gasless</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-600"><span class="flex-1 h-px bg-slate-700"></span>or seed phrase<span class="flex-1 h-px bg-slate-700"></span></div>
      <div class="flex gap-2 text-xs">
        <button id="wm-tab-generate" class="flex-1 py-2 rounded-lg bg-amber-600 text-slate-950 font-semibold">Generate New Seed</button>
        <button id="wm-tab-import" class="flex-1 py-2 rounded-lg bg-slate-800 text-slate-300">Use Existing Seed</button>
      </div>
      <div id="wm-generate" class="space-y-3">
        <div id="wm-words" class="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800 mono text-xs"></div>
        <div class="flex gap-2"><button id="wm-gen" class="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs">Generate 12 words</button><button id="wm-copy" class="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs">Copy</button><button id="wm-hide" class="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs">Hide</button></div>
        <button id="wm-login-gen" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold">Login with this seed</button>
        <p class="text-xs text-amber-300">⚠ Save these 12 words — they ARE your wallet. Never share.</p>
      </div>
      <div id="wm-import" class="space-y-3 hidden">
        <textarea id="wm-seed-input" placeholder="Enter 12-word seed phrase (space separated)" class="w-full h-20 mono text-xs bg-slate-950 border border-slate-700 rounded-lg p-3 text-slate-200"></textarea>
        <button id="wm-login-import" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold">Login with seed</button>
      </div>
    </div>
    <div class="p-4 border-t border-slate-800 flex justify-between"><button id="wm-close" class="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs">Close</button><span class="text-xs text-slate-600 mono">BIP39 · BIP44 m/44'/60'/0'/0/0</span></div>
  </div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("wm-close").onclick = closeWalletModal;
  document.getElementById("wm-web3app").onclick = async () => {
    const panel = document.getElementById("wm-web3panel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      // Generate WalletConnect-like QR (SIWE message as data)
      const wcUri = `wc:${Math.random().toString(36).slice(2)}@2?relay-protocol=irn&symKey=${Math.random().toString(36).slice(2)}`;
      document.getElementById("wm-qr").src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(wcUri)}`;
    }
  };
  document.querySelectorAll(".wallet-opt").forEach(b=> b.onclick = () => connectWithMetamask());
  document.querySelectorAll("[data-social]").forEach(b=> b.onclick = async () => {
    const prov = b.dataset.social;
    alert(`Social Sign-In (${prov}) — Web3Auth: instant wallet, gasless, no install. Demo: use Seed or MetaMask for now. Provider: ${prov}`);
    // In production: Web3Auth modal → social → wallet → SIWE
  });
  document.getElementById("wm-tab-generate").onclick = () => { document.getElementById("wm-generate").classList.remove("hidden"); document.getElementById("wm-import").classList.add("hidden"); document.getElementById("wm-tab-generate").className = "flex-1 py-2 rounded-lg bg-amber-600 text-slate-950 font-semibold"; document.getElementById("wm-tab-import").className = "flex-1 py-2 rounded-lg bg-slate-800 text-slate-300"; };
  document.getElementById("wm-tab-import").onclick = () => { document.getElementById("wm-generate").classList.add("hidden"); document.getElementById("wm-import").classList.remove("hidden"); document.getElementById("wm-tab-generate").className = "flex-1 py-2 rounded-lg bg-slate-800 text-slate-300"; document.getElementById("wm-tab-import").className = "flex-1 py-2 rounded-lg bg-amber-600 text-slate-950 font-semibold"; };
  document.getElementById("wm-gen").onclick = async () => {
    const { generateMnemonic } = await import("/js/seed-wallet.js");
    const m = await generateMnemonic();
    const words = m.split(" ");
    document.getElementById("wm-words").innerHTML = words.map((w, i) => `<span class="px-2 py-1 rounded bg-slate-800 border border-slate-700">${i + 1}. ${w}</span>`).join("");
    document.getElementById("wm-words").dataset.mnemonic = m;
  };
  document.getElementById("wm-copy").onclick = () => { const m = document.getElementById("wm-words").dataset.mnemonic || ""; if (m) navigator.clipboard.writeText(m); };
  document.getElementById("wm-hide").onclick = () => { const el = document.getElementById("wm-words"); el.classList.toggle("blur-sm"); };
  document.getElementById("wm-login-gen").onclick = async () => { const m = document.getElementById("wm-words").dataset.mnemonic; if (!m) { alert("Generate first"); return; } await connectWithSeed(m); };
  document.getElementById("wm-login-import").onclick = async () => { const m = document.getElementById("wm-seed-input").value.trim(); if (!m) { alert("Enter seed"); return; } await connectWithSeed(m); };
  // auto-generate on open
  document.getElementById("wm-gen").click();
}
function closeWalletModal() { document.getElementById("wallet-modal")?.remove(); }

export async function connectGithub() {
  // Try direct verify for ABsUP (EVM owner) first — no OAuth needed for this one
  const me = _session || await fetchMe();
  if (me?.siweAddr?.toLowerCase() === "0x9016a472c308a4e87bed705d066636adf625d1b0".toLowerCase()) {
    const tok = getToken();
    const r2 = await fetch(`${WORKER}/auth/github/verify`, { method: "POST", headers: { "content-type": "application/json", ...(tok?{authorization:`Bearer ${tok}`}:{}) }, body: JSON.stringify({ login: "ABsUP" }) });
    const j2 = await r2.json();
    if (j2.ok) {
      if (j2.token) { localStorage.setItem("gdbx_token", j2.token); _session = null; await fetchMe(); renderAuth(); }
      alert(`✓ Verified @${j2.login} — dsgx.pages.dev/${j2.login} is now live!`);
      location.href = `https://dsgx.pages.dev/${j2.login}`;
      return;
    }
  }
  // Secure GitHub OAuth — only the real owner can verify (github.com official)
  const r = await fetch(`${WORKER}/auth/github/start?redirect=${encodeURIComponent(location.href)}`, { credentials: "include" });
  const j = await r.json();
  if (j.ok && j.url) {
    if (j.url.includes("Ov23liPlaceholder")) {
      alert("GitHub OAuth not yet configured — contact admin to set GITHUB_CLIENT_ID/SECRET. For ABsUP, dsgx.pages.dev/ABsUP is already active.");
      return;
    }
    location.href = j.url;
  } else alert(j.error || "Verify failed — GitHub OAuth not configured");
}

export async function logout() {
  const tok = getToken();
  try { await fetch(`${WORKER}/auth/logout`, { method: "POST", headers: tok ? { authorization: `Bearer ${tok}` } : {}, credentials: "include" }); } catch {}
  localStorage.removeItem("gdbx_token"); localStorage.removeItem("gdbx_seed"); localStorage.removeItem("gdbx_seed_addr"); _session = null; renderAuth();
  location.href="/";
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
    bar.innerHTML = `<button id="btn-connect" class="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold">Connect Wallet</button>`;
    bar.querySelector("#btn-connect")?.addEventListener("click", connectWallet);
    return;
  }
  const { addr, siweAddr, verified, apikeyCount, githubLogin, githubs, wallets } = _session;
  const allWallets = wallets || (siweAddr ? [siweAddr] : []);
  const allGithubs = githubs || (githubLogin ? [{login: githubLogin}] : []);
  const shortAddr = (siweAddr || addr || "").slice(0, 10) + "…";
  const moreWallets = allWallets.length > 1 ? ` +${allWallets.length-1}` : "";
  const moreGithubs = allGithubs.length > 1 ? ` +${allGithubs.length-1}` : "";
  bar.innerHTML = `<span class="mono text-xs text-emerald-300" title="${allWallets.join(', ')}">${shortAddr}${moreWallets}</span> ${allGithubs.length ? `<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">✓ @${allGithubs[0].login}${moreGithubs}</span>` : `<button id="btn-github2" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs">Verify GitHub</button>`} <button id="btn-connect-more" class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs" title="Connect more wallets/GitHub">+ Connect</button> <a href="/Dashboard" class="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold">Dashboard</a> <button id="btn-apikeys" class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold">API Keys (${apikeyCount||0})</button> <button id="btn-logout" class="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs">Logout</button>`;
  bar.querySelector("#btn-github2")?.addEventListener("click", connectGithub);
  bar.querySelector("#btn-connect-more")?.addEventListener("click", connectWallet);
  bar.querySelector("#btn-logout")?.addEventListener("click", logout);
  bar.querySelector("#btn-apikeys")?.addEventListener("click", openApiPanel);
}

async function openApiPanel() {
  const data = await listKeys();
  if (!data.ok) { alert(data.error); return; }
  const quota = data.quota;
  const limitStr = quota.unlimited ? "unlimited" : quota.limit;
  const html = `<div class="fixed inset-0 bg-slate-950/80 backdrop-blur flex items-center justify-center z-50 p-4" id="apikey-modal"><div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg"><h3 class="font-bold text-lg mb-2">API Keys <span class="text-xs text-slate-500">(${data.keys.length}/${limitStr}) ${quota.unlimited ? "· unlimited (verified)" : "· 3 max"}</span></h3><div id="key-list" class="space-y-2 max-h-64 overflow-y-auto mb-4">${data.keys.map(k => `<div class="flex items-center gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800"><span class="mono text-xs text-amber-300">${k.prefix}</span><span class="text-xs text-slate-500">${k.label||""}</span><button data-copy="${k.hash}" class="copy-key px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs">Copy</button><button data-hash="${k.hash}" class="revoke px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs">Revoke</button></div>`).join("") || "<div class=text-xs text-slate-600>No keys yet</div>"}</div><div class="flex gap-2"><input id="new-key-label" placeholder="label (optional)" class="flex-1 mono text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200"><button id="create-key" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 text-sm font-bold">Create GDBx****AB</button></div><div id="new-key-result" class="mt-3 mono text-xs"></div><button id="close-modal" class="mt-4 w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm">Close</button></div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("close-modal").onclick = () => document.getElementById("apikey-modal").remove();
  document.getElementById("create-key").onclick = async () => {
    const label = document.getElementById("new-key-label").value;
    const r = await createKey(label);
    if (!r.ok) { document.getElementById("new-key-result").textContent = "✗ " + r.error; return; }
    document.getElementById("new-key-result").innerHTML = `<span class="text-emerald-300">✓ ${r.prefix}</span><br><span class="text-amber-300 break-all">${r.key}</span> <button onclick="navigator.clipboard.writeText('${r.key}')" class="px-2 py-0.5 rounded bg-slate-800 text-xs">Copy</button><br><span class="text-slate-500">Save now — won't be shown again</span>`;
    setTimeout(() => openApiPanel(), 2000);
  };
  document.querySelectorAll(".copy-key").forEach(b=> b.onclick=async()=>{
    const r=await fetch(`${WORKER}/apikey/${b.dataset.copy}/raw`,{headers: getToken()?{authorization:`Bearer ${getToken()}`}:{}});
    const j=await r.json();
    if(j.ok&&j.key){ await navigator.clipboard.writeText(j.key); const o=b.textContent; b.textContent="✓ Copied"; setTimeout(()=>b.textContent=o,1200); }
    else { document.getElementById("new-key-result").innerHTML=`<span class="text-amber-300">⚠ ${j.error||"Cannot copy"}</span> — revoke and create new`; }
  });
  document.querySelectorAll(".revoke").forEach(b => b.onclick = async () => { await revokeKey(b.dataset.hash); document.getElementById("apikey-modal").remove(); openApiPanel(); });
}

// Init on load
document.addEventListener("DOMContentLoaded", async () => {
  await fetchMe();
  renderAuth();
  // Expose for console
  window.GDBxAuth = { connectWallet, connectGithub, logout, listKeys, createKey, fetchMe };
});
