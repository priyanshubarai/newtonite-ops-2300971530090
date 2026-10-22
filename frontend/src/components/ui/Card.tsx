import { Link } from "react-router-dom";

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