#!/usr/bin/env node
/**
 * The dispatcher.
 *
 * Watches GitHub issues carrying a label, builds each one in an isolated
 * worktree with Claude Code, proves it with the gate, and opens a PR. It never
 * merges — that is deliberate and permanent; review and merge are human.
 *
 * Polling, not webhooks: no public endpoint, no tunnel, no App, no signature
 * verification, no inbound attack surface at all. `gh` already holds the auth.
 *
 * ONE TASK AT A TIME. The local Supabase stack binds fixed ports and is shared
 * across worktrees, so two concurrent builds would fight over one database.
 *
 * Usage: node scripts/agent-loop.mjs [--once] [--dry-run]
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));

const REPO = "abrhim/lumen";
const LABEL_QUEUED = "agent";
const LABEL_BUILDING = "agent:building";
const LABEL_REVIEW = "agent:needs-review";
const LABEL_FAILED = "agent:failed";
const WORKTREES = join(process.env.HOME, ".lumen-agent/worktrees");
const POLL_MS = 30_000;
const ONCE = process.argv.includes("--once");
const DRY = process.argv.includes("--dry-run");

/**
 * Mirrors the tool policy we settled on while vetting Cyrus. The Bash list is
 * verb-scoped on purpose: a broad `Bash(*)` walks straight past every other
 * restriction, including reading ~/.ssh. Nothing here can merge or force-push.
 */
const ALLOWED = [
	"Read", "Edit", "Write", "Glob", "Grep", "TodoWrite",
	"Bash(pnpm:*)", "Bash(node:*)", "Bash(npx --yes supabase:*)",
	"Bash(git status)", "Bash(git diff:*)", "Bash(git log:*)",
	"Bash(git add:*)", "Bash(git commit:*)",
	"Bash(lsof:*)", "Bash(curl -s -o /dev/null:*)",
];
const DISALLOWED = [
	"Bash(gh pr merge:*)", "Bash(gh api:*)", "Bash(git push:*)",
	"Bash(git reset --hard:*)", "Bash(rm:*)", "Bash(curl:*)",
	"Bash(wrangler:*)", "Bash(npm:*)", "WebFetch", "WebSearch",
];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sh = (cmd, cwd = ROOT, timeout = 20 * 60_000) =>
	execSync(cmd, { cwd, timeout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const gh = (args) => execFileSync("gh", args, { encoding: "utf8" }).trim();

/**
 * Best-effort append to agent.events. Never throws: an audit log that can take
 * the pipeline down with it is worse than one with a gap.
 */
function event(kind, { task, run, summary, ref, risk } = {}) {
	try {
		const { Client } = require("pg");
		const c = new Client({
			connectionString: "postgresql://lumen_agent:lumen_agent@127.0.0.1:54322/postgres",
			connectionTimeoutMillis: 2000,
		});
		c.connect()
			.then(() =>
				c.query(
					`insert into agent.events (task_id, run_id, actor, kind, summary, ref, risk)
					 values ($1, $2, 'claude:builder', $3, $4, $5, $6)`,
					[task ?? null, run ?? null, kind, summary ?? kind, ref ?? null, risk ?? null],
				),
			)
			.catch(() => {})
			.finally(() => c.end().catch(() => {}));
	} catch {
		/* pg unavailable — carry on */
	}
}

/** Issues labelled and not yet claimed, oldest first. */
function queued() {
	const out = gh([
		"issue", "list", "--repo", REPO, "--state", "open",
		"--label", LABEL_QUEUED, "--json", "number,title,body,url",
		"--limit", "20",
	]);
	return JSON.parse(out || "[]").reverse();
}

function relabel(n, add, remove) {
	const args = ["issue", "edit", String(n), "--repo", REPO];
	for (const l of add) args.push("--add-label", l);
	for (const l of remove) args.push("--remove-label", l);
	gh(args);
}

const comment = (n, body) =>
	gh(["issue", "comment", String(n), "--repo", REPO, "--body", body]);

function buildPrompt(issue) {
	return [
		`Implement GitHub issue #${issue.number} in this repository.`,
		"",
		`## ${issue.title}`,
		"",
		issue.body || "(no description)",
		"",
		"---",
		"",
		"Read CLAUDE.md first and follow it — especially the voice rules for any",
		"user-facing copy, and the list of things to escalate rather than do.",
		"",
		"The gate is `pnpm verify` and it must exit 0 before you are done. Run it,",
		"fix what it reports, run it again. Do not skip the e2e leg.",
		"",
		"Commit your work with a clear message. Do NOT push and do NOT open a pull",
		"request — the dispatcher does that after independently re-running the gate.",
		"",
		"If the issue asks for something you should escalate per CLAUDE.md, or if you",
		"cannot make the gate pass, stop and explain why instead of forcing it.",
	].join("\n");
}

async function build(issue) {
	const n = issue.number;
	const run = crypto.randomUUID();
	const branch = `agent/issue-${n}`;
	const wt = join(WORKTREES, `issue-${n}`);
	log(`#${n} claiming: ${issue.title}`);
	event("claimed", { task: `#${n}`, run, summary: issue.title });

	if (DRY) return log(`#${n} dry-run, stopping here`);
	relabel(n, [LABEL_BUILDING], [LABEL_QUEUED]);

	try {
		// Fresh worktree per task. Stale trees from a crashed run are removed
		// rather than reused — resuming into unknown state is worse than restarting.
		if (existsSync(wt)) {
			sh(`git worktree remove --force ${JSON.stringify(wt)}`);
		}
		mkdirSync(WORKTREES, { recursive: true });
		sh(`git fetch origin main --quiet`);
		sh(`git worktree add -B ${branch} ${JSON.stringify(wt)} origin/main --quiet`);
		sh(`bash scripts/agent-setup.sh`, wt);
		event("planned", { task: `#${n}`, run, summary: `worktree ${branch}` });

		log(`#${n} running builder…`);
		execFileSync(
			"claude",
			[
				"-p", buildPrompt(issue),
				"--allowedTools", ...ALLOWED,
				"--disallowedTools", ...DISALLOWED,
				"--permission-mode", "acceptEdits",
			],
			{ cwd: wt, stdio: ["ignore", "inherit", "inherit"], timeout: 45 * 60_000 },
		);
		event("built", { task: `#${n}`, run });

		// Independent re-run. The agent was told to verify; this is the check that
		// it actually did, and the one that decides whether anything is pushed.
		log(`#${n} verifying…`);
		sh("bash scripts/verify.sh", wt, 30 * 60_000);
		event("verified", { task: `#${n}`, run });

		const changed = sh("git status --porcelain", wt).trim();
		const ahead = sh(`git rev-list --count origin/main..HEAD`, wt).trim();
		if (changed) throw new Error(`uncommitted changes left in worktree:\n${changed}`);
		if (ahead === "0") throw new Error("no commits — the agent changed nothing");

		sh(`git push -u origin ${branch} --quiet`, wt);
		const files = sh(`git diff --name-only origin/main..HEAD`, wt).trim().split("\n");
		const pr = gh([
			"pr", "create", "--repo", REPO, "--head", branch, "--base", "main",
			"--title", `${issue.title} (#${n})`,
			"--body",
			[
				`Closes #${n}`, "",
				"Built by the agent loop. **Not merged, not reviewed** — shadow mode.",
				"",
				`\`pnpm verify\` passed in the worktree, re-run independently by the dispatcher.`,
				"",
				`${files.length} file(s) changed:`, "", files.map((f) => `- \`${f}\``).join("\n"),
			].join("\n"),
		]);
		relabel(n, [LABEL_REVIEW], [LABEL_BUILDING]);
		comment(n, `Opened ${pr} — gate green. Not merged; needs your review.`);
		event("pr_opened", { task: `#${n}`, run, ref: pr, summary: `${files.length} files` });
		log(`#${n} PR: ${pr}`);
	} catch (err) {
		const msg = (err.stderr || err.stdout || err.message || String(err)).toString().slice(-1500);
		log(`#${n} FAILED: ${msg.split("\n")[0]}`);
		relabel(n, [LABEL_FAILED], [LABEL_BUILDING]);
		comment(n, `Agent run failed — left for you.\n\n\`\`\`\n${msg}\n\`\`\``);
		event("failed", { task: `#${n}`, run, summary: msg.split("\n")[0] });
	}
}

async function tick() {
	const issues = queued();
	if (!issues.length) return;
	log(`${issues.length} queued; taking #${issues[0].number}`);
	await build(issues[0]); // one at a time, deliberately
}

log(`agent-loop watching ${REPO} for "${LABEL_QUEUED}"${DRY ? " (dry run)" : ""}`);
await tick();
if (!ONCE) {
	setInterval(() => {
		tick().catch((e) => log("tick error:", e.message));
	}, POLL_MS);
}
