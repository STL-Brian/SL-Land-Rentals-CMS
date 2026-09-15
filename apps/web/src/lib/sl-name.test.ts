import { describe, expect, it, vi } from "vitest";
import { parseSecondLifeUsername, resolveSecondLifeAgentId } from "./sl-name.js";

describe("Second Life name resolution", () => {
  it("canonicalizes one-part names to Resident", () => {
    expect(parseSecondLifeUsername("  Mira  ")).toEqual({
      username: "mira",
      lastname: "Resident",
      canonical: "mira resident",
    });
  });

  it("preserves the two-part account name boundary", () => {
    expect(parseSecondLifeUsername("First.Last")).toEqual({
      username: "first",
      lastname: "last",
      canonical: "first last",
    });
    expect(parseSecondLifeUsername("First Last")).toEqual({
      username: "first",
      lastname: "last",
      canonical: "first last",
    });
  });

  it("posts the official request shape and API key", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ agent_id: "11111111-1111-4111-8111-111111111111" }), { status: 200 }));
    const result = await resolveSecondLifeAgentId("Mira", "test-api-key", fetcher);

    expect(result).toBe("11111111-1111-4111-8111-111111111111");
    expect(fetcher).toHaveBeenCalledWith("https://api.secondlife.com/get_agent_id", expect.objectContaining({
      method: "POST",
      headers: { "api-key": "test-api-key", "content-type": "application/json" },
      body: JSON.stringify({ username: "mira", lastname: "Resident" }),
      cache: "no-store",
    }));
  });

  it("returns null for upstream failures or malformed IDs", async () => {
    await expect(resolveSecondLifeAgentId("Mira", "key", async () => new Response("bad", { status: 502 }))).resolves.toBeNull();
    await expect(resolveSecondLifeAgentId("Mira", "key", async () => new Response(JSON.stringify({ agent_id: "not-a-uuid" })))).resolves.toBeNull();
  });
});
