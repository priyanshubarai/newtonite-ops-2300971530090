import { conflict, ERROR_CODES } from "../common/errors.js";
import type { WorkStatus } from "./validation.js";

/**
 * The approved, linear work-item workflow. Each status has exactly one allowed
 * next status (or none), so skipping states, arbitrary assignment, and
 * reopening `CLOSED` are all rejected by construction. This is the single
 * source of truth for the state machine; there is no separate workflow engine.
 *
 *   OPEN -> IN_PROGRESS -> AWAITING_APPROVAL -> RESOLVED -> CLOSED
 */
export const WORKFLOW_NEXT: Record<WorkStatus, WorkStatus | null> = {
  OPEN: "IN_PROGRESS",
  IN_PROGRESS: "AWAITING_APPROVAL",
  AWAITING_APPROVAL: "RESOLVED",
  RESOLVED: "CLOSED",
  CLOSED: null,
};

/**
 * Statuses in which an unassigned work item may be claimed. Claiming is for
 * work that has not yet entered the approval/resolution part of the workflow;
 * `AWAITING_APPROVAL`, `RESOLVED`, and `CLOSED` items are not claimable. This
 * is an interpretation of "claimable" over the approved status model above -
 * no new statuses were introduced.
 */
export const CLAIMABLE_STATUSES: readonly WorkStatus[] = ["OPEN", "IN_PROGRESS"];

/** The one transition that requires approval authority rather than ordinary edit rights. */
export const APPROVAL_FROM: WorkStatus = "AWAITING_APPROVAL";
const APPROVAL_TO: WorkStatus = "RESOLVED";

export function isApprovalStep(from: WorkStatus, to: WorkStatus): boolean {
  return from === APPROVAL_FROM && to === APPROVAL_TO;
}

/**
 * Reject any transition that is not the single allowed next step. Throws a
 * 409 `INVALID_TRANSITION`; the caller performs authorization first so an
 * unprivileged caller never learns whether a transition would have been valid.
 */
export function assertValidTransition(from: WorkStatus, to: WorkStatus): void {
  const next = WORKFLOW_NEXT[from];
  if (next === null || next !== to) {
    throw conflict(
      ERROR_CODES.INVALID_TRANSITION,
      `Invalid workflow transition from ${from} to ${to}`,
    );
  }
}
