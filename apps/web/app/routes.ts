import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("scripture/:book", "routes/book.tsx"),
	route("scripture/:book/:chapter", "routes/scripture.tsx"),
	route("scripture/:book/:chapter/art", "routes/scripture.art.tsx"),
	route("word/:no", "routes/word.tsx"),
	route("media/:id", "routes/media.tsx"),
	route("collections/:id", "routes/collections.tsx"),
	route("login", "routes/login.tsx"),
	route("auth/confirm", "routes/auth.confirm.tsx"),
	route("logout", "routes/logout.tsx"),
	route("admin/users", "routes/admin.users.tsx"),
] satisfies RouteConfig;
