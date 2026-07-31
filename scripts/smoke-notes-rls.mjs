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
 *        authenticated/anon/PUBLIC hold zero grants on every other lumen
 *        relation (negative-space sweep; ADMIN_DATABASE_URL is REQUIRED —
 *        gap 5). The default-privilege probe is a REAL assertion (B19).
 *  CF-10/11 – RLS-enforced soft-delete invisibility; composite-FK anchor
 *        forgery rejection; owner_id reassignment probe (gap 1/2/7).
 *  B8/CF-25 – the app's real create shape (create_note_with_anchors) incl.
 *        one-transaction atomicity, and ADVERSARIAL probes of the SECURITY
 *        DEFINER soft_delete_note: cross-user call → 0 rows and the victim's
 *        note untouched; sessionless anon call → denied; double delete → 0.
 *  B20/B27 – anon holds EXECUTE on zero lumen functions (authenticated on
 *        exactly the two app RPCs); column-scoped grants deny born-dead
 *        INSERTs and created_at tampering on the caller's OWN rows.
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
	return {
		id: data.user.id,
		client,
		// throws on failure so the allSettled sweep below can actually SEE a
		// stranded user (the admin API resolves with {error}, never rejects).
		cleanup: async () => {
			const { error: delErr } = await admin.auth.admin.deleteUser(data.user.id);
			if (delErr) throw new Error(`deleteUser ${tag}: ${delErr.message}`);
		},
	};
}

// CP-58 (test hygiene): both users are created INSIDE the try and cleaned up
// through allSettled — a throw in makeUser("b"), or a rejecting a.cleanup(),
// used to strand a confirmed @example.invalid user with notes write ability.
const acquired = [];
let a;
let b;

try {
	a = await makeUser("a");
	acquired.push(a);
	b = await makeUser("b");
	acquired.push(b);

	// F1 — A creates; B must see nothing.
	// CP-54: through the app's REAL create statement — the INVOKER RPC — not
	// a raw insert the app never issues. The direct-insert path is still
	// probed below (it is the grant/policy surface PostgREST exposes).
	const { data: note, error: createErr } = await a.client
		.schema("lumen")
		.rpc("create_note_with_anchors", {
			p_body_md: "private to A [[alma-32-21]]",
			p_anchors: [{ kind: "verse", ref_id: "alma-32-21" }],
		})
		.single();
	check("A can create a note via create_note_with_anchors (app shape)", !createErr && !!note?.id, createErr?.message);

	if (note?.id) {
		const { data: rpcAnchors } = await a.client
			.schema("lumen")
			.from("note_anchors")
			.select("*")
			.eq("note_id", note.id);
		check("CF-25: the RPC lands note + anchors together (owner_id defaulted inside the function)",
			(rpcAnchors ?? []).length === 1 && rpcAnchors[0].owner_id === a.id && rpcAnchors[0].ref_id === "alma-32-21");

		// CF-25 atomicity: an invalid kind must roll the note row back too.
		const countNotes = async () => ((await a.client.schema("lumen").from("notes").select("id")).data ?? []).length;
		const beforeCount = await countNotes();
		const { error: atomicErr } = await a.client
			.schema("lumen")
			.rpc("create_note_with_anchors", {
				p_body_md: "atomicity probe — must not survive",
				p_anchors: [{ kind: "bogus", ref_id: "alma-32-21" }],
			})
			.single();
		const afterCount = await countNotes();
		check("CF-25: an invalid anchor kind rolls the whole create back (no orphan note)",
			!!atomicErr && afterCount === beforeCount, `${beforeCount} → ${afterCount}`);

		// The direct PostgREST insert path (grants + notes_insert WITH CHECK).
		const { data: rawNote, error: rawErr } = await a.client
			.schema("lumen")
			.from("notes")
			.insert({ body_md: "direct-insert path" })
			.select()
			.single();
		check("A can create a note by direct insert (owner_id column default)", !rawErr && !!rawNote?.id, rawErr?.message);

		const { error: anchorErr } = await a.client
			.schema("lumen")
			.from("note_anchors")
			.insert({ note_id: note.id, kind: "chapter", ref_id: "alma-32" });
		check("A can anchor the note", !anchorErr, anchorErr?.message);

		// B27/DATA-4: column-scoped grants. A owns these rows and the policies
		// pass — only the absent column privilege stops the write.
		const { error: bornDeadErr } = await a.client
			.schema("lumen")
			.from("notes")
			.insert({ body_md: "born dead", deleted_at: new Date().toISOString() });
		check("B27: born-dead INSERT (deleted_at pre-set) on one's OWN row is denied", !!bornDeadErr, "no error — deleted_at is INSERT-grantable");

		const { error: stampErr } = await a.client
			.schema("lumen")
			.from("notes")
			.update({ created_at: "1999-01-01T00:00:00Z" })
			.eq("id", note.id)
			.select();
		check("B27: created_at tampering on one's OWN row is denied", !!stampErr, "no error — created_at is UPDATE-grantable");

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
		// B8/DATA-1 — ADVERSARIAL probes FIRST. Post harness-revision 1 the
		// entire soft-delete security boundary is this DEFINER function's
		// hand-written WHERE (it runs as postgres, BYPASSRLS): if a future
		// edit drops `owner_id = auth.uid()`, every other assertion in this
		// file stays green while any signed-in user deletes any note by uuid.
		const { data: bSoft, error: bSoftErr } = await b.client
			.schema("lumen")
			.rpc("soft_delete_note", { p_id: note.id });
		check("B8: B's soft_delete_note on A's note deletes 0 rows (DEFINER owner predicate)",
			!bSoftErr && bSoft === 0, bSoftErr ? bSoftErr.message : `returned ${JSON.stringify(bSoft)}`);
		const { data: aStillThere } = await a.client.schema("lumen").from("notes").select("id").eq("id", note.id);
		check("B8: A's note survives B's cross-user RPC attempt", (aStillThere ?? []).length === 1);

		{
			const anonRpc = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
				auth: { autoRefreshToken: false, persistSession: false },
			});
			const { error: anonSoftErr } = await anonRpc.schema("lumen").rpc("soft_delete_note", { p_id: note.id });
			check("B8: a sessionless anon client cannot EXECUTE soft_delete_note", !!anonSoftErr, "anon call succeeded");
			const { error: anonCreateErr } = await anonRpc
				.schema("lumen")
				.rpc("create_note_with_anchors", { p_body_md: "anon", p_anchors: [] });
			check("B8: a sessionless anon client cannot EXECUTE create_note_with_anchors", !!anonCreateErr, "anon call succeeded");
			const { data: anonStill } = await a.client.schema("lumen").from("notes").select("id").eq("id", note.id);
			check("B8: A's note survives the anon RPC attempt", (anonStill ?? []).length === 1);
		}

		const { data: sdCount, error: sdErr } = await a.client.schema("lumen").rpc("soft_delete_note", { p_id: note.id });
		check("CF-10: owner soft-delete succeeds via soft_delete_note RPC (1 row)", !sdErr && sdCount === 1, sdErr?.message);
		// CP-54: the app maps 0 → 404; a second delete must not re-report 1.
		const { data: sdAgain, error: sdAgainErr } = await a.client
			.schema("lumen")
			.rpc("soft_delete_note", { p_id: note.id });
		check("CP-54: a second soft_delete_note on the same note returns 0 (the 404 path)",
			!sdAgainErr && sdAgain === 0, sdAgainErr ? sdAgainErr.message : `returned ${JSON.stringify(sdAgain)}`);
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
		const readColGrants = await sql`
			SELECT grantee, table_name, column_name FROM information_schema.column_privileges
			WHERE table_schema = 'lumen' AND table_name IN ('notes','note_anchors')
			  AND grantee IN ('lumen_read','anon')`;
		check("A6: lumen_read/anon hold ZERO grants on notes tables (table AND column level)",
			readGrants.length === 0 && readColGrants.length === 0);
		// B19/CP-20: this was `check(…, true, …)` — an assertion that could not
		// fail, laundering the PASS count over the exact mechanism it named.
		// setup-readonly-role.sql:16's ALTER DEFAULT PRIVILEGES entry must be
		// gone, or the next CREATE TABLE lumen.* re-opens D3 with no gate.
		const defaultAcl = await sql`
			SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON d.defaclnamespace = n.oid
			WHERE n.nspname = 'lumen' AND d.defaclacl::text LIKE '%lumen_read=%'
			  AND d.defaclobjtype = 'r'`;
		check("CF-9: no lumen default-privilege entry auto-grants lumen_read on FUTURE tables",
			defaultAcl.length === 0, `pg_default_acl rows still naming lumen_read: ${defaultAcl.length}`);
		// BR-7: 'PUBLIC' added — schema USAGE activates a PUBLIC-grantee grant
		// for every API role, and the two-role filter could never see one.
		const wideGrants = await sql`
			SELECT grantee, table_name FROM information_schema.role_table_grants
			WHERE table_schema = 'lumen' AND grantee IN ('authenticated','anon','PUBLIC')
			  AND table_name NOT IN ('notes','note_anchors')`;
		check("A6: authenticated/anon/PUBLIC hold zero grants on every OTHER lumen relation (app_users, user_roles, collections...)", wideGrants.length === 0,
			wideGrants.map((g) => `${g.grantee}:${g.table_name}`).join(","));
		// B20/CP-21: role_table_grants is blind to pg_proc — schema USAGE plus
		// Postgres' default PUBLIC EXECUTE left every pre-existing lumen
		// function callable as /rpc/ by any signed-in user.
		const anonFns = await sql`
			SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
			WHERE n.nspname = 'lumen' AND has_function_privilege('anon', p.oid, 'EXECUTE')`;
		check("B20: anon holds EXECUTE on ZERO lumen functions", anonFns.length === 0,
			anonFns.map((f) => f.proname).join(","));
		const authFns = await sql`
			SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
			WHERE n.nspname = 'lumen' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
			ORDER BY p.proname`;
		check("B20: authenticated holds EXECUTE on EXACTLY the two app RPCs",
			authFns.length === 2 && authFns[0].proname === "create_note_with_anchors" && authFns[1].proname === "soft_delete_note",
			authFns.map((f) => f.proname).join(","));
		await sql.end();
	}
	// Gap 3: anon PostgREST probe — a sessionless client sees nothing.
	{
		const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
		const { data: anonRead, error: anonErr } = await anon.schema("lumen").from("notes").select("*");
		check("Gap 3: anon client reads zero notes (error or empty)", !!anonErr || (anonRead ?? []).length === 0);
	}
} catch (err) {
	// A throw past this point is a failed run, not a silent skip — the
	// finally below still reclaims every user that was actually created.
	check("smoke run completed without throwing", false, err?.message ?? String(err));
} finally {
	const results = await Promise.allSettled(acquired.map((u) => u.cleanup()));
	const stranded = results.filter((r) => r.status === "rejected").length;
	check("CP-58: every throwaway auth user was deleted", stranded === 0, `${stranded} stranded`);
}

console.log(failures === 0 ? "smoke-notes-rls: PASS" : `smoke-notes-rls: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
