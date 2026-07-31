import { Link } from "react-router";
import { PageFrame, PageHeader } from "~/components/PageFrame";
import type { Route } from "./+types/about";

/** About (punch list 16). Plain and factual — no poetic or journalistic
 * voice in product copy (Abram, 2026-07-31, standing rule). */

export function meta(_args: Route.MetaArgs) {
	return [{ title: "About — candlestick.study" }];
}

export default function About() {
	return (
		<PageFrame frame="column">
			<PageHeader title="About" />
			<div className="mt-8 space-y-5 font-reading text-[17px] leading-relaxed text-ink">
				<p>candlestick.study is a scripture study app.</p>
				<p>
					You can read the standard works and see what is connected to each verse:
					people, places, topics, cross-references, the underlying Hebrew and Greek
					words, public-domain art, and podcast episodes that discuss the passage.
				</p>
				<p>
					You can write notes. Notes can link to verses, people, topics, episodes,
					other notes, and web pages. Notes are private to your account and appear in
					your search results.
				</p>
				<p className="text-muted-foreground">
					The app is in active development. See the{" "}
					<Link
						to="/roadmap"
						className="text-ink underline decoration-dotted underline-offset-4 hover:text-primary"
					>
						roadmap
					</Link>
					.
				</p>
			</div>
		</PageFrame>
	);
}
