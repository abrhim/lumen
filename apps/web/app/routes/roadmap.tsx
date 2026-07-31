import { PageFrame, PageHeader } from "~/components/PageFrame";
import type { Route } from "./+types/roadmap";

/** Roadmap (punch list 17). Static type, seeded from the punch list —
 * Abram edits the words live. Registers print in the house anatomy;
 * no dates promised, only order. */

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Roadmap — lintel" }];
}

const SECTIONS: Array<{ label: string; items: string[] }> = [
	{
		label: "Recently landed",
		items: [
			"Notes, with links to verses, people, episodes, other notes, and web pages",
			"Writing works signed out; an account is only needed to save",
			"Global navigation, and a settings page",
			"Browse pages for Strong's and for art",
		],
	},
	{
		label: "Now",
		items: [
			"Consistent layout and typography on every page",
			"Sign in with Google",
			"A feedback form",
		],
	},
	{
		label: "Next",
		items: [
			"Tags on notes, with colors",
			"A references panel on notes: read a linked source in full without leaving the note",
			"Replace generated cross-references with a licensed set",
			"The Scripture Citation Index",
			"Link General Conference talks as sources",
		],
	},
	{
		label: "Later",
		items: [
			"Home page: resume where you left off, recent activity",
			"Summary pages for collections",
			"More ways to explore the graph",
		],
	},
];

export default function Roadmap() {
	return (
		<PageFrame frame="column">
			<PageHeader title="Roadmap" intro="In rough order. No dates." />
			{SECTIONS.map((s) => (
				<section key={s.label} aria-labelledby={`rm-${s.label}`} className="mt-8">
					<h2
						id={`rm-${s.label}`}
						className="font-ui text-[13px] font-normal text-muted-foreground"
					>
						{s.label}
					</h2>
					<ul className="mt-2 list-none space-y-1.5">
						{s.items.map((item) => (
							<li key={item} className="font-reading text-[16px] leading-relaxed text-ink">
								{item}
							</li>
						))}
					</ul>
				</section>
			))}
		</PageFrame>
	);
}
