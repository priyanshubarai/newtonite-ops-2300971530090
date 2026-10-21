interface Column<T> {
  key: string;
  header: string;
  width?: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  /** Render the body cell as a row header (`<th scope="row">`) instead of a
   *  `<td>`. A `<th>` must be a direct child of `<tr>`, so this belongs to the
   *  cell rather than to the caller's `render` output. */
  rowHeader?: boolean;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

export function Table<T extends { [key: string]: any }>({
  columns,
  data,
  keyField,
  onRowClick,
  emptyState,
  loading,
  className = "",
}: TableProps<T>) {
  if (loading) {
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col" style={{ width: col.width, textAlign: col.align || "left" }}>
                  <Skeleton width={col.width || "120px"} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(5)].map((_, i) => (
              <tr key={i}>
                {columns.map(() => <td><Skeleton width="100%" /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`table-wrap ${className}`}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{ width: col.width, textAlign: col.align || "left" }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="state state--full" style={{ padding: "var(--space-10)" }}>
                {emptyState || (
                  <p className="text-center text-[var(--color-text-tertiary)]">No data available</p>
                )}
              </td>
            </tr>
          ) : (
            <>
              {data.map((row) => (
                <tr
                  key={row[keyField]}
                  className={onRowClick ? "table__row--clickable" : undefined}
                  style={{ textAlign: "left" }}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) =>
                    col.rowHeader ? (
                      <th
                        key={col.key}
                        scope="row"
                        className="table__title-cell"
                        style={{ textAlign: col.align || "left" }}
                      >
                        {col.render(row)}
                      </th>
                    ) : (
                      <td key={col.key} style={{ textAlign: col.align || "left" }}>
                        {col.render(row)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton({
  variant = "text",
  width,
  height,
  className = "",
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "text" | "circular" | "rectangular"; width?: string | number; height?: string | number }) {
  const baseClass = "skeleton";
  const variantClass = variant !== "text" ? `skeleton--${variant}` : "";

  return (
    <div
      className={`${baseClass} ${variantClass} ${className}`}
      style={{
        width,
        height: variant === "text" ? "1rem" : height,
        ...style,
      }}
      {...props}
    />
  );
}

export const TextSkeleton = ({ lines = 3, className = "" }: { lines?: number; className?: string }) => (
  <div className={`text-skeleton ${className}`}>
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

interface TablePaginationProps {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  onPageChange: (page: number) => void;
  busy?: boolean;
}

export function TablePagination({ pagination, onPageChange, busy }: TablePaginationProps) {
  const { page, pageSize, total, totalPages, hasNextPage, hasPrevPage } = pagination;

  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="pagination__summary">
        Showing {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, total)} of {total}
      </p>

      <div className="pagination__controls">
        <button
          className="pagination__button"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPrevPage || busy}
          aria-label="Previous page"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span className="pagination__page">
          Page {page} of {totalPages}
        </span>

        <button
          className="pagination__button"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage || busy}
          aria-label="Next page"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </nav>
  );
}