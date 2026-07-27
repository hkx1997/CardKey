import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AdminLayout } from "@/app/layouts/admin-layout";
import { RequireAuth } from "@/app/layouts/require-auth";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { PageLoading } from "@/shared/components/page-loading";

const RedeemPage = lazy(() =>
  import("@/features/redeem/redeem-page").then((m) => ({
    default: m.RedeemPage,
  })),
);
const ApiDocsPage = lazy(() =>
  import("@/features/docs/api-docs-page").then((m) => ({
    default: m.ApiDocsPage,
  })),
);
const LoginPage = lazy(() =>
  import("@/features/auth/login-page").then((m) => ({
    default: m.LoginPage,
  })),
);
const ChangePasswordPage = lazy(() =>
  import("@/features/auth/change-password-page").then((m) => ({
    default: m.ChangePasswordPage,
  })),
);
const SetupPage = lazy(() =>
  import("@/features/auth/setup-page").then((m) => ({
    default: m.SetupPage,
  })),
);
const DashboardPage = lazy(() =>
  import("@/features/dashboard/dashboard-page").then((m) => ({
    default: m.DashboardPage,
  })),
);
const CategoriesPage = lazy(() =>
  import("@/features/categories/categories-page").then((m) => ({
    default: m.CategoriesPage,
  })),
);
const CardsPage = lazy(() =>
  import("@/features/cards/cards-page").then((m) => ({
    default: m.CardsPage,
  })),
);
const ImportPage = lazy(() =>
  import("@/features/cards/import-page").then((m) => ({
    default: m.ImportPage,
  })),
);
const BatchesPage = lazy(() =>
  import("@/features/batches/batches-page").then((m) => ({
    default: m.BatchesPage,
  })),
);
const RedeemsPage = lazy(() =>
  import("@/features/redeems/redeems-page").then((m) => ({
    default: m.RedeemsPage,
  })),
);
const ApiKeysPage = lazy(() =>
  import("@/features/api-keys/api-keys-page").then((m) => ({
    default: m.ApiKeysPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/features/settings/settings-page").then((m) => ({
    default: m.SettingsPage,
  })),
);
const AuditPage = lazy(() =>
  import("@/features/audit/audit-page").then((m) => ({
    default: m.AuditPage,
  })),
);
const AdminApiDocsPage = lazy(() =>
  import("@/features/docs/admin-api-docs-page").then((m) => ({
    default: m.AdminApiDocsPage,
  })),
);

function LazyPage({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <LazyPage>
            <RedeemPage />
          </LazyPage>
        }
      />
      <Route
        path="/docs"
        element={
          <LazyPage>
            <ApiDocsPage />
          </LazyPage>
        }
      />
      <Route
        path="/admin/setup"
        element={
          <LazyPage>
            <SetupPage />
          </LazyPage>
        }
      />
      <Route
        path="/admin/login"
        element={
          <LazyPage>
            <LoginPage />
          </LazyPage>
        }
      />
      <Route element={<RequireAuth />}>
        <Route
          path="/admin/change-password"
          element={
            <LazyPage>
              <ChangePasswordPage />
            </LazyPage>
          }
        />
        <Route path="/admin" element={<AdminLayout />}>
          <Route
            index
            element={
              <LazyPage>
                <DashboardPage />
              </LazyPage>
            }
          />
          <Route
            path="categories"
            element={
              <LazyPage>
                <CategoriesPage />
              </LazyPage>
            }
          />
          <Route
            path="cards"
            element={
              <LazyPage>
                <CardsPage />
              </LazyPage>
            }
          />
          <Route
            path="cards/import"
            element={
              <LazyPage>
                <ImportPage />
              </LazyPage>
            }
          />
          <Route
            path="batches"
            element={
              <LazyPage>
                <BatchesPage />
              </LazyPage>
            }
          />
          <Route
            path="redeems"
            element={
              <LazyPage>
                <RedeemsPage />
              </LazyPage>
            }
          />
          <Route
            path="api-keys"
            element={
              <LazyPage>
                <ApiKeysPage />
              </LazyPage>
            }
          />
          <Route
            path="api-docs"
            element={
              <LazyPage>
                <AdminApiDocsPage />
              </LazyPage>
            }
          />
          <Route
            path="settings"
            element={
              <LazyPage>
                <SettingsPage />
              </LazyPage>
            }
          />
          <Route
            path="audit"
            element={
              <LazyPage>
                <AuditPage />
              </LazyPage>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
