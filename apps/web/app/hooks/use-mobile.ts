import { useEffect, useState } from "react";

/**
 * Tracks Tailwind's `lg` breakpoint (1024px). False during SSR and first
 * paint — portaled components (sheets, dialogs) can't render server-side
 * anyway, so the desktop branch is the correct hydration default.
 */
export function useIsMobile() {
	const [isMobile, setIsMobile] = useState(false);
	useEffect(() => {
		const mq = window.matchMedia("(max-width: 1023px)");
		const update = () => setIsMobile(mq.matches);
		update();
		mq.addEventListener("change", update);
		return () => mq.removeEventListener("change", update);
	}, []);
	return isMobile;
}
