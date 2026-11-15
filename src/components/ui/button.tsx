import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Targets are at least 48px tall (WCAG 2.5.8 asks for 24px; elders benefit from more). */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-transparent font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-70 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline: "border-input bg-surface text-foreground hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "min-h-0 rounded-sm px-0.5 text-primary underline underline-offset-4 hover:text-primary-hover",
      },
      size: {
        default: "min-h-12 px-5 text-base",
        sm: "min-h-10 px-4 text-[0.95rem]",
        lg: "min-h-14 px-7 text-lg",
        xl: "min-h-20 px-8 text-xl",
        icon: "size-12",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner and blocks clicks while keeping keyboard focus (unlike `disabled`). */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, children, onClick, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      aria-disabled={loading || props["aria-disabled"] ? true : undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {loading && <Loader2 aria-hidden="true" className="animate-spin" />}
      {children}
    </button>
  );
});
