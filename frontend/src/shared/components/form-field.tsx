import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/shared/lib/cn";

export function FormField({
  label,
  children,
  className,
  hint,
  error,
  required,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <div className={cn("min-w-0 max-w-full space-y-1.5", className)}>
      <Label className="text-xs" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      <div className="min-w-0 max-w-full">{children}</div>
      {error ? (
        <p className="break-words text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="break-words text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
