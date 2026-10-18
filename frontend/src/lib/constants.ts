import type {
  TeamRole,
  WorkItemType,
  WorkPriority,
  WorkStatus,
  SortField,
  SortDirection,
} from "../api/types";

/** Human-readable labels for the API's enum values. */

export const STATUS_LABELS: Record<WorkStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  AWAITING_APPROVAL: "Awaiting approval",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const PRIORITY_LABELS: Record<WorkPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const TYPE_LABELS: Record<WorkItemType, string> = {
  INCIDENT: "Incident",
  CUSTOMER_ISSUE: "Customer issue",
  PAYMENT: "Payment",
  COMPLIANCE: "Compliance",
  TASK: "Task",
};

export const ROLE_LABELS: Record<TeamRole, string> = {
  VIEWER: "Viewer",
  MEMBER: "Member",
  LEAD: "Lead",
  ADMIN: "Admin",
};

/**
 * The approved, linear workflow. Mirrors `backend/src/items/workflow.ts` so the
 * UI can offer exactly the next step; the backend remains authoritative.
 */
export const WORKFLOW_NEXT: Record<WorkStatus, WorkStatus | null> = {
  OPEN: "IN_PROGRESS",
  IN_PROGRESS: "AWAITING_APPROVAL",
  AWAITING_APPROVAL: "RESOLVED",
  RESOLVED: "CLOSED",
  CLOSED: null,
};

/** Action verb shown on the transition control for each current status. */
export const TRANSITION_LABELS: Record<WorkStatus, string | null> = {
  OPEN: "Start progress",
  IN_PROGRESS: "Submit for approval",
  AWAITING_APPROVAL: "Approve & resolve",
  RESOLVED: "Close item",
  CLOSED: null,
};

/** The one transition that requires approval authority (LEAD/ADMIN). */
export const APPROVAL_FROM: WorkStatus = "AWAITING_APPROVAL";

/** Statuses in which an unassigned item may be claimed. Mirrors the backend. */
export const CLAIMABLE_STATUSES: readonly WorkStatus[] = ["OPEN", "IN_PROGRESS"];

/** Page-size options offered in the UI. All are <= the backend maximum of 100. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Supported sort fields, mirroring the backend validation allowlist. */
export const SORT_FIELDS: readonly SortField[] = ["createdAt", "updatedAt", "priority", "dueAt"] as const;

/** Supported sort directions, mirroring the backend validation allowlist. */
export const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"] as const;
