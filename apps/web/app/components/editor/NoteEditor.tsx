/**
 * personal-notes — the ProseMirror editor chunk (A10/A11/A12/A13/A17/A19).
 * Loaded ONLY via React.lazy behind edit intent; nothing outside this
 * chunk may import it statically (A11). Owns:
 *  - the constrained PM view over noteSchema + markdown shortcuts
 *  - the reference auto-link rule (A12: boundary-char fire, undo
 *    suppression, polite announcements, never inside `[[` spans)
 *  - `[[` autocomplete + the ⌘K insert posture (Shape C: context sets the
 *    verb — Enter inserts, ⌘↵ navigates), one popup, combobox ARIA
 *  - paste conversion of Lumen URLs into wikilinks
 *  - autosave (G5: ≥3s idle debounce, blur/visibility flush, ⌘S forces,
 *    loud failure, buffer never lost) storing C(md) by construction
 *  - the round-trip canary (A19), the formatting legend (A17), and the
 *    data-loss error boundary (A19; beacon deliberately absent — recorded)
 */
import {
	Component,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";
import { useFetcher, useNavigate } from "react-router";
import { EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import {
	inputRules,
	textblockTypeInputRule,
	wrappingInputRule,
	InputRule,
} from "prosemirror-inputrules";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import type { MarkType } from "prosemirror-model";
import {
	noteSchema,
	parseNoteMarkdown,
	serializeNoteDoc,
	canonicalizeNoteMarkdown,
	insertLabel,
} from "./markdown";
import { findCanonReferences } from "./reference-rule";
import { suggestDestinations, type InsertSuggestion } from "./suggest";
import { lumenUrlToRef } from "./lumen-url";
import { resolveAnchorRef } from "@lumen/scripture/notes-refs";
import { pushEscape, installEscapeHandler } from "~/lib/escape-registry";
import { extractWikilinkRefs } from "~/lib/notes-derive";

export interface NoteEditorProps {
	noteId: string | null;
	initialBody: string;
	initialUpdatedAt: string | null;
	prefillAnchor: string | null;
	onClose: () => void;
	/** fires whenever the doc's wikilink ref-set changes — feeds the live
	 * composing rail (debounced upstream) */
	onRefsChange?: (refs: string[]) => void;
	/** `[id, title]` of the writer's OWN notes (current note excluded) —
	 * sources the `[[` notes leg and paste-a-note-URL labels */
	noteIndex?: ReadonlyArray<readonly [string, string]>;
	/** signed-out composing (Abram, 2026-07-31): everything works except
	 * SAVE — the buffer rides localStorage and survives the sign-in trip */
	guest?: boolean;
}

/** where a guest draft waits out the sign-in round trip */
export const GUEST_DRAFT_KEY = "lumen-guest-draft";

/* ─── mark input rules (**bold**, *italic*) ─── */

function markRule(pattern: RegExp, mark: MarkType): InputRule {
	return new InputRule(pattern, (state, match, start, end) => {
		const text = match[1];
		if (!text) return null;
		const tr = state.tr.delete(start, end);
		tr.insertText(text, start);
		tr.addMark(start, start + text.length, mark.create());
		tr.removeStoredMark(mark);
		return tr;
	});
}

/* ─── reference auto-link plugin (A12) ─── */

interface AutoLinkState {
	/** last auto-link, for Backspace = undo-the-rule */
	last: { from: number; text: string } | null;
	/** match texts the user un-linked — never re-fire while typed through */
	suppressed: Set<string>;
	announce: string | null;
}

const autoLinkKey = new PluginKey<AutoLinkState>("noteAutoLink");
const BOUNDARY = /[\s.,;:!?)\]}"'”’]/;

function makeAutoLinkPlugin(): Plugin<AutoLinkState> {
	return new Plugin<AutoLinkState>({
		key: autoLinkKey,
		state: {
			init: () => ({ last: null, suppressed: new Set(), announce: null }),
			apply(tr, value) {
				const meta = tr.getMeta(autoLinkKey) as Partial<AutoLinkState> | undefined;
				if (meta) return { ...value, announce: null, ...meta };
				if (!tr.docChanged) return value;
				// any later edit closes the Backspace-undo window — a stale
				// revert would surprise more than it helps (A12: "right after")
				return { ...value, last: null, announce: null };
			},
		},
		appendTransaction(trs, _old, state) {
			// fire only after ordinary typing transactions, never our own
			const typed = trs.some((tr) => tr.docChanged && !tr.getMeta(autoLinkKey));
			if (!typed) return null;
			const { $head, empty } = state.selection;
			if (!empty || !$head.parent.isTextblock) return null;
			// inert while the `[[` span is active
			if (autocompleteKey.getState(state)?.from !== null) return null;
			// one placeholder char per atom keeps index arithmetic aligned with
			// doc positions (wikilinks are atoms; U+FFFC never matches a ref)
			const text = $head.parent.textBetween(0, $head.parentOffset, undefined, "￼");
			if (text.length < 2) return null;
			const lastChar = text[text.length - 1];
			const isEnterBoundary = false;
			if (!BOUNDARY.test(lastChar) && !isEnterBoundary) return null;
			const upToBoundary = text.slice(0, -1);
			const matches = findCanonReferences(upToBoundary);
			const match = matches.find((m) => m.index + m.length === upToBoundary.length);
			if (!match) return null;
			// firing boundary (A12): a colon after a chapter match means the
			// verse number is still coming — "Alma 32:" must never link
			// "Alma 32" mid-keystroke.
			if (lastChar === ":" && match.kind === "chapter") return null;
			const pluginState = autoLinkKey.getState(state)!;
			if (pluginState.suppressed.has(match.text)) return null;
			const blockStart = $head.start();
			const from = blockStart + match.index;
			const to = from + match.length;
			// never fire across existing non-text content (wikilinks are atoms)
			let plain = true;
			state.doc.nodesBetween(from, to, (node) => {
				if (!node.isText && !node.isTextblock) plain = false;
			});
			if (!plain) return null;
			const node = noteSchema.nodes.wikilink.create({ ref: match.ref, label: match.text });
			const tr = state.tr.replaceWith(from, to, node);
			tr.setMeta(autoLinkKey, {
				last: { from, text: match.text },
				announce: `Linked to ${match.text} — Backspace to undo`,
			});
			return tr;
		},
		props: {
			handleKeyDown(view, event) {
				if (event.key !== "Backspace") return false;
				const ps = autoLinkKey.getState(view.state);
				const last = ps?.last;
				if (!last) return false;
				const { $head, empty } = view.state.selection;
				if (!empty) return false;
				const before = view.state.doc.nodeAt(last.from);
				if (before?.type.name !== "wikilink") return false;
				const after = last.from + before.nodeSize;
				// the cursor sits right after the link — or right after the
				// single boundary char whose typing fired the rule
				const atLink = $head.pos === after;
				const atBoundary =
					$head.pos === after + 1 && BOUNDARY.test(view.state.doc.textBetween(after, after + 1));
				if (atLink || atBoundary) {
					const tr = view.state.tr.replaceWith(last.from, after, noteSchema.text(last.text));
					const suppressed = new Set(ps!.suppressed);
					suppressed.add(last.text);
					tr.setMeta(autoLinkKey, { last: null, suppressed, announce: null });
					view.dispatch(tr);
					event.preventDefault();
					return true;
				}
				return false;
			},
		},
	});
}

/* ─── `[[` autocomplete + ⌘K insert posture (A10, Shape C) ─── */

interface AutocompleteState {
	/** doc position of the opening `[[`, or null when inactive */
	from: number | null;
	/** insert posture (⌘K): popup owns its own query input */
	insertPosture: boolean;
	storedSelection: { from: number; to: number; text: string } | null;
}

const autocompleteKey = new PluginKey<AutocompleteState>("noteAutocomplete");

function makeAutocompletePlugin(): Plugin<AutocompleteState> {
	return new Plugin<AutocompleteState>({
		key: autocompleteKey,
		state: {
			init: () => ({ from: null, insertPosture: false, storedSelection: null }),
			apply(tr, value) {
				const meta = tr.getMeta(autocompleteKey) as Partial<AutocompleteState> | undefined;
				let next = meta ? { ...value, ...meta } : value;
				if (next.from !== null && tr.docChanged && !meta) {
					next = { ...next, from: tr.mapping.map(next.from) };
				}
				// Deactivate when the caret leaves the span in EITHER direction or
				// `]]` closes it (B29/CP-31). Only the backwards case used to be
				// handled, so a hand-typed `[[alma-32-21]]` — or a click into a
				// later paragraph — left the span active forever, and the
				// auto-link rule is gated on exactly this (:97): reference
				// auto-linking died for the rest of the session.
				if (next.from !== null && !next.insertPosture) {
					const head = tr.selection.head;
					const size = tr.doc.content.size;
					const from = next.from;
					if (head < from + 2 || from > size || head > size) {
						next = { ...next, from: null };
					} else {
						const $from = tr.doc.resolve(from);
						const $head = tr.doc.resolve(head);
						// left the block the `[[` was typed in
						if (!$from.sameParent($head)) {
							next = { ...next, from: null };
						} else if (tr.doc.textBetween(from, head, undefined, "￼").includes("]]")) {
							// the writer closed the wikilink by hand
							next = { ...next, from: null };
						}
					}
				}
				return next;
			},
		},
		props: {
			handleTextInput(view, from, _to, text) {
				if (text !== "[") return false;
				const prev = view.state.doc.textBetween(Math.max(0, from - 1), from);
				if (prev === "[") {
					// activate: span starts at the first `[`
					setTimeout(() => {
						view.dispatch(
							view.state.tr.setMeta(autocompleteKey, {
								from: from - 1,
								insertPosture: false,
								storedSelection: null,
							}),
						);
					}, 0);
				}
				return false;
			},
		},
	});
}

function autocompleteQuery(state: EditorState): string {
	const ps = autocompleteKey.getState(state);
	if (!ps || ps.from === null || ps.insertPosture) return "";
	const head = state.selection.head;
	if (head < ps.from + 2) return "";
	return state.doc.textBetween(ps.from + 2, head, undefined, "￼");
}

/* ─── paste conversion (mechanism 4) lives in ./lumen-url (origin-gated) ─── */

/* ─── combobox ARIA on the focused element (A10 / B10) ─── */

const LISTBOX_ID = "note-insert-listbox";
const EDITOR_CLASS =
	"note-editor outline-none font-reading text-[17px] leading-relaxed text-ink min-h-[16rem]";

/** live listbox facts the PM `attributes` function cannot read off plugin
 * state (they live in React): whether a listbox is rendered, and which
 * option is active. */
interface ComboState {
	expanded: boolean;
	activeId: string | null;
}

/** PM-managed attributes stay STATIC. The combobox ARIA is applied
 * imperatively (below) because PM re-applies this map on every redraw, and
 * each re-application of aria-controls/aria-activedescendant triggers
 * Chromium's native reveal-scroll — hundreds of px per keystroke in a tall
 * note (B11's true root cause). */
function editorAttributes(): Record<string, string> {
	return { class: EDITOR_CLASS };
}

/** Popup box geometry (B11): width of the panel and the gap it keeps from
 * the caret and the viewport edges. */
const POPUP_W = 320;
const POPUP_GAP = 4;
const POPUP_EDGE = 8;
/** worst-case panel height (max-h-72 list + input + foot line) — used only
 * to decide the flip, never to size the box */
const POPUP_MAX_H = 360;

/**
 * Position the popup at the caret, clamped to the viewport, flipped above
 * the caret when it would clip the bottom (B11/CP-12). `fixed` because the
 * coordinates `coordsAtPos` returns are viewport coordinates; with no
 * anchor yet the box sits at the top-left of the editor's flow, which is
 * the old behavior and never off-screen.
 */
function popupStyle(anchor: { left: number; top: number; flipUp: boolean } | null): CSSProperties {
	// position:fixed with viewport coords — a fixed box can't be scrolled
	// "into view", so Chromium's native reveals (aria idrefs, focus) no-op
	// against it. The historical page-jumps came from the popup existing
	// UNPLACED for a frame and from PM re-applying ARIA per redraw — both
	// now structurally impossible (anchor-gated mount, imperative ARIA).
	if (!anchor) return { position: "fixed", left: 0, top: 0, zIndex: 20, visibility: "hidden" };
	return anchor.flipUp
		? { position: "fixed", left: anchor.left, bottom: anchor.top, zIndex: 20 }
		: { position: "fixed", left: anchor.left, top: anchor.top, zIndex: 20 };
}

/* ─── error boundary (A19/CF-51): data-loss containment first ─── */

class EditorBoundary extends Component<
	{ latestMarkdown: () => string; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		if (!this.state.failed) return this.props.children;
		return (
			<div>
				<p className="font-ui text-sm text-muted-foreground" role="alert">
					The editor hit an error. Your writing is preserved below — copy it or reload.
				</p>
				<textarea
					readOnly
					defaultValue={this.props.latestMarkdown()}
					rows={14}
					aria-label="Note markdown (read-only)"
					className="mt-3 w-full resize-y rounded-md border border-rule2 bg-transparent p-3 font-mono text-sm text-ink"
				/>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="mt-3 font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-ink"
				>
					Reload
				</button>
			</div>
		);
	}
}

/* ─── the editor ─── */

const FMT_COUNT_KEY = "lumen:fmt-count";

function PMEditor(props: NoteEditorProps & { onMarkdown?: (md: string) => void }) {
	const {
		noteId,
		initialBody,
		initialUpdatedAt,
		prefillAnchor,
		onClose,
		onMarkdown,
		onRefsChange,
		noteIndex,
		guest = false,
	} = props;
	// the mount-effect closure (handlePaste) reads the CURRENT index
	const noteIndexRef = useRef(noteIndex);
	noteIndexRef.current = noteIndex;
	const lastRefsKeyRef = useRef<string | null>(null);
	const reportRefs = (md: string) => {
		if (!onRefsChange) return;
		const refs = extractWikilinkRefs(md);
		const key = refs.join(" ");
		if (key !== lastRefsKeyRef.current) {
			lastRefsKeyRef.current = key;
			onRefsChange(refs);
		}
	};
	const fetcher = useFetcher<{
		ok?: boolean;
		updated_at?: string;
		code?: string;
		current?: { body_md: string; updated_at: string };
	}>();
	const navigate = useNavigate();
	const mountRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const baseRef = useRef(initialUpdatedAt);
	const latestMdRef = useRef(initialBody);
	// A19 canary: the LOADED body and its reserialization, captured at mount.
	// `sent` makes it report ONCE per editor session (B49/CP-60) — the old
	// clear-on-success re-sent the same event on every failed retry.
	const canaryRef = useRef<{
		mismatch: boolean;
		stored: string;
		reserialized: string;
		sent: boolean;
		sha: string | null;
	} | null>(null);
	const [dirty, setDirty] = useState(false);
	// B3/CP-4: a 409 is a fork, not a dead end — the server's current row is
	// held here and the writer picks a door (keep mine = LWW overwrite per
	// D6; load theirs = adopt). Neither destroys the buffer silently.
	const [stale, setStale] = useState<{ body_md: string; updated_at: string } | null>(null);
	const [announce, setAnnounce] = useState<string | null>(null);
	const [popup, setPopup] = useState<{
		insertPosture: boolean;
		query: string;
		storedSelection: { from: number; to: number; text: string } | null;
	} | null>(null);
	// caret anchor for the popup (B11): viewport coords of the selection head
	const [anchor, setAnchor] = useState<{ left: number; top: number; flipUp: boolean } | null>(null);
	const [insertQuery, setInsertQuery] = useState("");
	const [highlight, setHighlight] = useState(0);
	const [fmtCount, setFmtCount] = useState(() => {
		try {
			return Number(localStorage.getItem(FMT_COUNT_KEY) ?? "0");
		} catch {
			return 3;
		}
	});
	const dirtyRef = useRef(false);
	const savingRef = useRef(false);
	// B1 (CP-1): the autosave state machine. Every doc change bumps the edit
	// generation and re-arms the idle timer (true ≥3s-idle debounce, G5); a
	// save snapshots the generation it covers, and success only clears dirty
	// when no keystrokes landed mid-flight — otherwise a follow-up save is
	// scheduled. The buffer can never be marked clean unseen.
	const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const editGenRef = useRef(0);
	const inflightGenRef = useRef(0);
	const armIdleTimer = (ms: number) => {
		if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
		idleTimerRef.current = setTimeout(() => saveRef.current(), ms);
	};
	// PM keymap handlers run outside React — they read the popup state
	// through refs kept current on every render.
	const comboRef = useRef<ComboState>({ expanded: false, activeId: null });
	const popupWrapRef = useRef<HTMLDivElement>(null);
	const popupBoxRef = useRef<HTMLDivElement>(null);
	const closePopupRef = useRef<() => void>(() => {});
	const suggestionsRef = useRef<InsertSuggestion[]>([]);
	const highlightRef = useRef(0);
	const commitRef = useRef<(s: InsertSuggestion, nav: boolean) => void>(() => {});
	const moveHighlightRef = useRef<(delta: number) => void>(() => {});

	// After a create-redirect the SAME route component carries on editing —
	// adopt the fresh row's updated_at as the LWW base.
	useEffect(() => {
		if (initialUpdatedAt && !baseRef.current) baseRef.current = initialUpdatedAt;
	}, [initialUpdatedAt]);

	// B50/CP-61: an aria-live region only announces when its text CHANGES.
	// Pasting the same URL twice, or re-typing the same reference, produced
	// the identical string and therefore silence. A zero-width space that
	// alternates on every call guarantees a DOM mutation; the ZWSP is not
	// spoken, so the announcement itself is unchanged.
	const announceParityRef = useRef(false);
	const say = (message: string) => {
		// alternate on the PREVIOUS value, not call parity — extra renders or
		// double-calls can never make two consecutive announcements identical
		setAnnounce((prev) => (prev === message ? message + "\u200B" : message));
	};

	const bumpFmt = () => {
		setFmtCount((c) => {
			const n = c + 1;
			try {
				localStorage.setItem(FMT_COUNT_KEY, String(n));
			} catch {
				// legend just stays
			}
			return n;
		});
	};

	const currentMarkdown = () => {
		const view = viewRef.current;
		return view ? serializeNoteDoc(view.state.doc) : latestMdRef.current;
	};

	const save = (explicit?: unknown) => {
		if (guest) {
			// only DELIBERATE saves speak; blur/visibility flushes stay silent
			if (explicit) say("Sign in to save — your draft is kept on this device");
			return;
		}
		if (savingRef.current) return;
		inflightGenRef.current = editGenRef.current;
		const body = currentMarkdown();
		latestMdRef.current = body;
		const form = new FormData();
		if (noteId === null) {
			form.set("intent", "create");
			form.set("body_md", body);
			if (prefillAnchor) form.append("anchor", prefillAnchor);
			savingRef.current = true;
			fetcher.submit(form, { method: "post", action: "/notes/new" });
			return;
		}
		form.set("intent", "update");
		form.set("body_md", body);
		form.set("base_updated_at", baseRef.current ?? "");
		// body anchors ride every save: wikilinks in the doc become anchor rows
		for (const ref of collectBodyRefs(body)) form.append("anchor", ref);
		form.set("sync_anchors", "1");
		// A19 round-trip canary: hash-only fields, never the body. Every field
		// describes the LOADED body against its reserialization — never the
		// buffer being saved — and rides exactly one submit (B49/CP-60).
		const canary = canaryRef.current;
		if (canary?.mismatch && !canary.sent) {
			canary.sent = true;
			form.set("roundtrip_ok", "false");
			form.set("rt_len_stored", String(canary.stored.length));
			form.set("rt_len_reserialized", String(canary.reserialized.length));
			form.set("rt_first_diff", String(firstDiff(canary.stored, canary.reserialized)));
			// hash of the LOADED body, computed client-side at mount — the
			// server never holds that body at log time (B49 server half)
			if (canary.sha) form.set("rt_sha", canary.sha);
		}
		savingRef.current = true;
		fetcher.submit(form, { method: "post", action: `/notes/${noteId}` });
	};
	const saveRef = useRef(save);
	saveRef.current = save;

	// mount the PM view once
	useEffect(() => {
		let startBody = initialBody;
		if (noteId === null && initialBody === "") {
			// a draft waiting out the sign-in trip (or a guest mid-compose)
			try {
				startBody = localStorage.getItem(GUEST_DRAFT_KEY) ?? "";
			} catch {
				startBody = "";
			}
		}
		const doc = parseNoteMarkdown(
			prefillAnchor && startBody === "" ? `[[${prefillAnchor}]]\n` : startBody,
		);
		if (startBody !== initialBody) {
			latestMdRef.current = startBody;
			onMarkdown?.(startBody);
			reportRefs(startBody);
			dirtyRef.current = true;
			// the signed-in return leg: the restored draft saves itself
			if (!guest) armIdleTimer(1500);
		}
		// A19: the canary — compare C(loaded) to loaded, report on next save
		const reserialized = canonicalizeNoteMarkdown(initialBody);
		canaryRef.current = {
			mismatch: initialBody !== "" && reserialized !== initialBody,
			stored: initialBody,
			reserialized,
			sent: false,
			sha: null,
		};
		if (canaryRef.current.mismatch && typeof crypto !== "undefined" && crypto.subtle) {
			crypto.subtle.digest("SHA-256", new TextEncoder().encode(initialBody)).then((d) => {
				const hex = [...new Uint8Array(d)]
					.slice(0, 8)
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
				if (canaryRef.current) canaryRef.current.sha = hex;
			});
		}

		const state = EditorState.create({
			doc,
			plugins: [
				history(),
				makeAutocompletePlugin(),
				makeAutoLinkPlugin(),
				inputRules({
					rules: [
						textblockTypeInputRule(/^(#{1,3})\s$/, noteSchema.nodes.heading, (m) => ({
							level: m[1].length,
						})),
						wrappingInputRule(/^\s*([-+*])\s$/, noteSchema.nodes.bullet_list),
						wrappingInputRule(/^\s*(\d+)\.\s$/, noteSchema.nodes.ordered_list, (m) => ({
							order: Number(m[1]),
						})),
						wrappingInputRule(/^\s*>\s$/, noteSchema.nodes.blockquote),
						markRule(/\*\*([^*]+)\*\*$/, noteSchema.marks.strong),
						markRule(/(?<!\*)\*([^*\s][^*]*)\*$/, noteSchema.marks.em),
					],
				}),
				keymap({
					"Mod-b": (s, d) => {
						bumpFmt();
						return toggleMark(noteSchema.marks.strong)(s, d);
					},
					"Mod-i": (s, d) => {
						bumpFmt();
						return toggleMark(noteSchema.marks.em)(s, d);
					},
					"Mod-z": undo,
					"Shift-Mod-z": redo,
					"Mod-s": () => {
						saveRef.current(true);
						return true;
					},
					// popup keys live in the PM keymap — a React handler on the
					// wrapper loses the race against PM's own Enter handling
					ArrowDown: (s) => {
						if (autocompleteKey.getState(s)?.from === null) return false;
						moveHighlightRef.current(1);
						return true;
					},
					ArrowUp: (s) => {
						if (autocompleteKey.getState(s)?.from === null) return false;
						moveHighlightRef.current(-1);
						return true;
					},
					"Mod-Enter": (s) => {
						if (autocompleteKey.getState(s)?.from === null) return false;
						if (suggestionsRef.current.length === 0) return true;
						commitRef.current(suggestionsRef.current[highlightRef.current], true);
						return true;
					},
					Enter: (s, d, v) => {
						const ac = autocompleteKey.getState(s);
						if (ac && ac.from !== null && suggestionsRef.current.length > 0) {
							commitRef.current(suggestionsRef.current[highlightRef.current], false);
							return true;
						}
						return splitListItem(noteSchema.nodes.list_item)(s, d, v);
					},
					Tab: sinkListItem(noteSchema.nodes.list_item),
					"Shift-Tab": liftListItem(noteSchema.nodes.list_item),
					// Shape C (gate-ratified): inside the editor ⌘K opens the
					// insert posture — Enter inserts, ⌘↵ navigates.
					"Mod-k": (s, dispatch, view) => {
						if (!view) return false;
						const { from, to } = s.selection;
						const text = s.doc.textBetween(from, to, " ");
						dispatch?.(
							s.tr.setMeta(autocompleteKey, {
								from: null,
								insertPosture: true,
								storedSelection: { from, to, text },
							}),
						);
						return true;
					},
				}),
				keymap(baseKeymap),
			],
		});

		const view = new EditorView(mountRef.current!, {
			state,
			// B10/CP-11 + CP-62: the combobox contract belongs on the FOCUSED
			// element. In the `[[` posture that element is this contenteditable,
			// so the attributes are computed from plugin state here (and from
			// the live listbox state through comboRef) — never on a role-less
			// wrapper div, where `aria-activedescendant` is inert.
			attributes: editorAttributes(),
			handlePaste(view, event) {
				const text = event.clipboardData?.getData("text/plain") ?? "";
				const ref = lumenUrlToRef(text);
				// any OTHER absolute http(s) URL pastes as an external link:
				// over a selection the selection is the label; bare, the URL
				// text itself carries the mark (honest, Obsidian-like)
				if (!ref) {
					const ext = /^https?:\/\/\S+$/.test(text.trim()) ? text.trim() : null;
					if (!ext) return false;
					const { from, to } = view.state.selection;
					const mark = noteSchema.marks.link.create({ href: ext });
					if (from !== to) {
						view.dispatch(view.state.tr.addMark(from, to, mark));
					} else {
						view.dispatch(view.state.tr.replaceSelectionWith(noteSchema.text(ext, [mark]), false));
					}
					say("Pasted as link");
					return true;
				}
				const { from, to } = view.state.selection;
				const selText = view.state.doc.textBetween(from, to, " ");
				const anchor = resolveAnchorRef(ref)!;
				// B47/CP-52: the label the writer sees IS the label that gets
				// stored — sanitize at the insert site, not only at serialize.
				// A pasted note URL takes the note's TITLE (uuid labels are noise).
				const noteTitle =
					anchor.kind === "note"
						? noteIndexRef.current?.find(([id]) => `note:${id}` === anchor.ref)?.[1]
						: undefined;
				const label = insertLabel(
					selText.trim() !== "" ? selText : (noteTitle ?? null),
					anchor.ref,
				);
				view.dispatch(
					view.state.tr.replaceSelectionWith(
						noteSchema.nodes.wikilink.create({ ref: anchor.ref, label }),
					),
				);
				say("Pasted as link — Backspace to undo");
				return true;
			},
			dispatchTransaction(tr: Transaction) {
				const view = viewRef.current!;
				const newState = view.state.apply(tr);
				view.updateState(newState);
				if (tr.docChanged) {
					dirtyRef.current = true;
					setDirty(true);
					editGenRef.current += 1;
					latestMdRef.current = serializeNoteDoc(newState.doc);
					onMarkdown?.(latestMdRef.current);
					reportRefs(latestMdRef.current);
					if (guest) {
						// the draft IS the persistence layer for a guest
						try {
							localStorage.setItem(GUEST_DRAFT_KEY, latestMdRef.current);
						} catch {
							/* private mode — the buffer still lives in memory */
						}
					} else {
						// idle-based debounce: every keystroke re-arms the window
						armIdleTimer(3000);
					}
				}
				const al = autoLinkKey.getState(newState);
				if (al?.announce) say(al.announce);
				const ac = autocompleteKey.getState(newState);
				if (ac && (ac.from !== null || ac.insertPosture)) {
					setPopup({
						insertPosture: ac.insertPosture,
						query: ac.insertPosture ? "" : autocompleteQuery(newState),
						storedSelection: ac.storedSelection,
					});
				} else {
					setPopup(null);
				}
			},
		});
		// iOS callout formatting (A17): route formatBold/formatItalic
		// beforeinput events into PM marks — device checklist item Q6.
		const beforeInput = (e: InputEvent) => {
			if (e.inputType === "formatBold" || e.inputType === "formatItalic") {
				e.preventDefault();
				const mark =
					e.inputType === "formatBold" ? noteSchema.marks.strong : noteSchema.marks.em;
				toggleMark(mark)(view.state, view.dispatch);
				bumpFmt();
			}
		};
		view.dom.addEventListener("beforeinput", beforeInput);
		viewRef.current = view;
		view.focus();
		// seed the composing rail with the initial doc's refs
		reportRefs(serializeNoteDoc(view.state.doc));
		return () => {
			view.dom.removeEventListener("beforeinput", beforeInput);
			view.destroy();
			viewRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// (idle-debounce autosave is armed imperatively in dispatchTransaction —
	// a ref in a dep array is inert and setDirty(true→true) bails, which is
	// exactly the CP-1 bug this replaces)
	useEffect(() => {
		return () => {
			if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
		};
	}, []);

	// flush on blur/navigation/visibilitychange (G5)
	useEffect(() => {
		const flush = () => {
			if (dirtyRef.current && !savingRef.current) saveRef.current();
		};
		const onVis = () => {
			if (document.visibilityState === "hidden") flush();
		};
		window.addEventListener("blur", flush);
		document.addEventListener("visibilitychange", onVis);
		return () => {
			flush();
			window.removeEventListener("blur", flush);
			document.removeEventListener("visibilitychange", onVis);
		};
	}, []);

	// save results
	useEffect(() => {
		if (fetcher.state !== "idle") return;
		savingRef.current = false;
		const d = fetcher.data;
		if (!d) return;
		if (d.updated_at) {
			try {
				localStorage.removeItem(GUEST_DRAFT_KEY);
			} catch {
				/* private mode */
			}
			baseRef.current = d.updated_at;
			// (the canary's own `sent` flag is what makes it report once — it is
			// set at submit time, so a failed save can never re-fire it: B49)
			if (editGenRef.current === inflightGenRef.current) {
				dirtyRef.current = false;
				setDirty(false);
			} else {
				// keystrokes landed while the save was in flight — the buffer
				// stays dirty and a follow-up save covers them promptly (CP-1)
				armIdleTimer(800);
			}
		} else if (d.code === "stale" && d.current) {
			// never auto-retry a stale base — that's the 409 loop (CP-4)
			setStale(d.current);
		} else if (d.code !== undefined && dirtyRef.current) {
			// failed save: buffer preserved, loud state shown, and a real
			// retry actually fires (the old machine never re-armed)
			armIdleTimer(5000);
		}
	}, [fetcher.state, fetcher.data]);

	const resolveStale = (keepMine: boolean) => {
		if (!stale) return;
		baseRef.current = stale.updated_at;
		if (keepMine) {
			setStale(null);
			save(); // LWW: this editor becomes the last writer (D6)
			return;
		}
		const view = viewRef.current;
		if (view) {
			const doc = parseNoteMarkdown(stale.body_md);
			view.updateState(EditorState.create({ doc, plugins: view.state.plugins }));
			latestMdRef.current = stale.body_md;
			onMarkdown?.(stale.body_md);
		}
		dirtyRef.current = false;
		setDirty(false);
		setStale(null);
	};

	// THE close path — one function, every door (Esc, outside pointerdown).
	// A10/CF-13: focus + selection restore on ANY close.
	const closePopup = () => {
		const view = viewRef.current;
		if (!view) {
			setPopup(null);
			setInsertQuery("");
			return;
		}
		const ac = autocompleteKey.getState(view.state);
		const tr = view.state.tr.setMeta(autocompleteKey, {
			from: null,
			insertPosture: false,
			storedSelection: null,
		});
		view.dispatch(tr);
		if (ac?.storedSelection) {
			const sel = TextSelection.create(
				view.state.doc,
				Math.min(ac.storedSelection.from, view.state.doc.content.size),
				Math.min(ac.storedSelection.to, view.state.doc.content.size),
			);
			view.dispatch(view.state.tr.setSelection(sel));
		}
		view.focus();
		setPopup(null);
		setInsertQuery("");
	};
	closePopupRef.current = closePopup;

	// escape registry: the popup is an escapable layer (A10)
	useEffect(() => {
		if (!popup) return;
		return pushEscape({ onEscape: () => closePopupRef.current() });
	}, [popup !== null]);

	// B51/CP-64: clicking away from the ⌘K palette dismisses it down the SAME
	// path as Esc — otherwise the popup stays mounted with aria-expanded=true
	// over a stale stored selection, and a later Esc jumps the caret back.
	// (The `[[` posture needs no listener: a click moves the caret out of the
	// span, which deactivates it — B29.)
	useEffect(() => {
		if (!popup?.insertPosture) return;
		const onDown = (e: Event) => {
			const box = popupBoxRef.current;
			const target = e.target as globalThis.Node | null;
			if (box && target && box.contains(target)) return;
			// A10 restores focus + selection on EVERY close, so a click on dead
			// space must not then hand focus to the body: swallow that pointer.
			// A click on something interactive keeps its default — the writer
			// asked to go there, and the restore would be a hijack.
			const el = target instanceof Element ? target : null;
			const interactive = el?.closest(
				"a,button,input,textarea,select,summary,[tabindex],[contenteditable]",
			);
			if (!interactive) e.preventDefault();
			closePopupRef.current();
		};
		document.addEventListener("pointerdown", onDown, true);
		return () => document.removeEventListener("pointerdown", onDown, true);
	}, [popup?.insertPosture]);

	// global Esc → registry (innermost layer only; inert when empty).
	// B16/CP-17: the pop is SYNCHRONOUS — an async hop lands after dispatch,
	// where preventDefault is a no-op and every other listener has run.
	useEffect(() => installEscapeHandler(document), []);

	// B54: Chromium natively smooth-scrolls the page toward the foot of a
	// taller-than-viewport contenteditable on a keystroke — no JS caller
	// (every scroll API trapped, silent) and it reproduces at the pre-feature
	// baseline, content-independent. When the caret was already visible that
	// animation is pure displacement: snap back to the keystroke's scroll
	// position. Small nudges (a line entering view at the fold) and genuine
	// reveals (caret off-screen) pass through untouched.
	useEffect(() => {
		let at = 0; // last keystroke that had a visible caret
		let y = 0; // page scrollY at that keystroke
		const KEEP_MS = 700; // the native ease runs ~500ms
		const SLACK_PX = 160; // legitimate caret-following stays a few lines
		const onKey = () => {
			const view = viewRef.current;
			if (!view || !view.hasFocus()) return;
			try {
				const c = view.coordsAtPos(view.state.selection.head);
				const visible = c.top >= 0 && c.bottom <= window.innerHeight;
				at = visible ? performance.now() : 0;
				y = window.scrollY;
			} catch {
				at = 0;
			}
		};
		const onScroll = () => {
			if (at === 0 || performance.now() - at > KEEP_MS) return;
			if (Math.abs(window.scrollY - y) <= SLACK_PX) return;
			window.scrollTo({ top: y, left: window.scrollX, behavior: "instant" });
		};
		document.addEventListener("keydown", onKey, true);
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			document.removeEventListener("keydown", onKey, true);
			window.removeEventListener("scroll", onScroll);
		};
	}, []);

	const suggestions = useMemo(
		() =>
			popup
				? suggestDestinations(popup.insertPosture ? insertQuery : popup.query, noteIndex)
				: [],
		[popup, insertQuery, noteIndex],
	);
	// B48/CP-53: reset on list IDENTITY, not length — "alma 3" → "mosiah 3"
	// yields equal-length lists with entirely different destinations, and a
	// stale highlight index makes Enter insert somewhere the writer never
	// looked. (The lists routinely share a length; that is the fixture.)
	const suggestionsKey = useMemo(() => suggestions.map((s) => s.ref).join(" "), [suggestions]);
	useEffect(() => setHighlight(0), [suggestionsKey]);
	// the list scrolls (no result cap) — keep the active option in view
	useEffect(() => {
		// container-only scrolling: scrollIntoView walks ancestors and was
		// dragging the PAGE hundreds of px per keystroke with the popup open —
		// manual scrollTop on the listbox physically cannot touch the page
		const el = document.getElementById(`note-insert-opt-${highlight}`);
		const listbox = document.getElementById("note-insert-listbox");
		if (!el || !listbox) return;
		const elTop = el.offsetTop;
		const elBottom = elTop + el.offsetHeight;
		if (elTop < listbox.scrollTop) listbox.scrollTop = elTop;
		else if (elBottom > listbox.scrollTop + listbox.clientHeight) {
			listbox.scrollTop = elBottom - listbox.clientHeight;
		}
	}, [highlight, suggestions]);
	suggestionsRef.current = suggestions;
	highlightRef.current = highlight;

	// B10: keep the focused element's combobox attributes in step with the
	// listbox React owns (the PM `attributes` function reads comboRef).
	// anchor-gated: until the caret anchor is measured the popup DOM must not
	// exist at all — its unplaced geometry sits at the editor's FOOT, and
	// Chromium's async reveal of a fresh aria-controls target scrolls the
	// page there (the B11 late-jump root cause)
	const listboxOpen = popup !== null && anchor !== null && suggestions.length > 0;
	// standard combobox pattern: the active option is exposed whenever the
	// listbox is open. (An earlier deferred-until-arrowed variant existed to
	// dodge a Chromium reveal-scroll wrongly attributed to this attribute —
	// the actual trigger was the keystroke-reveal the B54 guard now cancels.)
	const activeOptionId = listboxOpen ? `note-insert-opt-${highlight}` : null;
	comboRef.current = { expanded: listboxOpen, activeId: activeOptionId };
	useEffect(() => {
		// imperative ARIA on the focused contenteditable (B10), applied ONLY on
		// real value changes — see editorAttributes for why PM must not manage
		// these (Chromium reveal-scroll per re-application)
		const dom = viewRef.current?.dom;
		if (!dom) return;
		const setAttr = (name: string, value: string | null) => {
			if (value === null) {
				if (dom.hasAttribute(name)) dom.removeAttribute(name);
			} else if (dom.getAttribute(name) !== value) {
				dom.setAttribute(name, value);
			}
		};
		setAttr("aria-label", "Note");
		// the combobox posture tracks the ACTIVE SPAN, not the listbox: with a
		// query that matches nothing the writer is still inside `[[` — the
		// editor stays a combobox and aria-expanded says "no list" (B36).
		// aria-controls only while its target exists (axe: valid idref).
		const comboActive = popup !== null && !popup.insertPosture;
		if (comboActive) {
			setAttr("role", "combobox");
			setAttr("aria-multiline", null);
			setAttr("aria-autocomplete", "list");
			setAttr("aria-haspopup", "listbox");
			setAttr("aria-expanded", listboxOpen ? "true" : "false");
			setAttr("aria-controls", listboxOpen ? LISTBOX_ID : null);
			setAttr("aria-activedescendant", activeOptionId);
		} else {
			setAttr("role", "textbox");
			setAttr("aria-multiline", "true");
			setAttr("aria-autocomplete", null);
			setAttr("aria-haspopup", null);
			setAttr("aria-expanded", null);
			setAttr("aria-controls", null);
			setAttr("aria-activedescendant", null);
		}
	}, [listboxOpen, activeOptionId, popup === null, popup?.insertPosture]);

	// B11/CP-12: anchor the popup at the CARET, not the editor's foot — in a
	// note taller than the viewport the foot placement opened the listbox
	// off-screen and the universal insert door (A9) read as broken.
	useEffect(() => {
		if (!popup) {
			setAnchor(null);
			return;
		}
		const place = () => {
			const view = viewRef.current;
			if (!view) return;
			try {
				const c = view.coordsAtPos(view.state.selection.head);
				const roomBelow = window.innerHeight - c.bottom;
				const flipUp = roomBelow < POPUP_MAX_H && c.top > POPUP_MAX_H;
				const left = Math.max(POPUP_EDGE, Math.min(c.left, window.innerWidth - POPUP_W - POPUP_EDGE));
				setAnchor(
					flipUp
						? { left, top: window.innerHeight - c.top + POPUP_GAP, flipUp: true }
						: { left, top: c.bottom + POPUP_GAP, flipUp: false },
				);
			} catch {
				// position no longer in the doc — leave the last known anchor
			}
		};
		place();
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [popup]);
	moveHighlightRef.current = (delta: number) => {
		setHighlight((h) => Math.max(0, Math.min(h + delta, Math.max(0, suggestions.length - 1))));
	};

	const commitSuggestion = (s: InsertSuggestion, navigateInstead: boolean) => {
		const view = viewRef.current;
		if (!view) return;
		if (navigateInstead) {
			// ⌘↵ navigates — autosave has flushed the draft, so leaving is safe
			if (dirtyRef.current) saveRef.current();
			if (s.path) navigate(s.path);
			return;
		}
		const ac = autocompleteKey.getState(view.state) ?? {
			from: null,
			insertPosture: false,
			storedSelection: null,
		};
		// B47/CP-52: the stored selection is the writer's own text — it must be
		// sanitized to the label grammar HERE, or the doc shows `a|b` while
		// storage silently keeps `ab` and the reload rewrites the note.
		const rawLabel =
			ac.storedSelection?.text && ac.storedSelection.text.trim() !== ""
				? ac.storedSelection.text
				: s.display !== s.ref
					? s.display
					: null;
		const label = insertLabel(rawLabel, s.ref);
		const node = noteSchema.nodes.wikilink.create({ ref: s.ref, label });
		let tr = view.state.tr;
		if (ac.insertPosture && ac.storedSelection) {
			tr = tr.replaceWith(ac.storedSelection.from, ac.storedSelection.to, node);
		} else if (ac.from !== null) {
			tr = tr.replaceWith(ac.from, view.state.selection.head, node);
		} else {
			tr = tr.replaceSelectionWith(node);
		}
		tr.setMeta(autocompleteKey, { from: null, insertPosture: false, storedSelection: null });
		view.dispatch(tr);
		view.focus();
		say(`Inserted link to ${s.display}`);
		setPopup(null);
		setInsertQuery("");
	};
	commitRef.current = commitSuggestion;

	const failed =
		fetcher.state === "idle" && fetcher.data !== undefined && fetcher.data.ok !== true &&
		fetcher.data.updated_at === undefined && noteId !== null && fetcher.data.code !== undefined &&
		stale === null;

	return (
		<div>
			{/* ONE polite status region (A12): terse announcements, silence for non-refs */}
			<div aria-live="polite" className="sr-only">
				{announce ?? ""}
			</div>

			{/* B10: the combobox ARIA lives on the contenteditable PM mounts
			    inside here (the focused element) — never on this wrapper. */}
			<div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-rule pb-3">
				{guest ? (
					<>
						<a
							href="/login?next=%2Fnotes%2Fnew"
							className="font-ui text-sm text-ink underline decoration-dotted underline-offset-4 hover:text-primary"
						>
							Sign in to save
						</a>
						<span className="font-ui text-[12px] text-muted-foreground">
							{dirty ? "Draft kept on this device" : "Nothing written yet"}
						</span>
					</>
				) : noteId !== null ? (
					<button
						type="button"
						onClick={onClose}
						className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-ink"
					>
						Done
					</button>
				) : (
					<button
						type="button"
						onClick={save}
						className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-ink"
					>
						Save
					</button>
				)}
				{!guest && (
				<>
				<span aria-live="polite" className="font-ui text-[12px] text-muted-foreground">
					{fetcher.state !== "idle"
						? "Saving…"
						: stale
							? "Changed elsewhere"
							: failed
								? "Save failed — edits kept, retrying on next change"
								: dirty
									? "Unsaved"
									: "Saved"}
				</span>
				{stale && (
					<>
						<button
							type="button"
							onClick={() => resolveStale(true)}
							className="font-ui text-[11px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-ink"
						>
							Keep mine
						</button>
						<button
							type="button"
							onClick={() => resolveStale(false)}
							className="font-ui text-[11px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-ink"
						>
							Load theirs
						</button>
					</>
				)}
				</>
				)}
				{failed && (
					<button
						type="button"
						onClick={save}
						className="font-ui text-[11px] font-semibold text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-ink"
					>
						Retry
					</button>
				)}
				{/* A17: the one-line typographic legend, earned-quiet after ~3 formats */}
				{fmtCount < 3 && (
					<span className="ml-auto font-ui text-[11px] text-muted-foreground">
						<strong className="font-semibold">⌘B</strong> bold · <em>⌘I italic</em> · # heading ·
						- list · &gt; quote · [[ link
					</span>
				)}
			</div>
			<div ref={mountRef} />

			{/* caret-anchored popup: zero-height relative wrapper right after the
			    editor; the popup positions absolutely inside it (never fixed) */}
			<div ref={popupWrapRef} className="relative h-0">
			{popup && anchor && (
				<div style={popupStyle(anchor)}>
					<div
						ref={popupBoxRef}
						className="w-80 max-w-[calc(100vw-1rem)] rounded-md border border-rule2 bg-panel p-1 shadow-sm"
					>
						{popup.insertPosture && (
							<input
								autoFocus
								value={insertQuery}
								onChange={(e) => setInsertQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "ArrowDown") {
										e.preventDefault();
										setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
									} else if (e.key === "ArrowUp") {
										e.preventDefault();
										setHighlight((h) => Math.max(0, h - 1));
									} else if (e.key === "Enter" && suggestions.length > 0) {
										e.preventDefault();
										commitSuggestion(suggestions[highlight], e.metaKey || e.ctrlKey);
									}
								}}
								placeholder="Link to…"
								aria-label="Link destination"
								role="combobox"
								// CP-62: the APG contract the palette was short of
								aria-autocomplete="list"
								aria-expanded={listboxOpen}
								aria-controls={listboxOpen ? LISTBOX_ID : undefined}
								aria-activedescendant={activeOptionId ?? undefined}
								className="mb-1 h-9 w-full rounded border-0 bg-transparent px-2 font-reading text-[15px] text-ink outline-none"
							/>
						)}
						{/* B36/CP-39: `role=listbox` may only contain options, so the
						    empty-state hint renders OUTSIDE the list and the listbox
						    itself exists only when there is something to list. */}
						{listboxOpen ? (
							<ul
								id={LISTBOX_ID}
								role="listbox"
								aria-label="Link destinations"
								className="max-h-72 list-none overflow-y-auto"
							>
								{suggestions.map((s, i) => (
									<li
										key={s.ref}
										id={`note-insert-opt-${i}`}
										role="option"
										aria-selected={i === highlight}
										onMouseDown={(e) => {
											e.preventDefault();
											commitSuggestion(s, false);
										}}
										className={`cursor-pointer rounded px-2 py-1.5 font-reading text-[15px] text-ink ${i === highlight ? "bg-sel" : ""}`}
									>
										{s.display}
										<span className="ml-2 font-ui text-[11px] text-ink">
											{s.gloss ?? s.kind}
										</span>
									</li>
								))}
							</ul>
						) : (
							<p className="px-2 py-1.5 font-ui text-xs text-muted-foreground">
								Type a reference — “Alma 32:21”
							</p>
						)}
						{/* Shape C foot line — the verbs, from context */}
						<p className="border-t border-rule px-2 pb-0.5 pt-1 font-ui text-[10.5px] text-muted-foreground">
							Enter to insert · ⌘↵ to go
						</p>
					</div>
				</div>
			)}
			</div>

		</div>
	);
}

/** wikilink refs in a canonical body → anchor rows for the save (A13) */
function collectBodyRefs(body: string): string[] {
	const refs = new Set<string>();
	for (const m of body.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)) {
		const ref = m[1].trim();
		const resolved = resolveAnchorRef(ref);
		// note links are body content, never anchors (the DB kind CHECK
		// excludes them; the rail resolves them from the body instead)
		if (resolved && resolved.kind !== "note") refs.add(ref);
	}
	return [...refs];
}

function firstDiff(a: string, b: string): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
	return a.length === b.length ? -1 : n;
}

export default function NoteEditor(props: NoteEditorProps) {
	const latest = useRef(props.initialBody);
	return (
		<EditorBoundary latestMarkdown={() => latest.current}>
			<PMEditor {...props} onMarkdown={(md) => void (latest.current = md)} />
		</EditorBoundary>
	);
}
