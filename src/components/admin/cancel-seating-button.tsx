"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function CancelSeatingButton({id, reference, seat, night}: {id:string; reference:string; seat:string; night:string}) {
 const [open,setOpen]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState("");
 const router=useRouter();
 async function cancel() {
  setBusy(true);setError("");
  try {
   const response=await fetch(`/api/admin/seating-bookings/${encodeURIComponent(id)}/cancel`,{method:"POST",credentials:"same-origin"});
   const data=await response.json().catch(()=>null);
   if(!response.ok) throw new Error(data?.error?.message ?? "Cancellation failed. Please try again.");
   setOpen(false);router.refresh();
  } catch(e) {setError(e instanceof Error ? e.message : "Cancellation failed. Please try again.");}
  finally {setBusy(false);}
 }
 return <Dialog open={open} onOpenChange={value=>{if(!busy){setOpen(value);setError("");}}}>
  <DialogTrigger asChild><Button size="sm" variant="outline">Cancel booking</Button></DialogTrigger>
  <DialogContent>
   <DialogHeader><DialogTitle>Cancel this booking?</DialogTitle><DialogDescription>{reference} · {seat} · {night}. This releases the space for another guest and queues a cancellation email to the guest. This cannot be undone.</DialogDescription></DialogHeader>
   {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
   <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={()=>setOpen(false)}>Keep booking</Button><Button type="button" variant="destructive" disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Yes, cancel booking"}</Button></DialogFooter>
  </DialogContent>
 </Dialog>;
}
