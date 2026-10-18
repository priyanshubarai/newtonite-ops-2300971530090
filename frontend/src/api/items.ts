import { request } from "./client";
import type {
  CreateItemInput,
  ItemFilters,
  TransitionItemInput,
  UpdateItemInput,
  WorkItem,
  WorkItemListResponse,
} from "./types";

/**
 * Work-item API calls. Each function maps 1:1 onto a verified Express route and
 * passes the backend's own field names straight through, so there is no
 * translation layer to drift out of sync.
 */

/** `GET /items` - filtered, paginated, team-scoped list. */
export function listItems(
  filters: ItemFilters,
  signal?: AbortSignal,
): Promise<WorkItemListResponse> {
  return request<WorkItemListResponse>("/items", {
    query: {
      teamId: filters.teamId,
      status: filters.status,
      priority: filters.priority,
      assigneeId: filters.assigneeId,
      search: filters.search,
      page: filters.page,
      pageSize: filters.pageSize,
      sort: filters.sort,
      order: filters.order,
    },
    signal,
  });
}

/** `GET /items/:id` - a single work item. */
export function getItem(id: string, signal?: AbortSignal): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}`, { signal });
}

/** `POST /items` - create a work item. */
export function createItem(
  input: CreateItemInput,
  idempotencyKey: string,
): Promise<WorkItem> {
  return request<WorkItem>("/items", {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}

/** `PATCH /items/:id` - update editable fields under optimistic concurrency. */
export function updateItem(
  id: string,
  input: UpdateItemInput,
  idempotencyKey: string,
): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    idempotencyKey,
  });
}

/** `POST /items/:id/claim` - atomically claim an unassigned item. */
export function claimItem(id: string, idempotencyKey: string): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}/claim`, {
    method: "POST",
    idempotencyKey,
  });
}

/** `POST /items/:id/transition` - advance along the approved workflow. */
export function transitionItem(
  id: string,
  input: TransitionItemInput,
  idempotencyKey: string,
): Promise<WorkItem> {
  return request<WorkItem>(`/items/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}
