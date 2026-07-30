/**
 * personal-notes A16 (CF-23) — the kill switch. One env var, one helper,
 * four gates: /notes loaders+actions, the scripture-loader anchors fetch,
 * the search-route notes leg, the media capture affordance. Default ON;
 * every gate fails toward the pre-feature signed-out shape, so
 * NOTES_ENABLED=0 is provably the shipped pre-notes behavior.
 */
export interface NotesFlagEnv {
	NOTES_ENABLED?: string;
}

export function notesEnabled(env: NotesFlagEnv | undefined): boolean {
	return (env?.NOTES_ENABLED ?? "1") !== "0";
}
