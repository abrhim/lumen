import { getVersesByStrongs } from "@lumen/scripture";
import { logEvent } from "../lib/log.server";
import type { Route } from "./+types/api.strongs";

/** Resource route: "also in" verses for a Strong's number (word-study card).
 * On-demand via useFetcher — never in the chapter's critical path. */
export async function loader({ params, context }: Route.LoaderArgs) {
	const no = (params.no ?? "").toUpperCase();
	if (!/^[HG]\d{1,5}[A-Z]?$/.test(no)) {
		throw new Response("Invalid Strong's number.", { status: 400 });
	}
	const startedAt = Date.now();
	try {
		const verses = await getVersesByStrongs(context.db, no, 6);
		return { no, verses };
	} catch (error) {
		logEvent("strongs_lookup_degraded", {
			name: error instanceof Error ? error.name : "unknown",
			message: error instanceof Error ? error.message : String(error),
			no,
			elapsedMs: Date.now() - startedAt,
		});
		return { no, verses: [] };
	}
}
