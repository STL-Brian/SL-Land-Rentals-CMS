import { createTerminalCallbackEnvelope, sealTerminalSecret } from "@lake-tech/core";
import { describe, expect, it, vi } from "vitest";
import { claimTerminalCallback, processOneTerminalCallback, runOneTerminalCallback } from "./terminal-callback-worker.js";

type Query = { sql: string; values?: unknown[] };
function scriptedDb(results: Array<{ rows: any[]; rowCount: number }>) {
  const queries: Query[] = [];
  return {
    queries,
    db: { query: vi.fn(async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return results.shift() ?? { rows: [], rowCount: 0 }; }) },
  };
}

describe("terminal callback worker", () => {
  it("claims due rows with a lease and increments attempts", async () => {
    const { db, queries } = scriptedDb([
      { rows: [{ id: "7", event_id: "evt-1", callback_url: "https://example.test/cb", callback_generation: 3, kind: "PAYMENT_RESULT", payload: { status: "CONFIRMED" }, sequence: 1, created_at: "2026-09-15T12:00:00.000Z", secret_ciphertext: "sealed" , attempts: 0 }], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    const item = await claimTerminalCallback(db);
    expect(item?.id).toBe("7");
    expect(queries[0]?.sql).toContain("FOR UPDATE OF d SKIP LOCKED");
    expect(queries[0]?.sql).toContain("d.secret_ciphertext");
    expect(queries[0]?.sql).not.toContain("JOIN terminals");
    expect(queries[1]?.sql).toContain("claimed_at=now()");
    expect(queries[1]?.values).toEqual(["7"]);
  });

  it("acknowledges a 2xx callback and retries a failed callback", async () => {
    const first = scriptedDb([{ rows: [], rowCount: 1 }]);
    const item = { id: "7", event_id: "evt-1", callback_url: "https://example.test/cb", callback_generation: 3, kind: "PAYMENT_RESULT", payload: { status: "CONFIRMED" }, sequence: 1, created_at: "2026-09-15T12:00:00.000Z", secret_ciphertext: "sealed", attempts: 1 };
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    await runOneTerminalCallback(first.db, item, "secret", fetcher);
    expect(first.queries[0]?.sql).toContain("delivered_at=now()");

    const second = scriptedDb([{ rows: [], rowCount: 1 }]);
    const failing = vi.fn(async () => new Response("no", { status: 503 }));
    await runOneTerminalCallback(second.db, item, "secret", failing);
    expect(second.queries[0]?.sql).toContain("available_at=now()+");
    expect(second.queries[0]?.sql).toContain("dead_lettered_at=CASE");
    expect(second.queries[0]?.values?.[0]).toBe("7");
  });

  it("uses the queued secret snapshot after the terminal secret rotates", async () => {
    const encryptionKey = "encryption-key";
    const oldSecret = "old-secret";
    const newSecret = "new-secret";
    const item = { id: "7", event_id: "evt-1", callback_url: "https://example.test/cb", callback_generation: 3, kind: "PAYMENT_RESULT", payload: { status: "CONFIRMED" }, sequence: 1, created_at: "2026-09-15T12:00:00.000Z", secret_ciphertext: sealTerminalSecret(oldSecret, encryptionKey), attempts: 1 };
    const db = scriptedDb([{ rows: [item], rowCount: 1 }, { rows: [], rowCount: 1 }, { rows: [], rowCount: 1 }]);
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const envelope = JSON.parse(String(init?.body));
        const data = { eventId: item.event_id, kind: item.kind, sequence: 1, payload: item.payload, createdAt: new Date(item.created_at).toISOString() };
      expect(envelope.signature).toBe(createTerminalCallbackEnvelope(data, oldSecret).signature);
      expect(envelope.signature).not.toBe(createTerminalCallbackEnvelope(data, newSecret).signature);
      return new Response("ok", { status: 200 });
    });
    await processOneTerminalCallback(async fn => fn(db.db), encryptionKey, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
