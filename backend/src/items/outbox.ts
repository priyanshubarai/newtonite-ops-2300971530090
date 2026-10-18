import type { NewOutboxJob, WorkItemRow } from "./repository.js";

/**
 * Transactional-outbox conventions.
 *
 * There was no pre-existing job format, so these are the minimal conventions
 * for this phase: a stable `jobType` string per business action and a payload
 * containing only what a future worker needs to locate the work item and
 * attribute the action. No email/webhook/external call happens in the request
 * transaction - a job is only *enqueued*; there is no worker in this phase.
 */
export const OUTBOX_JOB_TYPES = {
  ITEM_CREATED: "work_item.created",
  ITEM_UPDATED: "work_item.updated",
  ITEM_CLAIMED: "work_item.claimed",
  ITEM_TRANSITIONED: "work_item.transitioned",
} as const;

export type OutboxJobType = (typeof OUTBOX_JOB_TYPES)[keyof typeof OUTBOX_JOB_TYPES];

export function buildOutboxJob(
  row: WorkItemRow,
  jobType: OutboxJobType,
  actorId: string,
): NewOutboxJob {
  return {
    jobType,
    status: "PENDING",
    payload: {
      // `workItemId` is the join key a future worker uses to re-load the item;
      // it is also what the test cleanup matches on.
      workItemId: row.id,
      teamId: row.teamId,
      actorId,
      status: row.status,
      version: row.version,
    },
  };
}
