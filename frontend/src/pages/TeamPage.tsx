import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listItems } from "../api/items";
import type { ItemFilters, SortDirection, SortField, WorkPriority, WorkStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PriorityBadge, StatusBadge, TypeBadge } from "../components/Badges";
import { ErrorState, LoadingState } from "../components/StateViews";
import { Input, Select } from "../components/ui/Input";
import { Pagination } from "../components/Pagination";
import {
  DEFAULT_PAGE_SIZE,
  PRIORITY_LABELS,
  STATUS_LABELS,
  SORT_FIELDS,
  SORT_DIRECTIONS,
} from "../lib/constants";
import { shortId } from "../lib/format";
import { errorMessage } from "../lib/apiErrors";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { teamsWhereUserCanCreate, canApproveTransition } from "../lib/permissions";

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

export function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { memberships } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const teamMembership = memberships.find((m) => m.teamId === teamId);
  const teamName = teamMembership?.teamName ?? "Unknown team";
  const userRole = teamMembership?.role;
  const canCreate = teamMembership ? teamsWhereUserCanCreate([teamMembership]).length > 0 : false;
  const canApprove = userRole ? canApproveTransition(userRole) : false;

  const [initialized, setInitialized] = useState(false);
  const [text, setText] = useState({ search: "", assigneeId: "" });
  const [applied, setApplied] = useState<AppliedFilters>({ ...INITIAL_FILTERS, teamId: teamId ?? "" });

  useEffect(() => {
    if (initialized) return;
    const params = searchParams.toString() ? searchParams : new URLSearchParams(window.location.search);
    const status = params.get("status") ?? "";
    const priority = params.get("priority") ?? "";
    const assigneeId = params.get("assigneeId") ?? "";
    const search = params.get("search") ?? "";
    const preset = params.get("preset") ?? "";
    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize")) || DEFAULT_PAGE_SIZE));
    const { sort, order } = parseSortValue(params.get("sort"));

    const hasUrlState = status || priority || assigneeId || search || preset || page !== 1 || pageSize !== DEFAULT_PAGE_SIZE || sort !== "updatedAt" || order !== "desc";
    if (hasUrlState) {
      setText({ search, assigneeId });
      setApplied((prev) => ({
        ...prev,
        status: status as WorkStatus | "",
        priority: priority as WorkPriority | "",
        assigneeId,
        search,
        preset: preset as "assigned" | "unassigned_urgent" | "awaiting_approval" | "",
        sort,
        order,
        pageSize,
        page,
      }));
    }
    setInitialized(true);
  }, [searchParams, initialized]);

  const debouncedSearch = useDebouncedValue(text.search, 300);
  const debouncedAssignee = useDebouncedValue(text.assigneeId, 300);

  useEffect(() => {
    setApplied((prev) => ({
      ...prev,
      search: debouncedSearch,
      assigneeId: debouncedAssignee,
      page: 1,
    }));
  }, [debouncedSearch, debouncedAssignee]);

  useEffect(() => {
    if (!initialized) return;
    const params = new URLSearchParams();
    if (applied.teamId) params.set("teamId", applied.teamId);
    if (applied.status) params.set("status", applied.status);
    if (applied.priority) params.set("priority", applied.priority);
    if (applied.assigneeId) params.set("assigneeId", applied.assigneeId);
    if (applied.search) params.set("search", applied.search);
    if (applied.preset) params.set("preset", applied.preset);
    if (applied.page !== 1) params.set("page", String(applied.page));
    if (applied.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(applied.pageSize));
    if (applied.sort !== "updatedAt" || applied.order !== "desc") params.set("sort", buildSortValue(applied.sort, applied.order));
    setSearchParams(params, { replace: true });
  }, [applied, initialized, setSearchParams]);

  const filters: ItemFilters = {
    teamId: applied.teamId || undefined,
    status: applied.status || undefined,
    priority: applied.priority || undefined,
    assigneeId: applied.assigneeId || undefined,
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
    retry: false,
    enabled: !!teamId,
  });

  const handleFilterChange = (key: keyof AppliedFilters, value: string | number) => {
    setApplied((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handlePresetChange = (preset: AppliedFilters["preset"]) => {
    setApplied((prev) => ({ ...prev, preset, page: 1 }));
  };

  const clearFilters = () => {
    setApplied({ ...INITIAL_FILTERS, teamId: teamId ?? "", preset: "" });
    setText({ search: "", assigneeId: "" });
  };

  const hasActiveFilters = applied.status || applied.priority || applied.assigneeId || applied.search || applied.preset;

  if (!teamId) {
    return <LoadingState />;
  }

  if (itemsQuery.isLoading) {
    return <LoadingState />;
  }

  if (itemsQuery.isError) {
    return <ErrorState title="Failed to load work items" message={errorMessage(itemsQuery.error)} onRetry={() => itemsQuery.refetch()} />;
  }

  const items = itemsQuery.data?.items ?? [];
  const pagination = itemsQuery.data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">{teamName}</h1>
          <p className="page__subtitle">
            {userRole && <span className="badge badge--type" style={{ background: "var(--color-info-bg)", borderColor: "var(--color-info)", color: "var(--color-info)" }}>{userRole}</span>}
          </p>
        </div>
        {canCreate && (
          <Link to="/items/new" className="button button--primary">
            New work item
          </Link>
        )}
      </header>

      <section className="filters" aria-label="Filters">
        <div className="filters__grid">
          <Input
            id={`team-${teamId}-search`}
            type="search"
            placeholder="Title or description…"
            value={text.search}
            onChange={(e) => setText((prev) => ({ ...prev, search: e.target.value }))}
            label="Search"
            hint="Search by title or description"
          />

          <Select
            id={`team-${teamId}-status`}
            value={applied.status}
            onChange={(e) => handleFilterChange("status", e.target.value as WorkStatus | "")}
            label="Status"
            options={[
              { value: "", label: "All statuses" },
              ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />

          <Select
            id={`team-${teamId}-priority`}
            value={applied.priority}
            onChange={(e) => handleFilterChange("priority", e.target.value as WorkPriority | "")}
            label="Priority"
            options={[
              { value: "", label: "All priorities" },
              ...Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>

        <div className="filters__actions" style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`button ${applied.preset === "assigned" ? "button--primary" : ""}`}
            onClick={() => handlePresetChange(applied.preset === "assigned" ? "" : "assigned")}
          >
            Assigned to me
          </button>
          <button
            type="button"
            className={`button ${applied.preset === "unassigned_urgent" ? "button--primary" : ""}`}
            onClick={() => handlePresetChange(applied.preset === "unassigned_urgent" ? "" : "unassigned_urgent")}
          >
            Unassigned urgent
          </button>
          {canApprove && (
            <button
              type="button"
              className={`button ${applied.preset === "awaiting_approval" ? "button--primary" : ""}`}
              onClick={() => handlePresetChange(applied.preset === "awaiting_approval" ? "" : "awaiting_approval")}
            >
              Awaiting approval
            </button>
          )}
          {hasActiveFilters && (
            <button type="button" className="button button--ghost" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </section>

      <section className="results" aria-label="Work items">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" style={{ width: "35%" }}>Work item</th>
                <th scope="col" style={{ width: "12%" }}>Status</th>
                <th scope="col" style={{ width: "10%" }}>Priority</th>
                <th scope="col" style={{ width: "10%" }}>Type</th>
                <th scope="col" style={{ width: "15%" }}>Team</th>
                <th scope="col" style={{ width: "18%" }}>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="state state--full" style={{ padding: "var(--space-6)" }}>
                    {hasActiveFilters ? (
                      <>
                        <p className="state__title">No matching work items</p>
                        <p className="state__message">Try adjusting your filters or search terms.</p>
                        <div className="state__actions">
                          <button type="button" className="button button--primary" onClick={clearFilters}>
                            Clear all filters
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="state__title">No work items in this team</p>
                        <p className="state__message">Create your first work item to get started.</p>
                        {canCreate && (
                          <div className="state__actions">
                            <Link to="/items/new" className="button button--primary">
                              Create work item
                            </Link>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/items/${item.id}`)}>
                    <td className="table__title-cell">
                      <Link className="table__title-link" to={`/items/${item.id}`} onClick={(e) => e.stopPropagation()}>
                        {item.title}
                      </Link>
                      <span className="mono muted" style={{ marginLeft: "var(--space-2)" }}>
                        {shortId(item.id)}
                      </span>
                    </td>
                    <td><StatusBadge status={item.status} /></td>
                    <td><PriorityBadge priority={item.priority} /></td>
                    <td><TypeBadge type={item.type} /></td>
                    <td className="muted">{item.teamName}</td>
                    <td>
                      {item.assigneeName ? (
                        item.assigneeName
                      ) : (
                        <span className="muted">Unassigned</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination pagination={pagination} onPageChange={(page) => handleFilterChange("page", page)} busy={itemsQuery.isFetching} />
      </section>
    </div>
  );
}