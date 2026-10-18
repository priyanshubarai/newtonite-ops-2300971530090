import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, type TxClient } from "../db/index.js";
import { workItems } from "../db/schema/work_items.js";
import { activityEvents } from "../db/schema/activity_events.js";
import { outboxJobs } from "../db/schema/outbox_jobs.js";
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
 *
 * Read queries run on the shared `db` handle. Every **mutation** takes a
 * `TxClient` so the caller controls the transaction boundary: the work-item
 * change, its version increment, its activity event, and its outbox job must
 * commit together. All conditional writes are expressed as a single `UPDATE`
 * with the precondition in the `WHERE` clause - the database, not application
 * code, decides the winner under a race.
 */

export type WorkItemRow = typeof workItems.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;
export type NewOutboxJob = typeof outboxJobs.$inferInsert;

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

/**
 * Insert a work item on the caller's transaction. `status` defaults to `OPEN`
 * and `version` to `1` at the database layer; the caller never supplies them.
 */
export async function insertWorkItemTx(
  tx: TxClient,
  values: NewWorkItem,
): Promise<WorkItemRow> {
  const [row] = await tx.insert(workItems).values(values).returning();
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
 * Optimistic-concurrency update: applies `values` and increments `version`
 * **only** if the stored version still equals `expectedVersion`.
 *
 * A zero-row result means either the item is gone or another writer already
 * bumped the version - the caller maps that to `404`/`409 STALE_VERSION`. The
 * version is incremented inside the same statement (`version = version + 1`),
 * so two writers with the same expected version cannot both succeed: the first
 * commits v+1, the second's `WHERE` no longer matches.
 */
export async function updateWorkItemTx(
  tx: TxClient,
  id: string,
  expectedVersion: number,
  values: WorkItemUpdate,
): Promise<WorkItemRow | null> {
  const rows = await tx
    .update(workItems)
    .set({
      ...values,
      version: sql`${workItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(workItems.id, id), eq(workItems.version, expectedVersion)))
    .returning();
  return rows[0] ?? null;
}

/**
 * Atomic claim: sets the assignee and increments the version **only** if the
 * item is still unassigned and in one of the claimable statuses. The
 * precondition lives entirely in the `WHERE` clause, so two concurrent
 * claimants cannot both win - the loser's update matches zero rows.
 */
export async function claimWorkItemTx(
  tx: TxClient,
  id: string,
  assigneeId: string,
  claimableStatuses: readonly WorkStatus[],
): Promise<WorkItemRow | null> {
  const rows = await tx
    .update(workItems)
    .set({
      assigneeId,
      version: sql`${workItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(workItems.id, id),
        isNull(workItems.assigneeId),
        inArray(workItems.status, [...claimableStatuses]),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Workflow transition: moves `status` from `fromStatus` to `toStatus` and
 * increments the version, but only when the stored version still equals
 * `expectedVersion` and the stored status still equals `fromStatus`. Both the
 * version guard (concurrency) and the status guard (workflow) are enforced by
 * the database.
 */
export async function transitionWorkItemTx(
  tx: TxClient,
  id: string,
  expectedVersion: number,
  fromStatus: WorkStatus,
  toStatus: WorkStatus,
): Promise<WorkItemRow | null> {
  const rows = await tx
    .update(workItems)
    .set({
      status: toStatus,
      version: sql`${workItems.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(workItems.id, id),
        eq(workItems.version, expectedVersion),
        eq(workItems.status, fromStatus),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Append an immutable activity event on the caller's transaction. */
export async function insertActivityEventTx(
  tx: TxClient,
  values: NewActivityEvent,
): Promise<void> {
  await tx.insert(activityEvents).values(values);
}

/** Insert a transactional-outbox job on the caller's transaction. */
export async function insertOutboxJobTx(
  tx: TxClient,
  values: NewOutboxJob,
): Promise<void> {
  await tx.insert(outboxJobs).values(values);
}
