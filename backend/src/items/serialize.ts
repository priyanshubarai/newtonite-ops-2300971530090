import type { workItems } from "../db/schema/work_items.js";

/** A full work-item row as stored (shape of `SELECT * FROM work_items`). */
export type WorkItemRow = typeof workItems.$inferSelect;

/**
 * Client-facing work-item shape. Only intended, non-sensitive fields are
 * exposed, and the mapping is explicit so a future column cannot leak by
 * accident. Dates are serialized to ISO strings by Express's JSON encoder.
 */
export interface WorkItemResponse {
  id: string;
  title: string;
  description: string | null;
  type: WorkItemRow["type"];
  priority: WorkItemRow["priority"];
  status: WorkItemRow["status"];
  teamId: string;
  assigneeId: string | null;
  createdBy: string;
  dueAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toWorkItemResponse(row: WorkItemRow): WorkItemResponse {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority,
    status: row.status,
    teamId: row.teamId,
    assigneeId: row.assigneeId,
    createdBy: row.createdBy,
    dueAt: row.dueAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
