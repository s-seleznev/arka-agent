import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--radius-buttons)] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[background-color,color,border-color,box-shadow] duration-[var(--duration-fast)] focus-visible:ring-2 focus-visible:ring-[var(--focus-default)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-[var(--fg-disabled)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:bg-[var(--neutral-container-soft)]",
        outline:
          "border-[var(--border-soft)] bg-card text-foreground hover:border-[var(--border-default)] hover:bg-accent active:bg-[var(--neutral-container-default)] aria-expanded:border-[var(--border-default)] aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[var(--neutral-container-hover)] active:bg-[var(--neutral-container-active)] aria-expanded:bg-[var(--neutral-container-hover)] disabled:bg-[var(--neutral-container-soft)]",
        ghost:
          "bg-transparent text-foreground hover:bg-accent active:bg-[var(--neutral-container-default)] aria-expanded:bg-accent",
        destructive:
          "bg-[var(--error-container-default)] text-[var(--error-on-container)] hover:bg-[var(--error-container-hover)] hover:text-[var(--error-hover)] active:bg-[var(--error-container-active)] active:text-[var(--error-active)] focus-visible:ring-[var(--error-container-active)] disabled:bg-[var(--neutral-container-soft)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
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
