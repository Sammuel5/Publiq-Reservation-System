"use client";
import * as React from "react";
import { formatClubTime12h } from "@/lib/utils/datetime";

type Result={reference:string;seat:string;night:string;time:string;guests:number;minimumCentavos:number;duplicate:boolean};
const choices=["VIP 1","VIP 2","VIP 3","VIP 4","VIP 5","VIP 6","VIP 7"];
const times=["21:00","21:30","22:00","22:30","23:00","23:30","00:00","00:30","01:00","01:30","02:00","02:30","03:00","03:30"];
export function SeatingBookingForm({initialSeat,defaultName}:{initialSeat:string|null;defaultName:string}) {
 const [seat,setSeat]=React.useState(initialSeat && choices.includes(initialSeat)?initialSeat:"");
 const [night,setNight]=React.useState("");const [time,setTime]=React.useState("21:00");const [guests,setGuests]=React.useState("1");const [name,setName]=React.useState(defaultName);const [mobile,setMobile]=React.useState("");
 const [error,setError]=React.useState("");const [result,setResult]=React.useState<Result|null>(null);const [busy,setBusy]=React.useState(false);const [ready,setReady]=React.useState(false);
 React.useEffect(()=>setReady(true),[]);
 const key=React.useRef<{fingerprint:string;id:string}|null>(null);
 async function submit(e:React.FormEvent<HTMLFormElement>) {e.preventDefault();if(busy)return;setBusy(true);setError("");
  const data={seat,night,time,guests:Number(guests),name:name.trim(),mobile:mobile.trim()};const fingerprint=JSON.stringify(data);
  if(!key.current || key.current.fingerprint!==fingerprint)key.current={fingerprint,id:crypto.randomUUID()};
  try {const response=await fetch("/api/seating-bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,requestId:key.current.id})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Could not complete the booking.");setResult(payload.booking);}
  catch(err){setError(err instanceof Error?err.message:"Could not complete the booking.");}finally{setBusy(false)}
 }
 if(result)return <div className="rounded-xl border border-gold/30 bg-card p-6" role="status"><h2 className="font-display text-3xl">Reservation confirmed</h2><p className="mt-3 text-muted">Your reference: <strong className="text-foreground">{result.reference}</strong></p><p className="mt-3 text-sm leading-relaxed">{result.seat} · {result.night} · {formatClubTime12h(result.time)} · {result.guests} guests</p><p className="mt-2 text-sm">Consumable minimum: ₱{(result.minimumCentavos/100).toLocaleString("en-PH")}. No deposit is required.</p><p className="mt-3 text-sm text-muted">Your space is reserved until 4:00 a.m. Save your reference; no confirmation email is sent yet.</p><a href="/my-seating-bookings" className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-gold">View my reservations</a></div>;
 const field="mt-2 min-h-12 w-full rounded-md border border-line bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-gold";
 return <form method="post" action="/api/seating-bookings" onSubmit={submit} className="space-y-5 rounded-lg border border-line bg-surface p-6 sm:p-8" data-testid="seating-booking-form">
  <fieldset disabled={!ready} className="space-y-5">
  <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-gold">02 / Your visit</p><h2 className="mt-3 font-display text-2xl">Booking details</h2></div><p className="text-sm text-muted">Reservations are held until 4:00 a.m. A date is the night you arrive, including arrivals after midnight.</p>
  <label className="block text-sm font-medium">Select a VIP booth<select required value={seat} onChange={e=>setSeat(e.target.value)} className={field}><option value="">Choose a VIP booth</option>{choices.map(x=><option key={x}>{x}</option>)}</select></label>
  {initialSeat && !choices.includes(initialSeat) ? <p className="text-sm text-muted">{initialSeat} is not available online until its guest capacity is confirmed.</p> : null}
  <label className="block text-sm font-medium">Night of visit<input required type="date" value={night} onChange={e=>setNight(e.target.value)} className={field}/></label>
  <label className="block text-sm font-medium">Arrival time<select value={time} onChange={e=>setTime(e.target.value)} className={field}>{times.map(t=><option key={t} value={t}>{formatClubTime12h(t)}{t<"04:00"?" (next day)":""}</option>)}</select></label>
  <label className="block text-sm font-medium">Number of guests<input required type="number" min="1" max="12" inputMode="numeric" value={guests} onChange={e=>setGuests(e.target.value)} className={field}/></label>
  <label className="block text-sm font-medium">Full name<input required autoComplete="name" value={name} onChange={e=>setName(e.target.value)} maxLength={100} className={field}/></label>
  <label className="block text-sm font-medium">Mobile number<input required type="tel" autoComplete="tel" value={mobile} onChange={e=>setMobile(e.target.value)} maxLength={25} className={field}/></label>
  <p className="text-sm text-muted">VIP consumable minimum: 1–5 guests none, 6–8 ₱7,000, 9 ₱8,500, and 10–12 ₱10,000. The server confirms the final amount. VIP 5 and 6 allow up to 10 guests.</p>
  {error?<p role="alert" className="text-sm text-red-300">{error}</p>:null}
  <button disabled={busy || !ready} type="submit" className="min-h-12 w-full rounded-md bg-gold px-5 font-semibold text-background disabled:opacity-60">{!ready?"Loading form…":busy?"Confirming…":"Confirm reservation"}</button>
 </fieldset></form>;
}
