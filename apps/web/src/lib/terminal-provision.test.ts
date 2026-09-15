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

  it("accepts and normalizes Second Life keys that are not RFC-versioned UUIDs", () => {
    expect(parseTerminalProvision({
      ...valid,
      objectId: " 01234567-89AB-CDEF-0123-456789ABCDEF ",
      ownerId: "abcdef01-2345-6789-cdef-0123456789ab",
    })).toMatchObject({
      objectId: "01234567-89ab-cdef-0123-456789abcdef",
      ownerId: "abcdef01-2345-6789-cdef-0123456789ab",
    });
  });

  it("rejects the null key for object and owner bindings", () => {
    const nullKey = "00000000-0000-0000-0000-000000000000";
    expect(() => parseTerminalProvision({ ...valid, objectId: nullKey })).toThrow("Invalid terminal binding");
    expect(() => parseTerminalProvision({ ...valid, ownerId: nullKey })).toThrow("Invalid terminal binding");
  });

  it.each(["second life", "Second Life Beta", "Agni", "", null, undefined])("rejects caller-controlled shard %s", (shard) => {
    expect(() => parseTerminalProvision({ ...valid, shard })).toThrow("Invalid terminal binding");
  });
});
