import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 border-2 px-3 py-1 text-base outline-none transition-[background-color,border-color,box-shadow] duration-[var(--duration-fast)] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-[var(--accent-muted)] focus-visible:ring-2 focus-visible:ring-[var(--focus-default)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--bg-disabled)] disabled:text-[var(--fg-disabled)] aria-invalid:border-[var(--error-muted)] aria-invalid:ring-2 aria-invalid:ring-[var(--error-container-default)] md:text-sm",
  {
    variants: {
      variant: {
        default:
          "h-9 rounded-[var(--radius-inputs)] border-transparent bg-card hover:border-[var(--border-soft)]",
        title:
          "h-8 rounded-[var(--radius-buttons)] border-transparent bg-transparent px-2 font-medium hover:bg-accent read-only:cursor-default read-only:hover:bg-transparent focus-visible:bg-card",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      data-variant={variant}
      className={cn(inputVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
