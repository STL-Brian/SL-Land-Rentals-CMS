"use client";

import { type FormEvent, useState } from "react";
import { Field, FormActions, FormGrid, Modal } from "./form-primitives";

type ListingRow = {
  id: string;
  name: string;
  slug?: string;
  kind?: string;
  regionName?: string;
  description?: string;
  areaSqm?: number;
  prims?: number;
  published: boolean;
  weeklyLinden: number;
  setupLinden: number;
  stripeWeeklyMinor: number;
  stripeSetupMinor: number;
  stripeCurrency?: string;
};

export function ListingsManager({ listings }: { listings: ListingRow[] }) {
  const [creating, setCreating] = useState(false);
  return <>
    <section className="panel card listing-panel">
      <div className="section-head">
        <div><h2>Rental inventory</h2><p>Review customer-facing prices and publishing state at a glance.</p></div>
        <button className="button btn btn-primary" type="button" onClick={() => setCreating(true)}>New property listing</button>
      </div>
      <div className="listing-grid row g-3">
        {listings.map((listing) => <article className="listing-admin-card" key={listing.id}>
          <div className="listing-card-head">
            <div><span className="listing-kind">{listing.kind?.replace("_", " ")}</span><h3>{listing.name}</h3></div>
            <span className={`publication-state ${listing.published ? "published" : "draft"}`}>{listing.published ? "Published" : "Draft"}</span>
          </div>
          <dl className="price-summary">
            <div><dt>Weekly</dt><dd>L${listing.weeklyLinden.toLocaleString()} <small>· {(listing.stripeWeeklyMinor/100).toLocaleString("en-US",{style:"currency",currency:listing.stripeCurrency ?? "USD"})}</small></dd></div>
            <div><dt>Setup</dt><dd>L${listing.setupLinden.toLocaleString()} <small>· {(listing.stripeSetupMinor/100).toLocaleString("en-US",{style:"currency",currency:listing.stripeCurrency ?? "USD"})}</small></dd></div>
          </dl>
          <ListingPricingForm listing={listing}/>
        </article>)}
        {!listings.length && <div className="empty-state"><h3>No listings yet</h3><p>Create the first Lake Tech Estates rental listing.</p></div>}
      </div>
    </section>
    <Modal open={creating} onClose={() => setCreating(false)} title="New property listing" description="Create inventory and set its initial customer pricing.">
      <InventoryForm onCancel={() => setCreating(false)}/>
    </Modal>
  </>;
}

export function InventoryForm({ onCancel }: { onCancel?: () => void }) {
  const [message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setMessage("");
    const form=new FormData(e.currentTarget);
    const payload={name:form.get("name"),slug:form.get("slug"),kind:form.get("kind"),regionName:form.get("regionName"),description:form.get("description"),areaSqm:Number(form.get("areaSqm")),prims:Number(form.get("prims")),weeklyLinden:Number(form.get("weeklyLinden")),setupLinden:Number(form.get("setupLinden")),stripeWeekly:String(form.get("stripeWeekly")),stripeSetup:String(form.get("stripeSetup")),published:form.get("published")==="on"};
    try {const r=await fetch("/api/admin/listings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok){setMessage(d.error??"Listing could not be created.");return}setMessage("Listing created.");location.reload()} catch {setMessage("Network error. Try again.")} finally {setSaving(false)}
  }
  return <form className="modern-form" onSubmit={submit}>
    <FormGrid>
      <Field label="Listing name" help="The customer-facing rental name."><input className="form-control" name="name" autoFocus required maxLength={128}/></Field>
      <Field label="URL slug" help="Lowercase letters, numbers, and hyphens."><input className="form-control" name="slug" pattern="[a-z0-9-]+" required/></Field>
      <Field label="Rental type"><select className="form-select" name="kind"><option value="PARCEL">Parcel</option><option value="FULL_REGION">Full region</option></select></Field>
      <Field label="Second Life region"><input className="form-control" name="regionName" required/></Field>
      <Field label="Area (m²)"><input className="form-control" name="areaSqm" type="number" min="1" inputMode="numeric" required/></Field>
      <Field label="Land impact allowance"><input className="form-control" name="prims" type="number" min="0" inputMode="numeric" required/></Field>
      <Field label="Weekly L$"><input className="form-control" name="weeklyLinden" type="number" min="1" inputMode="numeric" required/></Field>
      <Field label="Setup L$"><input className="form-control" name="setupLinden" type="number" min="0" inputMode="numeric" defaultValue="0" required/></Field>
      <Field label="Weekly USD" help="Enter dollars and cents, for example 12.34."><input className="form-control" name="stripeWeekly" type="text" inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" placeholder="12.34" required/></Field>
      <Field label="Setup USD"><input className="form-control" name="stripeSetup" type="text" inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" defaultValue="0.00" required/></Field>
      <Field label="Description" className="form-span"><textarea className="form-control" name="description" rows={4} minLength={20} required/></Field>
    </FormGrid>
    <label className="check-field"><input className="form-check-input" name="published" type="checkbox"/> Publish immediately</label>
    {message && <p className="form-message" role="alert">{message}</p>}
    <FormActions><button className="button btn btn-outline-light secondary" type="button" onClick={onCancel}>Cancel</button><button className="button btn btn-primary" type="submit" disabled={saving}>{saving?"Creating…":"Create listing"}</button></FormActions>
  </form>;
}

export function ListingPricingForm({listing}:{listing:ListingRow}) {
  const [open,setOpen]=useState(false);const[msg,setMsg]=useState("");const[saving,setSaving]=useState(false);const[reason,setReason]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setMsg("");const f=new FormData(e.currentTarget);const payload={name:String(f.get("name")),slug:String(f.get("slug")),kind:String(f.get("kind")),regionName:String(f.get("regionName")),description:String(f.get("description")),areaSqm:Number(f.get("areaSqm")),prims:Number(f.get("prims")),weeklyLinden:Number(f.get("weeklyLinden")),setupLinden:Number(f.get("setupLinden")),stripeWeekly:String(f.get("stripeWeekly")),stripeSetup:String(f.get("stripeSetup"))};try{const r=await fetch(`/api/admin/listings/${listing.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok){setMsg(d.error??"Listing update failed.");return}location.reload()}catch{setMsg("Network error. Try again.")}finally{setSaving(false)}}
  async function publish(){if(listing.published&&!reason.trim()){setMsg("A reason is required before unpublishing.");return}setSaving(true);setMsg("");try{const response=await fetch(`/api/admin/listings/${listing.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({published:!listing.published,reason:listing.published?reason:undefined})});const body=await response.json();if(!response.ok){setMsg(body.error??"Listing update failed.");return}location.reload()}catch{setMsg("Network error. Try again.")}finally{setSaving(false)}}
  return <>
    <button className="button secondary card-action" type="button" onClick={()=>setOpen(true)} aria-label={`Edit ${listing.name}`}>Edit</button>
    <Modal open={open} onClose={()=>setOpen(false)} title={`Edit ${listing.name}`} description="Update weekly and setup prices, or change publishing state.">
      <form className="modern-form" onSubmit={submit} aria-label={`Edit ${listing.name}`}>
        <FormGrid>
          <Field label="Listing name"><input className="form-control" name="name" defaultValue={listing.name} required maxLength={100}/></Field>
          <Field label="URL slug"><input className="form-control" name="slug" defaultValue={listing.slug} pattern="[a-z0-9-]+" required/></Field>
          <Field label="Rental type"><select className="form-select" name="kind" defaultValue={listing.kind}><option value="PARCEL">Parcel</option><option value="FULL_REGION">Full region</option></select></Field>
          <Field label="Second Life region"><input className="form-control" name="regionName" defaultValue={listing.regionName} required/></Field>
          <Field label="Area (m²)"><input className="form-control" name="areaSqm" type="number" min="1" inputMode="numeric" defaultValue={listing.areaSqm} required/></Field>
          <Field label="Land impact allowance"><input className="form-control" name="prims" type="number" min="0" inputMode="numeric" defaultValue={listing.prims} required/></Field>
          <Field label="Weekly L$"><input className="form-control" name="weeklyLinden" type="number" min="1" inputMode="numeric" defaultValue={listing.weeklyLinden} required/></Field>
          <Field label="Setup L$"><input className="form-control" name="setupLinden" type="number" min="0" inputMode="numeric" defaultValue={listing.setupLinden} required/></Field>
          <Field label="Weekly USD"><input className="form-control" name="stripeWeekly" type="text" inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" defaultValue={(listing.stripeWeeklyMinor/100).toFixed(2)} required/></Field>
          <Field label="Setup USD"><input className="form-control" name="stripeSetup" type="text" inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" defaultValue={(listing.stripeSetupMinor/100).toFixed(2)} required/></Field>
          <Field label="Description" className="form-span"><textarea className="form-control" name="description" rows={4} minLength={20} defaultValue={listing.description} required/></Field>
        </FormGrid>
        {msg&&<p className="form-message" role="alert">{msg}</p>}
        <FormActions><button className="button btn btn-outline-light secondary" type="button" onClick={()=>setOpen(false)}>Cancel</button><button className="button btn btn-primary" type="submit" disabled={saving}>{saving?"Saving…":"Save changes"}</button></FormActions>
      </form>
      <section className="danger-zone" aria-labelledby={`publishing-${listing.id}`}><h3 id={`publishing-${listing.id}`}>Publishing</h3><p>{listing.published?"Unpublishing removes this rental from public browsing.":"Publishing makes this rental visible to customers."}</p>{listing.published&&<Field label="Reason for unpublishing"><textarea className="form-control" value={reason} onChange={e=>setReason(e.target.value)} rows={2} required/></Field>}<button className={listing.published?"button danger":"button secondary"} type="button" disabled={saving} onClick={()=>void publish()}>{listing.published?"Unpublish listing":"Publish listing"}</button></section>
    </Modal>
  </>;
}
