import { describe, expect, it } from "vitest";
import { reservationUserSearchPattern } from "./reservation-user-search.js";

describe("reservation account search",()=>{
  it("matches anywhere in an account name and escapes SQL wildcard input",()=>{
    expect(reservationUserSearchPattern(" Resident ")).toBe("%resident%");
    expect(reservationUserSearchPattern("ri%_ley")).toBe("%ri\\%\\_ley%");
  });
});
