import { createHash, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { connectToDatabase } from "@/lib/db/mongoose";
import { formatClubTime12h } from "@/lib/utils/datetime";

/** Email outbox records are written in the booking transaction. The recipient
 * for staff is resolved at send time so missing configuration leaves a job
 * queued and a future change of staff email doesn't retain an obsolete address. */
export type SeatingEmail = {
  _id: string;
  reference: string;
  kind: "guest" | "staff" | "cancelled";
  recipient: string | null;
  seat: string;
  night: string;
  time: string;
  guests: number;
  minimumCentavos: number;
  state: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
  lastError?: string | null;
  sentAt?: Date;
  leaseUntil?: Date | null;
  leaseToken?: string | null;
};

export function seatingEmailJobs(input: {
  reference: string; email: string; seat: string; night: string; time: string; guests: number; minimumCentavos: number;
}): SeatingEmail[] {
  const now = new Date();
  const data = { reference: input.reference, seat: input.seat, night: input.night, time: input.time, guests: input.guests, minimumCentavos: input.minimumCentavos };
  return (["guest", "staff"] as const).map(kind => ({ _id: `${input.reference}:${kind}`, ...data, kind, recipient: kind === "guest" ? input.email : null, state: "pending", attempts: 0, nextAttemptAt: now, createdAt: now }));
}

type SendEmail = (message: { from: string; to: string; subject: string; text: string; messageId: string }) => Promise<unknown>;

/** Leased and retryable. SMTP has no provider idempotency guarantee: an
 * ambiguous failure after Gmail accepts a message can cause duplicate mail. */
export async function processSeatingEmails(maxJobs = 10, testSend?: SendEmail): Promise<{sent:number; failed:number; configured:boolean}> {
  const user=process.env.GMAIL_USER?.trim(), password=process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!user || !/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(user) || !password) return {sent:0, failed:0, configured:false};
  const from=`PUBLIQ <${user}>`;
  const transport = testSend ? null : nodemailer.createTransport({ host:"smtp.gmail.com", port:465, secure:true, auth:{user,pass:password}, connectionTimeout:8000, greetingTimeout:8000, socketTimeout:8000 });
  const send:SendEmail = testSend ?? (message => transport!.sendMail(message));
  const db=(await connectToDatabase()).connection.db!;
  const outbox=db.collection<SeatingEmail>("publiq_email_outbox");
  const kinds: SeatingEmail["kind"][] = process.env.NOTIFICATION_STAFF_EMAIL ? ["guest", "staff", "cancelled"] : ["guest", "cancelled"];
  let sent=0, failed=0;
  const deadline=Date.now()+10_000;
  for (let i=0; i<Math.min(10, Math.max(0,maxJobs)) && Date.now()<deadline; i++) {
    const now=new Date(), leaseToken=randomUUID();
    const job=await outbox.findOneAndUpdate(
      {kind:{$in:kinds}, $or:[{state:"pending",nextAttemptAt:{$lte:now}},{state:"sending",leaseUntil:{$lte:now}}]},
      {$set:{state:"sending",leaseToken,leaseUntil:new Date(now.getTime()+60_000)},$inc:{attempts:1}},
      {sort:{createdAt:1,_id:1},returnDocument:"after"},
    );
    if (!job) break;
    const booking=await db.collection("publiq_seating_bookings").findOne({reference:job.reference}, {projection:{status:1,seat:1,night:1,time:1,guests:1,minimumCentavos:1}});
    const expectedStatus = job.kind === "cancelled" ? "CANCELLED" : "CONFIRMED";
    const valid=booking?.status === expectedStatus && booking.seat===job.seat && booking.night===job.night && booking.time===job.time && booking.guests===job.guests && booking.minimumCentavos===job.minimumCentavos;
    let error: string | null=null;
    if (valid) {
      try {
        const to=job.kind === "staff" ? process.env.NOTIFICATION_STAFF_EMAIL : job.recipient;
        if (!to) throw new Error("Recipient not configured");
        const money=new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",currencyDisplay:"narrowSymbol"}).format(job.minimumCentavos/100);
        const intro = job.kind === "cancelled" ? "Your PUBLIQ reservation has been cancelled by the club." : job.kind === "guest" ? "Your PUBLIQ reservation is confirmed." : "A new PUBLIQ seating reservation has been confirmed.";
        const lines=[intro, `Reference: ${job.reference}`, `Space: ${job.seat}`, `Night of visit: ${job.night}`, `Arrival: ${formatClubTime12h(job.time)}${job.time < "04:00" ? " (following day)" : ""}`, `Guests: ${job.guests}`, `Consumable minimum: ${money}`, ...(job.kind === "cancelled" ? ["The space is no longer reserved for this booking. Please contact the club if you have questions."] : ["No deposit required. Your reservation is held until 4:00 AM.", ...(job.kind === "staff" ? ["Review the booking in the admin reservations page."] : ["Please keep this reference for your visit."])])];
        const subject=job.kind === "cancelled" ? "Your PUBLIQ reservation was cancelled" : job.kind === "guest" ? "Your PUBLIQ reservation is confirmed" : "New PUBLIQ seating reservation";
        const messageId=`<${createHash("sha256").update(job._id).digest("hex")}@publiq-mail.local>`;
        await send({from,to,subject,text:lines.join("\n"),messageId});
      } catch { error="Delivery request failed"; }
    }
    const patch: Partial<SeatingEmail> = !valid ? {state:"skipped",lastError:"Booking state changed",leaseToken:null,leaseUntil:null}
      : error ? {state:job.attempts>=8?"failed":"pending",nextAttemptAt:new Date(Date.now()+Math.min(3_600_000,30_000*2**(job.attempts-1))),lastError:error,leaseToken:null,leaseUntil:null}
      : {state:"sent",sentAt:new Date(),lastError:null,leaseToken:null,leaseUntil:null};
    const written=await outbox.updateOne({_id:job._id,state:"sending",leaseToken},{$set:patch});
    if (written.modifiedCount && valid) {if(error)failed++;else sent++;}
  }
  return {sent,failed,configured:true};
}
