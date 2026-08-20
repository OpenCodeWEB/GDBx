# Third-Party Licenses — GDBx

GDBx ships **zero runtime dependencies** resolved from npm at install time.
The SDK bundle (`dist/gdbx.mjs`) is self-contained — primitives are vendored
into the artifact at build time (see `scripts/build-sdk.mjs`).

## Bundled primitives (build-time, vendored into dist)

| Package | Version | License | Purpose |
|---|---|---|---|
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | 1.8.0 (pinned) | MIT | BLAKE3 checksum, SHA-256 PoW & signing |

- Pinned to an **exact version**; reviewed before each bump.
- Bundled by esbuild into `dist/gdbx.mjs` — never resolved from npm at runtime.

## Development / build tooling (devDependencies — not shipped)

| Package | License | Purpose |
|---|---|---|
| esbuild | MIT | SDK bundling |
| wrangler | Apache-2.0 | Cloudflare Workers/Pages tooling |

## Runtime posture

- `npm ls --omit=dev` → `@noble/hashes` (only, pinned) — used by the
  Cloudflare worker's codec (BLAKE3 address checksum).
- `npm audit --omit=dev` → **0 vulnerabilities** (verified in CI gate:
  `node scripts/check-supply-chain.mjs`).
- No install scripts in the dependency tree (`npm approve-scripts` warnings
  apply to dev tooling only).
- gun/GunDB is **not** a dependency — see `conductor/tracks/self-sovereign-mesh/spec.md`
  for the supply-chain rationale (Socket.dev report on gun@0.2020.1241).