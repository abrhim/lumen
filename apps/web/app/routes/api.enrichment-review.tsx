import { data } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { requireEntitlement } from "~/lib/entitlements.server";
import { ADMIN_COLLECTIONS } from "~/lib/entitlements-keys";
import {
	clearReview,
	isReviewStatus,
	parseMentionId,
	setNote,
	setReview,
} from "~/lib/enrichment-review.server";
import type { Route } from "./+types/api.enrichment-review";

/**
 * Accept / reject / undo one enrichment mention.
 *
 * A RESOURCE route (the api.highlight precedent) so a row action does not
 * revalidate the whole queue loader — a 40-row page re-reading two database
 * legs on every keystroke-fast decision is how a review tool becomes
 * unusable. The fetcher updates one row; the page stays put.
 *
 * Gated twice on purpose: requireEntitlement here, and the RLS policy at the
 * database. The gate that matters is the one this code cannot bypass.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const { user, headers } = await getSessionUser(request, context.cloudflare.env);
	await requireEntitlement(context.db, user?.id ?? null, ADMIN_COLLECTIONS);

	const form = await request.formData();
	const key = parseMentionId(String(form.get("mention") ?? ""));
	if (!key) return data({ ok: false, error: "bad mention id" }, { status: 400, headers });

	const intent = String(form.get("intent") ?? "");
	if (intent === "note") {
		const res = await setNote(request, context.cloudflare.env, key, String(form.get("note") ?? ""));
		return data({ ok: res.ok, status: "note" }, { headers });
	}
	if (intent === "clear") {
		const res = await clearReview(request, context.cloudflare.env, key);
		return data({ ok: res.ok, status: "pending" }, { headers });
	}
	if (!isReviewStatus(intent)) {
		return data({ ok: false, error: "bad intent" }, { status: 400, headers });
	}
	const res = await setReview(request, context.cloudflare.env, key, intent);
	return data({ ok: res.ok, status: intent }, { headers });
}

/** No loader: a GET here is not a page. */
export function loader() {
	throw data(null, { status: 404 });
}
