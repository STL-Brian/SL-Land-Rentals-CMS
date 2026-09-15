import { describe, expect, it } from "vitest";
import { parseTerminalProvision } from "./terminal-provision";

const valid = {
  listingId: "00000000-0000-4000-8000-000000000001",
  objectId: "00000000-0000-4000-8000-000000000002",
  ownerId: "00000000-0000-4000-8000-000000000003",
  shard: "Second Life",
};

describe("terminal provisioning grid enforcement", () => {
  it("accepts the fixed Second Life grid", () => {
    expect(parseTerminalProvision(valid)).toEqual(valid);
  });

  it.each(["second life", "Second Life Beta", "Agni", "", null, undefined])("rejects caller-controlled shard %s", (shard) => {
    expect(() => parseTerminalProvision({ ...valid, shard })).toThrow("Invalid terminal binding");
  });
});
