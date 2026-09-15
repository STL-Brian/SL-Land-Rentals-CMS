import { describe, expect, it } from "vitest";
import { consumeLoginRateLimit, fixedWindowStart, rateLimitAllowed } from "./rate-limit.js";

describe("fixed-window rate limits", () => {
  it("keeps both endpoints inside the window and resets exactly at the boundary", () => {
    expect(fixedWindowStart(599_999, 600)).toBe(0);
    expect(fixedWindowStart(600_000, 600)).toBe(600_000);
  });
  it("allows the limit-th hit and rejects the next hit", () => {
    expect(rateLimitAllowed(4, 5)).toBe(true);
    expect(rateLimitAllowed(5, 5)).toBe(false);
  });
  it("does not create username buckets after an IP is exhausted", async () => {
    const scopes:string[]=[];
    const db={query:async (_sql:string,values:unknown[])=>{scopes.push(String(values[0]));return {rowCount:values[0]==="otp-create-ip"?0:1,rows:[]}}};
    await expect(consumeLoginRateLimit(db,"otp-create","198.51.100.4","many names",20,5,600)).resolves.toBe(false);
    expect(scopes).toEqual(["otp-create-ip"]);
  });
});
