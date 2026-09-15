import { describe, expect, it } from "vitest";
import { assertBrowserOrigin, clientIp, sessionCookieOptions } from "./http.js";

describe("browser mutation security", () => {
  it("allows exact configured origin and rejects missing or foreign origins", () => {
    expect(() => assertBrowserOrigin(new Headers({ origin: "http://localhost:3000" }), "http://localhost:3000")).not.toThrow();
    expect(() => assertBrowserOrigin(new Headers(), "http://localhost:3000")).toThrow();
    expect(() => assertBrowserOrigin(new Headers({ origin: "https://evil.test" }), "http://localhost:3000")).toThrow();
  });
  it("uses opaque no-script session cookie settings", () => {
    expect(sessionCookieOptions(false).httpOnly).toBe(true);
    expect(sessionCookieOptions(false).sameSite).toBe("lax");
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
  it("uses the rightmost address supplied by the one trusted nginx hop", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.10, 10.0.0.2" });
    expect(clientIp(headers, false)).toBe("direct");
    expect(clientIp(headers, true)).toBe("10.0.0.2");
  });
  it("fails closed on malformed, empty, and overlong forwarded chains", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "attacker-controlled" }), true)).toBe("direct");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.1,,10.0.0.2" }), true)).toBe("direct");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1,2.2.2.2,3.3.3.3" }), true)).toBe("direct");
  });
});
