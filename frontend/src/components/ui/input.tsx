import * as React from "react";

import { cn } from "@/shared/lib/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-8 w-full rounded-md border border-transparent bg-secondary/55 px-3 py-1 text-xs shadow-xs",
      "transition-[background-color,border-color,box-shadow] duration-150",
      "placeholder:text-muted-foreground",
      "hover:bg-secondary/75 hover:border-border/60",
      "focus-visible:outline-none focus-visible:border-ring/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/40",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";
