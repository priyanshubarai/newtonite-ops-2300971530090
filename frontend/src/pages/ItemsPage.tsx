import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
import { StatusBadge, PriorityBadge, TypeBadge } from "../components/ui/Badge";
import { ErrorState } from "../components/StateViews";
import { FormField } from "../components/FormField";
import { Table, TablePagination } from "../components/ui/Table";
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
import { PlusIcon, FilterIcon, XIcon, ChevronDownIcon, SearchIcon, Loader2Icon } from "lucide-react";

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

function parseSortValue(value: string | null): { sort: SortField; order: SortDirection } {
  if (!value) return { sort: "updatedAt", order: "desc" };
  const [sort, order] = value.split(":") as [SortField, SortDirection];
  const validSort = SORT_FIELDS.includes(sort) ? sort : "updatedAt";
  const validOrder = SORT_DIRECTIONS.includes(order) ? order : "desc";
  return { sort: validSort, order: validOrder };
}

function buildSortValue(sort: SortField, order: SortDirection): string {
  return `${sort}:${order}`;
}

export function ItemsPage() {
  const { memberships, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [initialized, setInitialized] = useState(false);
  const [text, setText] = useState({ search: "", assigneeId: "" });
  const [applied, setApplied] = useState<AppliedFilters>(INITIAL_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // The `search` value this page last wrote into the URL. The header's global
  // search is a second writer of the same param, so this page must be able to
  // tell "the URL changed because I wrote it" from "the URL changed because the
  // header pushed a new query" — otherwise the two writers overwrite each other
  // in a loop and neither query ever reaches the server.
  const lastWrittenSearch = useRef<string | null>(null);

  useEffect(() => {
    if (initialized) return;
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

    const hasUrlState = teamId || status || priority || assigneeId || search || preset || page !== 1 || pageSize !== DEFAULT_PAGE_SIZE || sort !== "updatedAt" || order !== "desc";
    if (hasUrlState) {
      setText({ search, assigneeId });
      lastWrittenSearch.current = search;
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

  // Adopt a `search` query pushed in from outside this page (the header's global
  // search) after mount. The mount effect above only reads the URL once, so
  // without this a header search made while the list is already open would be
  // silently discarded. Values this page wrote itself are skipped.
  useEffect(() => {
    if (!initialized) return;
    const fromUrl = searchParams.get("search") ?? "";
    if (fromUrl === lastWrittenSearch.current) return;
    lastWrittenSearch.current = fromUrl;
    setText((prev) => (prev.search === fromUrl ? prev : { ...prev, search: fromUrl }));
    setApplied((prev) => (prev.search === fromUrl ? prev : { ...prev, search: fromUrl, page: 1 }));
  }, [searchParams, initialized]);

  const debouncedSearch = useDebouncedValue(text.search, 300);
  const debouncedAssignee = useDebouncedValue(text.assigneeId, 300);

  useEffect(() => {
    const nextSearch = debouncedSearch.trim();
    const nextAssignee = debouncedAssignee.trim();
    setApplied((prev) => {
      if (prev.search === nextSearch && prev.assigneeId === nextAssignee) return prev;
      return { ...prev, search: nextSearch, assigneeId: nextAssignee, page: 1 };
    });
  }, [debouncedSearch, debouncedAssignee]);

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
    lastWrittenSearch.current = applied.search;
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

  // Table columns
  const columns = [
    { key: "title", header: "Title", width: "28%", rowHeader: true, render: (item: any) => (
      <Link to={`/items/${item.id}`} className="table__title-link">
        {item.title}
      </Link>
    )},
    { key: "status", header: "Status", width: "10%", render: (item: any) => <StatusBadge status={item.status} /> },
    { key: "priority", header: "Priority", width: "10%", render: (item: any) => <PriorityBadge priority={item.priority} /> },
    { key: "type", header: "Type", width: "10%", render: (item: any) => <TypeBadge type={item.type} /> },
    { key: "team", header: "Team", width: "14%", render: (item: any) => <span>{teamNames.get(item.teamId) ?? shortId(item.teamId)}</span> },
    { key: "assignee", header: "Assignee", width: "14%", render: (item: any) => <AssigneeLabel assigneeId={item.assigneeId} currentUserId={user?.id} /> },
    { key: "due", header: "Due", width: "12%", render: (item: any) => {
      const overdue = isOverdue(item.dueAt);
      return item.dueAt ? (
        <span className={overdue ? "text-danger" : undefined}>
          {formatDate(item.dueAt)}
          {overdue && <span className="visually-hidden"> (overdue)</span>}
          {overdue && <span aria-hidden="true"> · Overdue</span>}
        </span>
      ) : (
        <span className="muted">—</span>
      );
    }},
    { key: "updated", header: "Updated", width: "16%", render: (item: any) => <span className="muted">{formatDateTime(item.updatedAt)}</span> },
  ];

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Work items</h1>
          <p className="page__subtitle">
            Track and resolve operational work across your teams.
          </p>
        </div>
        {/* Only rendered when at least one of the user's teams grants create. */}
        {canCreate && (
          <Link className="button button--primary" to="/items/new">
            <PlusIcon width="16" height="16" className="mr-1" />
            New work item
          </Link>
        )}
      </div>

      <section className="card-shell">
        <div className="card-core p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-h3">Filters</h2>
              <button
                type="button"
                className={`button button--ghost button--sm ${filtersOpen ? "" : "rotate-180"}`}
                onClick={() => setFiltersOpen(!filtersOpen)}
                aria-expanded={filtersOpen}
                aria-controls="filters-panel"
              >
                <FilterIcon width="16" height="16" />
                {filtersOpen ? "Hide" : "Show"} filters
                <ChevronDownIcon width="14" height="14" className="ml-1" style={{ transform: filtersOpen ? "rotate(180deg)" : "rotate(0)" }} />
              </button>
            </div>
          </div>

          <form
            id="filters-panel"
            className="filters"
            onSubmit={(event) => event.preventDefault()}
            aria-label="Work item filters"
            style={{ display: filtersOpen ? "block" : "none" }}
          >
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
                  <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none" width="18" height="18" />
                    <input
                      {...props}
                      className="input pl-10"
                      type="search"
                      placeholder="Title or description"
                      value={text.search}
                      onChange={(event) => setText((prev) => ({ ...prev, search: event.target.value }))}
                    />
                  </div>
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
            </div>

            <div className="filters__actions flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters && applied.pageSize === DEFAULT_PAGE_SIZE}
              >
                <XIcon width="16" height="16" className="mr-1" />
                Clear filters
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="results" aria-busy={itemsQuery.isFetching}>
        {itemsQuery.isPending && !data && (
          <div className="card-shell">
            <div className="card-core p-12 text-center">
              <Loader2Icon width="48" height="48" className="mx-auto mb-4 animate-spin text-[var(--color-primary)]" />
              <p className="text-body text-[var(--color-text-secondary)]">Loading work items…</p>
            </div>
          </div>
        )}

        {itemsQuery.isError && !data && (
          <ErrorState
            title="We couldn't load work items"
            message={errorMessage(itemsQuery.error)}
            onRetry={() => void itemsQuery.refetch()}
          />
        )}

        {data && data.items.length === 0 && (
          <div className="card-shell">
            <div className="card-core p-12 text-center">
              <div className="state state--full">
                {hasActiveFilters ? (
                  <>
                    <p className="state__title">No items match your filters</p>
                    <p className="state__message">Try widening your filters or clearing them.</p>
                    <div className="state__actions">
                      <button type="button" className="button button--primary" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="state__title">No work items yet</p>
                    <p className="state__message">Work items created in your teams will appear here.</p>
                    {canCreate && (
                      <div className="state__actions">
                        <Link to="/items/new" className="button button--primary">
                          Create the first work item
                        </Link>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
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

            <Table
              data={data.items}
              columns={columns}
              keyField="id"
              onRowClick={(item) => navigate(`/items/${item.id}`)}
              loading={itemsQuery.isFetching}
            />

            <TablePagination
              pagination={data.pagination}
              onPageChange={setPage}
              busy={itemsQuery.isFetching}
            />
          </>
        )}

        {itemsQuery.isFetching && data && (
          <p className="muted refreshing text-center py-4" aria-live="polite">
            <Loader2Icon width="16" height="16" className="inline-block animate-spin mr-2" />
            Updating results…
          </p>
        )}
      </section>
    </div>
  );
}

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