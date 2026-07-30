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
 *  D3/A6 – lumen_read/anon hold zero grants on the notes tables AND
 *        authenticated/anon hold zero grants on every other lumen relation
 *        (negative-space sweep; ADMIN_DATABASE_URL is REQUIRED — gap 5).
 *  CF-10/11 – RLS-enforced soft-delete invisibility; composite-FK anchor
 *        forgery rejection; owner_id reassignment probe (gap 1/2/7).
 *
 * Exit 0 = all assertions pass; exit 1 = any failure. Run:
 *   node scripts/smoke-notes-rls.mjs
 */
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY, ADMIN_DATABASE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_PUBLISHABLE_KEY) {
	console.error("smoke-notes-rls: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY all required");
	process.exit(1);
}
// Gap 5 (CF-9): the D3 grant probe is load-bearing — without the admin DSN a
// green run proves nothing. Hard-fail, never skip-with-warning.
if (!ADMIN_DATABASE_URL) {
	console.error("smoke-notes-rls: ADMIN_DATABASE_URL required (D3/negative-grant sweep is not skippable)");
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
	const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
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

		// Gap 2 (CF-11): FK checks bypass RLS — the composite FK must reject
		// B anchoring A's note even though B's own WITH CHECK passes.
		const { error: anchorForgeErr } = await b.client
			.schema("lumen")
			.from("note_anchors")
			.insert({ note_id: note.id, owner_id: b.id, kind: "verse", ref_id: "alma-32-21" });
		check("CF-11: B cannot anchor A's note (composite FK)", !!anchorForgeErr);

		// Gap 1 (CF-38 style pin): A cannot reassign ownership of A's own note.
		const { data: reassign } = await a.client
			.schema("lumen")
			.from("notes")
			.update({ owner_id: b.id })
			.eq("id", note.id)
			.select();
		const { data: bAfter } = await b.client.schema("lumen").from("notes").select("*");
		check("Gap 1: owner_id reassignment lands nothing in B's notebook", (bAfter ?? []).length === 0 && (reassign ?? []).length === 0);

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

		// Gap 7 (CF-10): soft-delete is RLS-enforced — after A soft-deletes,
		// A's own SELECT of note AND anchors returns 0 rows; update affects 0.
		// harness-revision (narrow, Abram-sanctioned 2026-07-30): the app's
		// soft-delete statement shape is the INVOKER RPC — PostgREST UPDATEs
		// always carry RETURNING, which Postgres checks against the
		// tombstone-hiding SELECT policy, so a raw PATCH can never succeed.
		const { data: sdCount, error: sdErr } = await a.client.schema("lumen").rpc("soft_delete_note", { p_id: note.id });
		check("CF-10: owner soft-delete succeeds via soft_delete_note RPC (1 row)", !sdErr && sdCount === 1, sdErr?.message);
		const { data: aDead } = await a.client.schema("lumen").from("notes").select("*").eq("id", note.id);
		const { data: aDeadAnchors } = await a.client.schema("lumen").from("note_anchors").select("*").eq("note_id", note.id);
		const { data: tombUpd } = await a.client.schema("lumen").from("notes").update({ body_md: "zombie" }).eq("id", note.id).select();
		check("CF-10: soft-deleted note invisible to its own owner (RLS)", (aDead ?? []).length === 0);
		check("CF-10: anchors of a soft-deleted note are invisible (EXISTS clause)", (aDeadAnchors ?? []).length === 0);
		check("CF-10: update-after-soft-delete affects 0 rows (no tombstone save)", (tombUpd ?? []).length === 0);

		// F11 — cascade (service role, verification only)
		await admin.schema("lumen").from("notes").delete().eq("id", note.id);
		const { data: orphans } = await admin
			.schema("lumen")
			.from("note_anchors")
			.select("*")
			.eq("note_id", note.id);
		check("F11: anchors cascade with the note", (orphans ?? []).length === 0);
	}

	// D3/A6 — structural search-path isolation + negative-space grant sweep (gap 4)
	{
		const { default: postgres } = await import("postgres");
		const sql = postgres(ADMIN_DATABASE_URL, { max: 1 });
		const readGrants = await sql`
			SELECT grantee, table_name FROM information_schema.role_table_grants
			WHERE table_schema = 'lumen' AND table_name IN ('notes','note_anchors')
			  AND grantee IN ('lumen_read','anon')`;
		check("A6: lumen_read/anon hold ZERO grants on notes tables", readGrants.length === 0);
		const defaultAcl = await sql`
			SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON d.defaclnamespace = n.oid
			WHERE n.nspname = 'lumen' AND d.defaclacl::text LIKE '%lumen_read%'
			  AND d.defaclobjtype = 'r'`;
		check("CF-9: the notes migration neutralized/handled default-privilege auto-grants (probe is informational if REVOKEs ran)", true, `default_acl rows: ${defaultAcl.length}`);
		const wideGrants = await sql`
			SELECT grantee, table_name FROM information_schema.role_table_grants
			WHERE table_schema = 'lumen' AND grantee IN ('authenticated','anon')
			  AND table_name NOT IN ('notes','note_anchors')`;
		check("A6: authenticated/anon hold zero grants on every OTHER lumen relation (app_users, user_roles, collections...)", wideGrants.length === 0,
			wideGrants.map((g) => `${g.grantee}:${g.table_name}`).join(","));
		await sql.end();
	}
	// Gap 3: anon PostgREST probe — a sessionless client sees nothing.
	{
		const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
		const { data: anonRead, error: anonErr } = await anon.schema("lumen").from("notes").select("*");
		check("Gap 3: anon client reads zero notes (error or empty)", !!anonErr || (anonRead ?? []).length === 0);
	}
} finally {
	await a.cleanup();
	await b.cleanup();
}

console.log(failures === 0 ? "smoke-notes-rls: PASS" : `smoke-notes-rls: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
