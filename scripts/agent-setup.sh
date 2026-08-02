#!/usr/bin/env bash
#
# Per-worktree bootstrap for an autonomous agent session.
#
# Cyrus (and `git worktree add` generally) gives the agent a fresh checkout with
# no node_modules and no environment. This makes that checkout usable, and fails
# loudly rather than letting the agent improvise around a half-set-up tree.
#
# Wire as `global_setup_script` in ~/.cyrus/config.json.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "── agent setup: $(pwd)"

# Worktrees do not share node_modules. --frozen-lockfile so an agent can never
# quietly drift dependencies as a side effect of setup.
pnpm install --frozen-lockfile

# The stack is a single Docker compose on FIXED ports (54321/54322), deliberately
# shared across worktrees rather than parameterized — the standing decision is
# one task at a time. If that ever changes, ports have to move with it, because
# two concurrent worktrees will silently fight over the same database.
if ! curl -s -o /dev/null -m 3 http://127.0.0.1:54321/rest/v1/ 2>/dev/null; then
  echo "── local stack down; starting"
  npx --yes supabase start >/dev/null
fi
node scripts/local-stack.mjs write

# Carry the project memory into the worktree.
#
# Claude Code's per-project memory is keyed by the PROJECT PATH, so a session
# running in ~/.lumen-agent/worktrees/issue-N resolves to a different (empty)
# memory directory and inherits nothing. Copying it in is what gives the agent
# the accumulated context — design decisions, dead ends, things that already
# cost someone a day.
#
# Copied, not committed: some of it is operational (where credentials live) and
# has no business in the repository. .agent-memory/ is gitignored.
MEM="$HOME/.claude/projects/-Users-abram-code-lumen/memory"
if [ -d "$MEM" ]; then
  rm -rf .agent-memory && mkdir -p .agent-memory
  cp -R "$MEM"/. .agent-memory/
  echo "── memory: $(find .agent-memory -name '*.md' | wc -l | tr -d ' ') files"
else
  echo "── memory: none found at $MEM (continuing)"
fi

echo "── ready. gate: pnpm verify"
