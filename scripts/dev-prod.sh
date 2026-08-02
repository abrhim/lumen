#!/usr/bin/env bash
#
# Run the dev server against PRODUCTION data.
#
# The local stack works by overriding two files; this steps out of the way of
# both and restores them when you quit. The restore is the point — doing this by
# hand is easy, remembering you did it three hours later is not, and a dev
# server silently pointed at prod is precisely the failure that cost a day here.
#
# Reads go through lumen_read and are SELECT-only. Writes do not: notes and
# roadmap votes go through PostgREST with your real session and land in the real
# database.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

restore() {
  [ -e .env.local.prod-run ] && mv .env.local.prod-run .env.local
  [ -e .dev.vars.prod-run ] && mv .dev.vars.prod-run .dev.vars
  printf '\n\033[32m── local overrides restored\033[0m\n'
}
trap restore EXIT INT TERM

[ -e .env.local ] && mv .env.local .env.local.prod-run
[ -e .dev.vars ] && mv .dev.vars .dev.vars.prod-run

cat <<'BANNER'

  ────────────────────────────────────────────────
   DEV SERVER ON PRODUCTION DATA
   Reads are SELECT-only. Notes and votes are REAL.
   Every page load takes a connection from a pool
   that is already the cause of the /admin/users
   failure — keep this short.
   Ctrl-C restores the local overrides.
  ────────────────────────────────────────────────

BANNER

pnpm dev "$@"
