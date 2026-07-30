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
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { noteSchema, parseNoteMarkdown, serializeNoteDoc, canonicalizeNoteMarkdown } from "./markdown";
import { findCanonReferences } from "./reference-rule";
import { suggestDestinations, type InsertSuggestion } from "./suggest";
import { resolveAnchorRef, anchorRefToPath } from "@lumen/scripture/notes-refs";
import { pushEscape } from "~/lib/escape-registry";

export interface NoteEditorProps {
	noteId: string | null;
	initialBody: string;
	initialUpdatedAt: string | null;
	prefillAnchor: string | null;
	onClose: () => void;
}

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
				// deactivate when the caret leaves the span or `]]` closes it
				if (next.from !== null && !next.insertPosture) {
					const head = tr.selection.head;
					if (head < next.from + 2) next = { ...next, from: null };
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

/* ─── paste conversion (mechanism 4) ─── */

function lumenUrlToRef(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	const segs = url.pathname.split("/").filter(Boolean);
	if (segs[0] === "scripture" && segs.length === 3) {
		const verse = url.searchParams.get("verse");
		const ref = `${segs[1]}-${segs[2]}${verse ? `-${verse}` : ""}`;
		return resolveAnchorRef(ref) ? ref : null;
	}
	if (segs[0] === "media" && segs.length === 2) {
		const t = url.searchParams.get("t");
		if (t !== null && /^\d+(\.\d+)?$/.test(t)) {
			const ref = `${segs[1]}@${t}`;
			return resolveAnchorRef(ref) ? ref : null;
		}
		return null;
	}
	if (segs.length === 2 && resolveAnchorRef(segs[1])?.kind === "entity") return segs[1];
	return null;
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
	const { noteId, initialBody, initialUpdatedAt, prefillAnchor, onClose, onMarkdown } = props;
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
	const canaryRef = useRef<{ mismatch: boolean; reserialized: string } | null>(null);
	const [dirty, setDirty] = useState(false);
	const [announce, setAnnounce] = useState<string | null>(null);
	const [popup, setPopup] = useState<{
		insertPosture: boolean;
		query: string;
		storedSelection: { from: number; to: number; text: string } | null;
	} | null>(null);
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
	const suggestionsRef = useRef<InsertSuggestion[]>([]);
	const highlightRef = useRef(0);
	const commitRef = useRef<(s: InsertSuggestion, nav: boolean) => void>(() => {});
	const moveHighlightRef = useRef<(delta: number) => void>(() => {});

	// After a create-redirect the SAME route component carries on editing —
	// adopt the fresh row's updated_at as the LWW base.
	useEffect(() => {
		if (initialUpdatedAt && !baseRef.current) baseRef.current = initialUpdatedAt;
	}, [initialUpdatedAt]);

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

	const save = () => {
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
		// A19 round-trip canary: hash-only fields, never the body
		const canary = canaryRef.current;
		if (canary?.mismatch) {
			form.set("roundtrip_ok", "false");
			form.set("rt_len_stored", String(initialBody.length));
			form.set("rt_len_reserialized", String(canary.reserialized.length));
			form.set("rt_first_diff", String(firstDiff(initialBody, canary.reserialized)));
		}
		savingRef.current = true;
		fetcher.submit(form, { method: "post", action: `/notes/${noteId}` });
	};
	const saveRef = useRef(save);
	saveRef.current = save;

	// mount the PM view once
	useEffect(() => {
		const doc = parseNoteMarkdown(
			prefillAnchor && initialBody === "" ? `[[${prefillAnchor}]]\n` : initialBody,
		);
		// A19: the canary — compare C(loaded) to loaded, report on next save
		const reserialized = canonicalizeNoteMarkdown(initialBody);
		canaryRef.current = { mismatch: initialBody !== "" && reserialized !== initialBody, reserialized };

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
						saveRef.current();
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
			attributes: {
				role: "textbox",
				"aria-multiline": "true",
				"aria-label": "Note",
				class: "note-editor outline-none font-reading text-[17px] leading-relaxed text-ink min-h-[16rem]",
			},
			handlePaste(view, event) {
				const text = event.clipboardData?.getData("text/plain") ?? "";
				const ref = lumenUrlToRef(text);
				if (!ref) return false;
				const { from, to } = view.state.selection;
				const selText = view.state.doc.textBetween(from, to, " ");
				const anchor = resolveAnchorRef(ref)!;
				const label = selText.trim() !== "" ? selText : null;
				view.dispatch(
					view.state.tr.replaceSelectionWith(
						noteSchema.nodes.wikilink.create({ ref: anchor.ref, label }),
					),
				);
				setAnnounce("Pasted as link — Backspace to undo");
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
					// idle-based debounce: every keystroke re-arms the window
					armIdleTimer(3000);
				}
				const al = autoLinkKey.getState(newState);
				if (al?.announce) setAnnounce(al.announce);
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
			baseRef.current = d.updated_at;
			canaryRef.current = null; // canary reports once
			if (editGenRef.current === inflightGenRef.current) {
				dirtyRef.current = false;
				setDirty(false);
			} else {
				// keystrokes landed while the save was in flight — the buffer
				// stays dirty and a follow-up save covers them promptly (CP-1)
				armIdleTimer(800);
			}
		} else if (d.code !== undefined && dirtyRef.current) {
			// failed save: buffer preserved, loud state shown, and a real
			// retry actually fires (the old machine never re-armed)
			armIdleTimer(5000);
		}
	}, [fetcher.state, fetcher.data]);

	// escape registry: the popup is an escapable layer (A10)
	useEffect(() => {
		if (!popup) return;
		return pushEscape({
			onEscape: () => {
				const view = viewRef.current;
				if (!view) return;
				const ac = autocompleteKey.getState(view.state);
				const tr = view.state.tr.setMeta(autocompleteKey, {
					from: null,
					insertPosture: false,
					storedSelection: null,
				});
				view.dispatch(tr);
				// CF-13: focus + selection restore on ANY close
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
			},
		});
	}, [popup !== null]);

	// global Esc → registry (innermost layer only; inert when empty)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			import("~/lib/escape-registry").then(({ popEscape }) => {
				if (popEscape()) e.preventDefault();
			});
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, []);

	const suggestions = useMemo(
		() => (popup ? suggestDestinations(popup.insertPosture ? insertQuery : popup.query) : []),
		[popup, insertQuery],
	);
	useEffect(() => setHighlight(0), [suggestions.length]);
	suggestionsRef.current = suggestions;
	highlightRef.current = highlight;
	moveHighlightRef.current = (delta: number) =>
		setHighlight((h) => Math.max(0, Math.min(h + delta, Math.max(0, suggestions.length - 1))));

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
		const label =
			ac.storedSelection?.text && ac.storedSelection.text.trim() !== ""
				? ac.storedSelection.text
				: s.display !== s.ref
					? s.display
					: null;
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
		setAnnounce(`Inserted link to ${s.display}`);
		setPopup(null);
		setInsertQuery("");
	};
	commitRef.current = commitSuggestion;

	const failed =
		fetcher.state === "idle" && fetcher.data !== undefined && fetcher.data.ok !== true &&
		fetcher.data.updated_at === undefined && noteId !== null && fetcher.data.code !== undefined;
	const stale = fetcher.data?.code === "stale";

	return (
		<div>
			{/* ONE polite status region (A12): terse announcements, silence for non-refs */}
			<div aria-live="polite" className="sr-only">
				{announce ?? ""}
			</div>

			<div
				ref={mountRef}
				aria-expanded={popup ? true : undefined}
				aria-haspopup={popup ? "listbox" : undefined}
				aria-controls={popup ? "note-insert-listbox" : undefined}
				aria-activedescendant={
					popup && suggestions.length > 0 ? `note-insert-opt-${highlight}` : undefined
				}
			/>

			{popup && (
				<div className="relative">
					<div className="absolute z-10 mt-1 w-80 max-w-full rounded-md border border-rule2 bg-panel p-1 shadow-sm">
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
								aria-expanded="true"
								aria-controls="note-insert-listbox"
								aria-activedescendant={
									suggestions.length > 0 ? `note-insert-opt-${highlight}` : undefined
								}
								className="mb-1 h-9 w-full rounded border-0 bg-transparent px-2 font-reading text-[15px] text-ink outline-none"
							/>
						)}
						<ul id="note-insert-listbox" role="listbox" className="list-none">
							{suggestions.length === 0 ? (
								<li className="px-2 py-1.5 font-ui text-xs text-muted-foreground">
									Type a reference — “Alma 32:21”
								</li>
							) : (
								suggestions.map((s, i) => (
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
										<span className="ml-2 font-ui text-[10.5px] uppercase tracking-wide text-muted-foreground">
											{s.kind}
										</span>
									</li>
								))
							)}
						</ul>
						{/* Shape C foot line — the verbs, from context */}
						<p className="border-t border-rule px-2 pb-0.5 pt-1 font-ui text-[10.5px] text-muted-foreground">
							Enter to insert · ⌘↵ to go
						</p>
					</div>
				</div>
			)}

			<div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-rule pt-3">
				{noteId !== null ? (
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
				<span aria-live="polite" className="font-ui text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
					{fetcher.state !== "idle"
						? "Saving…"
						: stale
							? "Changed elsewhere — reload to merge"
							: failed
								? "Save failed — edits kept, retrying on next change"
								: dirty
									? "Unsaved"
									: "Saved"}
				</span>
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
		</div>
	);
}

/** wikilink refs in a canonical body → anchor rows for the save (A13) */
function collectBodyRefs(body: string): string[] {
	const refs = new Set<string>();
	for (const m of body.matchAll(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)) {
		const ref = m[1].trim();
		if (resolveAnchorRef(ref)) refs.add(ref);
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
