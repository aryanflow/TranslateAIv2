import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-tight transition-[color,box-shadow,transform,background] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg0)] disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-[#0b0c0e] shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_8px_24px_-8px_rgba(212,175,92,0.45)] hover:brightness-[1.06]",
        outline:
          "border border-[var(--edge-bright)] bg-[var(--panel)]/60 text-[var(--fg-soft)] shadow-sm hover:border-[var(--accent-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)]",
        ghost: "text-[var(--muted)] hover:bg-[var(--edge)]/80 hover:text-[var(--fg)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6 text-[15px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
