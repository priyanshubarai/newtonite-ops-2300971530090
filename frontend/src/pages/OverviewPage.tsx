import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listItems } from "../api/items";
import type { ItemFilters, SortDirection, SortField, WorkPriority, WorkStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge, PriorityBadge, TypeBadge } from "../components/ui/Badge";
import { ErrorState, LoadingState } from "../components/StateViews";
import { ActionCard, MetricCard, Table } from "../components/ui";
import { DEFAULT_PAGE_SIZE, SORT_FIELDS, SORT_DIRECTIONS } from "../lib/constants";
import { shortId } from "../lib/format";
import { errorMessage } from "../lib/apiErrors";
import { PlusIcon, FilterIcon, FlagIcon, ClockIcon, ChevronRightIcon, LayoutDashboardIcon, UserIcon, AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";

/** Parse a `sort:order` query value, falling back to the default when invalid. */
function parseSortValue(value: string | null): { sort: SortField; order: SortDirection } {
  if (!value) return { sort: "updatedAt", order: "desc" };
  const [sort, order] = value.split(":") as [SortField, SortDirection];
  const validSort = SORT_FIELDS.includes(sort) ? sort : "updatedAt";
  const validOrder = SORT_DIRECTIONS.includes(order) ? order : "desc";
  return { sort: validSort, order: validOrder };
}

export function OverviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // The dashboard is a read-only summary: filters arrive from links elsewhere in
  // the app (sidebar presets, team pages) via the query string, so the metrics
  // query is derived from the URL rather than from local filter state.
  const filters: ItemFilters = useMemo(() => {
    const teamId = searchParams.get("teamId") ?? "";
    const status = (searchParams.get("status") ?? "") as WorkStatus | "";
    const priority = (searchParams.get("priority") ?? "") as WorkPriority | "";
    const preset = (searchParams.get("preset") ?? "") as ItemFilters["preset"];
    const { sort, order } = parseSortValue(searchParams.get("sort"));

    return {
      teamId: teamId || undefined,
      status: status || undefined,
      priority: priority || undefined,
      preset: preset || undefined,
      // The metric row and the recent-items table summarise the whole backlog,
      // so the dashboard always reads the first page at the default page size.
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      sort,
      order,
    };
  }, [searchParams]);

  const itemsQuery = useQuery({
    queryKey: ["items", filters],
    queryFn: ({ signal }) => listItems(filters, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

  if (itemsQuery.isLoading) {
    return <LoadingState />;
  }

  if (itemsQuery.isError) {
    return <ErrorState title="Failed to load work items" message={errorMessage(itemsQuery.error)} onRetry={() => itemsQuery.refetch()} />;
  }

  const items = itemsQuery.data?.items ?? [];
  const pagination = itemsQuery.data?.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false };

  // Metrics.
  //
  // `total` is the server's true count for the current filter. The other three
  // are counted from `items`, which is only the FIRST page — so their captions
  // say "of N recent items" rather than implying a whole-backlog total. The
  // previous version showed a hardcoded percentage ("+12%", "-3%") with no
  // comparison data behind it, which was fabricated.
  const total = pagination.total;
  const mine = items.filter(item => item.assigneeId === user?.id).length;
  const urgent = items.filter(item => item.priority === "CRITICAL" || item.priority === "HIGH").length;
  const completed = items.filter(item => item.status === "RESOLVED" || item.status === "CLOSED").length;

  // Honest supporting line for a card whose value is a first-page count.
  //
  // When the backlog runs past the first page the count covers only the loaded
  // window, so the caption says so. When everything fits on one page the count
  // IS the whole figure and the caption reads as a plain share of the backlog.
  // Either way the text describes the number that is actually on screen.
  const loaded = items.length;
  const recentCaption = (count: number) => {
    if (total > loaded) {
      return `${count} of the ${loaded} most recent`;
    }
    if (total === 0) {
      return "Nothing here yet";
    }
    return `${count} of ${total} ${total === 1 ? "item" : "items"}`;
  };

  // The scope line names what the summary is reading. It reports the filter
  // actually applied rather than guessing a team name from the first row (which
  // would label a filtered view with whichever team happened to sort first).
  const scopeCaption = filters.teamId ? "Filtered to one team" : "All teams combined";

  // Columns for table
  const overviewColumns = [
    { key: "title", header: "Work item", width: "35%", render: (item: any) => (
      <div>
        <Link className="table__title-link" to={`/items/${item.id}`} onClick={(e) => e.stopPropagation()}>
          {item.title}
        </Link>
        <span className="mono muted" style={{ marginLeft: "var(--space-2)" }}>
          {shortId(item.id)}
        </span>
      </div>
    )},
    { key: "status", header: "Status", width: "12%", render: (item: any) => <StatusBadge status={item.status} /> },
    { key: "priority", header: "Priority", width: "10%", render: (item: any) => <PriorityBadge priority={item.priority} /> },
    { key: "type", header: "Type", width: "10%", render: (item: any) => <TypeBadge type={item.type} /> },
    { key: "team", header: "Team", width: "15%", render: (item: any) => <span className="muted">{item.teamName}</span> },
    { key: "assignee", header: "Assignee", width: "18%", render: (item: any) => (
      <span>{item.assigneeName ? item.assigneeName : <span className="muted">Unassigned</span>}</span>
    )},
  ];

  return (
    <div className="page">
      {/* Hero Section with Key Metrics */}
      <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total Items" value={total} icon={<LayoutDashboardIcon />} caption={scopeCaption} />
        <MetricCard title="My Items" value={mine} icon={<UserIcon />} caption={recentCaption(mine)} />
        <MetricCard title="Urgent" value={urgent} icon={<AlertTriangleIcon />} caption={recentCaption(urgent)} variant="warning" />
        <MetricCard title="Completed" value={completed} icon={<CheckCircle2Icon />} caption={recentCaption(completed)} variant="success" />
      </section>

      {/* Quick Actions - Bento Grid */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionCard icon={<PlusIcon />} title="Create item" description="Log a new work request" href="/items/new" primary />
        <ActionCard icon={<FilterIcon />} title="Items on you" description="Everything currently assigned to you" href="/assigned" />
        <ActionCard icon={<FlagIcon />} title="Urgent queue" description="Unassigned work that is running late" href="/attention" />
        <ActionCard icon={<ClockIcon />} title="Pending review" description="Waiting on a lead to approve" href="/approval" />
      </section>

      {/* Filters & Table */}
      <section className="card-shell">
        <div className="card-core">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-eyebrow">Recent Activity</p>
                <h2 className="text-h2 mt-1">Latest Work Items</h2>
              </div>
              <Link to="/items" className="button button--ghost">
                View All
                <ChevronRightIcon width="16" height="16" className="button__icon button__icon--end" />
              </Link>
            </div>
            <Table
              data={items.slice(0, 5)}
              columns={overviewColumns}
              keyField="id"
              onRowClick={(item) => navigate(`/items/${item.id}`)}
              loading={itemsQuery.isLoading}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

// MetricCard and ActionCard are defined once in `components/ui/Card.tsx` and
// imported above, so the dashboard uses the shared primitives rather than a
// second, drifting copy.
