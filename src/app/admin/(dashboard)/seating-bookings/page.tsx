import { formatClubTime12h } from "@/lib/utils/datetime";
import mongoose from "mongoose";
import { requireAdminPermission, PERMISSIONS } from "@/lib/auth/guards";
import { connectToDatabase } from "@/lib/db/mongoose";
export const dynamic="force-dynamic";
export default async function SeatingBookingsAdmin() {
 await requireAdminPermission(PERMISSIONS.RESERVATION_VIEW);await connectToDatabase();
 const rows=await mongoose.connection.db!.collection("publiq_seating_bookings").find({},{projection:{reference:1,seat:1,night:1,time:1,guests:1,minimumCentavos:1,status:1,name:1,mobile:1,googleEmail:1}}).sort({createdAt:-1}).limit(200).toArray();
 return <div><h2 className="font-display text-3xl">Seating reservations</h2><p className="mt-2 text-sm text-muted">Google-signed-in bookings appear here. Showing the latest 200.</p>{rows.length===0?<p className="mt-6 text-muted">No seating reservations yet.</p>:<ul className="mt-6 space-y-3">{rows.map(r=><li key={String(r._id)} className="rounded-lg border border-line bg-card p-5"><p className="font-semibold">{r.seat} · {r.status}</p><p className="mt-2 text-sm text-muted">{r.night} at {formatClubTime12h(r.time)} · {r.guests} guests · {r.reference}</p><p className="mt-2 text-sm">{r.name} · {r.mobile} · {r.googleEmail}</p><p className="mt-2 text-sm">Consumable minimum: ₱{(r.minimumCentavos/100).toLocaleString("en-PH")}</p></li>)}</ul>}</div>;
}
