import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./auth/RequireAuth";
import { ItemCreatePage } from "./pages/ItemCreatePage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { ItemEditPage } from "./pages/ItemEditPage";
import { ItemsPage } from "./pages/ItemsPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OverviewPage } from "./pages/OverviewPage";
import { MyWorkPage } from "./pages/MyWorkPage";
import { NeedsAttentionPage } from "./pages/NeedsAttentionPage";
import { AwaitingApprovalPage } from "./pages/AwaitingApprovalPage";
import { TeamPage } from "./pages/TeamPage";

/**
 * Route table. Providers (query client, router, auth) live in `main.tsx` so the
 * routes themselves can be rendered inside a `MemoryRouter` in tests.
 *
 * Everything except `/login` is behind `RequireAuth`, and the authenticated
 * pages share the `AppShell` layout.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/assigned" element={<MyWorkPage />} />
          <Route path="/attention" element={<NeedsAttentionPage />} />
          <Route path="/approval" element={<AwaitingApprovalPage />} />
          <Route path="/teams" element={<Navigate to="/overview" replace />} />
          <Route path="/teams/:teamId" element={<TeamPage />} />
          <Route path="/items/new" element={<ItemCreatePage />} />
          <Route path="/items/:id" element={<ItemDetailPage />} />
          <Route path="/items/:id/edit" element={<ItemEditPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
