#!/usr/bin/env bash
#
# The gate. Exit 0 means a change is fit to open a PR for.
#
# This is what an autonomous agent runs before it is allowed to push, so it
# resolves its own environment rather than trusting the caller's shell, and it
# refuses to run against production.
#
# The stack comes up FIRST, before any test step. That ordering is not
# cosmetic: `turbo test` includes live-DB harnesses in @lumen/scripture, and
# with the env exported later they ran against production's session pooler and
# exhausted its 15-client cap (EMAXCONNSESSION). Every test leg must inherit
# local endpoints, not just the e2e one.
#
# Usage: scripts/verify.sh [--no-e2e]
set -euo pipefail

cd "$(dirname "$0")/.."

run_e2e=1
[[ "${1:-}" == "--no-e2e" ]] && run_e2e=0

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "local stack"
# `supabase start` is idempotent — a running stack is a no-op, not an error
npx --yes supabase start >/dev/null
node scripts/local-stack.mjs write
set -a
eval "$(node scripts/local-stack.mjs env)"
set +a

# The guard. Everything above this line is reversible; the suites below are not
# — they mint auth users, cast roadmap votes, and open pooled connections.
case "$SUPABASE_URL" in
  *supabase.co*|*studylintel.com*)
    echo "REFUSING: SUPABASE_URL points at production ($SUPABASE_URL)" >&2
    exit 1
    ;;
esac
for dsn_name in DATABASE_URL LUMEN_READ_DSN; do
  case "${!dsn_name}" in
    *localhost*|*127.0.0.1*) ;;
    *)
      echo "REFUSING: $dsn_name is not local (${!dsn_name})" >&2
      exit 1
      ;;
  esac
done
echo "stack: $SUPABASE_URL"

step "workspace harness (typecheck + unit)"
pnpm exec turbo test typecheck

step "script tests"
# glob, not the bare directory — node resolves a lone dir path as a module
node --test scripts/__tests__/*.test.mjs

if [[ "$run_e2e" == "0" ]]; then
  printf '\n\033[33mskipped e2e (--no-e2e)\033[0m\n'
  exit 0
fi

step "e2e"
pnpm --filter @lumen/web exec playwright test

printf '\n\033[32m✓ verify passed\033[0m\n'
