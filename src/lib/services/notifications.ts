import { formatClubTime12h } from "@/lib/utils/datetime";
import { randomUUID } from "node:crypto";
import { connectToDatabase } from "@/lib/db/mongoose";

type Channel = "email" | "sms" | "staff";
type Job = { id: string; channel: Channel; recipient: string | null; message: string; expectedStatus: "PENDING" | "CONFIRMED"; expectedDate: string; expectedTime: string; expectedRoom: string; state: string; attempts: number; nextAttemptAt: Date; leaseUntil?: Date | null; leaseToken?: string | null };

/** Captured at the same instant as the booking change; no access tokens in messages. */
export function bookingNotifications(input: { reference: string; date: string; time: string; room: string; roomId: string; mobile: string; email?: string | null; confirmed: boolean; staff?: boolean }): Job[] {
  const status = input.confirmed ? "Your reservation is confirmed" : "Your reservation request is pending approval";
  const message = `${status}: ${input.reference}, ${input.date} at ${formatClubTime12h(input.time)}, ${input.room}.`;
  const job = (channel: Channel, recipient: string | null, text: string): Job => ({ id: randomUUID(), channel, recipient, message: text, expectedStatus: input.confirmed ? "CONFIRMED" : "PENDING", expectedDate: input.date, expectedTime: input.time, expectedRoom: input.roomId, state: "pending", attempts: 0, nextAttemptAt: new Date() });
  return [job("sms", input.mobile, message), ...(input.email ? [job("email", input.email, message)] : []),
    ...(input.staff ? [job("staff", null, `New reservation ${input.reference}, ${input.date} at ${formatClubTime12h(input.time)}, ${input.room}. Review it in the admin console.`)] : [])];
}

function configuredChannels(): Channel[] {
  const channels: Channel[] = [];
  if (process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL) {
    channels.push("email");
    if (process.env.NOTIFICATION_STAFF_EMAIL) channels.push("staff");
  }
  if (process.env.NOTIFICATIONS_SMS_ENABLED === "true" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) channels.push("sms");
  return channels;
}

async function deliver(job: Job): Promise<void> {
  const timeout = AbortSignal.timeout(8_000);
  let response: Response;
  if (job.channel === "sms") {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST", signal: timeout,
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: process.env.TWILIO_FROM_NUMBER!, To: job.recipient!, Body: job.message }),
    });
  } else {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: timeout,
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": job.id },
      body: JSON.stringify({ from: process.env.NOTIFICATION_FROM_EMAIL, to: [job.channel === "staff" ? process.env.NOTIFICATION_STAFF_EMAIL : job.recipient], subject: "PUBLIQ reservation update", text: job.message }),
    });
  }
  // Do not persist provider response bodies: they may contain personal data.
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
}

/** Lease one job at a time across instances. Delivery is at-least-once: a crash
 * after provider acceptance and before acknowledgement can duplicate an SMS. */
export async function processNotifications(maxJobs = 25, maxDurationMs = 40_000): Promise<{ sent: number; failed: number; configured: Channel[] }> {
  const db = (await connectToDatabase()).connection.db;
  if (!db) throw new Error("Database unavailable");
  const collection = db.collection("reservations");
  const configured = configuredChannels();
  let sent = 0, failed = 0;
  if (!configured.length) return { sent, failed, configured };
  const deadline = Date.now() + maxDurationMs;
  for (let i = 0; i < maxJobs && Date.now() < deadline; i++) {
    const now = new Date();
    const eligible = { channel: { $in: configured }, nextAttemptAt: { $lte: now }, $or: [{ state: "pending" }, { state: "sending", leaseUntil: { $lte: now } }] };
    const candidate = await collection.findOne({ notifications: { $elemMatch: eligible } }, { projection: { notifications: 1 } });
    if (!candidate) break;
    const jobs = candidate.notifications as Job[];
    const job = jobs.find((j) => configured.includes(j.channel) && new Date(j.nextAttemptAt) <= now && (j.state === "pending" || (j.state === "sending" && !!j.leaseUntil && new Date(j.leaseUntil) <= now)));
    if (!job) continue;
    const token = randomUUID();
    const claim = await collection.updateOne({ _id: candidate._id, notifications: { $elemMatch: { ...eligible, id: job.id } } }, {
      $set: { "notifications.$.state": "sending", "notifications.$.leaseToken": token, "notifications.$.leaseUntil": new Date(now.getTime() + 60_000) },
      $inc: { "notifications.$.attempts": 1 },
    });
    if (!claim.modifiedCount) continue;
    // A request or confirmation can become obsolete while waiting in the queue.
    const current = await collection.findOne({ _id: candidate._id }, { projection: { status: 1, pendingExpiresAt: 1, reservationDate: 1, startTime: 1, room: 1 } });
    const stateValid = job.expectedStatus === "PENDING" ? current?.status === "PENDING" && (!current.pendingExpiresAt || new Date(current.pendingExpiresAt) > new Date()) : ["CONFIRMED", "CHECKED_IN"].includes(current?.status);
    const valid = stateValid && current?.reservationDate === job.expectedDate && current?.startTime === job.expectedTime && String(current?.room) === job.expectedRoom;
    let error: string | null = null;
    if (valid) {
      try { await deliver(job); } catch (e) { error = e instanceof Error && /^Provider HTTP \d+$/.test(e.message) ? e.message : "Delivery request failed"; }
    }
    const attempts = job.attempts + 1;
    const update = !valid
      ? { state: "skipped", lastError: "Booking state changed", leaseUntil: null, leaseToken: null }
      : error
      ? { state: attempts >= 8 ? "failed" : "pending", nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** (attempts - 1))), lastError: error, leaseUntil: null, leaseToken: null }
      : { state: "sent", sentAt: new Date(), lastError: null, leaseUntil: null, leaseToken: null };
    const set = Object.fromEntries(Object.entries(update).map(([key, value]) => [`notifications.$.${key}`, value]));
    const written = await collection.updateOne({ _id: candidate._id, notifications: { $elemMatch: { id: job.id, leaseToken: token, state: "sending" } } }, { $set: set });
    if (written.modifiedCount && valid) { if (error) failed++; else sent++; }
  }
  return { sent, failed, configured };
}
