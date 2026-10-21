import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "../App";
import { AuthProvider } from "../auth/AuthContext";

/**
 * Render helpers. `renderApp` mounts the real route table inside a
 * `MemoryRouter` with the app's providers, so route guards, session handling,
 * and TanStack Query wiring are all exercised together.
 *
 * Retries are disabled so failures surface immediately instead of after
 * back-off, and the cache is not persisted between tests.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  { route = "/", state, initialEntries }: { route?: string; state?: unknown; initialEntries?: string[] } = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = createTestQueryClient();
  const entries = initialEntries ?? (state ? [{ pathname: route, state }] : [route]);
  const result = render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{ui}</AuthProvider>
        <Toaster position="top-center" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...result, queryClient };
}

export function renderApp(
  { route = "/", state, initialEntries }: { route?: string; state?: unknown; initialEntries?: string[] } = {},
) {
  return renderWithProviders(<App />, { route, state, initialEntries });
}

export function withProviders(node: ReactNode, route = "/"): ReactElement {
  return (
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>{node}</AuthProvider>
        <Toaster position="top-center" />
      </QueryClientProvider>
    </MemoryRouter>
  );
}
