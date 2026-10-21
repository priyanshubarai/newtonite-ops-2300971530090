import { forwardRef } from "react";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ variant = "text", width, height, className = "", style, ...props }, ref) => {
    const baseStyles = "bg-[var(--color-border)] rounded overflow-hidden";

    const variantStyles = {
      text: "h-4 rounded",
      circular: "rounded-full",
      rectangular: "rounded-md",
    };

    return (
      <div
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${className}`}
        style={{
          width,
          height: variant === "text" ? "1rem" : height,
          ...style,
        }}
        {...props}
      />
    );
  }
);

Skeleton.displayName = "Skeleton";

export const TextSkeleton = ({ lines = 3, className = "" }: { lines?: number; className?: string }) => (
  <div className={`space-y-2 ${className}`}>
    {[...Array(lines)].map((_, i) => (
      <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
    ))}
  </div>
);

export const CardSkeleton = ({ className = "" }: { className?: string }) => (
  <div className={`card-elevated p-6 ${className}`}>
    <Skeleton variant="circular" width={48} height={48} className="mb-4" />
    <TextSkeleton lines={2} />
    <div className="mt-4 flex gap-2">
      <Skeleton width={80} height={36} />
      <Skeleton width={60} height={36} />
    </div>
  </div>
);

export const TableSkeleton = ({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) => (
  <tbody>
    {[...Array(rows)].map((_, i) => (
      <tr key={i}>
        {[...Array(columns)].map((_, j) => (
          <td key={j}><Skeleton width="100%" /></td>
        ))}
      </tr>
    ))}
  </tbody>
);