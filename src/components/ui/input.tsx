import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "file:text-foreground placeholder:text-muted-foreground/75 selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input/80 h-11 w-full min-w-0 rounded-xl border bg-background/72 px-3.5 py-2 text-base shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm transition-[border-color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          "focus-visible:border-ring/70 focus-visible:ring-[4px] focus-visible:ring-ring/15",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = "Input"

export { Input }
