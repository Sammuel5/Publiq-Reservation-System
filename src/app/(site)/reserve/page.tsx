import Link from "next/link";
import type { Metadata } from "next";
import { customerGoogleConfig } from "@/lib/customer-auth/config";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { validSeat } from "@/lib/customer-auth/crypto";
import { SeatingBookingForm } from "@/components/site/seating-booking-form";
export const metadata: Metadata = { title: "Reservations" };
export const dynamic = "force-dynamic";
export default async function ReservePage({searchParams}: {searchParams: Promise<{seat?: string | string[]; auth?: string | string[]}>}) {
 const params=await searchParams;const raw=typeof params.seat==="string"?params.seat:"";const seat=validSeat(raw)?raw:null;
 const configured=Boolean(customerGoogleConfig()), customer=await getCustomerSession();
 const authHref=`/api/customer-auth/google${seat?`?seat=${encodeURIComponent(seat)}`:""}`;
 const enabled=process.env.CUSTOMER_BOOKINGS_ENABLED==="true" && configured;
 return <div className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20"><p className="text-[11px] font-semibold uppercase tracking-[.22em] text-gold">PUBLIQ / Plan your visit</p><h1 className="mt-5 font-display text-5xl tracking-tight sm:text-6xl">Reservations</h1><p className="mt-4 max-w-xl text-sm leading-7 text-muted">Choose your space and plan a night worth staying out for. No deposit is required.</p>{seat?<p className="mt-3 text-sm font-semibold text-gold">Selected: {seat}</p>:null}
 <div className="mt-10 space-y-5"><section className="rounded-lg border border-line bg-surface p-6 sm:p-8"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-gold">01 / Your account</p><h2 className="mt-3 font-display text-2xl">Google sign-in</h2>{params.auth==="failed"?<p role="alert" className="mt-3 text-sm text-red-300">Google sign-in could not be completed. Please try again.</p>:null}{customer?<div className="mt-3"><p className="text-sm">Signed in as {customer.email}</p><form action="/api/customer-auth/logout" method="post"><button className="mt-2 min-h-11 text-sm font-semibold text-gold underline">Sign out</button></form></div>:configured?<><p className="mt-3 text-sm text-muted">Sign in before submitting a reservation.</p><a href={authHref} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-md bg-white px-5 text-sm font-semibold text-black">Sign in with Google</a></>:<p className="mt-3 text-sm text-muted">Google sign-in is not configured yet.</p>}</section>
 {!enabled?<section className="rounded-lg border border-line bg-surface p-6 sm:p-8"><h2 className="text-xl font-semibold">Booking is not available yet</h2><p className="mt-2 text-sm leading-relaxed text-muted">Online reservations are disabled while setup and testing are completed. Please contact the club for assistance.</p><Link href="/contact" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-gold">Contact us</Link></section>:customer?<SeatingBookingForm initialSeat={seat} defaultName={customer.name}/>:<p className="rounded-lg border border-line p-5 text-sm text-muted">Sign in with Google to continue to the booking form.</p>}
 </div></div>;
}
