// pow-worker.js — Off-main-thread PoW mining for TLD claims
// Keeps UI responsive during mining (diff 4 can take 500ms-2s on main thread)

self.onmessage = async (e) => {
  const { name, pub, target, ts, diff, id } = e.data;
  const input = `${name}:${pub}:${target}:${ts}:`;
  for (let nonce = 1; nonce < 2000000; nonce++) {
    const data = new TextEncoder().encode(input + nonce);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (hash.startsWith("0".repeat(diff))) {
      self.postMessage({ id, nonce, hash });
      return;
    }
    // Yield every 1000 iterations to avoid blocking
    if (nonce % 1000 === 0) await new Promise(r => setTimeout(r, 0));
  }
  self.postMessage({ id, error: "PoW timeout" });
};
