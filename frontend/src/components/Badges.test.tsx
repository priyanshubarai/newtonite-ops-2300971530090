import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriorityBadge, StatusBadge, TypeBadge } from "./Badges";
import { PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "../lib/constants";

/**
 * The shared status/priority/type badges.
 *
 * These replaced a second, divergent badge implementation in
 * `components/ui/Badge.tsx` that printed raw enum values ("in_progress") and
 * used hyphenated status classes (`badge--status-in-progress`) which no style
 * rule matched. The contract pinned here is: human-readable label, the
 * underscore class the stylesheet actually defines, and a non-colour severity
 * cue for the two highest priorities.
 */
describe("badges", () => {
  it("shows human-readable status labels, never raw enum values", () => {
    render(<StatusBadge status="AWAITING_APPROVAL" />);
    const badge = screen.getByText(STATUS_LABELS.AWAITING_APPROVAL);

    expect(badge.textContent).toBe("Awaiting approval");
    expect(badge.textContent).not.toBe("AWAITING_APPROVAL");
    expect(badge.className).not.toContain("AWAITING_APPROVAL");
  });

  it("emits the underscore status class the stylesheet defines", () => {
    render(<StatusBadge status="IN_PROGRESS" />);
    const badge = screen.getByText(STATUS_LABELS.IN_PROGRESS);

    expect(badge.className).toContain("badge");
    expect(badge.className).toContain("badge--status");
    expect(badge.className).toContain("badge--status-in_progress");
    expect(badge.className).not.toContain("badge--status-in-progress");
  });

  it("carries a non-colour severity mark for HIGH and CRITICAL", () => {
    const { unmount } = render(<PriorityBadge priority="CRITICAL" />);
    const critical = screen.getByText(PRIORITY_LABELS.CRITICAL);
    const criticalMark = critical.querySelector('[aria-hidden="true"]');

    expect(criticalMark).not.toBeNull();
    expect(criticalMark?.textContent?.trim()).toBe("▲▲");
    expect(critical.className).toContain("badge--priority-critical");
    unmount();

    render(<PriorityBadge priority="HIGH" />);
    const high = screen.getByText(PRIORITY_LABELS.HIGH);
    expect(high.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe("▲");
  });

  it("adds no severity mark to LOW and MEDIUM", () => {
    render(<PriorityBadge priority="LOW" />);
    const low = screen.getByText(PRIORITY_LABELS.LOW);

    expect(low.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(low.textContent).toBe("Low");
    expect(low.className).toContain("badge--priority-low");
  });

  it("labels the work item type", () => {
    render(<TypeBadge type="CUSTOMER_ISSUE" />);
    const badge = screen.getByText(TYPE_LABELS.CUSTOMER_ISSUE);

    expect(badge.textContent).toBe("Customer issue");
    expect(badge.className).toContain("badge--type");
  });
});
