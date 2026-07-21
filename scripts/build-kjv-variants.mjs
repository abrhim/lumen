// M2 generator + eval gate (search-endpoint): builds data/kjv-variants.json
// from the live corpus with fail-safe curation (PER-7 ruling: ambiguous forms
// DROP; a missing mapping is status quo, a wrong mapping ships garbage).
//
// Rules (plan decision 9, REL-1/REL-2):
//   morphology  -ieth→y | -eth→strip'th' | -eth→strip'eth'   (3rd person)
//               -iest→y | -est→strip'st' | -est→strip'est'   (2nd person)
//               -edst→strip'edst' | strip'dst' | strip'st'   (2nd past;
//               base candidates FIRST — DATC-2: the past form wins G1
//               first-match but can never attest G2 siblings)
//   orthography curated (shew→show, saviour→savior, …)
//   irregulars  curated (spake→spoke, sware→swore, …)
//
// Acceptance gates, all mechanical:
//   G1 attestation: target appears lowercase ≥3× in lumen.words
//   G2 sibling evidence (morphology only): target+'ed' | +'ing' | +'eth'
//      attested — kills best→be, west→we (no 'beeth'/'weeth'/'beed'/'weed'?
//      'weed' exists… which is why G2 requires the VARIANT's own stem family:
//      sibling must share the candidate target, and G5 still applies)
//   G3 proper-noun filter: variant must occur lowercase ≥3× (Seth, Japheth,
//      Nazareth are capitalized → skipped)
//   G4 closure: if a target is itself a variant key, resolve the chain at
//      build time (sheweth→shew→show); cycles fatal
//   G5 lexeme gates: to_tsvector(target) is exactly one non-empty lexeme AND
//      differs from to_tsvector(variant) (else no-op / stopword → drop)
//
//   node --import tsx scripts/build-kjv-variants.mjs           # report only
//   COMMIT=1 node --import tsx scripts/build-kjv-variants.mjs  # write JSON
// Exit 0 ok, 1 fatal, 2 gate failure (cycle detected).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

// Curated irregular past forms / archaic verbs. Targets are modern BASE or
// past forms whose lexeme equals the likely modern query lexeme (verified by
// G5 at build). Ambiguous forms deliberately absent: bare (adjective), clave
// (two verbs), wax (semantic), art/hath/doth-class auxiliaries whose targets
// are stopwords are auto-dropped by G5.
export const IRREGULARS = {
	spake: 'spoke',
	sware: 'swore',
	brake: 'broke',
	drave: 'drove',
	gat: 'got',
	begat: 'begot',
	forgat: 'forgot',
	trode: 'trod',
	wist: 'knew',
	wot: 'know',
	quoth: 'said',
	durst: 'dared',
	saith: 'say',
	sayest: 'say',
	sayeth: 'say',
	doth: 'does',
	holpen: 'helped',
	holden: 'held',
	astonied: 'astonished',
	twain: 'two',
	nigh: 'near',
	betwixt: 'between',
};

// Curated British/orthographic variants (KJV spellings). -our→-or is NOT a
// safe rule (hour, four, our) — enumerated only, G1-checked at build.
export const ORTHOGRAPHIC = {
	shew: 'show',
	shewed: 'showed',
	shewn: 'shown',
	saviour: 'savior',
	honour: 'honor',
	honoured: 'honored',
	honourable: 'honorable',
	favour: 'favor',
	favoured: 'favored',
	labour: 'labor',
	laboured: 'labored',
	neighbour: 'neighbor',
	neighbours: 'neighbors',
	colour: 'color',
	colours: 'colors',
	armour: 'armor',
	valour: 'valor',
	succour: 'succor',
	vapour: 'vapor',
	rigour: 'rigor',
	clamour: 'clamor',
	rumour: 'rumor',
	behaviour: 'behavior',
	endeavour: 'endeavor',
	musick: 'music',
	publick: 'public',
};

const MIN_LOWER = 3;

async function main() {
	const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
	const commit = process.env.COMMIT === '1';
	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	const envPath = join(ROOT, '.env');
	if (!existsSync(envPath)) {
		console.error('FATAL: root .env required');
		process.exit(1);
	}
	const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	const sql = postgres(url, { prepare: false, max: 1 });

	try {
		// Lowercase-attested corpus words with counts (G1/G3 base data).
		const words = await sql`
			SELECT lower(surface) AS w, count(*)::int AS n,
			       count(*) FILTER (WHERE surface = lower(surface))::int AS n_lower
			FROM lumen.words
			GROUP BY lower(surface)`;
		const attested = new Map(words.map((r) => [r.w, r.n_lower]));
		const ok = (w) => (attested.get(w) ?? 0) >= MIN_LOWER;

		const candidates = new Map(); // variant -> {modern, cls}
		const rejected = { unattested: 0, no_sibling: 0, proper_or_rare: 0 };

		for (const [w, nLower] of attested) {
			if (nLower < MIN_LOWER) continue; // G3
			let cands = [];
			let cls = null;
			if (w.length > 5 && w.endsWith('ieth')) {
				cands = [w.slice(0, -4) + 'y', w.slice(0, -2), w.slice(0, -3)];
				cls = 'eth';
			} else if (w.length > 4 && w.endsWith('eth')) {
				cands = [w.slice(0, -2), w.slice(0, -3)];
				cls = 'eth';
			} else if (w.length > 5 && w.endsWith('iest')) {
				cands = [w.slice(0, -4) + 'y', w.slice(0, -2), w.slice(0, -3)];
				cls = 'est';
			} else if (w.length > 5 && w.endsWith('edst')) {
				// DATC-2: base candidates FIRST. The past form (slice(0,-2),
				// 'delivered') is always attested so it won G1 first-match, but
				// its G2 siblings ('deliveredeth', …) can never attest — the
				// whole class shipped 0 of 429. Base forms: strip 'edst'
				// (deliveredst→deliver) or strip 'dst' for e-final stems
				// (desiredst→desire); past form kept as a last resort.
				cands = [w.slice(0, -4), w.slice(0, -3), w.slice(0, -2)];
				cls = 'edst';
			} else if (w.length > 4 && w.endsWith('est')) {
				cands = [w.slice(0, -2), w.slice(0, -3)];
				cls = 'est';
			} else {
				continue;
			}
			// Doubled-consonant class: sitteth → 'sitt' → also try 'sit'.
			for (const c of [...cands]) {
				if (/([bcdfghlmnprstv])\1$/.test(c)) cands.push(c.slice(0, -1));
			}
			const target = cands.find(ok); // G1, first-match priority
			if (!target) {
				rejected.unattested++;
				continue;
			}
			// G2: the target must show verb-family siblings sharing its stem —
			// kills superlatives (greatest→great: no greated/greating) and noun
			// false-positives (forest, harvest). English morphology: drop final
			// e before -ed/-ing (believe→believed/believing), allow consonant
			// doubling (sit→sitting), y→ied (cry→cried). The variant itself is
			// NEVER its own evidence.
			const stem = target.endsWith('e') ? target.slice(0, -1) : target;
			const last = target.slice(-1);
			const sibs = new Set([
				stem + 'ed', stem + 'ing', stem + 'eth',
				target + last + 'ed', target + last + 'ing', target + last + 'eth',
			]);
			if (target.endsWith('y')) sibs.add(target.slice(0, -1) + 'ied');
			sibs.delete(w);
			const sibling = [...sibs].some(ok);
			if (!sibling) {
				rejected.no_sibling++;
				continue;
			}
			candidates.set(w, { modern: target, cls });
		}

		for (const [v, m] of Object.entries(ORTHOGRAPHIC)) {
			if (attested.has(v)) candidates.set(v, { modern: m, cls: 'orthographic' });
		}
		for (const [v, m] of Object.entries(IRREGULARS)) {
			if (attested.has(v)) candidates.set(v, { modern: m, cls: 'irregular' });
		}

		// G4: chain resolution (sheweth→shew→show); cycle = fatal.
		for (const [v, entry] of candidates) {
			const seen = new Set([v]);
			while (candidates.has(entry.modern)) {
				if (seen.has(entry.modern)) {
					console.error(`FATAL: mapping cycle at ${v} → ${entry.modern}`);
					process.exit(2);
				}
				seen.add(entry.modern);
				entry.modern = candidates.get(entry.modern).modern;
			}
		}

		// G5: lexeme gates, evaluated server-side in one round trip.
		const entries = [...candidates.entries()];
		const gate = await sql`
			SELECT v.variant, v.modern,
			       to_tsvector('english', v.variant)::text AS vlex,
			       to_tsvector('english', v.modern)::text  AS mlex
			FROM jsonb_to_recordset(${sql.json(
					entries.map(([variant, e]) => ({ variant, modern: e.modern })),
				)}) AS v(variant text, modern text)`;
		const final = {};
		const dropped = [];
		for (const g of gate) {
			const mLexemes = g.mlex.match(/'[^']+'/g) ?? [];
			if (mLexemes.length !== 1 || g.mlex === g.vlex) {
				dropped.push(`${g.variant}→${g.modern} (${g.mlex || 'stopword'})`);
				continue;
			}
			final[g.variant] = g.modern;
		}

		// Histogram + eval report (strongs lesson: histogram ALL divergences).
		const byClass = {};
		for (const [v, e] of candidates) {
			if (!(v in final)) continue;
			byClass[e.cls] = (byClass[e.cls] ?? 0) + 1;
		}
		console.log(JSON.stringify({ event: 'kjv_variants_eval', classes: byClass, total: Object.keys(final).length, rejected, g5_dropped: dropped.length }));
		console.log(JSON.stringify({ event: 'kjv_variants_g5_drops', drops: dropped.slice(0, 40) }));
		// DATC-2: per-class floors (set just under the 2026-07-21 live counts) —
		// a silently dead class must fail the gate, not vanish into the histogram.
		const CLASS_FLOORS = { eth: 300, est: 60, edst: 5, orthographic: 22, irregular: 15 };
		let classFail = 0;
		for (const [cls, min] of Object.entries(CLASS_FLOORS)) {
			const got = byClass[cls] ?? 0;
			const pass = got >= min;
			if (!pass) classFail++;
			console.log(JSON.stringify({ event: 'class_floor_check', cls, min, got, pass }));
		}
		// Spot-check pins the harness also asserts (H16).
		const pins = { believeth: 'believe', spake: 'spoke', loveth: 'love', crieth: 'cry', sware: 'swore', goeth: 'go', shew: 'show' };
		let pinFail = 0;
		for (const [v, want] of Object.entries(pins)) {
			const got = final[v];
			const pass = got === want;
			if (!pass) pinFail++;
			console.log(JSON.stringify({ event: 'pin_check', variant: v, want, got: got ?? null, pass }));
		}

		if (commit) {
			const out = join(ROOT, 'data', 'kjv-variants.json');
			const sorted = Object.fromEntries(Object.entries(final).sort(([a], [b]) => a.localeCompare(b)));
			writeFileSync(out, JSON.stringify(sorted, null, '\t') + '\n');
			console.log(JSON.stringify({ event: 'kjv_variants_written', path: 'data/kjv-variants.json', count: Object.keys(sorted).length }));
		}
		await sql.end();
		process.exit(pinFail > 0 || classFail > 0 ? 2 : 0);
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
