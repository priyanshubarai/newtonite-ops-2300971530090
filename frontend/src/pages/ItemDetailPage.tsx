import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { claimItem, createComment, getItem, listActivity, listComments, transitionItem } from "../api/items";
import { useStableIdempotencyKey } from "../api/idempotency";
import { isApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import { PriorityBadge, StatusBadge, TypeBadge } from "../components/Badges";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import {
  CLAIMABLE_STATUSES,
  ROLE_LABELS,
  STATUS_LABELS,
  TRANSITION_LABELS,
  WORKFLOW_NEXT,
} from "../lib/constants";
import { errorMessage, isForbidden, isNotFound } from "../lib/apiErrors";
import { formatDateTime, isOverdue, shortId } from "../lib/format";
import { reticleSignal } from "../lib/reticleSignal";
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

  const activityQuery = useQuery({
    queryKey: ["activity", id],
    queryFn: ({ signal }) => listActivity(id, 1, 20, signal),
    enabled: id.length > 0,
    retry: false,
  });

  const commentsQuery = useQuery({
    queryKey: ["comments", id],
    queryFn: ({ signal }) => listComments(id, 1, 20, signal),
    enabled: id.length > 0,
    retry: false,
  });

  const item = itemQuery.data;
  const activity = activityQuery.data;
  const comments = commentsQuery.data;
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
      reticleSignal("item.claimed", { id, assigneeId: updated.assigneeId });
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
      reticleSignal("item.status-changed", { id, status: updated.status });
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

  const commentKey = useStableIdempotencyKey(`comment:${id}`);
  const commentMutation = useMutation({
    mutationFn: (body: string) => createComment(id, { body }, commentKey),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["comments", id] });
      setActionError(null);
      setActionMessage("Comment added.");
      reticleSignal("comment.created", { itemId: id, commentId: response?.comment?.id });
    },
    onError: (error) => {
      setActionMessage(null);
      if (isForbidden(error)) {
        setActionError("Your role in this team doesn't allow adding comments.");
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

      <section className="card" aria-labelledby="detail-activity-heading">
        <h2 id="detail-activity-heading" className="card__title">
          Activity
        </h2>
        {activityQuery.isPending && <LoadingState message="Loading activity…" />}
        {activityQuery.isError && (
          <ErrorState
            title="Couldn't load activity"
            message={errorMessage(activityQuery.error)}
            onRetry={() => void activityQuery.refetch()}
          />
        )}
        {activity && activity.items.length === 0 && (
          <EmptyState
            title="No activity yet"
            message="Activity will appear here when this item is updated."
          />
        )}
        {activity && activity.items.length > 0 && (
          <>
            <dl className="activity-timeline">
              {activity.items.map((event) => (
                <div key={event.id} className="activity-event">
                  <div className="activity-event__meta">
                    <span className="activity-event__type">{formatEventType(event.eventType)}</span>
                    <time className="activity-event__time" dateTime={event.createdAt}>
                      {formatDateTime(event.createdAt)}
                    </time>
                  </div>
                  <div className="activity-event__details">
                    {renderEventDetails(event)}
                  </div>
                </div>
              ))}
            </dl>
            {activity.pagination.hasNextPage && (
              <p className="muted note">
                Showing latest 20 events. Older activity available via API.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="detail-comments-heading">
        <h2 id="detail-comments-heading" className="card__title">
          Comments
        </h2>
        {commentsQuery.isPending && <LoadingState message="Loading comments…" />}
        {commentsQuery.isError && (
          <ErrorState
            title="Couldn't load comments"
            message={errorMessage(commentsQuery.error)}
            onRetry={() => void commentsQuery.refetch()}
          />
        )}
        {comments && comments.items.length === 0 && (
          <EmptyState
            title="No comments yet"
            message="Be the first to add a comment."
          />
        )}
        {comments && comments.items.length > 0 && (
          <>
            <dl className="comments-list">
              {comments.items.map((comment) => (
                <div key={comment.id} className="comment">
                  <div className="comment__header">
                    <span className="comment__author">User {comment.authorId}</span>
                    <time className="comment__time" dateTime={comment.createdAt}>
                      {formatDateTime(comment.createdAt)}
                    </time>
                  </div>
                  <div className="comment__body">{comment.body}</div>
                </div>
              ))}
            </dl>
            {comments.pagination.hasNextPage && (
              <p className="muted note">
                Showing latest 20 comments. Older comments available via API.
              </p>
            )}
          </>
        )}
        <form
          className="comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const body = formData.get("body") as string;
            if (body.trim()) {
              commentMutation.mutate(body);
              e.currentTarget.reset();
            }
          }}
        >
          <div className="form-field">
            <label htmlFor="comment-body" className="form-field__label">
              Add a comment
            </label>
            <textarea
              id="comment-body"
              name="body"
              className="form-field__input form-field__input--textarea"
              rows={3}
              placeholder="Write a comment…"
              disabled={commentMutation.isPending}
              aria-busy={commentMutation.isPending}
              required
              maxLength={5000}
            />
          </div>
          <button
            type="submit"
            className="button button--primary"
            disabled={commentMutation.isPending || !item}
            aria-busy={commentMutation.isPending}
          >
            {commentMutation.isPending ? "Posting…" : "Post comment"}
          </button>
        </form>
      </section>
    </div>
  );
}

/** Convert backend event type to human-readable label. */
function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    ITEM_CREATED: "Created",
    STATUS_CHANGED: "Status changed",
    ASSIGNEE_CHANGED: "Assignee changed",
    PRIORITY_CHANGED: "Priority changed",
    ITEM_UPDATED: "Updated",
    COMMENT_ADDED: "Comment added",
  };
  return labels[type] ?? type;
}

/** Render human-readable details for an activity event. */
function renderEventDetails(event: { eventType: string; metadata: Record<string, unknown> }): React.ReactNode {
  const { metadata } = event;
  const before = metadata.before as Record<string, unknown> | undefined;
  const after = metadata.after as Record<string, unknown> | undefined;
  const via = metadata.via as string | undefined;
  switch (event.eventType) {
    case "ITEM_CREATED": {
      if (!after) return null;
      return (
        <dl className="activity-details">
          <div><dt>Title</dt><dd>{after.title as string}</dd></div>
          <div><dt>Type</dt><dd>{after.type as string}</dd></div>
          <div><dt>Priority</dt><dd>{after.priority as string}</dd></div>
          <div><dt>Status</dt><dd>{after.status as string}</dd></div>
        </dl>
      );
    }
    case "STATUS_CHANGED": {
      return (
        <dl className="activity-details">
          <div><dt>From</dt><dd>{before?.status as string | undefined}</dd></div>
          <div><dt>To</dt><dd>{after?.status as string | undefined}</dd></div>
        </dl>
      );
    }
    case "ASSIGNEE_CHANGED": {
      return (
        <dl className="activity-details">
          <div><dt>From</dt><dd>{before?.assigneeId ? `User ${before.assigneeId as string}` : "Unassigned"}</dd></div>
          <div><dt>To</dt><dd>{after?.assigneeId ? `User ${after.assigneeId as string}` : "Unassigned"}</dd></div>
          {via && <div><dt>Via</dt><dd>{via === "claim" ? "Claim" : "Assignment"}</dd></div>}
        </dl>
      );
    }
    case "PRIORITY_CHANGED": {
      return (
        <dl className="activity-details">
          <div><dt>From</dt><dd>{before?.priority as string | undefined}</dd></div>
          <div><dt>To</dt><dd>{after?.priority as string | undefined}</dd></div>
        </dl>
      );
    }
    case "ITEM_UPDATED": {
      if (!before || !after) return null;
      const changedKeys = Object.keys(after).filter((k) => before[k] !== after[k]);
      return (
        <dl className="activity-details">
          {changedKeys.map((key) => (
            <div key={key}><dt>{key}</dt><dd>{before[key] as string} → {after[key] as string}</dd></div>
          ))}
        </dl>
      );
    }
    default:
      return (
        <pre className="activity-details--raw">{JSON.stringify(metadata, null, 2)}</pre>
      );
  }
}
