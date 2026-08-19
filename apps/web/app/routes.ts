import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("scripture/:book", "routes/book.tsx"),
	route("scripture/:book/:chapter", "routes/scripture.tsx"),
	route("scripture/:book/:chapter/art", "routes/scripture.art.tsx"),
	route("word/:no", "routes/word.tsx"),
	route("media/:id", "routes/media.tsx"),
	// canonical episode home (media/:id 301s here; serial = episodic content)
	route("collections/:cid/serial/:id", "routes/serial.tsx"),
	route("strongs", "routes/strongs.tsx"),
	route("art", "routes/art.tsx"),
	route("collections", "routes/collections.index.tsx"),
	route("collections/:id", "routes/collections.tsx"),
	// Index over the typed node pages below; must sit above the `:type/:id`
	// catch-all, which would otherwise never see a bare `/principles`.
	route("principles", "routes/principles.index.tsx"),
	route("notes", "routes/notes.tsx"),
	// `/notes/new` is the create surface — the :id loader special-cases it (CF-29)
	route("notes/:id", "routes/notes.$id.tsx"),
	route("me", "routes/me.tsx"),
	route("about", "routes/about.tsx"),
	route("roadmap", "routes/roadmap.tsx"),
	route("privacy", "routes/privacy.tsx"),
	route("terms", "routes/terms.tsx"),
	route("login", "routes/login.tsx"),
	route("auth/confirm", "routes/auth.confirm.tsx"),
	route("auth/google", "routes/auth.google.tsx"),
	route("auth/callback", "routes/auth.callback.tsx"),
	route("logout", "routes/logout.tsx"),
	route("admin/users", "routes/admin.users.tsx"),
	route("admin/enrichment", "routes/admin.enrichment.tsx"),
	route("api/enrichment-review", "routes/api.enrichment-review.tsx"),
	route("api/search", "routes/api.search.tsx"),
	route("api/notes-linked", "routes/api.notes-linked.tsx"),
	route("api/highlight", "routes/api.highlight.tsx"),
	route("search", "routes/search.tsx"),
	// Typed node pages — the type is the slug (/people/:id, /principles/:id…).
	// LAST on purpose: static routes above always win; the loader 404s any
	// :type outside the known slug set (fail-closed).
	route(":type/:id", "routes/node.tsx"),
] satisfies RouteConfig;
