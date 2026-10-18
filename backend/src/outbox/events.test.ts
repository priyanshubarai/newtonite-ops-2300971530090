import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OUTBOX_JOB_TYPES } from "../items/outbox.js";
import { SUPPORTED_JOB_TYPES, isSupportedJobType, parseOutboxPayload } from "./events.js";

/**
 * Pure unit tests for the outbox event contract (no database involved).
 *
 * These pin the consumer to the Phase 5 producer's format: the same four job
 * types and the same five payload fields. If the producer ever changes, these
 * fail rather than letting the worker silently reject every event.
 */

function validPayload() {
  return {
    workItemId: randomUUID(),
    teamId: randomUUID(),
    actorId: randomUUID(),
    status: "OPEN",
    version: 1,
  };
}

describe("outbox event contract", () => {
  it("supports exactly the job types the producer emits", () => {
    const producerTypes = Object.values(OUTBOX_JOB_TYPES).sort();
    expect([...SUPPORTED_JOB_TYPES].sort()).toEqual(producerTypes);
  });

  it("recognises supported job types and rejects others", () => {
    for (const type of SUPPORTED_JOB_TYPES) {
      expect(isSupportedJobType(type)).toBe(true);
    }
    expect(isSupportedJobType("work_item.deleted")).toBe(false);
    expect(isSupportedJobType("")).toBe(false);
  });

  it("accepts a well-formed payload", () => {
    const payload = validPayload();
    const result = parseOutboxPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(payload);
    }
  });

  it("accepts every work status in the schema", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "RESOLVED", "CLOSED"]) {
      expect(parseOutboxPayload({ ...validPayload(), status }).ok).toBe(true);
    }
  });

  it("rejects a missing required field", () => {
    const { workItemId: _omitted, ...rest } = validPayload();
    const result = parseOutboxPayload(rest);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown field so producer/consumer drift is visible", () => {
    const result = parseOutboxPayload({ ...validPayload(), injected: "value" });
    expect(result.ok).toBe(false);
  });

  it("rejects identifiers that are not UUIDs", () => {
    for (const field of ["workItemId", "teamId", "actorId"] as const) {
      const result = parseOutboxPayload({ ...validPayload(), [field]: "not-a-uuid" });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a version that is not a positive integer", () => {
    for (const version of [0, -1, 1.5, "1", null]) {
      expect(parseOutboxPayload({ ...validPayload(), version }).ok).toBe(false);
    }
  });

  it("rejects an unknown status", () => {
    expect(parseOutboxPayload({ ...validPayload(), status: "REOPENED" }).ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    for (const value of [null, undefined, "work_item.created", 42, []]) {
      expect(parseOutboxPayload(value).ok).toBe(false);
    }
  });

  it("reports validation issues without echoing the offending value", () => {
    const marker = "S3CR3T-VALUE-THAT-MUST-NOT-BE-ECHOED";
    const result = parseOutboxPayload({ ...validPayload(), workItemId: marker });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContain("workItemId");
      expect(result.issues).not.toContain(marker);
    }
  });
});
