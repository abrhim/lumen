import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Whether a FULL scripture corpus is behind the DSN.
 *
 * The two live-DB harnesses pin regression floors measured against production
 * — faith>=810, jerusalem>=1686 — so they are meaningful only against the whole
 * corpus. The local stack carries a deliberately bounded slice (~162 verses),
 * against which those floors cannot pass and never could.
 *
 * Historically they "passed" locally only because turbo's strict env mode
 * starved them of LUMEN_READ_DSN and they fell back to the PRODUCTION pooler in
 * apps/web/.env. That made the gate green by reading prod. Opt in explicitly
 * instead: set LUMEN_FULL_CORPUS=1 when the DSN really does point at a full
 * corpus.
 */
export const FULL_CORPUS = process.env.LUMEN_FULL_CORPUS === "1";

/** localhost DSNs are the local stack, which has no TLS in front of it. */
const isLocal = (dsn: string) => /@(localhost|127\.0\.0\.1)[:/]/.test(dsn);

/**
 * The `lumen_read` DSN the live-DB harnesses connect as.
 *
 * Prefers LUMEN_READ_DSN, which `scripts/verify.sh` exports pointed at the
 * local stack. Falls back to the production Hyperdrive DSN in apps/web/.env, so
 * a bare `pnpm test` behaves exactly as it always has.
 *
 * That fallback is the path worth understanding: it runs against PRODUCTION
 * through a session pooler capped at 15 clients — which these two harnesses
 * exhausted the first time the full gate ran them concurrently under turbo
 * (EMAXCONNSESSION). Anything running the suite on a loop wants the env var.
 */
export function lumenReadDsn(): { dsn: string; ssl: 'require' | false } {
	const fromEnv = process.env.LUMEN_READ_DSN?.trim();
	if (fromEnv) return { dsn: fromEnv, ssl: isLocal(fromEnv) ? false : 'require' };

	// NO FALLBACK, deliberately.
	//
	// This used to read apps/web/.env when the variable was missing — and that
	// file holds the PRODUCTION pooler DSN. A missing local config therefore
	// succeeded silently against prod, twice in one afternoon, while every guard
	// upstream reported localhost. Refusing is the whole point: absent config is
	// a loud failure, never a quiet production read.
	throw new Error(
		"LUMEN_READ_DSN is not set. Run the gate via `pnpm verify` (which exports " +
			"it from the local stack), or set it explicitly. There is no fallback: " +
			"an unset DSN must never resolve to production.",
	);
}
