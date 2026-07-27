import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium",
    "cursor-pointer select-none",
    "transition-[transform,background-color,box-shadow,color,opacity,border-color] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.97] active:brightness-[0.96]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground shadow-sm",
          "hover:bg-primary/88 hover:shadow-md",
          "active:bg-primary/80",
        ].join(" "),
        destructive: [
          "bg-destructive text-white shadow-sm",
          "hover:bg-destructive/90 hover:shadow-md",
          "active:bg-destructive/80",
        ].join(" "),
        outline: [
          "border border-border/90 bg-background text-foreground shadow-xs",
          "hover:bg-accent hover:text-accent-foreground hover:border-foreground/20",
          "active:bg-accent/80",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-foreground",
          "hover:bg-secondary/75 hover:shadow-sm",
          "active:bg-secondary/65",
        ].join(" "),
        ghost: [
          "text-foreground",
          "hover:bg-accent hover:text-accent-foreground",
          "active:bg-accent/80",
        ].join(" "),
        link: [
          "text-primary underline-offset-4",
          "hover:underline hover:opacity-90",
          "active:opacity-80 active:scale-100",
        ].join(" "),
        success: [
          "bg-success text-success-foreground shadow-sm",
          "hover:bg-success/90 hover:shadow-md",
          "active:bg-success/80",
        ].join(" "),
      },
      size: {
        default: "h-8 px-3 text-xs",
        sm: "h-8 px-3 text-xs",
        lg: "h-9 px-5 text-sm",
        icon: "h-8 w-8 text-xs",
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
  /** 加载中：禁用并显示 spinner，保留宽度 */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? undefined : isDisabled}
        aria-busy={loading || undefined}
        aria-disabled={asChild ? isDisabled : undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
