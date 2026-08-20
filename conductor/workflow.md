# Workflow — GDBx

## Core Principles
1. **Spec before code** — every feature/bugfix starts with a Track (`conductor/tracks/<id>/spec.md` + `plan.md`), registered in `conductor/tracks.md`.
2. **TDD** — tests first, red → green. Run `node --test test/` before committing.
3. **Small commits** — one logical change per commit; message convention below.
4. **Production deploy = `git push origin main`** (Cloudflare Pages git integration).
   - ⚠️ `wrangler pages deploy` creates **Preview** builds only (project is git-connected).
   - Worker changes: `npx wrangler deploy` in `worker/` (separate deploy; Pages Functions bind via `script_name`).
5. **Verify before claiming done** — live checks (curl/browser) after deploy.

## Commit Convention
- `feat: ...` — new feature
- `fix: ...` — bugfix
- `docs: ...` — docs/conductor only
- `test: ...` — tests only
- `chore: ...` — tooling/deps

## Test Commands (Windows — run individually, NOT `node --test test/`)
```powershell
node --test test/test_codec.mjs
node --test test/test_sync.mjs
# ... one file per run; `node --test` glob on Windows can flake with gun deps
```

## Deploy Steps
1. Run tests: `node --test test/test_*.mjs` (each file)
2. `git add -A && git commit -m "feat: ..."`
3. `git push origin main` → Pages production build (auto)
4. Worker (if changed): `npx wrangler deploy` (workdir `worker/`)
5. Verify live: `curl https://gdbx.pages.dev/api/v1/...`

## Secrets & Env
- `ROOT_PUBKEYS` — comma-separated SEA pubkeys with root privileges (worker var)
- Never commit `.dev.vars` or API keys. `.gitignore` covers them.