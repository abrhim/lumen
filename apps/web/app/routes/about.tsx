import { Link } from "react-router";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import type { Route } from "./+types/about";

/** About (punch list 16). Static type; Abram edits the words live. */

export function meta(_args: Route.MetaArgs) {
	return [{ title: "About — Lumen" }];
}

export default function About() {
	return (
		<PageFrame frame="column">
			<PageHeader
				title="About"
				intro="A reader for the scriptures, and the web of connections inside them."
			/>
			<div className="mt-8 space-y-5 font-reading text-[17px] leading-relaxed text-ink">
				<p>
					Lumen begins with the text — the standard works, set for reading. Around the
					text it keeps the connections: the people, places, and principles a verse
					touches; the words underneath in Hebrew and Greek; the art a chapter has
					gathered across five centuries; the places a passage is taught aloud.
				</p>
				<p>
					On top of that canon you write. Notes link verses, entries, episodes, and
					each other, and everything you write is yours alone — private by
					construction, searchable beside the library.
				</p>
				<p className="text-muted-foreground">
					Lumen is built by one person, in the open, a stroke at a time. See{" "}
					<Link
						to="/roadmap"
						className="text-ink underline decoration-dotted underline-offset-4 hover:text-primary"
					>
						where it's headed
					</Link>
					.
				</p>
			</div>
		</PageFrame>
	);
}
