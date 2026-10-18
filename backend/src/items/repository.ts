import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { workItems } from "../db/schema/work_items.js";
import type {
  SortDirection,
  SortField,
  WorkPriority,
  WorkStatus,
} from "./validation.js";

/**
 * Work-item persistence queries.
 *
 * Everything here is built with Drizzle's query builder, so every user value is
 * sent as a bound parameter - never string-concatenated into SQL. Sorting uses
 * the explicit `SORT_COLUMNS` allowlist so no client string can become an
 * identifier or expression.
 */

export type WorkItemRow = typeof workItems.$inferSelect;

// Allowlisted sort columns. Kept as a literal map (not a dynamic lookup on the
// table object) so the set of orderable fields is obvious and closed.
const SORT_COLUMNS = {
  createdAt: workItems.createdAt,
  updatedAt: workItems.updatedAt,
  priority: workItems.priority,
  dueAt: workItems.dueAt,
} as const satisfies Record<SortField, unknown>;

export interface ListWorkItemsParams {
  /** Teams the caller is a member of. The query is always scoped to these. */
  memberTeamIds: string[];
  status?: WorkStatus;
  priority?: WorkPriority;
  assigneeId?: string;
  search?: string;
  page: number;
  pageSize: number;
  sort: SortField;
  order: SortDirection;
}

export interface ListWorkItemsResult {
  rows: WorkItemRow[];
  /** Exact count of rows matching the same filters, ignoring pagination. */
  total: number;
}

/**
 * Escape LIKE/ILIKE metacharacters in user input so a search for a literal
 * `%` or `_` does not behave as a wildcard. Backslash is the default ESCAPE
 * character for `LIKE`/`ILIKE` in PostgreSQL.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function buildFilters(params: ListWorkItemsParams): SQL {
  const conditions: SQL[] = [inArray(workItems.teamId, params.memberTeamIds)];

  if (params.status) {
    conditions.push(eq(workItems.status, params.status));
  }
  if (params.priority) {
    conditions.push(eq(workItems.priority, params.priority));
  }
  if (params.assigneeId) {
    conditions.push(eq(workItems.assigneeId, params.assigneeId));
  }
  if (params.search) {
    const pattern = `%${escapeLikePattern(params.search)}%`;
    const searchCondition = or(
      ilike(workItems.title, pattern),
      ilike(workItems.description, pattern),
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  // `and` with at least one condition always yields a concrete SQL node.
  return and(...conditions) as SQL;
}

/**
 * Filtered, paginated, team-scoped listing.
 *
 * Ordering is always deterministic: the requested column/direction followed by
 * the primary key as a tie-breaker, so equal sort keys never yield unstable
 * pages.
 */
export async function listWorkItems(
  params: ListWorkItemsParams,
): Promise<ListWorkItemsResult> {
  if (params.memberTeamIds.length === 0) {
    return { rows: [], total: 0 };
  }

  const where = buildFilters(params);
  const direction = params.order === "asc" ? asc : desc;
  const sortColumn = SORT_COLUMNS[params.sort];
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(where)
      .orderBy(direction(sortColumn), asc(workItems.id))
      .limit(params.pageSize)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(workItems)
      .where(where),
  ]);

  return { rows, total: totalRows[0]?.value ?? 0 };
}

export async function findWorkItemById(id: string): Promise<WorkItemRow | null> {
  const rows = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface NewWorkItem {
  title: string;
  description: string | null;
  type: WorkItemRow["type"];
  priority: WorkItemRow["priority"];
  teamId: string;
  assigneeId: string | null;
  createdBy: string;
  dueAt: Date | null;
}

export async function insertWorkItem(values: NewWorkItem): Promise<WorkItemRow> {
  const [row] = await db.insert(workItems).values(values).returning();
  return row;
}

/** Editable fields only; `status`/`version` are intentionally excluded. */
export type WorkItemUpdate = Partial<{
  title: string;
  description: string | null;
  type: WorkItemRow["type"];
  priority: WorkItemRow["priority"];
  assigneeId: string | null;
  dueAt: Date | null;
}>;

/**
 * Apply an update by id and return the new row (or `null` if it disappeared).
 *
 * Phase 5 will extend this with an optimistic-concurrency guard: add
 * `and(eq(workItems.id, id), eq(workItems.version, expectedVersion))` and
 * `version: sql\`${workItems.version} + 1\`` to the SET clause, treating a
 * zero-row result as a 409. The route/service layering already isolates that
 * change to this function plus its caller, so no API layer needs rewriting.
 */
export async function updateWorkItem(
  id: string,
  values: WorkItemUpdate,
): Promise<WorkItemRow | null> {
  const rows = await db
    .update(workItems)
    .set(values)
    .where(eq(workItems.id, id))
    .returning();
  return rows[0] ?? null;
}
