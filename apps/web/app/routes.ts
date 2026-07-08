import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("scripture/:book", "routes/book.tsx"),
	route("scripture/:book/:chapter", "routes/scripture.tsx"),
	route("scripture/:book/:chapter/art", "routes/scripture.art.tsx"),
	route("api/strongs/:no", "routes/api.strongs.tsx"),
] satisfies RouteConfig;
