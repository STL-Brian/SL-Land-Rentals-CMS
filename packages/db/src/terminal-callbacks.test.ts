import { describe, expect, it } from "vitest";
import { enqueueTerminalCallback } from "./terminal-callbacks.js";

describe("terminal callback enqueue", () => {
  it("inserts an idempotent delivery using the transaction client", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const client = { query: async (text: string, values: unknown[]) => { queries.push({ text, values }); return { rows: [], rowCount: 1 }; } };
    await enqueueTerminalCallback(client, { terminalId: "terminal-1", eventId: "event-1", callbackUrl: "https://object.secondlife.io/callback", callbackGeneration: 2, secretCiphertext: "sealed-at-generation-2", kind: "PAYMENT_RESULT", sequence: 1, payload: { status: "CONFIRMED" } });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain("ON CONFLICT (terminal_id,event_id) DO NOTHING");
    expect(queries[0]?.values).toEqual(["terminal-1", "event-1", "https://object.secondlife.io/callback", 2, "sealed-at-generation-2", "PAYMENT_RESULT", '{"status":"CONFIRMED"}', 1]);
  });

  it("fails closed before writing for non-HTTPS callback URLs", async () => {
    const client = { query: async () => { throw new Error("must not write"); } };
    await expect(enqueueTerminalCallback(client, { terminalId: "terminal-1", eventId: "event-1", callbackUrl: "http://object.secondlife.io/callback", callbackGeneration: 1, secretCiphertext: "sealed", kind: "PAYMENT_RESULT", sequence: 1, payload: {} })).rejects.toThrow("invalid terminal callback URL");
  });
});
