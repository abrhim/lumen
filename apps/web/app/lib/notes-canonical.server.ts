/**
 * personal-notes A2 — server-side access to C(md). Every save path stores
 * canonical form, including non-editor writers (reader capture appends),
 * so the invariant holds for bodies the client editor never touched.
 *
 * `.server` suffix on purpose: this pulls prosemirror-model/markdown into
 * the WORKER bundle only (accepted, CF-56 class); the client reaches the
 * same functions solely through the lazy editor chunk (A11).
 */
export {
	canonicalizeNoteMarkdown,
	sanitizeWikilinkLabel,
} from "~/components/editor/markdown";
