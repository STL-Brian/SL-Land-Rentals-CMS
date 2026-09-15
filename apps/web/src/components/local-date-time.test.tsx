// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LocalDateTime } from "./local-date-time";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("local timestamp display", () => {
  it("renders a deterministic UTC fallback, then uses the browser default timezone", async () => {
    const format = vi.fn(() => "Sep 14, 2026, 7:00 PM CDT");
    const dateTimeFormat = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      return { format } as unknown as Intl.DateTimeFormat;
    });
    render(<LocalDateTime value="2026-09-15T00:00:00.000Z" />);
    await waitFor(() => expect(screen.getByText("Sep 14, 2026, 7:00 PM CDT")).toBeTruthy());
    expect(dateTimeFormat).toHaveBeenCalled();
    expect(screen.getByRole("time").getAttribute("dateTime")).toBe("2026-09-15T00:00:00.000Z");
  });
});
