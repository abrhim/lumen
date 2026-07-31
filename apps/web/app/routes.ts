import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("scripture/:book", "routes/book.tsx"),
	route("scripture/:book/:chapter", "routes/scripture.tsx"),
	route("scripture/:book/:chapter/art", "routes/scripture.art.tsx"),
	route("word/:no", "routes/word.tsx"),
	route("media/:id", "routes/media.tsx"),
	route("strongs", "routes/strongs.tsx"),
	route("art", "routes/art.tsx"),
	route("collections", "routes/collections.index.tsx"),
	route("collections/:id", "routes/collections.tsx"),
	route("notes", "routes/notes.tsx"),
	// `/notes/new` is the create surface — the :id loader special-cases it (CF-29)
	route("notes/:id", "routes/notes.$id.tsx"),
	route("me", "routes/me.tsx"),
	route("about", "routes/about.tsx"),
	route("roadmap", "routes/roadmap.tsx"),
	route("login", "routes/login.tsx"),
	route("auth/confirm", "routes/auth.confirm.tsx"),
	route("logout", "routes/logout.tsx"),
	route("admin/users", "routes/admin.users.tsx"),
	route("api/search", "routes/api.search.tsx"),
	route("api/notes-linked", "routes/api.notes-linked.tsx"),
	route("search", "routes/search.tsx"),
	// Typed node pages — the type is the slug (/people/:id, /principles/:id…).
	// LAST on purpose: static routes above always win; the loader 404s any
	// :type outside the known slug set (fail-closed).
	route(":type/:id", "routes/node.tsx"),
] satisfies RouteConfig;
