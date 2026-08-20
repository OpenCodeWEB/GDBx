/**
 * build-sdk.mjs — Bundle the GDBx SDK into a single self-contained ESM file.
 *
 * GenosDB supply-chain pattern: primitives (@noble/hashes) are pinned, bundled
 * INTO the artifact at build time — the published/used artifact has ZERO
 * runtime dependencies resolved from npm at install time.
 *
 * Output: dist/gdbx.mjs (browser + Node ESM, everything inlined)
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(`${root}/dist`, { recursive: true });

await build({
  entryPoints: [`${root}/sdk/gdbx-sdk.js`],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: `${root}/dist/gdbx.mjs`,
  banner: { js: "/* GDBx SDK — bundled artifact (zero runtime deps). */" },
  logLevel: "info",
});

// also bundle the WS client on top of the same primitives
await build({
  entryPoints: [`${root}/sdk/gdbx-ws-client.js`],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: `${root}/dist/gdbx-ws-client.mjs`,
  logLevel: "info",
});

console.log("dist/gdbx.mjs + dist/gdbx-ws-client.mjs built (self-contained).");