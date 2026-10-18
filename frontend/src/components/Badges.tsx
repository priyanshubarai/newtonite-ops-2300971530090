import type { WorkItemType, WorkPriority, WorkStatus } from "../api/types";
import { PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "../lib/constants";

/**
 * Status / priority / type badges.
 *
 * Each badge carries a text label, so status is never conveyed by colour alone;
 * priority adds a non-colour severity mark as a second cue.
 */

export function StatusBadge({ status }: { status: WorkStatus }) {
  return (
    <span className={`badge badge--status badge--status-${status.toLowerCase()}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_MARK: Record<WorkPriority, string> = {
  LOW: "",
  MEDIUM: "",
  HIGH: "▲",
  CRITICAL: "▲▲",
};

export function PriorityBadge({ priority }: { priority: WorkPriority }) {
  const mark = PRIORITY_MARK[priority];
  return (
    <span className={`badge badge--priority badge--priority-${priority.toLowerCase()}`}>
      {mark && <span aria-hidden="true">{mark} </span>}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function TypeBadge({ type }: { type: WorkItemType }) {
  return <span className="badge badge--type">{TYPE_LABELS[type]}</span>;
}
