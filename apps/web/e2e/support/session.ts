import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";

/**
 * Throwaway-user session minting for e2e. Users are created confirmed via
 * the admin API (service key from the gitignored root .env), signed in
 * with a password, and their session is serialized into the EXACT cookie
 * shapes the app's SSR client reads — by driving @supabase/ssr's own
 * cookie writer, so chunking/base64 format can never drift from the app.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const SUPABASE_URL = "https://dsoekevnjqjfdntxhdhd.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_t7YqqT8Zu727RzviYMTXtQ_GjqYZlp-";

function serviceKey(): string {
	const env = readFileSync(join(ROOT, ".env"), "utf8");
	const key = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();
	if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from root .env");
	return key;
}

export interface E2eUser {
	id: string;
	email: string;
	/** signed-in PostgREST client for seeding/asserting data server-side */
	client: SupabaseClient;
	session: Session;
	/** install the session cookies into a Playwright context */
	install: (context: BrowserContext) => Promise<void>;
	cleanup: () => Promise<void>;
}

export async function createE2eUser(tag: string): Promise<E2eUser> {
	const admin = createClient(SUPABASE_URL, serviceKey(), {
		auth: { autoRefreshToken: false, persistSession: false },
	});
	const email = `e2e-notes-${tag}-${Date.now()}@example.invalid`;
	const password = crypto.randomUUID();
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw new Error(`createUser: ${error.message}`);
	const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
	const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
		email,
		password,
	});
	if (signInErr || !signIn.session) throw new Error(`signIn: ${signInErr?.message}`);

	const install = async (context: BrowserContext) => {
		// drive @supabase/ssr's own cookie serialization
		const jar: Array<{ name: string; value: string }> = [];
		const ssr = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
			cookies: {
				getAll: () => [],
				setAll(cookies) {
					for (const c of cookies) jar.push({ name: c.name, value: c.value });
				},
			},
		});
		await ssr.auth.setSession({
			access_token: signIn.session!.access_token,
			refresh_token: signIn.session!.refresh_token,
		});
		await context.addCookies(
			jar.map((c) => ({
				name: c.name,
				value: c.value,
				domain: "localhost",
				path: "/",
				httpOnly: true,
				sameSite: "Lax" as const,
			})),
		);
	};

	return {
		id: data.user.id,
		email,
		client,
		session: signIn.session,
		install,
		cleanup: async () => {
			// roadmap_votes.voter_id is a bare uuid, not an FK to auth.users, so
			// deleting the user leaves its presses standing in the PUBLIC totals.
			// Every suite run used to add a few; they compounded into triple
			// digits on the live roadmap. Take them with the user.
			await admin.schema("lumen").from("roadmap_votes").delete().eq("voter_id", data.user.id);
			await admin.auth.admin.deleteUser(data.user.id);
		},
	};
}
