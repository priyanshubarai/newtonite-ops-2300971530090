import { forwardRef } from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "status" | "priority" | "type";
  status?: "open" | "in_progress" | "awaiting_approval" | "resolved" | "closed";
  priority?: "low" | "medium" | "high" | "critical";
  className?: string;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ children, variant = "default", status, priority, className = "" }, ref) => {
    const baseClass = "badge";
    
    let variantClass = "badge--default";
    if (variant === "status" && status) {
      variantClass = `badge--status-${status.replace("_", "-")}`;
    } else if (variant === "priority" && priority) {
      variantClass = `badge--priority-${priority}`;
    } else if (variant === "type") {
      variantClass = "badge--type";
    }

    return (
      <span
        ref={ref}
        className={`${baseClass} ${variantClass} ${className}`}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";

interface StatusBadgeProps {
  status: "open" | "in_progress" | "awaiting_approval" | "resolved" | "closed";
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  return <Badge variant="status" status={status} className={className}>{status.replace("_", " ")}</Badge>;
}

interface PriorityBadgeProps {
  priority: "low" | "medium" | "high" | "critical";
  className?: string;
}

export function PriorityBadge({ priority, className = "" }: PriorityBadgeProps) {
  return <Badge variant="priority" priority={priority} className={className}>{priority}</Badge>;
}

interface TypeBadgeProps {
  type: string;
  className?: string;
}

export function TypeBadge({ type, className = "" }: TypeBadgeProps) {
  return <Badge variant="type" className={className}>{type.replace("_", " ")}</Badge>;
}