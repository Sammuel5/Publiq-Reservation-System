import { formatClubTime12h } from "@/lib/utils/datetime";
import Link from "next/link";
import mongoose from "mongoose";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { connectToDatabase } from "@/lib/db/mongoose";
export const dynamic="force-dynamic";
export default async function MySeatingBookings() {
 const customer=await getCustomerSession();
 if(!customer)return <div className="mx-auto max-w-3xl px-5 py-12"><h1 className="font-display text-4xl">My reservations</h1><p className="mt-4 text-muted">Sign in with Google to see your reservations.</p><Link href="/reserve" className="mt-5 inline-flex min-h-11 items-center text-gold">Go to sign in</Link></div>;
 await connectToDatabase(); const rows=await mongoose.connection.db!.collection("publiq_seating_bookings").find({googleSub:customer.sub},{projection:{reference:1,seat:1,night:1,time:1,guests:1,minimumCentavos:1,status:1}}).sort({night:-1}).limit(100).toArray();
 return <div className="mx-auto max-w-3xl px-5 py-12"><h1 className="font-display text-4xl">My reservations</h1><p className="mt-3 text-sm text-muted">Signed in as {customer.email}</p>{rows.length===0?<p className="mt-8 text-muted">You have no reservations yet.</p>:<ul className="mt-8 space-y-3">{rows.map(r=><li key={String(r._id)} className="rounded-lg border border-line bg-card p-5"><p className="font-semibold">{r.seat} · {r.status}</p><p className="mt-2 text-sm text-muted">{r.night} at {formatClubTime12h(r.time)} · {r.guests} guests</p><p className="mt-2 text-sm">Reference: {r.reference}</p><p className="mt-2 text-sm">Consumable minimum: ₱{(r.minimumCentavos/100).toLocaleString("en-PH")}</p></li>)}</ul>}</div>;
}
