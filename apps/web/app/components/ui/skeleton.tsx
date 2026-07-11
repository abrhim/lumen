import { cn } from "~/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // motion-reduce:animate-none so every consumer honors prefers-reduced-motion
      // (UX-A11Y-10) — the app.css reduced-motion block only covers view transitions
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
