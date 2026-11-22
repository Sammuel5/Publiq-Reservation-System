import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { seatsClaimed, type Seat, SEATS } from "./policy";
import type { SeatingEmail } from "./email-notifications";

/** Cancel, release only this reservation's claims, and queue the guest email in
 * one transaction. Repeated cancellations are harmless and do not release a
 * replacement booking's claims or create duplicate emails. */
export async function cancelSeatingBooking(id: string, actorId: string) {
  await connectToDatabase();
  const db = mongoose.connection.db!;
  const bookings = db.collection("publiq_seating_bookings");
  const claims = db.collection("publiq_night_claims");
  const outbox = db.collection<SeatingEmail>("publiq_email_outbox");
  const txn = await mongoose.startSession();
  try {
    return await txn.withTransaction(async () => {
      const booking = await bookings.findOne({ _id: new Types.ObjectId(id) }, { session: txn });
      if (!booking) throw new NotFoundError("That seating booking no longer exists.");
      if (booking.status === "CANCELLED") return { ok: true, alreadyCancelled: true };
      if (booking.status !== "CONFIRMED") throw new ConflictError("Only confirmed seating bookings can be cancelled.");
      if (!SEATS.includes(booking.seat as Seat) || typeof booking.googleEmail !== "string" || !booking.googleEmail) {
        throw new ConflictError("Booking details need review before cancellation. No changes were made.");
      }
      const now = new Date();
      const updated = await bookings.updateOne({ _id: booking._id, status: "CONFIRMED" }, { $set: { status: "CANCELLED", cancelledAt: now, cancelledBy: new Types.ObjectId(actorId) } }, { session: txn });
      if (updated.modifiedCount !== 1) throw new ConflictError("This booking changed. Refresh and try again.");
      await claims.deleteMany({ reference: booking.reference, night: booking.night, seat: { $in: seatsClaimed(booking.seat as Seat) } }, { session: txn });
      await outbox.insertOne({ _id: `${booking.reference}:cancelled`, reference: booking.reference, kind: "cancelled", recipient: booking.googleEmail, seat: booking.seat, night: booking.night, time: booking.time, guests: booking.guests, minimumCentavos: booking.minimumCentavos, state: "pending", attempts: 0, nextAttemptAt: now, createdAt: now }, { session: txn });
      return { ok: true, alreadyCancelled: false };
    });
  } finally { await txn.endSession(); }
}
