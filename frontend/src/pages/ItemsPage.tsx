import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listItems } from "../api/items";
import type {
  ItemFilters,
  SortDirection,
  SortField,
  WorkPriority,
  WorkStatus,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PriorityBadge, StatusBadge, TypeBadge } from "../components/Badges";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import { FormField } from "../components/FormField";
import { Pagination } from "../components/Pagination";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  SORT_FIELDS,
  SORT_DIRECTIONS,
} from "../lib/constants";
import { formatDate, formatDateTime, isOverdue, isUuid, shortId } from "../lib/format";
import { teamsWhereUserCanCreate } from "../lib/permissions";
import { errorMessage } from "../lib/apiErrors";
import { useDebouncedValue } from "../lib/useDebouncedValue";

interface AppliedFilters {
  teamId: string;
  status: WorkStatus | "";
  priority: WorkPriority | "";
  assigneeId: string;
  search: string;
  preset: "assigned" | "unassigned_urgent" | "awaiting_approval" | "";
  sort: SortField;
  order: SortDirection;
  pageSize: number;
  page: number;
}

const INITIAL_FILTERS: AppliedFilters = {
  teamId: "",
  status: "",
  priority: "",
  assigneeId: "",
  search: "",
  preset: "",
  sort: "updatedAt",
  order: "desc",
  pageSize: DEFAULT_PAGE_SIZE,
  page: 1,
};

/**
 * Parse a sort:string like "updatedAt:desc" into { sort, order }.
 * Falls back to defaults if the format is invalid.
 */
function parseSortValue(value: string | null): { sort: SortField; order: SortDirection } {
  if (!value) return { sort: "updatedAt", order: "desc" };
  const [sort, order] = value.split(":") as [SortField, SortDirection];
  const validSort = SORT_FIELDS.includes(sort) ? sort : "updatedAt";
  const validOrder = SORT_DIRECTIONS.includes(order) ? order : "desc";
  return { sort: validSort, order: validOrder };
}

/**
 * Build a sort string from sort and order.
 */
function buildSortValue(sort: SortField, order: SortDirection): string {
  return `${sort}:${order}`;
}

/**
 * Operations dashboard: a server-filtered, server-paginated list of the work
 * items the signed-in user is allowed to see.
 *
 * Filtering and pagination are performed by the backend; the browser never
 * downloads the full collection. Changing any filter resets to page 1, and the
 * free-text filters are debounced so a burst of keystrokes produces a single
 * request rather than one per character.
 *
 * Queue state is synchronized with the URL query string so that filters,
 * search, sort, and pagination are shareable and survive refresh.
 */
export function ItemsPage() {
  const { memberships, user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL search params on first render.
  // Use location.search as a fallback for environments where useSearchParams
  // doesn't parse initialEntries correctly (e.g., MemoryRouter in tests).
  const [initialized, setInitialized] = useState(false);
  const [text, setText] = useState({ search: "", assigneeId: "" });
  const [applied, setApplied] = useState<AppliedFilters>(INITIAL_FILTERS);

  useEffect(() => {
    if (initialized) return;
    // Prefer useSearchParams, but fall back to parsing location.search directly
    // for test environments where initialEntries query strings aren't parsed.
    const params = searchParams.toString() ? searchParams : new URLSearchParams(location.search);
    const teamId = params.get("teamId") ?? "";
    const status = params.get("status") ?? "";
    const priority = params.get("priority") ?? "";
    const assigneeId = params.get("assigneeId") ?? "";
    const search = params.get("search") ?? "";
    const preset = params.get("preset") ?? "";
    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize")) || DEFAULT_PAGE_SIZE));
    const { sort, order } = parseSortValue(params.get("sort"));

    // Only update if URL has non-default values to avoid unnecessary re-renders.
    const hasUrlState = teamId || status || priority || assigneeId || search || preset || page !== 1 || pageSize !== DEFAULT_PAGE_SIZE || sort !== "updatedAt" || order !== "desc";
    if (hasUrlState) {
      setText({ search, assigneeId });
      setApplied({
        teamId,
        status: status as WorkStatus | "",
        priority: priority as WorkPriority | "",
        assigneeId,
        search,
        preset: preset as "assigned" | "unassigned_urgent" | "awaiting_approval" | "",
        sort,
        order,
        pageSize,
        page,
      });
    }
    setInitialized(true);
  }, [searchParams, location.search, initialized]);

  const debouncedSearch = useDebouncedValue(text.search, 300);
  const debouncedAssignee = useDebouncedValue(text.assigneeId, 300);

  // Fold debounced text into the applied filters atomically, resetting the page.
  // Doing it here (rather than reading the debounced values directly) keeps the
  // request count to exactly one per settled search term.
  useEffect(() => {
    const nextSearch = debouncedSearch.trim();
    const nextAssignee = debouncedAssignee.trim();
    setApplied((prev) => {
      if (prev.search === nextSearch && prev.assigneeId === nextAssignee) return prev;
      return { ...prev, search: nextSearch, assigneeId: nextAssignee, page: 1 };
    });
  }, [debouncedSearch, debouncedAssignee]);

  // Synchronize applied filters to URL search params.
  // We use `replace` to avoid polluting history with every keystroke/filter change.
  useEffect(() => {
    if (!initialized) return;
    const nextParams = new URLSearchParams();
    if (applied.teamId) nextParams.set("teamId", applied.teamId);
    if (applied.status) nextParams.set("status", applied.status);
    if (applied.priority) nextParams.set("priority", applied.priority);
    if (applied.assigneeId) nextParams.set("assigneeId", applied.assigneeId);
    if (applied.search) nextParams.set("search", applied.search);
    if (applied.preset) nextParams.set("preset", applied.preset);
    if (applied.page !== 1) nextParams.set("page", String(applied.page));
    if (applied.pageSize !== DEFAULT_PAGE_SIZE) nextParams.set("pageSize", String(applied.pageSize));
    if (applied.sort !== "updatedAt" || applied.order !== "desc") {
      nextParams.set("sort", buildSortValue(applied.sort, applied.order));
    }
    setSearchParams(nextParams, { replace: true });
  }, [applied, initialized, setSearchParams]);

  function updateFilter<K extends keyof AppliedFilters>(key: K, value: AppliedFilters[K]) {
    setApplied((prev) => ({ ...prev, [key]: value, page: 1 }));
  }

  function setPage(page: number) {
    setApplied((prev) => ({ ...prev, page }));
  }

  function clearFilters() {
    setText({ search: "", assigneeId: "" });
    setApplied({ ...INITIAL_FILTERS });
  }

  // Only send a well-formed assignee id; a partial value is a UI hint, never an
  // invalid query parameter.
  const assigneeFilter = applied.assigneeId && isUuid(applied.assigneeId) ? applied.assigneeId : undefined;
  const assigneeInvalid = applied.assigneeId.length > 0 && !isUuid(applied.assigneeId);

  const filters: ItemFilters = {
    teamId: applied.teamId || undefined,
    status: applied.status || undefined,
    priority: applied.priority || undefined,
    assigneeId: assigneeFilter,
    search: applied.search || undefined,
    preset: applied.preset || undefined,
    page: applied.page,
    pageSize: applied.pageSize,
    sort: applied.sort,
    order: applied.order,
  };

  const itemsQuery = useQuery({
    queryKey: ["items", filters],
    queryFn: ({ signal }) => listItems(filters, signal),
    placeholderData: keepPreviousData,
  });

  const teamNames = new Map(memberships.map((m) => [m.teamId, m.teamName]));
  const canCreate = teamsWhereUserCanCreate(memberships).length > 0;
  const hasActiveFilters =
    Boolean(applied.teamId) ||
    Boolean(applied.status) ||
    Boolean(applied.priority) ||
    Boolean(applied.assigneeId) ||
    Boolean(applied.search);

  const data = itemsQuery.data;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Work items</h1>
          <p className="page__subtitle">
            Track and resolve operational work across your teams.
          </p>
        </div>
        {canCreate && (
          <Link to="/items/new" className="button button--primary">
            New work item
          </Link>
        )}
      </div>

      <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Work item filters">
        <h2 className="visually-hidden">Filters</h2>

        {/* Dashboard preset filters */}
        <div className="filters__presets">
          <span className="filters__preset-label">Quick filters:</span>
          <button
            type="button"
            className={`button button--preset ${applied.preset === "assigned" ? "button--preset-active" : ""}`}
            onClick={() => updateFilter("preset", applied.preset === "assigned" ? "" : "assigned")}
            aria-pressed={applied.preset === "assigned"}
            disabled={memberships.length === 0}
          >
            Assigned to me
          </button>
          <button
            type="button"
            className={`button button--preset ${applied.preset === "unassigned_urgent" ? "button--preset-active" : ""}`}
            onClick={() => updateFilter("preset", applied.preset === "unassigned_urgent" ? "" : "unassigned_urgent")}
            aria-pressed={applied.preset === "unassigned_urgent"}
          >
            Unassigned urgent
          </button>
          <button
            type="button"
            className={`button button--preset ${applied.preset === "awaiting_approval" ? "button--preset-active" : ""}`}
            onClick={() => updateFilter("preset", applied.preset === "awaiting_approval" ? "" : "awaiting_approval")}
            aria-pressed={applied.preset === "awaiting_approval"}
            disabled={!memberships.some((m) => m.role === "LEAD" || m.role === "ADMIN")}
          >
            Awaiting my approval
          </button>
        </div>

        <div className="filters__grid">
          <FormField id="filter-team" label="Team">
            {(props) => (
              <select
                {...props}
                className="input"
                value={applied.teamId}
                onChange={(event) => updateFilter("teamId", event.target.value)}
              >
                <option value="">All my teams</option>
                {memberships.map((m) => (
                  <option key={m.teamId} value={m.teamId}>
                    {m.teamName}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField id="filter-status" label="Status">
            {(props) => (
              <select
                {...props}
                className="input"
                value={applied.status}
                onChange={(event) => updateFilter("status", event.target.value as WorkStatus | "")}
              >
                <option value="">Any status</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField id="filter-priority" label="Priority">
            {(props) => (
              <select
                {...props}
                className="input"
                value={applied.priority}
                onChange={(event) =>
                  updateFilter("priority", event.target.value as WorkPriority | "")
                }
              >
                <option value="">Any priority</option>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <FormField
            id="filter-assignee"
            label="Assignee ID"
            hint="Exact user ID (UUID) of the assignee."
            error={assigneeInvalid ? "Enter a full user ID (UUID)." : null}
          >
            {(props) => (
              <input
                {...props}
                className="input"
                type="text"
                spellCheck={false}
                value={text.assigneeId}
                onChange={(event) =>
                  setText((prev) => ({ ...prev, assigneeId: event.target.value }))
                }
              />
            )}
          </FormField>

          <FormField id="filter-search" label="Search">
            {(props) => (
              <input
                {...props}
                className="input"
                type="search"
                placeholder="Title or description"
                value={text.search}
                onChange={(event) => setText((prev) => ({ ...prev, search: event.target.value }))}
              />
            )}
          </FormField>

          <FormField id="filter-sort" label="Sort by">
            {(props) => (
              <select
                {...props}
                className="input"
                value={`${applied.sort}:${applied.order}`}
                onChange={(event) => {
                  const [sort, order] = event.target.value.split(":") as [SortField, SortDirection];
                  setApplied((prev) => ({ ...prev, sort, order, page: 1 }));
                }}
              >
                <option value="updatedAt:desc">Recently updated</option>
                <option value="updatedAt:asc">Least recently updated</option>
                <option value="createdAt:desc">Newest first</option>
                <option value="createdAt:asc">Oldest first</option>
                <option value="priority:desc">Highest priority</option>
                <option value="dueAt:asc">Due soonest</option>
              </select>
            )}
          </FormField>

          <FormField id="filter-page-size" label="Per page">
            {(props) => (
              <select
                {...props}
                className="input"
                value={String(applied.pageSize)}
                onChange={(event) => updateFilter("pageSize", Number(event.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          <div className="filters__actions">
            <button
              type="button"
              className="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters && applied.pageSize === DEFAULT_PAGE_SIZE}
            >
              Clear filters
            </button>
          </div>
        </div>
      </form>

      <section className="results" aria-busy={itemsQuery.isFetching}>
        {itemsQuery.isPending && !data && <LoadingState message="Loading work items…" />}

        {itemsQuery.isError && !data && (
          <ErrorState
            title="We couldn't load work items"
            message={errorMessage(itemsQuery.error)}
            onRetry={() => void itemsQuery.refetch()}
          />
        )}

        {data && data.items.length === 0 && (
          <EmptyState
            title={hasActiveFilters ? "No items match your filters" : "No work items yet"}
            message={
              hasActiveFilters
                ? "Try widening your filters or clearing them."
                : "Work items created in your teams will appear here."
            }
            action={
              hasActiveFilters ? (
                <button type="button" className="button" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : canCreate ? (
                <Link to="/items/new" className="button button--primary">
                  Create the first work item
                </Link>
              ) : undefined
            }
          />
        )}

        {data && data.items.length > 0 && (
          <>
            {itemsQuery.isError && (
              <ErrorState
                title="Couldn't refresh"
                message={errorMessage(itemsQuery.error)}
                onRetry={() => void itemsQuery.refetch()}
              />
            )}

            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">
                  Work items{hasActiveFilters ? " matching your filters" : ""}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Type</th>
                    <th scope="col">Team</th>
                    <th scope="col">Assignee</th>
                    <th scope="col">Due</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => {
                    const overdue = isOverdue(item.dueAt);
                    return (
                      <tr key={item.id}>
                        <th scope="row" className="table__title-cell">
                          <Link to={`/items/${item.id}`} className="table__title-link">
                            {item.title}
                          </Link>
                        </th>
                        <td>
                          <StatusBadge status={item.status} />
                        </td>
                        <td>
                          <PriorityBadge priority={item.priority} />
                        </td>
                        <td>
                          <TypeBadge type={item.type} />
                        </td>
                        <td>{teamNames.get(item.teamId) ?? shortId(item.teamId)}</td>
                        <td>
                          <AssigneeLabel assigneeId={item.assigneeId} currentUserId={user?.id} />
                        </td>
                        <td>
                          {item.dueAt ? (
                            <span className={overdue ? "text-danger" : undefined}>
                              {formatDate(item.dueAt)}
                              {overdue && <span className="visually-hidden"> (overdue)</span>}
                              {overdue && <span aria-hidden="true"> · Overdue</span>}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="muted">{formatDateTime(item.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              pagination={data.pagination}
              onPageChange={setPage}
              busy={itemsQuery.isFetching}
            />
          </>
        )}

        {itemsQuery.isFetching && data && (
          <p className="muted refreshing" aria-live="polite">
            Updating results…
          </p>
        )}
      </section>
    </div>
  );
}

/** Show the assignee as "Unassigned", "You", or a compact id (no user directory exists). */
function AssigneeLabel({
  assigneeId,
  currentUserId,
}: {
  assigneeId: string | null;
  currentUserId?: string;
}) {
  if (!assigneeId) return <span className="muted">Unassigned</span>;
  if (currentUserId && assigneeId === currentUserId) return <span>You</span>;
  return (
    <span title={assigneeId} className="mono">
      {shortId(assigneeId)}
    </span>
  );
}
