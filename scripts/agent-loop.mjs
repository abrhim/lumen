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
import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));

const REPO = "abrhim/lumen";
const OWNER = "abrhim";
const LABEL_QUEUED = "agent";
const LABEL_BUILDING = "agent:building";
const LABEL_REVIEW = "agent:needs-review";
const LABEL_FAILED = "agent:failed";
const WORKTREES = join(process.env.HOME, ".lumen-agent/worktrees");
const POLL_MS = 30_000;
const ONCE = process.argv.includes("--once");
const DRY = process.argv.includes("--dry-run");
// Pinned, not inherited. Without this the builder silently takes whatever
// ~/.claude/settings.json happens to say — and this repo's own
// .claude/settings.local.json is gitignored, so the worktree never sees it.
const MODEL = process.env.AGENT_MODEL || "opus";

/**
 * Mirrors the tool policy we settled on while vetting Cyrus. The Bash list is
 * verb-scoped on purpose: a broad `Bash(*)` walks straight past every other
 * restriction, including reading ~/.ssh. Nothing here can merge or force-push.
 */
const ALLOWED = [
	"Read", "Edit", "Write", "Glob", "Grep", "TodoWrite",
	// Named invocations, not interpreters. `Bash(node:*)` and `Bash(pnpm:*)`
	// read as tight and are not: `node -e '<anything>'` and `pnpm exec
	// <anything>` both mean arbitrary code, which makes every other restriction
	// here decorative. Enumerate what the work actually needs; widen
	// deliberately when the agent reports being blocked on something legitimate.
	"Bash(pnpm verify)", "Bash(pnpm verify --no-e2e)",
	"Bash(pnpm install --frozen-lockfile)",
	"Bash(pnpm db:start)", "Bash(pnpm db:reset)",
	"Bash(pnpm typecheck)", "Bash(pnpm build)",
	"Bash(pnpm --filter @lumen/web exec vitest:*)",
	"Bash(pnpm --filter @lumen/web exec playwright test:*)",
	"Bash(pnpm --filter @lumen/web typecheck)",
	"Bash(node --test:*)",
	"Bash(git status)", "Bash(git diff:*)", "Bash(git log:*)",
	"Bash(git add:*)", "Bash(git commit:*)",
	"Bash(lsof:*)",
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

/**
 * Issues labelled and not yet claimed, oldest first.
 *
 * Author-gated as well as label-gated. The label alone is access control only
 * because GitHub restricts labelling to triage+ — but the issue BODY becomes
 * the agent's prompt verbatim, so labelling a stranger's report would feed
 * untrusted text straight into a builder with write access to a branch.
 *
 * To act on someone else's report, re-file it in your own words. That is not
 * bureaucracy: rewriting it IS the vetting step.
 */
function queued() {
	const out = gh([
		"issue", "list", "--repo", REPO, "--state", "open",
		"--label", LABEL_QUEUED, "--json", "number,title,body,url,author",
		"--limit", "20",
	]);
	const all = JSON.parse(out || "[]");
	const mine = all.filter((i) => i.author?.login === OWNER);
	for (const skipped of all.filter((i) => i.author?.login !== OWNER)) {
		log(`  skipping #${skipped.number}: authored by ${skipped.author?.login}, not ${OWNER}`);
	}
	return mine.reverse();
}

function relabel(n, add, remove) {
	const args = ["issue", "edit", String(n), "--repo", REPO];
	for (const l of add) args.push("--add-label", l);
	for (const l of remove) args.push("--remove-label", l);
	gh(args);
}

const comment = (n, body) =>
	gh(["issue", "comment", String(n), "--repo", REPO, "--body", body]);

/**
 * The memory index, inlined into the prompt.
 *
 * `.agent-memory/` is copied into the worktree by agent-setup.sh, but nothing
 * loads it: Claude Code keys its own project memory by path, and a worktree
 * resolves to an empty one. Pointing at the directory from CLAUDE.md makes it
 * discoverable, not loaded — the agent has to choose to look.
 *
 * So the INDEX rides in the prompt, where it cannot be missed. One line per
 * memory is small; the 28 full files are not, and most are irrelevant to any
 * given task. The agent reads the ones that match what it is doing.
 */
function memoryIndex(wt) {
	try {
		const idx = readFileSync(join(wt, ".agent-memory/MEMORY.md"), "utf8").trim();
		return [
			"",
			"## What this project already knows",
			"",
			"Full notes are in `.agent-memory/<name>.md`. Read the ones that touch",
			"what you are about to change — each has already cost someone a day.",
			"",
			idx,
			"",
		].join("\n");
	} catch {
		return "";
	}
}

const SESSIONS = join(process.env.HOME, ".lumen-agent/sessions.json");

/**
 * Run the builder with a structured event stream instead of opaque text.
 *
 * Two things this buys that `-p` alone does not: a readable live feed of what
 * the agent is actually doing, and the session id — which is what makes the
 * run answerable afterwards (`scripts/agent-ask.mjs`). Without the id the
 * session is written to disk but unreachable.
 */
function runBuilder(wt, prompt, issueNumber) {
	return new Promise((resolve, reject) => {
		// Progress digest. A long run is otherwise a black box, and "is it stuck
		// or is it thinking?" is the question you actually have at minute twelve.
		// Summarised, not streamed: the raw event feed is unreadable on a phone
		// and would bury the issue thread.
		const started = Date.now();
		const touched = new Set();
		const ran = new Set();
		let since = 0;
		const digest = setInterval(() => {
			if (since === 0) return; // nothing happened; silence is the honest report
			const mins = Math.round((Date.now() - started) / 60000);
			const files = [...touched].slice(-8).map((f) => `\`${f}\``).join(", ");
			const cmds = [...ran].slice(-6).map((c) => `\`${c}\``).join(", ");
			const body = [
				`**${mins}m in** — ${since} step${since === 1 ? "" : "s"} since the last update.`,
				files ? `\nTouched: ${files}` : "",
				cmds ? `\nRan: ${cmds}` : "",
				lastText ? `\n\n> ${lastText.split("\n")[0].slice(0, 300)}` : "",
			].join("");
			try { comment(issueNumber, body); } catch { /* never let reporting kill the run */ }
			since = 0;
			touched.clear();
			ran.clear();
		}, 10 * 60_000);
		const done = (fn) => (v) => { clearInterval(digest); fn(v); };
		const _resolve = resolve, _reject = reject;
		resolve = done(_resolve); reject = done(_reject);
		const child = spawn(
			"claude",
			[
				"-p", prompt,
				"--model", MODEL,
				"--output-format", "stream-json",
				"--verbose",
				"--allowedTools", ...ALLOWED,
				"--disallowedTools", ...DISALLOWED,
				"--permission-mode", "acceptEdits",
			],
			{ cwd: wt, stdio: ["ignore", "pipe", "pipe"] },
		);

		let sessionId = null;
		let buf = "";
		let lastText = "";

		child.stdout.on("data", (chunk) => {
			buf += chunk;
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				let ev;
				try { ev = JSON.parse(line); } catch { continue; }

				if (ev.session_id && !sessionId) {
					sessionId = ev.session_id;
					try {
						const all = existsSync(SESSIONS)
							? JSON.parse(readFileSync(SESSIONS, "utf8"))
							: {};
						all[issueNumber] = { sessionId, worktree: wt };
						writeFileSync(SESSIONS, JSON.stringify(all, null, 2));
					} catch { /* feed matters more than the bookmark */ }
					log(`  session ${sessionId.slice(0, 8)} — ask with: node scripts/agent-ask.mjs ${issueNumber} "..."`);
				}

				for (const b of ev.message?.content ?? []) {
					if (b.type === "tool_use") {
						const d = b.input?.file_path ?? b.input?.command ?? b.input?.pattern ?? "";
						log(`  ${b.name}${d ? ` ${String(d).slice(0, 90)}` : ""}`);
						since++;
						if (b.input?.file_path) touched.add(String(b.input.file_path).replace(wt + "/", ""));
						else if (b.input?.command) ran.add(String(b.input.command).split("\n")[0].slice(0, 60));
					} else if (b.type === "text" && b.text?.trim()) {
						lastText = b.text.trim();
						for (const l of lastText.split("\n").slice(0, 4)) {
							if (l.trim()) log(`  · ${l.slice(0, 110)}`);
						}
					}
				}

				if (ev.type === "result") {
					if (ev.is_error) return reject(new Error(ev.result || "builder reported an error"));
					resolve({ sessionId, summary: lastText });
				}
			}
		});

		let err = "";
		child.stderr.on("data", (c) => { err += c; });
		child.on("close", (code) => {
			if (code !== 0) reject(new Error(`builder exited ${code}: ${err.slice(-800)}`));
			else resolve({ sessionId, summary: lastText });
		});
		child.on("error", reject);
	});
}

function buildPrompt(issue, wt) {
	return [
		`Implement GitHub issue #${issue.number} in this repository.`,
		"",
		`## ${issue.title}`,
		"",
		issue.body || "(no description)",
		memoryIndex(wt),
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
		const built = await runBuilder(wt, buildPrompt(issue, wt), n);
		event("built", { task: `#${n}`, run, summary: built.summary?.slice(0, 300) });

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
		const raw = (err.stderr || "") + (err.stdout || "") || err.message || String(err);
		const msg = raw.toString().slice(-1800);
		// Report the last ERROR-ish line, not the first line of stderr — supabase
		// prints deprecation warnings before anything real happens, and those were
		// masquerading as the failure.
		const signal =
			msg.split("\n").filter((l) => /ERROR|Error:|failed|✘|not found/i.test(l)).pop() ||
			msg.split("\n").filter(Boolean).pop() ||
			"unknown failure";
		log(`#${n} FAILED: ${signal.trim().slice(0, 200)}`);
		relabel(n, [LABEL_FAILED], [LABEL_BUILDING]);
		comment(n, `Agent run failed — left for you.\n\n\`\`\`\n${msg}\n\`\`\``);
		event("failed", { task: `#${n}`, run, summary: msg.split("\n")[0] });
	}
}

/** Sessions bookmark: { [issue]: { sessionId, worktree, lastComment } } */
const readSessions = () => {
	try { return JSON.parse(readFileSync(SESSIONS, "utf8")); } catch { return {}; }
};
const writeSessions = (all) => {
	try { writeFileSync(SESSIONS, JSON.stringify(all, null, 2)); } catch { /* best effort */ }
};

/**
 * The review-feedback leg.
 *
 * A PR the agent opened is a conversation, not a delivery. Comments marked
 * `@agent` are replayed into the SESSION THAT WROTE THE CODE — it still knows
 * which files it read and why it made each call, which a fresh agent staring at
 * a diff does not.
 *
 * Marker-gated on purpose: without it, every review remark you make to yourself
 * would start a build.
 */
async function tickPRs() {
	const prs = JSON.parse(
		gh(["pr", "list", "--repo", REPO, "--state", "open", "--json", "number,headRefName"]) || "[]",
	).filter((p) => /^agent\/issue-\d+$/.test(p.headRefName));

	for (const pr of prs) {
		const issue = pr.headRefName.split("-").pop();
		const all = readSessions();
		const entry = all[issue];
		if (!entry?.sessionId) continue;

		const comments = JSON.parse(
			gh(["pr", "view", String(pr.number), "--repo", REPO, "--json", "comments"]) || "{}",
		).comments ?? [];
		const fresh = comments.filter(
			(c) =>
				c.body?.includes("@agent") &&
				c.author?.login === OWNER &&
				(!entry.lastComment || c.id > entry.lastComment),
		);
		if (!fresh.length) continue;

		const ask = fresh.map((c) => c.body).join("\n\n");
		all[issue] = { ...entry, lastComment: fresh[fresh.length - 1].id };
		writeSessions(all);

		log(`PR #${pr.number} — ${fresh.length} comment(s) for issue #${issue}`);
		event("note", { task: `#${issue}`, summary: `review feedback on PR #${pr.number}` });

		try {
			await new Promise((res, rej) => {
				const c = spawn(
					"claude",
					[
						"--resume", entry.sessionId,
						"-p",
						[
							"Review feedback on your pull request:",
							"",
							ask,
							"",
							"---",
							"Make the change, run `pnpm verify` until it exits 0, and commit.",
							"Do not push — the dispatcher pushes after re-running the gate itself.",
							"If you disagree or it should be escalated per CLAUDE.md, say so and change nothing.",
						].join("\n"),
						"--model", MODEL,
						"--allowedTools", ...ALLOWED,
						"--disallowedTools", ...DISALLOWED,
						"--permission-mode", "acceptEdits",
					],
					{ cwd: entry.worktree, stdio: ["ignore", "inherit", "inherit"], timeout: 30 * 60_000 },
				);
				c.on("close", (code) => (code === 0 ? res() : rej(new Error(`resume exited ${code}`))));
				c.on("error", rej);
			});

			const ahead = sh("git status --porcelain", entry.worktree).trim();
			if (ahead) throw new Error(`uncommitted changes left behind:\n${ahead}`);

			// Same rule as a first build: nothing is pushed on the agent's word.
            sh("bash scripts/verify.sh", entry.worktree, 30 * 60_000);
			sh(`git push origin ${pr.headRefName}`, entry.worktree);
			gh(["pr", "comment", String(pr.number), "--repo", REPO, "--body",
				"Updated and pushed — gate green. Still not merged."]);
			event("built", { task: `#${issue}`, summary: `updated from review on PR #${pr.number}` });
			log(`PR #${pr.number} updated`);
		} catch (err) {
			const msg = (err.stderr || err.stdout || err.message || String(err)).toString().slice(-1200);
			gh(["pr", "comment", String(pr.number), "--repo", REPO, "--body",
				`Could not apply that — left as-is.\n\n\`\`\`\n${msg}\n\`\`\``]);
			log(`PR #${pr.number} feedback FAILED: ${msg.split("\n")[0]}`);
		}
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
await tickPRs().catch((e) => log("pr tick error:", e.message));
if (!ONCE) {
	setInterval(() => {
		tick()
			.then(() => tickPRs())
			.catch((e) => log("tick error:", e.message));
	}, POLL_MS);
}
