import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createItem } from "../api/items";
import type { CreateItemInput } from "../api/types";
import { useStableIdempotencyKey } from "../api/idempotency";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import {
  EMPTY_ITEM_FORM_VALUES,
  ItemFormFields,
  type ItemFormValues,
} from "../components/ItemFormFields";
import { ErrorState } from "../components/StateViews";
import { errorMessage, fieldErrorsFrom } from "../lib/apiErrors";
import {
  toCreateItemInput,
  validateItemForm,
  validateTeamSelected,
} from "../lib/itemForm";
import { teamsWhereUserCanCreate } from "../lib/permissions";

/** Create-work-item form. Team options are limited to teams where creation is permitted. */
export function ItemCreatePage() {
  const { memberships, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const creatableTeams = teamsWhereUserCanCreate(memberships);

  const [values, setValues] = useState<ItemFormValues>(() => ({
    ...EMPTY_ITEM_FORM_VALUES,
    teamId: creatableTeams[0]?.teamId ?? "",
  }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function handleChange<K extends keyof ItemFormValues>(field: K, value: ItemFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  // A stable key for the current form contents: retrying the same payload
  // replays safely, while editing the payload produces a fresh key.
  const idempotencyKey = useStableIdempotencyKey(JSON.stringify(values));

  const mutation = useMutation({
    mutationFn: (payload: CreateItemInput) => createItem(payload, idempotencyKey),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      navigate(`/items/${item.id}`, {
        replace: true,
        state: { flash: "Work item created." },
      });
    },
    onError: (error) => {
      const backendErrors = fieldErrorsFrom(error);
      setFieldErrors(backendErrors);
      setFormError(Object.keys(backendErrors).length > 0 ? null : errorMessage(error));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = { ...validateItemForm(values), ...validateTeamSelected(values) };
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError(null);
      return;
    }
    setFormError(null);
    mutation.mutate(toCreateItemInput(values));
  }

  if (creatableTeams.length === 0) {
    return (
      <div className="page">
        <ErrorState
          title="You can't create work items"
          message="You don't hold a role that permits creating work items in any of your teams. Contact a team lead or admin if you think this is wrong."
          secondaryAction={{ label: "Back to work items", onClick: () => navigate("/items") }}
        />
      </div>
    );
  }

  const submitting = mutation.isPending;

  return (
    <div className="page page--narrow">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/items">Work items</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">New</span>
      </nav>

      <h1 className="page__title">New work item</h1>
      <p className="page__subtitle">Status starts at Open and is advanced separately.</p>

      {formError && (
        <Alert tone="error" title="Couldn't create the work item">
          {formError}
        </Alert>
      )}

      <form className="form card" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <ItemFormFields
          idPrefix="create"
          values={values}
          onChange={handleChange}
          fieldErrors={fieldErrors}
          teams={creatableTeams}
          currentUserId={user?.id}
          disabled={submitting}
        />

        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create work item"}
          </button>
          <Link to="/items" className="button">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
