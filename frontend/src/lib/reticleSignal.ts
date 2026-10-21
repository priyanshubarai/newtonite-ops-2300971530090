/**
 * Fire a Reticle signal when a piece of state is committed.
 *
 * Reticle pairs a DOM change with the signal that explains it, so a verification
 * can assert the *intent* ("this item is now claimed") instead of reverse-
 * engineering it from a rendered string. Without one, a mutation that changes
 * the screen looks identical to a stray re-render — the tooling reports
 * "the DOM changed and no signal fired for it".
 *
 * The import is dynamic and its failure is swallowed: `@reticlehq/*` is a dev
 * dependency that is absent from a production install, and a missing signal
 * must never break the thing it was meant to describe.
 */
export function reticleSignal(name: string, data?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  void import("@reticlehq/react")
    .then((mod) => mod.reticle?.signal?.(name, data))
    .catch(() => {
      // No Reticle bundle in this build; the app carries on without a signal.
    });
}
