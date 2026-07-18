// Shared pipeline utilities (unshaken-ingest A1). Pure, dependency-free —
// portability invariant 1: logic here, I/O in the stage shells.

/** CSEC-1 + SEC-2: redact DSN passwords, bearer tokens, and any known secret
 * values before a message can reach a log or console. */
export function scrubSecrets(message, { extraSecrets = [] } = {}) {
	let out = String(message)
		.replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]*@/gi, '$1***@')
		.replace(/\bToken \S+/g, 'Token ***')
		.replace(/\bpassword=\S+/gi, 'password=***');
	const secrets = [...extraSecrets];
	if (process.env.DEEPGRAM_API_KEY) secrets.push(process.env.DEEPGRAM_API_KEY);
	for (const s of secrets) {
		if (s) out = out.split(s).join('***');
	}
	return out;
}

/** SEC-3 (amended): SUBTRACTIVE child env — strip the two secrets, keep
 * everything else (PATH-only breaks yt-dlp's HOME/TMPDIR needs). */
export function childEnv(env) {
	const out = { ...env };
	delete out.DEEPGRAM_API_KEY;
	delete out.DATABASE_URL;
	return out;
}

/** SEC-5: YouTube video ids are exactly 11 chars of [A-Za-z0-9_-]; nothing
 * else may reach argv. */
export function assertVideoId(id) {
	if (!/^[A-Za-z0-9_-]{11}$/.test(String(id))) {
		throw new Error(`invalid videoId: ${JSON.stringify(String(id).slice(0, 24))}`);
	}
	return id;
}

/** B4: scrubber with the live key baked in — no env-var dependency (the
 * process.env fallback in scrubSecrets is belt-and-suspenders only). */
export function makeScrubber(apiKey) {
	return (message) => scrubSecrets(message, { extraSecrets: apiKey ? [apiKey] : [] });
}

/** B5: crash/concurrency-safe artifact write — tmp then atomic rename. */
export function writeArtifactAtomic(path, data, { writeFileSync, renameSync }) {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, data);
	renameSync(tmp, path);
}

/** B1: runner-owned, per-invocation-unique log path (kills the shared-log
 * collision and the tee exit-code masking in one move). */
export function makeRunLogPath(dir, { now, pid }) {
	return `${dir}/run-${now}-${pid}.log`;
}

/** B9: stage roll-up from pool results. */
export function summarizeResults(results) {
	let ok = 0;
	let failed = 0;
	for (const r of results) (r.ok ? (ok += 1) : (failed += 1));
	return { ok, failed };
}

/** Amendment 1: bounded concurrency with order-preserving results and
 * sibling isolation — results[i] is {ok:true,value} or {ok:false,error}. */
export async function runPool(taskFns, limit) {
	const results = new Array(taskFns.length);
	let next = 0;
	async function worker() {
		while (next < taskFns.length) {
			const i = next++;
			try {
				results[i] = { ok: true, value: await taskFns[i]() };
			} catch (error) {
				results[i] = { ok: false, error };
			}
		}
	}
	const workers = Array.from({ length: Math.max(1, Math.min(limit, taskFns.length)) }, worker);
	await Promise.all(workers);
	return results;
}
