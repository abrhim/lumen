import { PageFrame, PageHeader } from "~/components/PageFrame";
import type { Route } from "./+types/roadmap";

/** Roadmap (punch list 17). Static type, seeded from the punch list —
 * Abram edits the words live. Registers print in the house anatomy;
 * no dates promised, only order. */

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Roadmap — Lumen" }];
}

const SECTIONS: Array<{ label: string; items: string[] }> = [
	{
		label: "Recently landed",
		items: [
			"Personal notes — links to verses, people, episodes, other notes, and the web",
			"Write before signing in; an account is only needed to save",
			"Global navigation, and a settings page",
			"Strong's and Art as traversable collections",
		],
	},
	{
		label: "Now",
		items: [
			"Layout and typography consistency across every page",
			"Sign in with Google",
			"A feedback form",
		],
	},
	{
		label: "Next",
		items: [
			"Tags on notes, with colors",
			"The references workspace — a note's sources readable beside it in full",
			"Licensed cross-references replacing the generated set",
			"The Scripture Citation Index",
			"General Conference as linked sources",
		],
	},
	{
		label: "Later",
		items: [
			"A home worth returning to — resume where you left off, recent trails",
			"Collection summary pages and collection-scoped study",
			"The graph, opened wider",
		],
	},
];

export default function Roadmap() {
	return (
		<PageFrame frame="column">
			<PageHeader title="Roadmap" intro="Order, not dates." />
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
