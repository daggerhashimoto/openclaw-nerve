/* eslint-disable react-refresh/only-export-components -- buttonVariants is intentionally exported for reuse */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[3px] border border-transparent text-sm font-medium transition-[background-color,border-color,color,filter] duration-[120ms] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-invalid:border-destructive active:translate-y-px",
  {
    variants: {
      variant: {
        // Primary actions are the operator's: warm
        default: "bg-primary text-primary-foreground hover:brightness-105",
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-105",
        outline:
          "border-input bg-transparent text-foreground hover:bg-raised",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "border-transparent text-muted-foreground hover:bg-raised hover:text-foreground",
        link: "text-foreground underline decoration-pane-edge underline-offset-4 hover:decoration-operator",
      },
      size: {
        default: "h-9 px-3.5 py-1.5 has-[>svg]:px-3",
        xs: "h-7 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1.5 px-3.5 sm:h-8 sm:px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-5 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-11 sm:size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
