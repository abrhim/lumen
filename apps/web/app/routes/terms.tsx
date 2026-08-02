import { Link } from "react-router";
import { PageFoot, PageFrame, PageHeader } from "~/components/PageFrame";
import type { Route } from "./+types/terms";

/** Terms of service (2026-08-01). Plain and true — it describes what the
 * app actually does and what using it means, and must be updated when that
 * changes. No governing-law jurisdiction is stated yet (see the TODO
 * below); don't invent one. */

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Terms — Lintel" }];
}

const UPDATED = "1 August 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="mt-8">
			<h2 className="font-ui text-[13px] font-normal text-muted-foreground">{title}</h2>
			<div className="mt-2 space-y-3 font-reading text-[16px] leading-relaxed text-ink">
				{children}
			</div>
		</section>
	);
}

export default function Terms() {
	return (
		<PageFrame frame="column">
			<PageHeader title="Terms" intro={`Last updated ${UPDATED}.`} />

			<Section title="What Lintel is">
				<p>
					Lintel is a scripture study app. It is free to use, and it is built and
					run by one person.
				</p>
			</Section>

			<Section title="Your account">
				<p>
					You can create an account to save your work. You are responsible for what
					happens under your account, so keep your sign-in details to yourself.
				</p>
			</Section>

			<Section title="Your notes">
				<p>
					The notes you write are yours. We store them so we can show them back to
					you and include them in your search results. We claim no ownership of them
					and no licence beyond what it takes to run the service for you.
				</p>
			</Section>

			<Section title="Scripture and the app around it">
				<p>
					The scripture text is in the public domain, and you can do what you like
					with it. The commentary, the connections graph, and the way the app puts
					them together are not public domain, and are not yours to copy or
					republish.
				</p>
			</Section>

			<Section title="Using it fairly">
				<p>
					Please don't attack the service or try to break it, don't scrape it
					wholesale, and don't use it to do anything illegal.
				</p>
			</Section>

			<Section title="Availability">
				<p>
					There is no uptime guarantee. Lintel is provided as it is, and it can
					change: features may be added, changed, or removed at any time.
				</p>
			</Section>

			<Section title="Ending it">
				<p>
					You can stop using Lintel at any time. You can delete your account and
					everything in it; the{" "}
					<Link
						to="/privacy"
						className="text-ink underline decoration-dotted underline-offset-4 hover:text-primary"
					>
						privacy page
					</Link>{" "}
					says how. We may suspend or close an account that abuses the service.
				</p>
			</Section>

			<Section title="Changes">
				<p>
					If these terms change, this page changes with them, and the date above is
					updated.
				</p>
			</Section>

			{/* TODO(abram): jurisdiction — add a governing-law section once decided. Don't guess. */}

			<Section title="Getting in touch">
				<p>
					Questions about these terms can go to{" "}
					<a
						href="mailto:abramhimmer@gmail.com"
						className="text-ink underline decoration-dotted underline-offset-4 hover:text-primary"
					>
						abramhimmer@gmail.com
					</a>
					.
				</p>
			</Section>
			<PageFoot />
		</PageFrame>
	);
}
