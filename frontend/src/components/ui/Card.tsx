import { forwardRef } from "react";
import { Link } from "react-router-dom";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  padded?: boolean;
  onClick?: () => void;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ children, className = "", elevated = false, padded = true, onClick, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`
          ${elevated ? "card-elevated" : "card"}
          ${padded ? "" : "p-0"}
          ${className}
        `}
        onClick={onClick}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

interface CardShellProps {
  children: React.ReactNode;
  className?: string;
}

export const CardShell = forwardRef<HTMLDivElement, CardShellProps>(
  ({ children, className = "" }, ref) => {
    return (
      <div
        ref={ref}
        className={`card-shell ${className}`}
      >
        <div className="card-core">
          {children}
        </div>
      </div>
    );
  }
);

CardShell.displayName = "CardShell";

interface CardCoreProps {
  children: React.ReactNode;
  className?: string;
}

export const CardCore = forwardRef<HTMLDivElement, CardCoreProps>(
  ({ children, className = "" }, ref) => {
    return (
      <div
        ref={ref}
        className={`card-core ${className}`}
      >
        {children}
      </div>
    );
  }
);

CardCore.displayName = "CardCore";

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, action, className = "" }: CardHeaderProps) {
  return (
    <div className={`card__header ${className}`}>
      <div>
        <h3 className="card__title">{title}</h3>
        {subtitle && (
          <p className="card__subtitle">{subtitle}</p>
        )}
      </div>
      {action && (
        <div style={{ flexShrink: 0 }}>{action}</div>
      )}
    </div>
  );
}

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function CardContent({ children, className = "" }: CardContentProps) {
  return <div className={className}>{children}</div>;
}

interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function CardFooter({ children, className = "" }: CardFooterProps) {
  return (
    <div className={`card-footer ${className}`}>
      {children}
    </div>
  );
}

interface MetricCardProps {
  /** Short metric name, rendered as the card's eyebrow. */
  title: string;
  value: string | number;
  icon: React.ReactNode;
  /**
   * Supporting line under the value. Must be truthful — pass a caption derived
   * from real data (or omit it). This deliberately replaces the old `trend`
   * percentage, which had no comparison data behind it.
   */
  caption?: string;
  /** Colours the value and the caption. */
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

/**
 * A single dashboard metric.
 *
 * Layout is deliberately a three-part flex column (header / value / caption)
 * with `margin-top: auto` on the caption, so the supporting line sits on the
 * card's baseline and can never collide with the bottom border. The previous
 * version stacked ad-hoc utility classes on `.card-elevated`, which declares no
 * padding — the label ended up 0.8px from the top edge and the caption 0.8px
 * from the bottom border.
 */
export function MetricCard({ title, value, icon, caption, variant = "default", className = "" }: MetricCardProps) {
  return (
    <div className={`card-elevated metric-card metric-card--${variant} ${className}`}>
      <div className="metric-card__header">
        <p className="metric-card__label">{title}</p>
        <span className="metric-card__icon" aria-hidden="true">
          {icon}
        </span>
      </div>

      {/* `role="group"` + label: the value and caption are read as one metric
          rather than as unrelated numbers echoing the heading. */}
      <div className="metric-card__body" role="group" aria-label={title}>
        <p className="metric-card__value">{value}</p>
        {caption !== undefined && <p className="metric-card__caption">{caption}</p>}
      </div>
    </div>
  );
}

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  primary?: boolean;
  className?: string;
}

/**
 * A navigation card. The whole card is the link target.
 *
 * The link carries an explicit `aria-label` because its accessible name would
 * otherwise be the entire card text (icon + heading + description + CTA), which
 * collides with the sidebar's own link names and reads poorly. Navigation uses
 * the router's `Link` so internal routes do not trigger a full page reload.
 */
export function ActionCard({ icon, title, description, href, primary = false, className = "" }: ActionCardProps) {
  return (
    <div className={`card-elevated ${className}`}>
      <Link to={href} className="action-card" aria-label={`Quick action: ${title}. ${description}`}>
        <div className={`action-card__icon ${primary ? "action-card__icon--primary" : ""}`}>
          {icon}
        </div>
        <div className="action-card__body">
          <h4 className="action-card__title">{title}</h4>
          <p className="action-card__description">{description}</p>
        </div>
      </Link>
    </div>
  );
}