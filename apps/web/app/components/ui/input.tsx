import * as React from "react"

import { cn } from "~/lib/utils"

/**
 * Minimal shared text input (user-roles D9 — recurs: login hand-rolled one).
 * Matches the SelectTrigger visual language. `text-base md:text-sm` is
 * load-bearing: 14px on mobile triggers iOS Safari zoom-on-focus; render 16px
 * there and drop to 14px at `md` (Emil forms-controls).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-panel px-3 font-ui text-base text-ink shadow-sm outline-none transition-colors placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
