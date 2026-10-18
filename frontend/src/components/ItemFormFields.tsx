import type { Membership, WorkItemType, WorkPriority } from "../api/types";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from "../lib/limits";
import {
  PRIORITY_LABELS,
  TYPE_LABELS,
} from "../lib/constants";
import { isUuid } from "../lib/format";
import { FormField } from "./FormField";

/** Editable values shared by the create and edit forms (all strings). */
export interface ItemFormValues {
  title: string;
  description: string;
  type: WorkItemType;
  priority: WorkPriority;
  teamId: string;
  assigneeId: string;
  dueAt: string;
}

export const EMPTY_ITEM_FORM_VALUES: ItemFormValues = {
  title: "",
  description: "",
  type: "TASK",
  priority: "MEDIUM",
  teamId: "",
  assigneeId: "",
  dueAt: "",
};

/**
 * The editable field set for a work item.
 *
 * Deliberately excludes status: status only changes through the dedicated
 * workflow-transition action. On edit, the team is shown read-only because team
 * ownership is immutable in the approved API contract.
 */
export function ItemFormFields({
  idPrefix,
  values,
  onChange,
  fieldErrors,
  teams,
  lockedTeamName,
  currentUserId,
  disabled = false,
}: {
  idPrefix: string;
  values: ItemFormValues;
  onChange: <K extends keyof ItemFormValues>(field: K, value: ItemFormValues[K]) => void;
  fieldErrors: Record<string, string>;
  /** Selectable teams (create mode). */
  teams?: Membership[];
  /** Team name to display read-only (edit mode). */
  lockedTeamName?: string;
  currentUserId?: string;
  disabled?: boolean;
}) {
  const assigneeError =
    fieldErrors.assigneeId ??
    (values.assigneeId.length > 0 && !isUuid(values.assigneeId)
      ? "Enter a full user ID (UUID), or leave blank."
      : null);

  return (
    <>
      <FormField
        id={`${idPrefix}-title`}
        label="Title"
        required
        error={fieldErrors.title}
        hint={`Up to ${TITLE_MAX_LENGTH} characters.`}
      >
        {(props) => (
          <input
            {...props}
            className="input"
            type="text"
            value={values.title}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => onChange("title", event.target.value)}
          />
        )}
      </FormField>

      <FormField
        id={`${idPrefix}-description`}
        label="Description"
        error={fieldErrors.description}
        hint={`Optional. Up to ${DESCRIPTION_MAX_LENGTH} characters.`}
      >
        {(props) => (
          <textarea
            {...props}
            className="input input--textarea"
            rows={5}
            value={values.description}
            disabled={disabled}
            onChange={(event) => onChange("description", event.target.value)}
          />
        )}
      </FormField>

      <div className="field-row">
        <FormField
          id={`${idPrefix}-type`}
          label="Type"
          required
          error={fieldErrors.type}
        >
          {(props) => (
            <select
              {...props}
              className="input"
              value={values.type}
              disabled={disabled}
              onChange={(event) => onChange("type", event.target.value as WorkItemType)}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          id={`${idPrefix}-priority`}
          label="Priority"
          required
          error={fieldErrors.priority}
        >
          {(props) => (
            <select
              {...props}
              className="input"
              value={values.priority}
              disabled={disabled}
              onChange={(event) => onChange("priority", event.target.value as WorkPriority)}
            >
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>

      {teams ? (
        <FormField
          id={`${idPrefix}-team`}
          label="Team"
          required
          error={fieldErrors.teamId}
        >
          {(props) => (
            <select
              {...props}
              className="input"
              value={values.teamId}
              disabled={disabled}
              onChange={(event) => onChange("teamId", event.target.value)}
            >
              <option value="">Select a team…</option>
              {teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.teamName}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : (
        <FormField id={`${idPrefix}-team`} label="Team" hint="Team ownership cannot be changed.">
          {(props) => (
            <input
              {...props}
              id={`${idPrefix}-team`}
              className="input"
              type="text"
              value={lockedTeamName ?? "—"}
              readOnly
              disabled
            />
          )}
        </FormField>
      )}

      <FormField
        id={`${idPrefix}-assignee`}
        label="Assignee (optional)"
        error={assigneeError}
        hint="User ID (UUID) of a member of the selected team. Leave blank to keep it unassigned."
      >
        {(props) => (
          <input
            {...props}
            className="input"
            type="text"
            spellCheck={false}
            value={values.assigneeId}
            disabled={disabled}
            onChange={(event) => onChange("assigneeId", event.target.value)}
          />
        )}
      </FormField>

      {currentUserId && (
        <div className="field-inline-action">
          <button
            type="button"
            className="button button--ghost"
            disabled={disabled}
            onClick={() => onChange("assigneeId", currentUserId)}
          >
            Assign to me
          </button>
        </div>
      )}

      <FormField id={`${idPrefix}-due`} label="Due date (optional)" error={fieldErrors.dueAt}>
        {(props) => (
          <input
            {...props}
            className="input"
            type="datetime-local"
            value={values.dueAt}
            disabled={disabled}
            onChange={(event) => onChange("dueAt", event.target.value)}
          />
        )}
      </FormField>
    </>
  );
}
