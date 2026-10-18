import type { ReactNode } from "react";

export type AlertTone = "error" | "warning" | "success" | "info";

/**
 * Inline message banner. Errors are announced with `role="alert"` (assertive);
 * informational messages use `role="status"`.
 */
export function Alert({
  tone = "info",
  title,
  children,
  actions,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const role = tone === "error" ? "alert" : "status";
  return (
    <div className={`alert alert--${tone}`} role={role}>
      <span className="alert__icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className="alert__content">
        {title && <p className="alert__title">{title}</p>}
        {children && <div className="alert__body">{children}</div>}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
    </div>
  );
}

const ICONS: Record<AlertTone, string> = {
  error: "!",
  warning: "!",
  success: "✓",
  info: "i",
};
