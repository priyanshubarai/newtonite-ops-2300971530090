import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getItem, updateItem } from "../api/items";
import { useStableIdempotencyKey } from "../api/idempotency";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import { ItemFormFields, type ItemFormValues } from "../components/ItemFormFields";
import { ErrorState, LoadingState } from "../components/StateViews";
import { StatusBadge } from "../components/Badges";
import { isApiError } from "../api/client";
import { errorMessage, fieldErrorsFrom, isForbidden, isNotFound } from "../lib/apiErrors";
import { itemToFormValues, toUpdateItemInput, validateItemForm } from "../lib/itemForm";
import { roleForTeam, canEditItem } from "../lib/permissions";

/**
 * Edit-work-item form.
 *
 * Implements the optimistic-concurrency contract: the version read from the
 * server is submitted as `expectedVersion` and is never user-editable. A
 * `409 STALE_VERSION` is surfaced as a conflict with a "reload latest" action
 * that refreshes the version *without* discarding the user's unsaved edits.
 * Status is deliberately absent — it only changes via workflow transitions.
 */
export function ItemEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { memberships, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const itemQuery = useQuery({
    queryKey: ["item", id],
    queryFn: ({ signal }) => getItem(id, signal),
    enabled: id.length > 0,
    retry: false,
  });

  const [values, setValues] = useState<ItemFormValues | null>(null);
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [reloadNotice, setReloadNotice] = useState<string | null>(null);

  // Hydrate the form exactly once, so later refetches cannot clobber edits.
  useEffect(() => {
    if (itemQuery.data && values === null) {
      setValues(itemToFormValues(itemQuery.data));
      setExpectedVersion(itemQuery.data.version);
    }
  }, [itemQuery.data, values]);

  const fingerprint = JSON.stringify({ values, expectedVersion });
  const idempotencyKey = useStableIdempotencyKey(fingerprint);

  const mutation = useMutation({
    mutationFn: (payload: { version: number }) => {
      if (!values) throw new Error("form not ready");
      return updateItem(id, toUpdateItemInput(values, payload.version), idempotencyKey);
    },
    onSuccess: (item) => {
      queryClient.setQueryData(["item", id], item);
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      navigate(`/items/${id}`, {
        replace: true,
        state: { flash: "Changes saved." },
      });
    },
    onError: (error) => {
      if (isApiError(error) && error.isStaleVersion) {
        setConflict(
          "This work item was changed by someone else after you opened it. Your edits are still here — reload the latest version, then review and save again.",
        );
        setFormError(null);
        return;
      }
      const backendErrors = fieldErrorsFrom(error);
      setFieldErrors(backendErrors);
      setFormError(Object.keys(backendErrors).length > 0 ? null : errorMessage(error));
    },
  });

  function handleChange<K extends keyof ItemFormValues>(field: K, value: ItemFormValues[K]) {
    setValues((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values || expectedVersion === null) return;

    const errors = validateItemForm(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError(null);
      return;
    }
    setConflict(null);
    setReloadNotice(null);
    setFormError(null);
    mutation.mutate({ version: expectedVersion });
  }

  async function handleReloadLatest() {
    const result = await itemQuery.refetch();
    if (result.data) {
      setExpectedVersion(result.data.version);
      setConflict(null);
      setReloadNotice(
        `Latest version loaded (v${result.data.version}). Your unsaved changes were kept — review them and save again.`,
      );
    }
  }

  if (itemQuery.isPending) {
    return (
      <div className="page">
        <LoadingState message="Loading work item…" />
      </div>
    );
  }

  if (itemQuery.isError && !itemQuery.data) {
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

  const item = itemQuery.data;
  const role = roleForTeam(memberships, item?.teamId);
  const teamName = memberships.find((m) => m.teamId === item?.teamId)?.teamName;

  if (item && !canEditItem(role)) {
    return (
      <div className="page">
        <ErrorState
          title="You can't edit this work item"
          message="Your role in this team doesn't allow editing work items."
          secondaryAction={{ label: "Back to the work item", onClick: () => navigate(`/items/${id}`) }}
        />
      </div>
    );
  }

  if (!values) {
    return (
      <div className="page">
        <LoadingState message="Preparing the form…" />
      </div>
    );
  }

  const submitting = mutation.isPending;

  return (
    <div className="page page--narrow">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/items">Work items</Link>
        <span aria-hidden="true"> / </span>
        <Link to={`/items/${id}`}>{item?.title ?? "Work item"}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Edit</span>
      </nav>

      <h1 className="page__title">Edit work item</h1>
      {item && (
        <p className="page__subtitle">
          Current status: <StatusBadge status={item.status} /> · version {item.version}
          {expectedVersion !== null && expectedVersion !== item.version
            ? ` (you are editing version ${expectedVersion})`
            : ""}
        </p>
      )}

      {conflict && (
        <Alert
          tone="warning"
          title="This item changed while you were editing"
          actions={
            <button type="button" className="button" onClick={() => void handleReloadLatest()}>
              Reload latest version
            </button>
          }
        >
          {conflict}
        </Alert>
      )}

      {reloadNotice && (
        <Alert tone="info" title="Latest version loaded">
          {reloadNotice}
        </Alert>
      )}

      {formError && (
        <Alert tone="error" title="Couldn't save your changes">
          {formError}
          {isForbidden(mutation.error) ? " Your role doesn't permit this change." : ""}
        </Alert>
      )}

      <form className="form card" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <ItemFormFields
          idPrefix="edit"
          values={values}
          onChange={handleChange}
          fieldErrors={fieldErrors}
          lockedTeamName={teamName}
          currentUserId={user?.id}
          disabled={submitting}
        />

        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </button>
          <Link to={`/items/${id}`} className="button">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
