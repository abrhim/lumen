import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

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

	const txt = readFileSync(resolve(here, '../../../../../apps/web/.env'), 'utf8');
	const m = txt.match(/^CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=(.+)$/m);
	if (!m) {
		throw new Error(
			'lumen_read DSN: set LUMEN_READ_DSN (see scripts/verify.sh) or add ' +
				'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE to apps/web/.env',
		);
	}
	const dsn = m[1].trim();
	return { dsn, ssl: isLocal(dsn) ? false : 'require' };
}
