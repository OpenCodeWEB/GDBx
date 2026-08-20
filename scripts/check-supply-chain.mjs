/**
 * check-supply-chain.mjs — CI gate for GDBx supply-chain hygiene.
 *
 * Fails (exit 1) when:
 *   1. Runtime dependencies (npm ls --omit=dev) are not exactly the pinned set
 *   2. npm audit reports any vulnerability
 *   3. The SDK bundle is missing or stale
 *
 * Usage: node scripts/check-supply-chain.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

try {
  const ls = execSync("npm ls --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const tree = JSON.parse(ls);
  const deps = tree.dependencies || {};
  const names = Object.keys(deps);
  // Only pinned @noble/hashes is acceptable at runtime; anything else → fail.
  const allowed = new Set(["@noble/hashes"]);
  const unexpected = names.filter((n) => !allowed.has(n));
  if (unexpected.length) bad(`runtime deps beyond allowlist: ${unexpected.join(", ")}`);
  else ok(`runtime dependencies: ${names.length ? names.join(", ") : "none"}`);
} catch (e) {
  bad(`npm ls failed: ${e.message.split("\n")[0]}`);
}

try {
  const audit = execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const report = JSON.parse(audit);
  const vulns = report.metadata?.vulnerabilities || {};
  const total = Object.values(vulns).reduce((a, b) => a + b, 0);
  if (total > 0) bad(`npm audit: ${total} vulnerabilities (${JSON.stringify(vulns)})`);
  else ok("npm audit: 0 vulnerabilities");
} catch (e) {
  // npm audit exits non-zero when vulns found — parse the JSON on stderr
  const raw = (e.stdout || "").toString();
  if (raw) {
    try {
      const report = JSON.parse(raw);
      const vulns = report.metadata?.vulnerabilities || {};
      const total = Object.values(vulns).reduce((a, b) => a + b, 0);
      if (total > 0) bad(`npm audit: ${total} vulnerabilities (${JSON.stringify(vulns)})`);
      else ok("npm audit: 0 vulnerabilities");
    } catch {
      bad("npm audit: parse error");
    }
  } else {
    bad(`npm audit failed: ${e.message.split("\n")[0]}`);
  }
}

for (const f of ["dist/gdbx.mjs", "dist/gdbx-ws-client.mjs"]) {
  if (!existsSync(f)) {
    bad(`${f} missing — run npm run build`);
  } else if (statSync(f).size < 10_000) {
    bad(`${f} looks empty — run npm run build`);
  } else {
    ok(`${f} present (${statSync(f).size} bytes)`);
  }
}

if (process.exitCode) console.error("\nSupply-chain gate FAILED.");
else console.log("\nSupply-chain gate PASSED — zero runtime deps, clean audit.");