#!/usr/bin/env node
/**
 * Ask a past (or in-flight) agent run a question, with its full context intact.
 *
 * The builder's session id is captured by agent-loop.mjs and bookmarked in
 * ~/.lumen-agent/sessions.json. Resuming by that id means the answer comes from
 * the session that actually did the work — it remembers the files it read, what
 * it tried, and why it gave up — rather than from a fresh agent guessing at a
 * diff.
 *
 * READ-ONLY by design. A question should never change the tree: you are asking
 * what happened, not asking for more work. Anything that edits is a new issue.
 *
 * Usage: node scripts/agent-ask.mjs <issue-number> "why did you skip the foot link?"
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SESSIONS = join(process.env.HOME, ".lumen-agent/sessions.json");
const [issue, ...rest] = process.argv.slice(2);
const question = rest.join(" ").trim();

if (!issue || !question) {
	console.error('usage: node scripts/agent-ask.mjs <issue-number> "your question"');
	process.exit(1);
}
if (!existsSync(SESSIONS)) {
	console.error(`no sessions recorded yet (${SESSIONS})`);
	process.exit(1);
}

const all = JSON.parse(readFileSync(SESSIONS, "utf8"));
const entry = all[issue];
if (!entry) {
	console.error(`no session for issue #${issue}. known: ${Object.keys(all).join(", ") || "none"}`);
	process.exit(1);
}

const child = spawn(
	"claude",
	[
		"--resume", entry.sessionId,
		"-p", question,
		// Read-only: it can look at anything to answer, and change nothing.
		"--allowedTools", "Read", "Glob", "Grep", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git status)",
		"--disallowedTools", "Edit", "Write", "Bash(git add:*)", "Bash(git commit:*)", "Bash(git push:*)",
		"--permission-mode", "auto",
	],
	{ cwd: entry.worktree, stdio: ["ignore", "inherit", "inherit"] },
);
child.on("close", (code) => process.exit(code ?? 0));
