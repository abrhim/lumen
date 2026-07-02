import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("scripture/:book/:chapter", "routes/scripture.tsx"),
] satisfies RouteConfig;
