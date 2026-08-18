// Canonical episode page: /collections/:cid/serial/:id (Abram 2026-08-18 —
// collection-scoped routes). The whole implementation lives in media.tsx;
// its loader canonicalizes BOTH routes (old /media/:id 301s in, a wrong
// :cid 301s to the episode's real collection).
export { loader, meta, default } from "./media";
