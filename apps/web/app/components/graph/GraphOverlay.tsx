import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Await } from "react-router";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import type { NeighborhoodResult } from "@lumen/scripture";
import { Skeleton } from "~/components/ui/skeleton";
import {
	buildGraphVM,
	filterVM,
	FORCE_NODE_LIMIT,
	FORCE_EDGE_LIMIT,
	type GraphVM,
	type GraphNodeVM,
} from "./graph-model";

// Each layout is its own chunk: radial-only users (reduced motion, huge
// neighborhoods) never download the d3 physics stack (B23).
const ForceLayout = lazy(() => import("./ForceLayout"));
const RadialLayout = lazy(() => import("./RadialLayout"));

export type GraphPanelData =
	| { degraded: false; neighborhood: NeighborhoodResult; entityId: string; depth: 1 | 2 | 3 }
	| { degraded: true; entityId: string; depth: 1 | 2 | 3 };

export interface GraphOverlayProps {
	entityId: string;
	depth: 1 | 2 | 3;
	graph: Promise<GraphPanelData>;
	/** A graph navigation is in flight (optimistic phase). */
	isPending: boolean;
	/** The control that opened the overlay — focus returns to it on close (B16). */
	invoker: { current: HTMLElement | null };
	onNavigate: (entityId: string, depth: 1 | 2 | 3) => void;
	onClose: () => void;
	onReadVerse: (target: { book: string; chapter: number; verse: number }) => void;
}

export default function GraphOverlay(props: GraphOverlayProps) {
	const { entityId, depth, graph, isPending, invoker, onClose } = props;

	// What the Await has actually delivered. Compared against the URL target so
	// the stale window after a transition commit still reads as pending (B1) —
	// startTransition holds the old tree without any signal from useNavigation.
	const [resolved, setResolved] = useState<{ id: string; depth: number } | null>(null);
	const [announce, setAnnounce] = useState("");
	const stale = isPending || resolved === null || resolved.id !== entityId || resolved.depth !== depth;

	return (
		<DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 data-open:animate-in data-open:fade-in-0 supports-backdrop-filter:backdrop-blur-xs" />
				<DialogPrimitive.Content
					className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-rule2 bg-panel shadow-2xl data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 md:inset-6"
					aria-describedby={undefined}
					onCloseAutoFocus={(event) => {
						if (invoker.current && document.contains(invoker.current)) {
							event.preventDefault();
							invoker.current.focus();
						}
					}}
				>
					{/* Generic title (CA11Y-5); the resolved entity is announced below. */}
					<DialogPrimitive.Title className="sr-only">Local graph</DialogPrimitive.Title>
					{/* One persistent live region, filled AFTER mount so screen readers
					    actually announce mutations (CA11Y-2). */}
					<p aria-live="polite" className="sr-only">
						{announce}
					</p>
					<div className="relative flex min-h-0 flex-1 flex-col">
						<Suspense fallback={<GraphSkeleton onClose={onClose} />}>
							<Await resolve={graph} errorElement={<GraphDegraded onClose={onClose} />}>
								{(data) => (
									<GraphResolved
										{...props}
										data={data}
										onSettle={(key, message) => {
											setResolved(key);
											setAnnounce(message);
										}}
									/>
								)}
							</Await>
						</Suspense>
						{/* Pending dim lives OUTSIDE the Suspense boundary so it shows over
						    held-stale content during transitions (B1). */}
						{stale && (
							<div aria-busy="true" className="absolute inset-0 z-10 bg-panel/60" />
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function CloseButton({ onClose }: { onClose: () => void }) {
	return (
		<button
			type="button"
			onClick={onClose}
			aria-label="Close graph"
			className="-m-2 ml-auto p-2 text-muted-foreground transition-colors duration-150 hover:text-ink"
		>
			<XIcon className="size-5" aria-hidden="true" />
		</button>
	);
}

function GraphSkeleton({ onClose }: { onClose: () => void }) {
	return (
		<div className="flex h-full flex-col p-5" aria-busy="true">
			<div className="flex items-start gap-3">
				<div className="space-y-2">
					<Skeleton className="h-3 w-32" />
					<Skeleton className="h-6 w-56" />
				</div>
				<CloseButton onClose={onClose} />
			</div>
			<div className="flex flex-1 items-center justify-center">
				<Skeleton className="size-28 rounded-full" />
			</div>
		</div>
	);
}

function GraphDegraded({ onClose }: { onClose: () => void }) {
	return (
		<div className="flex h-full flex-col p-5">
			<div className="flex items-start">
				<h2 className="font-display text-xl font-medium">Local graph</h2>
				<CloseButton onClose={onClose} />
			</div>
			<p className="mt-6 max-w-prose font-reading text-sm italic leading-relaxed text-muted-foreground">
				Graph features are unavailable right now — connections couldn't be loaded. The chapter
				behind this panel is unaffected.
			</p>
		</div>
	);
}

function GraphResolved({
	entityId,
	depth,
	isPending,
	data,
	onSettle,
	onNavigate,
	onClose,
	onReadVerse,
}: GraphOverlayProps & {
	data: GraphPanelData;
	onSettle: (key: { id: string; depth: number }, message: string) => void;
}) {
	const vm = useMemo(
		() => (data.degraded ? null : buildGraphVM(data.neighborhood)),
		[data],
	);

	// Report what actually landed — clears the stale dim (B1) and feeds the
	// live region (CA11Y-2) one tick after mount so it announces.
	useEffect(() => {
		const message = data.degraded
			? "Graph unavailable — connections couldn't be loaded."
			: vm === null
				? `Nothing in the graph is named ${data.entityId}.`
				: `Local graph for ${vm.center.label} loaded: ${vm.nodes.length - 1} connections shown${
						data.neighborhood.truncated.shown < data.neighborhood.truncated.total
							? ` of at least ${data.neighborhood.truncated.total}`
							: ""
					}.`;
		onSettle({ id: data.entityId, depth: data.depth }, message);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [data]);

	if (data.degraded) return <GraphDegraded onClose={onClose} />;
	if (!vm) {
		return (
			<div className="flex h-full flex-col p-5">
				<div className="flex items-start">
					<h2 className="font-display text-xl font-medium">Local graph</h2>
					<CloseButton onClose={onClose} />
				</div>
				<p className="mt-6 max-w-prose font-reading text-sm italic text-muted-foreground">
					Nothing in the graph is named “{data.entityId}”. It may not be part of this knowledge
					set.
				</p>
			</div>
		);
	}
	return (
		<GraphBody
			vm={vm}
			neighborhood={data.neighborhood}
			entityId={entityId}
			depth={depth}
			isPending={isPending}
			onNavigate={onNavigate}
			onClose={onClose}
			onReadVerse={onReadVerse}
		/>
	);
}

function GraphBody({
	vm,
	neighborhood,
	entityId,
	depth,
	isPending,
	onNavigate,
	onClose,
	onReadVerse,
}: {
	vm: GraphVM;
	neighborhood: NeighborhoodResult;
	entityId: string;
	depth: 1 | 2 | 3;
	isPending: boolean;
	onNavigate: (entityId: string, depth: 1 | 2 | 3) => void;
	onClose: () => void;
	onReadVerse: (target: { book: string; chapter: number; verse: number }) => void;
}) {
	const prefersReducedMotion =
		typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const [layout, setLayout] = useState<"force" | "radial">("force");
	const [view, setView] = useState<"graph" | "list">("graph");
	const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
	const positionsRef = useRef(new Map<string, { x: number; y: number }>());
	const listRef = useRef<HTMLDivElement>(null);

	const filtered = useMemo(() => filterVM(vm, hiddenTypes), [vm, hiddenTypes]);

	// The force sim is gated on BOTH node and edge volume (B4) and reduced
	// motion; the control reflects what actually renders (B7 — no lying
	// aria-pressed state).
	const forceViable =
		!prefersReducedMotion &&
		filtered.nodes.length <= FORCE_NODE_LIMIT &&
		filtered.edges.length <= FORCE_EDGE_LIMIT;
	const effectiveLayout = forceViable ? layout : "radial";

	// Focus lands in the list when it becomes the active view (CA11Y-9).
	useEffect(() => {
		if (view === "list") listRef.current?.focus();
	}, [view]);

	const { shown, total } = neighborhood.truncated;
	const truncatedNotice = shown < total;
	const allHidden = vm.nodes.length > 1 && filtered.nodes.length <= 1;
	const isEmpty = vm.nodes.length <= 1;
	const recenter = (id: string) => onNavigate(id, depth);

	return (
		<div className="flex h-full flex-col">
			<header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-rule p-5 pb-4">
				<div className="min-w-0">
					<p className="font-ui text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
						Local graph · depth {depth}
					</p>
					<h2 className="mt-1 truncate font-display text-2xl font-medium">{vm.center.label}</h2>
				</div>
				{vm.center.verseTarget && (
					<button
						type="button"
						onClick={() => onReadVerse(vm.center.verseTarget!)}
						className="mt-1 rounded-md border border-rule2 px-3 py-1.5 font-ui text-xs font-bold text-primary transition-colors duration-150 hover:border-primary"
					>
						Read →
					</button>
				)}
				<div className="ml-auto flex flex-wrap items-center gap-3">
					{/* Only Depth is fetch-coupled; Layout/View stay interactive while
					    pending (B17). aria-disabled keeps focus in the tab order. */}
					<SegmentedToggle
						label="Depth"
						value={String(depth)}
						options={["1", "2", "3"]}
						isDisabled={() => isPending}
						onChange={(v) => onNavigate(entityId, Number(v) as 1 | 2 | 3)}
					/>
					<SegmentedToggle
						label="Layout"
						value={effectiveLayout}
						options={["force", "radial"]}
						isDisabled={(opt) => (opt === "force" ? !forceViable : false)}
						onChange={(v) => setLayout(v as "force" | "radial")}
					/>
					<SegmentedToggle
						label="View"
						value={view}
						options={["graph", "list"]}
						onChange={(v) => setView(v as "graph" | "list")}
					/>
					<CloseButton onClose={onClose} />
				</div>
			</header>

			{truncatedNotice && (
				<p className="border-b border-rule bg-panel2 px-5 py-1.5 font-ui text-xs font-semibold text-muted-foreground">
					{depth > 1
						? `Showing ${shown} of ${total}+ connections — reduce the depth, or recenter on a neighbor.`
						: `Showing ${shown} of ${total} connections — recenter on a neighbor to explore further.`}
				</p>
			)}

			<div className="relative min-h-0 flex-1">
				{isEmpty ? (
					<p className="p-8 font-reading text-sm italic text-muted-foreground">
						No connections recorded within depth {depth} for this entity.
					</p>
				) : allHidden && view === "graph" ? (
					<p className="p-8 font-reading text-sm italic text-muted-foreground">
						Every connection type is hidden — re-enable one in the legend below.
					</p>
				) : view === "list" ? (
					<div ref={listRef} tabIndex={-1} className="h-full outline-none">
						<ListView vm={filtered} onRecenter={recenter} onReadVerse={onReadVerse} />
					</div>
				) : (
					<Suspense fallback={null}>
						{effectiveLayout === "force" ? (
							<ForceLayout
								vm={vm}
								hiddenTypes={hiddenTypes}
								positions={positionsRef.current}
								onRecenter={recenter}
							/>
						) : (
							<RadialLayout vm={filtered} onRecenter={recenter} />
						)}
					</Suspense>
				)}
			</div>

			<footer className="flex flex-wrap items-center gap-2 border-t border-rule px-5 py-3">
				{vm.types.map((t) => {
					const hidden = hiddenTypes.has(t.type);
					return (
						<button
							key={t.type}
							type="button"
							aria-pressed={!hidden}
							onClick={() =>
								setHiddenTypes((prev) => {
									const next = new Set(prev);
									if (next.has(t.type)) next.delete(t.type);
									else next.add(t.type);
									return next;
								})
							}
							className={`inline-flex items-center gap-1.5 rounded-full border border-rule2 px-2.5 py-1 font-ui text-[11px] font-semibold transition-colors duration-150 ${
								hidden ? "text-muted-foreground line-through" : "text-ink"
							}`}
						>
							<span className="size-2 rounded-full" style={{ background: t.color }} aria-hidden="true" />
							{t.label} · {t.count}
						</button>
					);
				})}
			</footer>
		</div>
	);
}

function SegmentedToggle({
	label,
	value,
	options,
	isDisabled,
	onChange,
}: {
	label: string;
	value: string;
	options: string[];
	isDisabled?: (opt: string) => boolean;
	onChange: (v: string) => void;
}) {
	return (
		<div className="inline-flex items-center gap-1.5" role="group" aria-label={label}>
			<span className="font-ui text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span className="inline-flex overflow-hidden rounded-md border border-rule2">
				{options.map((opt) => {
					const disabled = isDisabled?.(opt) ?? false;
					return (
						<button
							key={opt}
							type="button"
							aria-pressed={opt === value}
							aria-disabled={disabled || undefined}
							onClick={() => {
								if (disabled || opt === value) return;
								onChange(opt);
							}}
							className={`px-2.5 py-1 font-ui text-[11px] font-bold capitalize transition-colors duration-150 aria-disabled:opacity-50 ${
								opt === value ? "bg-sel text-ink" : "bg-surface text-muted-foreground hover:text-ink"
							}`}
						>
							{opt}
						</button>
					);
				})}
			</span>
		</div>
	);
}

/** Structured equivalent of the canvas (A11Y-2): same data, plain markup. */
function ListView({
	vm,
	onRecenter,
	onReadVerse,
}: {
	vm: GraphVM;
	onRecenter: (id: string) => void;
	onReadVerse: (target: { book: string; chapter: number; verse: number }) => void;
}) {
	const groups = useMemo(() => {
		const byType = new Map<string, GraphNodeVM[]>();
		for (const n of vm.nodes.slice(1)) {
			const list = byType.get(n.type) ?? [];
			list.push(n);
			byType.set(n.type, list);
		}
		return [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
	}, [vm]);

	return (
		<div className="h-full overflow-y-auto p-5">
			{groups.map(([type, nodes]) => {
				const meta = vm.types.find((t) => t.type === type);
				return (
					<section key={type} aria-label={meta?.label ?? type} className="mb-6">
						<h3 className="font-ui text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
							<span
								className="mr-1.5 inline-block size-2 rounded-full align-baseline"
								style={{ background: meta?.color }}
								aria-hidden="true"
							/>
							{meta?.label ?? type} · {nodes.length}
						</h3>
						<ul className="mt-2 flex flex-wrap gap-1.5">
							{nodes.map((n) => (
								<li key={n.id} className="inline-flex overflow-hidden rounded-md border border-rule2 bg-surface">
									<button
										type="button"
										onClick={() => onRecenter(n.id)}
										className="px-2.5 py-1 font-ui text-xs font-semibold text-ink transition-colors duration-150 hover:bg-sel"
									>
										{n.label}
										{n.hop > 1 && <span className="ml-1 text-[9px] text-muted-foreground">+{n.hop - 1}</span>}
									</button>
									{n.verseTarget && (
										<button
											type="button"
											onClick={() => onReadVerse(n.verseTarget!)}
											aria-label={`Read ${n.label}`}
											className="border-l border-rule2 px-2 py-1 font-ui text-[10px] font-bold text-primary transition-colors duration-150 hover:bg-sel"
										>
											Read
										</button>
									)}
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}
