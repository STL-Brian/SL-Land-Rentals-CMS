import { describe, expect, it } from "vitest";
import { canRecoverProviderAction } from "./provider-recovery.js";

describe("provider action recovery UI",()=>{
  it("offers operator controls only for API-recoverable states",()=>{
    expect(canRecoverProviderAction("FAILED")).toBe(true);
    expect(canRecoverProviderAction("MANUAL_REVIEW")).toBe(true);
    expect(canRecoverProviderAction("QUEUED")).toBe(false);
    expect(canRecoverProviderAction("PROCESSING")).toBe(false);
  });
});
