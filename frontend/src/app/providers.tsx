import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/shared/auth/auth-context";
import { ConfirmProvider } from "@/shared/components/confirm-dialog";
import { DocumentMeta } from "@/shared/components/document-meta";
import { createAppQueryClient } from "@/shared/lib/query-client";
import { ThemeProvider, useTheme } from "@/shared/theme/theme-provider";

function ThemedToaster() {
  const { isDark } = useTheme();
  return (
    <Toaster
      theme={isDark ? "dark" : "light"}
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        className: "fade-in",
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createAppQueryClient());

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <BrowserRouter>
            <AuthProvider>
              <ConfirmProvider>
                <DocumentMeta />
                {children}
                <ThemedToaster />
              </ConfirmProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
