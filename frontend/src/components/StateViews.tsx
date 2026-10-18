import type { ReactNode } from "react";

/** Shared loading / empty / error presentations used across screens. */

export function LoadingState({
  message = "Loading…",
  fullPage = false,
}: {
  message?: string;
  fullPage?: boolean;
}) {
  return (
    <div
      className={fullPage ? "state state--full" : "state"}
      role="status"
      aria-live="polite"
    >
      <span className="spinner" aria-hidden="true" />
      <p className="state__message">{message}</p>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  secondaryAction,
  fullPage = false,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  secondaryAction?: { label: string; onClick: () => void };
  fullPage?: boolean;
}) {
  return (
    <div className={fullPage ? "state state--full" : "state"} role="alert">
      <h2 className="state__title">{title}</h2>
      <p className="state__message">{message}</p>
      {(onRetry || secondaryAction) && (
        <div className="state__actions">
          {onRetry && (
            <button type="button" className="button button--primary" onClick={onRetry}>
              {retryLabel}
            </button>
          )}
          {secondaryAction && (
            <button type="button" className="button" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state--empty">
      <h2 className="state__title">{title}</h2>
      {message && <p className="state__message">{message}</p>}
      {action && <div className="state__actions">{action}</div>}
    </div>
  );
}
