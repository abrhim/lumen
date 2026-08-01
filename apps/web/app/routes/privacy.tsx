import { PageFrame, PageHeader } from "~/components/PageFrame";
import type { Route } from "./+types/privacy";

/** Privacy policy (2026-08-01). Plain and true — it describes what the
 * app actually does, and must be updated when the practices change
 * (Resend email, analytics, etc. are NOT live and NOT listed). */

export function meta(_args: Route.MetaArgs) {
	return [{ title: "Privacy — Lintel" }];
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

export default function Privacy() {
	return (
		<PageFrame frame="column">
			<PageHeader title="Privacy" intro={`Last updated ${UPDATED}.`} />

			<Section title="What Lintel collects">
				<p>
					If you create an account, we store your email address. If you sign in with
					Google, Google shares your email address and basic profile (name and
					picture); we use the email address to identify your account and nothing
					else.
				</p>
				<p>
					Notes you save are stored with your account. They are private: the
					database enforces that only your account can read or change them.
				</p>
				<p>
					Roadmap votes are stored with your account. Public vote totals are
					shown as counts only — never who voted.
				</p>
				<p>
					If you write a note without an account, the draft stays in your
					browser's local storage and is not sent to us unless you sign in and
					save it. Your theme choice also lives in local storage.
				</p>
			</Section>

			<Section title="Cookies">
				<p>
					Lintel uses cookies only to keep you signed in. There are no advertising
					or tracking cookies, and no third-party analytics.
				</p>
			</Section>

			<Section title="Server logs">
				<p>
					Like most websites, our servers keep short-lived technical logs (such as
					requested pages and search queries) to diagnose problems. They are not
					used for advertising and are not sold or shared.
				</p>
			</Section>

			<Section title="Who processes the data">
				<p>
					Lintel runs on Cloudflare (hosting), Supabase (accounts and database),
					and Neo4j (the connections graph). Google is involved only if you choose
					to sign in with Google. We do not sell data to anyone, and there are no
					advertisers.
				</p>
				<p>
					The operator of Lintel can access the database in order to run the
					service. Your notes are treated as private and are not read except when
					required to fix a problem you report or as required by law.
				</p>
			</Section>

			<Section title="Deleting your data">
				<p>
					You can delete any note yourself. To delete your whole account and
					everything in it, email{" "}
					<a
						href="mailto:abramhimmer@gmail.com"
						className="text-ink underline decoration-dotted underline-offset-4 hover:text-primary"
					>
						abramhimmer@gmail.com
					</a>{" "}
					and it will be done promptly.
				</p>
			</Section>

			<Section title="Children">
				<p>Lintel is not directed at children under 13.</p>
			</Section>

			<Section title="Changes">
				<p>
					If these practices change, this page changes with them, with the date
					above updated.
				</p>
			</Section>
		</PageFrame>
	);
}
