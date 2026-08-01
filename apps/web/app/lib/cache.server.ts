import { logEvent } from "./log.server";

/** Minimal KV surface so tests and non-Workers contexts don't need the real type. */
export interface KVLike {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Read-through JSON cache. Cache failures never break a request: get/put
 * errors are logged once and the fetcher result is served live. Fetcher
 * errors DO propagate — callers own their degradation semantics.
 */
/** Crawler user-agents read the cache but never spend the WRITE quota —
 * KV free tier is 1,000 writes/day, and a fresh domain's crawler swarm
 * walking per-verse URLs exhausted it in hours (2026-07-31). */
export function isBotUA(userAgent: string | null): boolean {
	return /bot|crawl|spider|slurp|preview|semrush|ahrefs|petal|bytespider|gpt|claude|ccbot|facebookexternal|headless/i.test(
		userAgent ?? "",
	);
}

export async function cachedJson<T>(
	kv: KVLike | undefined,
	key: string,
	ttlSeconds: number,
	fetcher: () => Promise<T>,
	opts?: { skipWrite?: boolean },
): Promise<T> {
	if (kv) {
		try {
			const hit = await kv.get(key);
			if (hit != null) {
				try {
					return JSON.parse(hit) as T;
				} catch {
					// corrupt entry — fall through to live fetch and overwrite
				}
			}
		} catch (error) {
			logEvent("kv_cache_error", {
				op: "get",
				key,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const value = await fetcher();

	if (kv && !opts?.skipWrite) {
		try {
			await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
		} catch (error) {
			logEvent("kv_cache_error", {
				op: "put",
				key,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return value;
}
