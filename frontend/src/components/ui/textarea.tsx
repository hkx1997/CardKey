import * as React from "react";

import { cn } from "@/shared/lib/cn";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-[96px] w-full rounded-md border border-transparent bg-secondary/55 px-3 py-2 text-xs shadow-xs",
      "transition-[background-color,border-color,box-shadow] duration-150",
      "placeholder:text-muted-foreground",
      "hover:bg-secondary/75 hover:border-border/60",
      "focus-visible:outline-none focus-visible:border-ring/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/40",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";
