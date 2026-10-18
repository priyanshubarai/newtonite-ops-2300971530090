import type { CreateItemInput, UpdateItemInput, WorkItem } from "../api/types";
import type { ItemFormValues } from "../components/ItemFormFields";
import { isUuid, isoToDateTimeLocal } from "./format";
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from "./limits";

/**
 * Client-side validation and payload mapping shared by the create and edit
 * forms. Validation here is for usability only; the backend validates again and
 * is authoritative, so these rules intentionally mirror (never replace) it.
 */

export function validateItemForm(values: ItemFormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  const title = values.title.trim();
  if (!title) errors.title = "Title is required.";
  else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = `Title must be at most ${TITLE_MAX_LENGTH} characters.`;
  }

  if (values.description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`;
  }

  const assignee = values.assigneeId.trim();
  if (assignee && !isUuid(assignee)) {
    errors.assigneeId = "Enter a full user ID (UUID), or leave blank.";
  }

  if (values.dueAt && Number.isNaN(new Date(values.dueAt).getTime())) {
    errors.dueAt = "Enter a valid date and time.";
  }

  return errors;
}

/** Validate that a team has been chosen (create mode only). */
export function validateTeamSelected(values: ItemFormValues): Record<string, string> {
  return values.teamId ? {} : { teamId: "Select a team." };
}

function normalizeDueAt(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
}

export function toCreateItemInput(values: ItemFormValues): CreateItemInput {
  return {
    title: values.title.trim(),
    description: normalizeOptionalText(values.description),
    type: values.type,
    priority: values.priority,
    teamId: values.teamId,
    assigneeId: values.assigneeId.trim() ? values.assigneeId.trim() : null,
    dueAt: normalizeDueAt(values.dueAt),
  };
}

export function toUpdateItemInput(values: ItemFormValues, expectedVersion: number): UpdateItemInput {
  return {
    title: values.title.trim(),
    description: normalizeOptionalText(values.description),
    type: values.type,
    priority: values.priority,
    assigneeId: values.assigneeId.trim() ? values.assigneeId.trim() : null,
    dueAt: normalizeDueAt(values.dueAt),
    expectedVersion,
  };
}

export function itemToFormValues(item: WorkItem): ItemFormValues {
  return {
    title: item.title,
    description: item.description ?? "",
    type: item.type,
    priority: item.priority,
    teamId: item.teamId,
    assigneeId: item.assigneeId ?? "",
    dueAt: isoToDateTimeLocal(item.dueAt),
  };
}
