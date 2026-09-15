import { describe, expect, it } from "vitest";
import { DISPLAY_TIME_ZONE, formatDate, formatDateTime } from "./date-time";

describe("website time zone", () => {
  it("formats timestamps in America/Chicago with the active zone abbreviation", () => {
    expect(DISPLAY_TIME_ZONE).toBe("America/Chicago");
    expect(formatDateTime("2026-09-15T00:00:00.000Z")).toBe("Sep 14, 2026, 7:00 PM CDT");
    expect(formatDateTime("2026-12-15T00:00:00.000Z")).toBe("Dec 14, 2026, 6:00 PM CST");
  });

  it("formats calendar dates against the Chicago day boundary", () => {
    expect(formatDate("2026-09-15T00:00:00.000Z")).toBe("Sep 14, 2026");
  });
});
