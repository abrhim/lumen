/**
 * Structured logging for Workers Logs (observability.enabled picks up stdout).
 * One JSON line per event so the dashboard can filter on `event`.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
	console.error(JSON.stringify({ event, ...fields }));
}
