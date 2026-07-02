/**
 * Applied to the single requestHandler return in workers/app.ts, so every
 * response — including thrown 404/redirect Responses that RR7 funnels back —
 * carries the same headers (COR-5).
 */
export function applySecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Frame-Options", "DENY");
	headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
