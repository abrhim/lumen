import { useMemo } from "react";
import type { GraphVM } from "./graph-model";

const W = 1200;
const H = 800;

/**
 * Deterministic radial layout: center at the middle, neighbors on rings by BFS
 * hop. No physics, no dependencies — the reduced-motion default and the
 * fallback when the node count would make the simulation too heavy (PERF-7).
 */
export default function RadialLayout({
	vm,
	onRecenter,
}: {
	vm: GraphVM;
	onRecenter: (id: string) => void;
}) {
	const placed = useMemo(() => {
		const byHop = new Map<number, typeof vm.nodes>();
		for (const n of vm.nodes) {
			const list = byHop.get(n.hop) ?? [];
			list.push(n);
			byHop.set(n.hop, list);
		}
		const pos = new Map<string, { x: number; y: number }>();
		pos.set(vm.center.id, { x: W / 2, y: H / 2 });
		for (const [hop, ring] of byHop) {
			if (hop === 0) continue;
			const radius = 130 + (hop - 1) * 150;
			ring.forEach((n, i) => {
				const angle = (i / ring.length) * 2 * Math.PI - Math.PI / 2;
				pos.set(n.id, {
					x: W / 2 + Math.cos(angle) * radius,
					y: H / 2 + Math.sin(angle) * radius,
				});
			});
		}
		return pos;
	}, [vm]);

	return (
		<svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="presentation" aria-hidden="true">
			<g>
				{vm.edges.map((e, i) => {
					const s = placed.get(e.from);
					const t = placed.get(e.to);
					if (!s || !t) return null;
					return (
						<line
							key={`${e.from}-${e.to}-${i}`}
							x1={s.x}
							y1={s.y}
							x2={t.x}
							y2={t.y}
							stroke="var(--color-rule2)"
							strokeWidth={1.2}
						/>
					);
				})}
				{vm.nodes.map((n) => {
					const p = placed.get(n.id);
					if (!p) return null;
					const r = n.hop === 0 ? 24 : n.hop === 1 ? 14 : 10;
					return (
						<g
							key={n.id}
							transform={`translate(${p.x},${p.y})`}
							className={n.hop === 0 ? undefined : "cursor-pointer"}
							onClick={n.hop === 0 ? undefined : () => onRecenter(n.id)}
						>
							<circle r={r + 8} fill="transparent" />
							<circle r={r} fill={n.color} stroke={n.hop === 0 ? "#ffffff" : "var(--color-paper)"} strokeWidth={n.hop === 0 ? 3 : 2} />
							{n.hop !== 0 && <circle r={r + 3} fill="none" stroke={n.color} strokeOpacity={0.35} strokeWidth={1} />}
							<text
								y={r + 14}
								textAnchor="middle"
								className="pointer-events-none select-none font-ui text-[11px] font-semibold"
								fill="var(--color-ink)"
							>
								{n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
							</text>
						</g>
					);
				})}
			</g>
		</svg>
	);
}
