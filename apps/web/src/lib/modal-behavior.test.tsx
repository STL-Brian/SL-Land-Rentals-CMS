// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../components/form-primitives.js";
import { ListingsManager } from "../components/inventory-form.js";
import { UserRoleForm } from "../components/user-role-form.js";
import { ReservationForm } from "../components/reservation-actions.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function ModalHarness() {
  const [open,setOpen]=useState(false);
  return <><button onClick={()=>setOpen(true)}>Open settings</button><Modal open={open} onClose={()=>setOpen(false)} title="Settings" description="Dialog behavior test"><input aria-label="First field"/><button>Last action</button></Modal></>;
}

const listing={id:"listing-a",name:"Parcel A",kind:"PARCEL",published:true,weeklyLinden:1000,setupLinden:100,stripeWeeklyMinor:1234,stripeSetupMinor:250,stripeCurrency:"USD"};

describe("management modal behavior",()=>{
  it("opens, traps focus, closes with Escape, and restores trigger focus",async()=>{
    const user=userEvent.setup();render(<ModalHarness/>);const trigger=screen.getByRole("button",{name:"Open settings"});await user.click(trigger);const dialog=screen.getByRole("dialog",{name:"Settings"});expect(dialog.getAttribute("aria-modal")).toBe("true");expect(document.activeElement).toBe(screen.getByRole("button",{name:"Close Settings"}));await user.keyboard("{Shift>}{Tab}{/Shift}");expect(document.activeElement).toBe(screen.getByRole("button",{name:"Last action"}));await user.keyboard("{Escape}");expect(screen.queryByRole("dialog")).toBeNull();expect(document.activeElement).toBe(trigger);
  });

  it("opens and backdrop-closes create, then opens the explicit listing editor",async()=>{
    const user=userEvent.setup();render(<ListingsManager listings={[listing]}/>);const create=screen.getByRole("button",{name:"New property listing"});await user.click(create);const createDialog=screen.getByRole("dialog",{name:"New property listing"});fireEvent.mouseDown(createDialog.parentElement!,{target:createDialog.parentElement});await waitFor(()=>expect(screen.queryByRole("dialog",{name:"New property listing"})).toBeNull());expect(document.activeElement).toBe(create);await user.click(screen.getByRole("button",{name:"Edit Parcel A"}));expect(screen.getByRole("dialog",{name:"Edit Parcel A"})).toBeTruthy();expect((screen.getByLabelText("Weekly USD") as HTMLInputElement).value).toBe("12.34");
  });

  it("submits create and edit forms with loading-safe inline errors",async()=>{
    const user=userEvent.setup();const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue({ok:false,json:async()=>({error:"Server validation message"})} as Response);render(<ListingsManager listings={[listing]}/>);
    await user.click(screen.getByRole("button",{name:"New property listing"}));const createDialog=screen.getByRole("dialog",{name:"New property listing"});const createForm=createDialog.querySelector("form")!;fireEvent.submit(createForm);await waitFor(()=>expect(within(createDialog).getByRole("alert").textContent).toContain("Server validation message"));expect(fetchMock).toHaveBeenCalledWith("/api/admin/listings",expect.objectContaining({method:"POST"}));
    await user.click(within(createDialog).getByRole("button",{name:"Cancel"}));await user.click(screen.getByRole("button",{name:"Edit Parcel A"}));const editDialog=screen.getByRole("dialog",{name:"Edit Parcel A"});fireEvent.submit(editDialog.querySelector("form")!);await waitFor(()=>expect(within(editDialog).getByRole("alert").textContent).toContain("Server validation message"));expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/listings/listing-a",expect.objectContaining({method:"PATCH"}));
  });

  it("opens role editing in a compact modal instead of an inline schema form",async()=>{
    const user=userEvent.setup();render(<UserRoleForm id="user-a" current="RESIDENT"/>);expect(screen.queryByRole("combobox")).toBeNull();await user.click(screen.getByRole("button",{name:"Edit role"}));const dialog=screen.getByRole("dialog",{name:"Edit user role"});expect(within(dialog).getByRole("combobox")).toBeTruthy();expect(within(dialog).queryByRole("checkbox")).toBeNull();expect(within(dialog).getByRole("button",{name:"Save role"})).toBeTruthy();
  });

  it("ignores stale account-search responses that arrive out of order",async()=>{
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    vi.spyOn(globalThis,"fetch").mockImplementation((input) => String(input).includes("q=ril") ? first : second);
    render(<ReservationForm listings={[{id:"listing-a",name:"Parcel A"}]}/>);
    const search=screen.getByRole("combobox",{name:"Find an existing resident or renter"});
    fireEvent.change(search,{target:{value:"ril"}});
    fireEvent.change(search,{target:{value:"mir"}});
    resolveSecond({ok:true,json:async()=>[{id:"resident-b",display_name:"Mira Renter",canonical_username:"mira.renter"}]} as Response);
    expect(await screen.findByRole("option",{name:/Mira Renter/})).toBeTruthy();
    resolveFirst({ok:true,json:async()=>[{id:"resident-a",display_name:"Riley Resident",canonical_username:"riley.resident"}]} as Response);
    await waitFor(()=>expect(screen.queryByRole("option",{name:/Riley Resident/})).toBeNull());
    expect(screen.getByRole("option",{name:/Mira Renter/})).toBeTruthy();
  });

  it("uses an account typeahead and preserves reservation fields after server errors",async()=>{
    const user=userEvent.setup();vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>String(input).includes("reservation-users")?({ok:true,json:async()=>[{id:"resident-a",display_name:"Riley Resident",canonical_username:"riley.resident"}]} as Response):({ok:false,json:async()=>({error:"Listing became unavailable"})} as Response));render(<ReservationForm listings={[{id:"listing-a",name:"Parcel A"}]}/>);const search=screen.getByRole("combobox",{name:"Find an existing resident or renter"});await user.type(search,"ril");const option=await screen.findByRole("option",{name:/Riley Resident/});await user.click(option);const expires=screen.getByLabelText("Expires at") as HTMLInputElement;const notes=screen.getByLabelText("Staff notes") as HTMLTextAreaElement;fireEvent.change(expires,{target:{value:"2026-09-15T12:00"}});await user.type(notes,"Keep these notes");await user.click(screen.getByRole("button",{name:"Create reservation"}));await screen.findByText("Listing became unavailable");expect(expires.value).toBe("2026-09-15T12:00");expect(notes.value).toBe("Keep these notes");expect((search as HTMLInputElement).value).toContain("Riley Resident");
  });
});
