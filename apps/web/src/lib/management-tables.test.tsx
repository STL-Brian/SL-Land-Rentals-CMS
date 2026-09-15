// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditTable } from "../components/audit-table.js";
import { RentalsTable } from "../components/rentals-table.js";

const rows=Array.from({length:21},(_,index)=>({id:String(index),action:index===20?"NEEDLE_ACTION":"ROLE_CHANGED",actor:index===20?"Needle Operator":"Admin",targetType:"USER",targetId:String(index),details:index===20?[["reason","needle detail"] as [string,string]]:[],createdAt:"2026-09-14T12:00:00.000Z"}));
afterEach(cleanup);

describe("management data tables",()=>{
  it("searches and paginates the security audit",async()=>{const user=userEvent.setup();render(<AuditTable rows={rows}/>);expect(screen.getByText("Page 1 of 2")).toBeTruthy();expect(screen.queryByText("Needle Operator")).toBeNull();await user.click(screen.getByRole("button",{name:"Next page"}));expect(screen.getByText("Needle Operator")).toBeTruthy();await user.type(screen.getByRole("searchbox",{name:"Search security audit"}),"needle");expect(screen.getByText("Page 1 of 1")).toBeTruthy();expect(screen.getByText("NEEDLE_ACTION")).toBeTruthy();});
  it("defaults leasing management to active rentals and supports filtering",async()=>{const user=userEvent.setup();render(<RentalsTable rows={[{id:"active",name:"Active Parcel",displayName:"Active User",canonicalUsername:"active.user",status:"ACTIVE",startsAt:"2026-09-01T00:00:00.000Z",endsAt:"2026-09-20T00:00:00.000Z"},{id:"ended",name:"Ended Parcel",displayName:"Past User",canonicalUsername:"past.user",status:"ENDED",startsAt:"2026-08-01T00:00:00.000Z",endsAt:"2026-08-20T00:00:00.000Z"}]}/>);expect(screen.getByText("Active Parcel")).toBeTruthy();expect(screen.queryByText("Ended Parcel")).toBeNull();await user.selectOptions(screen.getByRole("combobox",{name:"Filter rentals by status"}),"ALL");expect(screen.getByText("Ended Parcel")).toBeTruthy();});
});
