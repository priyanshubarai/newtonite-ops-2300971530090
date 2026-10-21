import { type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "start" | "end";
  fullWidth?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  iconPosition = "start",
  fullWidth,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const baseClass = "button";
  const variantClass = `button--${variant}`;
  const sizeClass = size !== "md" ? `button--${size}` : "";
  const fullWidthClass = fullWidth ? "button--full" : "";
  const iconOnlyClass = icon && !children ? "button--icon-only" : "";

  return (
    <button
      className={`${baseClass} ${variantClass} ${sizeClass} ${fullWidthClass} ${iconOnlyClass} ${className}`}
      disabled={loading || disabled}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <span className="button__spinner" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" />
          </svg>
        </span>
      ) : icon && iconPosition === "start" ? (
        <span className="button__icon">{icon}</span>
      ) : null}
      {children}
      {icon && iconPosition === "end" && !loading && (
        <span className="button__icon button__icon--end">{icon}</span>
      )}
    </button>
  );
}

export default Button;