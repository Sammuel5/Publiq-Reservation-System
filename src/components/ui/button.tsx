import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * Button — the primary interactive primitive.
 * Gold is reserved for the single main action in a view; everything else is
 * neutral, outline or ghost.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-medium tracking-wide",
    "transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-[var(--ease-lux)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    "min-h-11 sm:min-h-10", // 44px touch target on phones
  ],
  {
    variants: {
      variant: {
        default:
          "bg-gold text-[#111111] font-semibold hover:bg-gold-soft active:translate-y-px shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset]",
        secondary:
          "bg-card-elevated text-foreground border border-line hover:border-line-strong hover:bg-[#303030]",
        outline:
          "border border-gold/45 text-gold hover:bg-gold/10 hover:border-gold/70",
        ghost: "text-muted hover:text-foreground hover:bg-card",
        destructive: "bg-danger text-white hover:bg-[#dc2626]",
        link: "text-gold underline-offset-4 hover:underline min-h-0 p-0",
      },
      size: {
        default: "h-11 px-5 sm:h-10",
        sm: "h-9 px-3.5 text-[13px]",
        lg: "h-12 px-7 text-[15px]",
        icon: "size-11 sm:size-10 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <span
              aria-hidden
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
