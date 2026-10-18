import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { claimItem, getItem, transitionItem } from "../api/items";
import { useStableIdempotencyKey } from "../api/idempotency";
import { isApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import { PriorityBadge, StatusBadge, TypeBadge } from "../components/Badges";
import { ErrorState, LoadingState } from "../components/StateViews";
import {
  CLAIMABLE_STATUSES,
  ROLE_LABELS,
  STATUS_LABELS,
  TRANSITION_LABELS,
  WORKFLOW_NEXT,
} from "../lib/constants";
import { errorMessage, isForbidden, isNotFound } from "../lib/apiErrors";
import { formatDateTime, isOverdue, shortId } from "../lib/format";
import {
  canApproveTransition,
  canClaimItem,
  canEditItem,
  roleForTeam,
} from "../lib/permissions";

/**
 * Work-item detail, with the two client-triggered actions that change state:
 * claim and workflow transition. Both are recoverable-conflict aware — a lost
 * race refreshes the item and explains the outcome rather than silently
 * retrying or pretending success.
 */
export function ItemDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { memberships, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const flash = (location.state as { flash?: string } | null)?.flash ?? null;

  const itemQuery = useQuery({
    queryKey: ["item", id],
    queryFn: ({ signal }) => getItem(id, signal),
    enabled: id.length > 0,
    retry: false,
  });

  const item = itemQuery.data;
  const next = item ? WORKFLOW_NEXT[item.status] : null;

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);

  const claimKey = useStableIdempotencyKey(`claim:${id}`);
  const transitionKey = useStableIdempotencyKey(
    `transition:${id}:${next ?? "none"}:${item?.version ?? 0}`,
  );

  const claimMutation = useMutation({
    mutationFn: () => claimItem(id, claimKey),
    onSuccess: (updated) => {
      queryClient.setQueryData(["item", id], updated);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      setActionError(null);
      setNeedsReload(false);
      setActionMessage("You claimed this work item.");
    },
    onError: async (error) => {
      setActionMessage(null);
      if (isApiError(error) && error.status === 409) {
        await itemQuery.refetch();
        setNeedsReload(false);
        if (error.code === "NOT_CLAIMABLE") {
          setActionError("This work item can no longer be claimed. The latest details are shown below.");
        } else {
          setActionError(
            "Another user claimed this item first, or it is no longer claimable. The latest details are shown below.",
          );
        }
      } else if (isForbidden(error)) {
        setActionError("Your role in this team doesn't allow claiming work items.");
      } else {
        setActionError(errorMessage(error));
      }
    },
  });

  const transitionMutation = useMutation({
    mutationFn: (version: number) =>
      transitionItem(id, { toStatus: next!, expectedVersion: version }, transitionKey),
    onSuccess: (updated) => {
      queryClient.setQueryData(["item", id], updated);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      setActionError(null);
      setNeedsReload(false);
      setActionMessage(`Moved to ${STATUS_LABELS[updated.status]}.`);
    },
    onError: (error) => {
      setActionMessage(null);
      if (isApiError(error) && error.isStaleVersion) {
        setNeedsReload(true);
        setActionError(
          "This work item changed since the page was loaded, so the transition was refused. Reload to see the current status before trying again.",
        );
      } else if (isApiError(error) && error.code === "INVALID_TRANSITION") {
        setNeedsReload(true);
        setActionError("That transition is no longer valid for this item. Reload to see its current status.");
      } else if (isForbidden(error)) {
        setActionError(
          next === "RESOLVED"
            ? "Only a team lead or admin can approve this transition."
            : "Your role in this team doesn't permit that transition.",
        );
      } else {
        setActionError(errorMessage(error));
      }
    },
  });

  async function handleReload() {
    await itemQuery.refetch();
    setNeedsReload(false);
  }

  if (itemQuery.isPending) {
    return (
      <div className="page">
        <LoadingState message="Loading work item…" />
      </div>
    );
  }

  if (itemQuery.isError && !item) {
    const notFound = isNotFound(itemQuery.error);
    return (
      <div className="page">
        <ErrorState
          title={notFound ? "Work item not found" : "Couldn't load this work item"}
          message={
            notFound
              ? "It may have been removed, or it belongs to a team you're not a member of."
              : errorMessage(itemQuery.error)
          }
          onRetry={notFound ? undefined : () => void itemQuery.refetch()}
          secondaryAction={{ label: "Back to work items", onClick: () => navigate("/items") }}
        />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="page">
        <LoadingState message="Loading work item…" />
      </div>
    );
  }

  const role = roleForTeam(memberships, item.teamId);
  const teamName = memberships.find((m) => m.teamId === item.teamId)?.teamName ?? shortId(item.teamId);
  const canEdit = canEditItem(role);
  const claimable = item.assigneeId === null && CLAIMABLE_STATUSES.includes(item.status) && canClaimItem(role);
  const requiresApproval = next === "RESOLVED" && item.status === "AWAITING_APPROVAL";
  const canTransition = next !== null && canEdit && (!requiresApproval || canApproveTransition(role));
  const approvalBlocked = next !== null && requiresApproval && !canApproveTransition(role);
  const overdue = isOverdue(item.dueAt);
  const acting = claimMutation.isPending || transitionMutation.isPending;

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/items">Work items</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{item.title}</span>
      </nav>

      {flash && (
        <Alert tone="success" title="Done">
          {flash}
        </Alert>
      )}

      <div className="page__header">
        <div>
          <h1 className="page__title">{item.title}</h1>
          <div className="badge-row">
            <StatusBadge status={item.status} />
            <PriorityBadge priority={item.priority} />
            <TypeBadge type={item.type} />
            {overdue && <span className="badge badge--overdue">Overdue</span>}
          </div>
        </div>
        {canEdit && (
          <Link to={`/items/${item.id}/edit`} className="button">
            Edit
          </Link>
        )}
      </div>

      {needsReload ? (
        <Alert
          tone="warning"
          title="The item changed"
          actions={
            <button type="button" className="button" onClick={() => void handleReload()}>
              Reload latest version
            </button>
          }
        >
          {actionError}
        </Alert>
      ) : (
        actionError && (
          <Alert tone="error" title="Action not completed">
            {actionError}
          </Alert>
        )
      )}

      {actionMessage && (
        <Alert tone="success" title="Done">
          {actionMessage}
        </Alert>
      )}

      <div className="detail-grid">
        <section className="card" aria-labelledby="detail-description-heading">
          <h2 id="detail-description-heading" className="card__title">
            Description
          </h2>
          {item.description ? (
            <p className="detail__description">{item.description}</p>
          ) : (
            <p className="muted">No description provided.</p>
          )}
        </section>

        <section className="card" aria-labelledby="detail-actions-heading">
          <h2 id="detail-actions-heading" className="card__title">
            Actions
          </h2>

          {claimable && (
            <div className="action-block">
              <button
                type="button"
                className="button button--primary"
                disabled={acting}
                aria-busy={claimMutation.isPending}
                onClick={() => claimMutation.mutate()}
              >
                {claimMutation.isPending ? "Claiming…" : "Claim this item"}
              </button>
              <p className="muted">Assigns the item to you.</p>
            </div>
          )}

          {next !== null && canTransition && (
            <div className="action-block">
              <button
                type="button"
                className="button button--primary"
                disabled={acting}
                aria-busy={transitionMutation.isPending}
                onClick={() => transitionMutation.mutate(item.version)}
              >
                {transitionMutation.isPending
                  ? "Working…"
                  : (TRANSITION_LABELS[item.status] ?? `Move to ${STATUS_LABELS[next]}`)}
              </button>
              <p className="muted">Moves this item to “{STATUS_LABELS[next]}”.</p>
            </div>
          )}

          {approvalBlocked && (
            <p className="muted">
              Moving this item out of “Awaiting approval” requires a team lead or admin. Your role:{" "}
              {role ? ROLE_LABELS[role] : "none"}.
            </p>
          )}

          {next === null && (
            <p className="muted">This item is closed. No further transitions are available.</p>
          )}

          {!claimable && next === null && (
            <p className="muted">No actions are available for you on this item.</p>
          )}

          {!canEdit && next !== null && (
            <p className="muted">
              Your role in this team doesn't allow changing this item's status.
            </p>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="detail-facts-heading">
        <h2 id="detail-facts-heading" className="card__title">
          Details
        </h2>
        <dl className="facts">
          <div className="facts__row">
            <dt>Team</dt>
            <dd>{teamName}</dd>
          </div>
          <div className="facts__row">
            <dt>Assignee</dt>
            <dd>
              {item.assigneeId ? (
                item.assigneeId === user?.id ? (
                  "You"
                ) : (
                  <span className="mono" title={item.assigneeId}>
                    {shortId(item.assigneeId)}
                  </span>
                )
              ) : (
                <span className="muted">Unassigned</span>
              )}
            </dd>
          </div>
          <div className="facts__row">
            <dt>Your role</dt>
            <dd>{role ? ROLE_LABELS[role] : "Not a member"}</dd>
          </div>
          <div className="facts__row">
            <dt>Due</dt>
            <dd className={overdue ? "text-danger" : undefined}>
              {item.dueAt ? formatDateTime(item.dueAt) : <span className="muted">—</span>}
            </dd>
          </div>
          <div className="facts__row">
            <dt>Created by</dt>
            <dd>{item.createdBy === user?.id ? "You" : <span className="mono">{shortId(item.createdBy)}</span>}</dd>
          </div>
          <div className="facts__row">
            <dt>Created</dt>
            <dd>{formatDateTime(item.createdAt)}</dd>
          </div>
          <div className="facts__row">
            <dt>Last updated</dt>
            <dd>{formatDateTime(item.updatedAt)}</dd>
          </div>
          <div className="facts__row">
            <dt>Version</dt>
            <dd>{item.version}</dd>
          </div>
        </dl>
      </section>

      <p className="muted note">
        Activity history isn't available in this phase — the backend exposes no activity-read
        endpoint.
      </p>
    </div>
  );
}
