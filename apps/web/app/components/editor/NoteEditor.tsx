/**
 * personal-notes — the ProseMirror editor chunk (A10/A11/A13/A17).
 * Loaded ONLY via React.lazy behind edit intent; nothing outside this
 * chunk may import it statically. Fleshed out with the PM view wiring in
 * the integration step — this module already owns the markdown boundary.
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { canonicalizeNoteMarkdown } from "./markdown";

export interface NoteEditorProps {
	noteId: string | null;
	initialBody: string;
	initialUpdatedAt: string | null;
	prefillAnchor: string | null;
	onClose: () => void;
}

export default function NoteEditor(props: NoteEditorProps) {
	// Placeholder textarea shell — replaced by the PM view in the
	// integration step. The save contract (autosave, C(md), base-echo) is
	// already the real one so the action wiring is exercised end to end.
	const { noteId, initialBody, initialUpdatedAt, prefillAnchor, onClose } = props;
	const fetcher = useFetcher<{ ok?: boolean; updated_at?: string; code?: string }>();
	const navigate = useNavigate();
	const [body, setBody] = useState(() =>
		prefillAnchor && initialBody === "" ? `[[${prefillAnchor}]]\n` : initialBody,
	);
	const baseRef = useRef(initialUpdatedAt);
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		if (fetcher.data?.updated_at) {
			baseRef.current = fetcher.data.updated_at;
			setDirty(false);
		}
	}, [fetcher.data]);

	const save = () => {
		const canonical = canonicalizeNoteMarkdown(body);
		if (noteId === null) {
			const form = new FormData();
			form.set("intent", "create");
			form.set("body_md", canonical);
			if (prefillAnchor) form.append("anchor", prefillAnchor);
			fetcher.submit(form, { method: "post", action: "/notes/new" });
			return;
		}
		const form = new FormData();
		form.set("intent", "update");
		form.set("body_md", canonical);
		form.set("base_updated_at", baseRef.current ?? "");
		fetcher.submit(form, { method: "post", action: `/notes/${noteId}` });
	};

	// ≥3s idle debounce autosave (A13, gate ruling G5) — flush on blur below
	useEffect(() => {
		if (!dirty || noteId === null) return;
		const t = setTimeout(save, 3000);
		return () => clearTimeout(t);
	}, [body, dirty]);

	const failed = fetcher.data?.code !== undefined && fetcher.data.ok !== true;

	return (
		<div>
			<textarea
				value={body}
				autoFocus
				onChange={(e) => {
					setBody(e.target.value);
					setDirty(true);
				}}
				onBlur={() => dirty && save()}
				rows={16}
				aria-label="Note"
				className="w-full resize-y border-0 bg-transparent font-reading text-[17px] leading-relaxed text-ink outline-none"
			/>
			<div className="mt-4 flex items-baseline gap-4 border-t border-rule pt-3">
				<button
					type="button"
					onClick={save}
					className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-ink"
				>
					Save
				</button>
				{noteId !== null ? (
					<button
						type="button"
						onClick={onClose}
						className="font-ui text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-ink"
					>
						Done
					</button>
				) : null}
				<span aria-live="polite" className="font-ui text-[11px] uppercase tracking-[0.14em] text-faint">
					{fetcher.state !== "idle" ? "Saving…" : failed ? "Save failed — retry" : dirty ? "Unsaved" : "Saved"}
				</span>
			</div>
		</div>
	);
}
