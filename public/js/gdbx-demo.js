/**
 * gdbx-demo.js — browser demo for the .GDBx address codec.
 * Uses the same pure codec module as the worker/Node SDK (no deps).
 */
import { makeAddress, validateAddress, normalizeAddress, networkOf, toDID } from "/js/gdbx-codec.js";

const $ = (id) => document.getElementById(id);

$("gen").addEventListener("click", () => {
  const hex = $("pubkey").value.trim();
  const network = parseInt($("network").value, 10);
  const out = $("out");
  try {
    const addr = makeAddress(hex, network);
    out.style.display = "block";
    out.className = "out";
    out.textContent =
      `address : ${addr}.gdbx\n` +
      `network : ${networkOf(addr)}\n` +
      `DID     : ${toDID(addr)}`;
  } catch (e) {
    out.style.display = "block";
    out.className = "out err";
    out.textContent = "error: " + e.message;
  }
});

$("verify").addEventListener("click", () => {
  const input = $("check").value.trim();
  const out = $("vout");
  const v = validateAddress(input);
  out.style.display = "block";
  if (v.ok) {
    const bare = normalizeAddress(input);
    out.className = "out";
    out.textContent = `valid ✓\ncanonical : ${bare}.gdbx\nnetwork   : ${networkOf(bare)}`;
  } else {
    out.className = "out err";
    out.textContent = "invalid ✗ — " + v.error;
  }
});

// Seed with a demo pubkey so the page is instantly interactive.
const demo = new Uint8Array(65);
demo[0] = 0x04;
for (let i = 1; i < 65; i++) demo[i] = i;
$("pubkey").value = Array.from(demo, (b) => b.toString(16).padStart(2, "0")).join("");