import { describe, expect, it } from "vitest";
import {
  itemToFormValues,
  toCreateItemInput,
  toUpdateItemInput,
  validateItemForm,
} from "./itemForm";
import { makeItem, TEAM_PAYMENTS } from "../test/fixtures";
import type { ItemFormValues } from "../components/ItemFormFields";

function formValues(overrides: Partial<ItemFormValues> = {}): ItemFormValues {
  return {
    title: "Investigate latency",
    description: "",
    type: "INCIDENT",
    priority: "HIGH",
    teamId: TEAM_PAYMENTS,
    assigneeId: "",
    dueAt: "",
    ...overrides,
  };
}

describe("validateItemForm", () => {
  it("requires a title", () => {
    expect(validateItemForm(formValues({ title: "   " }))).toMatchObject({ title: "Title is required." });
  });

  it("rejects an over-long title and description", () => {
    const errors = validateItemForm(
      formValues({ title: "x".repeat(201), description: "y".repeat(5001) }),
    );
    expect(errors.title).toBeTruthy();
    expect(errors.description).toBeTruthy();
  });

  it("rejects a non-UUID assignee", () => {
    expect(validateItemForm(formValues({ assigneeId: "not-a-uuid" }))).toMatchObject({
      assigneeId: expect.any(String),
    });
  });

  it("accepts a well-formed form", () => {
    expect(validateItemForm(formValues({ assigneeId: "" }))).toEqual({});
  });
});

describe("payload mapping", () => {
  it("trims the title and normalises empty optional fields to null", () => {
    const input = toCreateItemInput(formValues({ title: "  Fix checkout  ", description: "  " }));
    expect(input).toEqual({
      title: "Fix checkout",
      description: null,
      type: "INCIDENT",
      priority: "HIGH",
      teamId: TEAM_PAYMENTS,
      assigneeId: null,
      dueAt: null,
    });
  });

  it("converts a due date to an ISO string", () => {
    const input = toCreateItemInput(formValues({ dueAt: "2026-11-01T09:30" }));
    expect(input.dueAt).toBe(new Date("2026-11-01T09:30").toISOString());
  });

  it("carries expectedVersion on update and never sends protected fields", () => {
    const input = toUpdateItemInput(formValues({ assigneeId: "" }), 7);
    expect(input.expectedVersion).toBe(7);
    expect(input).not.toHaveProperty("teamId");
    expect(input).not.toHaveProperty("status");
    expect(input).not.toHaveProperty("version");
  });

  it("maps a fetched item back into form values", () => {
    const dueAt = "2026-11-01T09:30:00.000Z";
    const values = itemToFormValues(makeItem({ description: null, assigneeId: null, dueAt }));
    expect(values.title).toBe("Latency spike on checkout");
    expect(values.description).toBe("");
    expect(values.assigneeId).toBe("");
    // `datetime-local` values are local-time strings; the instant must match.
    expect(new Date(values.dueAt).getTime()).toBe(new Date(dueAt).getTime());
  });
});
