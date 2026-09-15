import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./date-time";

describe("UTC timestamp fallback formatting", () => {
  it("does not expose a fixed display timezone", () => {
    expect(formatDateTime("2026-09-15T00:00:00.000Z")).toBe("Sep 15, 2026, 12:00 AM UTC");
    expect(formatDate("2026-09-15T00:00:00.000Z")).toBe("Sep 15, 2026");
  });
});
