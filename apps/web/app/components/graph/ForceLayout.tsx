import { useEffect, useRef } from "react";
import {
	forceSimulation,
	forceManyBody,
	forceLink,
	forceX,
	forceY,
	forceCollide,
	type Simulation,
	type SimulationLinkDatum,
} from "d3-force";
import { select } from "d3-selection";
import { drag } from "d3-drag";
import { zoom } from "d3-zoom";
import type { GraphVM, GraphNodeVM } from "./graph-model";

interface SimNode extends GraphNodeVM {
	x?: number;
	y?: number;
	fx?: number | null;
	fy?: number | null;
}

const W = 1200;
const H = 800;

/**
 * Obsidian-style force layout. The simulation runs entirely off-React: node
 * and edge positions are written to the DOM per tick via refs (PERF-3 — a
 * per-tick setState reconciles hundreds of SVG elements per frame). React
 * renders the elements once; d3 owns their coordinates afterwards.
 */
export default function ForceLayout({
	vm,
	hiddenTypes,
	positions,
	onRecenter,
}: {
	/** The FULL vm — type filtering happens via visibility (B5), not remounting. */
	vm: GraphVM;
	hiddenTypes: ReadonlySet<string>;
	/** Position memory across depth/center changes (UX-9). Mutated in place. */
	positions: Map<string, { x: number; y: number }>;
	onRecenter: (id: string) => void;
}) {
	const svgRef = useRef<SVGSVGElement>(null);
	const viewportRef = useRef<SVGGElement>(null);
	const nodeRefs = useRef(new Map<string, SVGGElement>());
	const edgeRefs = useRef(new Map<number, SVGLineElement>());
	const simRef = useRef<Simulation<SimNode, undefined> | null>(null);

	// Legend toggles hide elements without touching the simulation (B5). The
	// edgeRefs index space is the same vm.edges array used below — keep it that
	// way (CCOR-2): indices are shared between render, tick, and this effect.
	const typeOf = useRef(new Map<string, string>());
	useEffect(() => {
		typeOf.current = new Map(vm.nodes.map((n) => [n.id, n.type]));
	}, [vm]);
	useEffect(() => {
		const hiddenNode = (id: string) => {
			const t = typeOf.current.get(id);
			return t !== undefined && hiddenTypes.has(t) && vm.center.id !== id;
		};
		for (const [id, el] of nodeRefs.current) {
			el.style.display = hiddenNode(id) ? "none" : "";
		}
		vm.edges.forEach((e, i) => {
			const el = edgeRefs.current.get(i);
			if (el) el.style.display = hiddenNode(e.from) || hiddenNode(e.to) ? "none" : "";
		});
	}, [hiddenTypes, vm]);

	useEffect(() => {
		const nodes: SimNode[] = vm.nodes.map((n) => {
			const seed = positions.get(n.id);
			return {
				...n,
				// returning nodes keep their place; new nodes enter near their ring
				x: seed?.x ?? W / 2 + Math.cos(hash(n.id)) * 90 * n.hop,
				y: seed?.y ?? H / 2 + Math.sin(hash(n.id)) * 90 * n.hop,
			};
		});
		const center = nodes[0];
		center.fx = W / 2;
		center.fy = H / 2;
		const nodeIds = new Set(vm.nodes.map((n) => n.id));
		const links: SimulationLinkDatum<SimNode>[] = vm.edges
			.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
			.map((e) => ({ source: e.from, target: e.to }));

		const sim = forceSimulation<SimNode>(nodes)
			.force("charge", forceManyBody().strength(-200))
			.force(
				"link",
				forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
					.id((d) => d.id)
					.distance((l) => ((l.source as SimNode).hop === 0 || (l.target as SimNode).hop === 0 ? 90 : 60))
					.strength(0.4),
			)
			.force("x", forceX(W / 2).strength(0.04))
			.force("y", forceY(H / 2).strength(0.04))
			.force("collide", forceCollide<SimNode>((d) => (d.hop === 0 ? 34 : 22)))
			.velocityDecay(0.32)
			.on("tick", () => {
				for (const n of nodes) {
					const el = nodeRefs.current.get(n.id);
					if (el) el.setAttribute("transform", `translate(${n.x ?? 0},${n.y ?? 0})`);
				}
				links.forEach((l, i) => {
					const el = edgeRefs.current.get(i);
					const s = l.source as SimNode;
					const t = l.target as SimNode;
					if (el) {
						el.setAttribute("x1", String(s.x ?? 0));
						el.setAttribute("y1", String(s.y ?? 0));
						el.setAttribute("x2", String(t.x ?? 0));
						el.setAttribute("y2", String(t.y ?? 0));
					}
				});
			})
			.on("end", () => {
				for (const n of nodes) if (n.x != null && n.y != null) positions.set(n.id, { x: n.x, y: n.y });
			});
		simRef.current = sim;

		// drag-to-pin
		for (const n of nodes) {
			const el = nodeRefs.current.get(n.id);
			if (!el) continue;
			select<SVGGElement, unknown>(el).call(
				drag<SVGGElement, unknown>()
					.on("start", () => sim.alphaTarget(0.25).restart())
					.on("drag", (event) => {
						n.fx = event.x;
						n.fy = event.y;
					})
					.on("end", () => {
						sim.alphaTarget(0);
						if (n.hop !== 0) {
							n.fx = null;
							n.fy = null;
						}
					}),
			);
		}

		// zoom / pan on the viewport group
		if (svgRef.current && viewportRef.current) {
			const vp = viewportRef.current;
			select(svgRef.current).call(
				zoom<SVGSVGElement, unknown>()
					.scaleExtent([0.25, 4])
					.on("zoom", (event) => vp.setAttribute("transform", event.transform.toString())),
			);
		}

		return () => {
			sim.stop();
			for (const n of nodes) if (n.x != null && n.y != null) positions.set(n.id, { x: n.x, y: n.y });
		};
	}, [vm, positions]);

	// hover dims non-neighbors — pointer-only affordance, gated to hover devices
	const setDim = (hoverId: string | null) => {
		if (!window.matchMedia("(hover: hover)").matches) return;
		const neighbors = hoverId ? (vm.adjacency.get(hoverId) ?? new Set()) : null;
		for (const [id, el] of nodeRefs.current) {
			const dim = hoverId !== null && id !== hoverId && !neighbors!.has(id);
			el.setAttribute("opacity", dim ? "0.25" : "1");
		}
	};

	return (
		<svg
			ref={svgRef}
			viewBox={`0 0 ${W} ${H}`}
			className="h-full w-full cursor-grab active:cursor-grabbing"
			role="presentation"
			aria-hidden="true"
		>
			<g ref={viewportRef}>
				{vm.edges.map((e, i) => (
					<line
						key={`${e.from}-${e.to}-${e.rel_type}-${i}`}
						ref={(el) => {
							if (el) edgeRefs.current.set(i, el);
							else edgeRefs.current.delete(i);
						}}
						stroke="var(--color-rule2)"
						strokeWidth={1.2}
					/>
				))}
				{vm.nodes.map((n) => (
					<g
						key={n.id}
						ref={(el) => {
							if (el) nodeRefs.current.set(n.id, el);
							else nodeRefs.current.delete(n.id);
						}}
						className={n.hop === 0 ? undefined : "cursor-pointer"}
						onClick={n.hop === 0 ? undefined : () => onRecenter(n.id)}
						onMouseEnter={() => setDim(n.id)}
						onMouseLeave={() => setDim(null)}
					>
						{/* invisible hit-slop so small nodes stay tappable (A11Y-6) */}
						<circle r={n.hop === 0 ? 34 : 22} fill="transparent" />
						<circle
							r={n.hop === 0 ? 24 : n.hop === 1 ? 14 : 10}
							fill={n.color}
							stroke={n.hop === 0 ? "#ffffff" : "var(--color-paper)"}
							strokeWidth={n.hop === 0 ? 3 : 2}
						/>
						{/* persistent recenter affordance, not hover-only (UX-5/B24) */}
						{n.hop !== 0 && (
							<circle r={n.hop === 1 ? 17 : 13} fill="none" stroke={n.color} strokeOpacity={0.6} strokeWidth={1.5} />
						)}
						<text
							y={(n.hop === 0 ? 24 : n.hop === 1 ? 14 : 10) + 14}
							textAnchor="middle"
							className="pointer-events-none select-none font-ui text-[11px] font-semibold"
							fill="var(--color-ink)"
						>
							{truncate(n.label)}
						</text>
					</g>
				))}
			</g>
		</svg>
	);
}

function truncate(s: string): string {
	return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

/** Deterministic angle from an id — stable initial placement without Math.random. */
function hash(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
	return (h % 628) / 100;
}
