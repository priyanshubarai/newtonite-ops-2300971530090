import type { Pagination as PaginationMeta } from "../api/types";

/** Server-driven pagination controls. Never fetches anything itself. */
export function Pagination({
  pagination,
  onPageChange,
  busy = false,
}: {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  busy?: boolean;
}) {
  const { page, pageSize, total, totalPages, hasNextPage, hasPrevPage } = pagination;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageCount = Math.max(totalPages, 1);

  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="pagination__summary" aria-live="polite">
        {total === 0 ? (
          "No items to show"
        ) : (
          <>
            Showing <strong>{start}</strong>–<strong>{end}</strong> of <strong>{total}</strong>
          </>
        )}
      </p>
      <div className="pagination__controls">
        <button
          type="button"
          className="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPrevPage || busy}
        >
          Previous
        </button>
        <span className="pagination__page">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          className="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage || busy}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
