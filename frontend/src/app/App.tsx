import { AppRouter } from "@/app/router";
import { ErrorBoundary } from "@/shared/components/error-boundary";

export function App() {
  return (
    <ErrorBoundary title="应用异常">
      <AppRouter />
    </ErrorBoundary>
  );
}
