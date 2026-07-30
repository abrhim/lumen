#!/usr/bin/env node
/**
 * smoke-notes-rls.mjs — harness F1/F11 (personal-notes plan).
 *
 * Live two-user RLS probe against the real database. Red-first: fails today
 * because lumen.notes / lumen.note_anchors do not exist.
 *
 * Requires env (repo-root .env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Creates two throwaway confirmed users via the admin API, exercises the
 * PostgREST surface as each, and deletes both users at the end (their notes
 * cascade). Never touches real user rows.
 *
 * Asserts:
 *  F1  – A creates a note+anchor; B cannot SELECT, UPDATE, or DELETE it
 *        (PostgREST returns empty/0-row results under RLS, not A's data).
 *  F1b – B's insert with owner_id=A is rejected (RLS WITH CHECK).
 *  F11 – updated_at advances on A's own update; anchors cascade on hard
 *        delete (service-role delete used to verify cascade only).
 *  D3  – the lumen_read role has no SELECT grant on either table
 *        (structural search-path isolation), probed via pg if ADMIN_DATABASE_URL
 *        is present; skipped with a warning otherwise.
 *
 * Exit 0 = all assertions pass; exit 1 = any failure. Run:
 *   node scripts/smoke-notes-rls.mjs
 */
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_DATABASE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error("smoke-notes-rls: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
	process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
function check(name, ok, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
}

async function makeUser(tag) {
	const email = `smoke-notes-${tag}-${Date.now()}@example.invalid`;
	const password = crypto.randomUUID();
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (error) throw new Error(`createUser ${tag}: ${error.message}`);
	const client = createClient(SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
	const { data: session, error: signInErr } = await client.auth.signInWithPassword({ email, password });
	if (signInErr) throw new Error(`signIn ${tag}: ${signInErr.message}`);
	return { id: data.user.id, client, cleanup: () => admin.auth.admin.deleteUser(data.user.id) };
}

const a = await makeUser("a");
const b = await makeUser("b");

try {
	// F1 — A creates; B must see nothing.
	const { data: note, error: createErr } = await a.client
		.schema("lumen")
		.from("notes")
		.insert({ body_md: "private to A [[alma-32-21]]" })
		.select()
		.single();
	check("A can create a note", !createErr && !!note?.id, createErr?.message);

	if (note?.id) {
		const { error: anchorErr } = await a.client
			.schema("lumen")
			.from("note_anchors")
			.insert({ note_id: note.id, kind: "verse", ref_id: "alma-32-21" });
		check("A can anchor the note", !anchorErr, anchorErr?.message);

		const { data: bRead } = await b.client.schema("lumen").from("notes").select("*");
		check("F1: B sees zero of A's notes", (bRead ?? []).length === 0);

		const { data: bAnchors } = await b.client.schema("lumen").from("note_anchors").select("*");
		check("F1: B sees zero of A's anchors", (bAnchors ?? []).length === 0);

		const { data: bUpd } = await b.client
			.schema("lumen")
			.from("notes")
			.update({ body_md: "stolen" })
			.eq("id", note.id)
			.select();
		check("F1: B's UPDATE of A's note affects 0 rows", (bUpd ?? []).length === 0);

		const { data: bDel } = await b.client
			.schema("lumen")
			.from("notes")
			.delete()
			.eq("id", note.id)
			.select();
		check("F1: B's DELETE of A's note affects 0 rows", (bDel ?? []).length === 0);

		const { error: forgeErr } = await b.client
			.schema("lumen")
			.from("notes")
			.insert({ owner_id: a.id, body_md: "forged into A's notebook" });
		check("F1b: B cannot insert a note owned by A (WITH CHECK)", !!forgeErr);

		// F11 — updated_at trigger on A's own update
		const before = note.updated_at;
		await new Promise((r) => setTimeout(r, 1100));
		const { data: upd } = await a.client
			.schema("lumen")
			.from("notes")
			.update({ body_md: "edited by A" })
			.eq("id", note.id)
			.select()
			.single();
		check("F11: updated_at advances on owner update", !!upd && upd.updated_at > before);

		// F11 — cascade (service role, verification only)
		await admin.schema("lumen").from("notes").delete().eq("id", note.id);
		const { data: orphans } = await admin
			.schema("lumen")
			.from("note_anchors")
			.select("*")
			.eq("note_id", note.id);
		check("F11: anchors cascade with the note", (orphans ?? []).length === 0);
	}

	// D3 — structural search-path isolation
	if (ADMIN_DATABASE_URL) {
		const { default: postgres } = await import("postgres");
		const sql = postgres(ADMIN_DATABASE_URL, { max: 1 });
		const grants = await sql`
			SELECT grantee, table_name FROM information_schema.role_table_grants
			WHERE table_schema = 'lumen' AND table_name IN ('notes','note_anchors')
			  AND grantee = 'lumen_read'`;
		check("D3: lumen_read has NO grant on notes tables", grants.length === 0);
		await sql.end();
	} else {
		console.log("  ! D3 grant probe skipped (no ADMIN_DATABASE_URL)");
	}
} finally {
	await a.cleanup();
	await b.cleanup();
}

console.log(failures === 0 ? "smoke-notes-rls: PASS" : `smoke-notes-rls: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
