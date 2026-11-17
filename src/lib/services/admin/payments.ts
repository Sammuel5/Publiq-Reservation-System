import { Types } from "mongoose";
import { PERMISSIONS, roleHasPermission, type AdminRole } from "@/config/app";
import { Customer, Payment, Reservation, Room } from "@/lib/db/models";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getClubSettings } from "@/lib/services/club-settings";
import { addDaysToDateString, clubDateTimeToUtc } from "@/lib/utils/datetime";
import { todayInClubTime } from "@/lib/services/availability";
import { formatMoney } from "@/lib/utils/money";
import { blankToNull, sanitizeText } from "@/lib/utils/normalize";
import { paymentCreateSchema, paymentQuerySchema } from "@/lib/validation/admin";
import { containsRegex, paginate, pageSkip, type Actor } from "@/lib/services/admin/shared";

/**
 * Payments (Phase 3).
 *
 * Money is integer centavos everywhere; the form speaks pesos and the
 * conversion happens once, in the schema. A payment row is an immutable receipt:
 * correcting one means adding a REFUNDED row, so the ledger still reconciles
 * against the counter's cash sheet. Deleting a row is allowed only as an
 * explicit "remove this entry" action and is logged with the acting account.
 *
 * The balance model:
 *   collected  = PAID + PARTIALLY_PAID
 *   refunded   = REFUNDED
 *   outstanding = estimatedAmount − collected + refunded   (never below zero)
 */

export type ReservationBalance = {
  expected: number;
  collected: number;
  refunded: number;
  outstanding: number;
  currency: string;
};

export async function getBalance(reservationId: string): Promise<ReservationBalance> {
  const reservation = await Reservation.findById(reservationId).select("estimatedAmount currency").lean();
  if (!reservation) throw new NotFoundError("That reservation no longer exists.");
  return balanceFor(reservationId, reservation.estimatedAmount, reservation.currency);
}

async function balanceFor(
  reservationId: unknown,
  expected: number,
  currency: string,
): Promise<ReservationBalance> {
  const rows = await Payment.aggregate<{ _id: string; total: number }>([
    { $match: { reservation: reservationId as Types.ObjectId } },
    { $group: { _id: "$paymentStatus", total: { $sum: "$amount" } } },
  ]);
  let collected = 0;
  let refunded = 0;
  for (const row of rows) {
    if (row._id === "PAID" || row._id === "PARTIALLY_PAID") collected += row.total;
    if (row._id === "REFUNDED") refunded += row.total;
  }
  return {
    expected,
    collected,
    refunded,
    outstanding: Math.max(0, expected - collected + refunded),
    currency,
  };
}

export type PaymentEntry = {
  id: string;
  reservationId: string;
  reference: string;
  customerName: string;
  roomName: string;
  date: string;
  time: string;
  amount: number;
  method: string;
  status: string;
  referenceNumber: string | null;
  notes: string | null;
  recordedBy: string | null;
};

export async function recordPayment(
  reservationId: string,
  raw: unknown,
  actor: Actor,
): Promise<{ ok: true; balance: ReservationBalance; message: string }> {
  const parsed = paymentCreateSchema.safeParse(asObject(raw));
  if (!parsed.success) {
    throw new ValidationError("Some fields need your attention.", {
      fields: issueFields(parsed.error.issues),
    });
  }

  if (parsed.data.paymentStatus === "REFUNDED" && !roleHasPermission(actor.role as AdminRole, PERMISSIONS.PAYMENT_MANAGE)) {
    throw new ForbiddenError("Your role cannot record refunds.");
  }

  const reservation = await Reservation.findById(reservationId).lean();
  if (!reservation) throw new NotFoundError("That reservation no longer exists.");

  const balance = await balanceFor(reservation._id, reservation.estimatedAmount, reservation.currency);
  const { amount, paymentStatus } = parsed.data;

  if (paymentStatus === "REFUNDED") {
    if (balance.collected === 0) {
      throw new ValidationError("Nothing has been collected on this booking yet, so there is nothing to refund.", {
        fields: { amount: "No payment to refund." },
      });
    }
    if (amount > balance.collected - balance.refunded) {
      throw new ValidationError(
        `Only ${formatMoney(balance.collected - balance.refunded, { currency: reservation.currency })} can be refunded on this booking.`,
        { fields: { amount: "That is more than was collected." } },
      );
    }
  } else if (amount > balance.outstanding) {
    throw new ValidationError(
      `Only ${formatMoney(balance.outstanding, { currency: reservation.currency })} is outstanding on this booking. Record it as a deposit instead, or correct the amount.`,
      { fields: { amount: "That is more than the balance." } },
    );
  }

  await Payment.create({
    reservation: reservation._id,
    amount,
    paymentMethod: parsed.data.paymentMethod,
    paymentStatus,
    paymentDate: new Date(),
    referenceNumber: blankToNull(sanitizeText(parsed.data.referenceNumber ?? "")),
    notes: blankToNull(sanitizeText(parsed.data.notes ?? "")),
    recordedBy: actor.id,
  });

  const next = await balanceFor(reservation._id, reservation.estimatedAmount, reservation.currency);
  const paidOff = next.outstanding === 0 && next.collected > 0;

  await Reservation.updateOne(
    { _id: reservation._id },
    {
      $push: {
        statusHistory: {
          from: reservation.status,
          to: reservation.status,
          changedAt: new Date(),
          changedBy: actor.id,
          actorType: "ADMIN",
          reason:
            `${paymentStatus === "REFUNDED" ? "Refund" : "Payment"} of ${formatMoney(amount, { currency: reservation.currency })} ` +
            `(${parsed.data.paymentMethod}) recorded by ${actor.name}` +
            // The counter's note belongs on the trail: six months later, "why" is
            // the only thing anybody wants to know, and the receipt is far away.
            (parsed.data.notes ? ` — ${parsed.data.notes}` : "") +
            (paidOff ? " · booking is now settled" : ""),
        },
      },
    },
  );

  logger.info("admin.payments.record", "Payment entry recorded", {
    reference: reservation.reservationReference,
    amount,
    actor: actor.email,
  });

  return {
    ok: true,
    balance: next,
    message: paidOff
      ? `${formatMoney(amount, { currency: reservation.currency })} recorded — this booking is fully settled.`
      : `${formatMoney(amount, { currency: reservation.currency })} recorded · ${formatMoney(next.outstanding, { currency: reservation.currency })} still due.`,
  };
}

export async function deletePaymentEntry(paymentId: string, actor: Actor): Promise<{ ok: true }> {
  const payment = await Payment.findByIdAndDelete(paymentId).lean();
  if (!payment) throw new NotFoundError("That entry no longer exists.");
  logger.warn("admin.payments.delete", "Payment entry removed", {
    paymentId: String(payment._id),
    amount: payment.amount,
    actor: actor.email,
  });
  return { ok: true };
}

export type PaymentLedger = {
  page: ReturnType<typeof paginate<PaymentEntry>>;
  totals: { collected: number; refunded: number; net: number; byMethod: Record<string, number> };
  window: { from: string; to: string };
  currency: string;
};

export async function listPayments(raw: unknown): Promise<PaymentLedger> {
  const parsed = paymentQuerySchema.safeParse(asObject(raw));
  const query = parsed.success ? parsed.data : paymentQuerySchema.parse({});
  const club = await getClubSettings();
  const today = todayInClubTime(club);

  const from = query.from ?? addDaysToDateString(today, -30);
  const to = query.to ?? today;
  const windowStart = clubDateTimeToUtc(from, "00:00", club.timezone);
  const windowEnd = clubDateTimeToUtc(addDaysToDateString(to, 1), "00:00", club.timezone);

  // The window is the money question ("what did we take in this week?"), so it is
  // kept separate from the filters below: narrowing rows to CASH must not shrink
  // the takings figure next to it, or the screen under-reports the night.
  const windowFilter: Record<string, unknown> = {
    paymentDate: { $gte: windowStart, $lt: windowEnd },
  };
  const filter: Record<string, unknown> = { ...windowFilter };
  if (query.method === "REFUNDED") filter.paymentStatus = "REFUNDED";
  else if (query.method) {
    filter.paymentMethod = query.method;
    filter.paymentStatus = { $ne: "REFUNDED" };
  }

  let reservationFilter: Record<string, unknown> | null = null;
  if (query.q) {
    const reference = query.q.toUpperCase().replace(/\s+/g, "");
    const reservations = await Reservation.find({
      $or: [
        { reservationReference: containsRegex(reference) },
        { customer: await customerIdsFor(query.q) },
      ],
    })
      .select("_id")
      .lean();
    reservationFilter = { reservation: { $in: reservations.map((doc) => doc._id) } };
  }

  const active = { ...filter, ...(reservationFilter ?? {}) };
  const [docs, total, allInWindow] = await Promise.all([
    Payment.find(active)
      .sort({ paymentDate: -1 })
      .skip(pageSkip(query.page, query.perPage))
      .limit(query.perPage)
      .populate<{
        reservation: {
          _id: Types.ObjectId;
          reservationReference: string;
          customer: Types.ObjectId;
          room: Types.ObjectId;
        } | null;
      }>("reservation", "reservationReference customer room")
      .populate<{ recordedBy: { name: string } | null }>("recordedBy", "name")
      .lean(),
    Payment.countDocuments(active),
    Payment.find(windowFilter).lean(),
  ]);

  // Names for the visible page only — never for the whole window.
  const customerIds = new Set(
    docs.map((doc) => (doc.reservation as { customer: Types.ObjectId } | null)?.customer).filter(Boolean),
  );
  const roomIds = new Set(
    docs.map((doc) => (doc.reservation as { room: Types.ObjectId } | null)?.room).filter(Boolean),
  );
  const [customers, rooms] = await Promise.all([
    customerIds.size
      ? Customer.find({ _id: { $in: [...customerIds] } }).select("fullName").lean()
      : Promise.resolve([]),
    roomIds.size ? Room.find({ _id: { $in: [...roomIds] } }).select("name").lean() : Promise.resolve([]),
  ]);
  const names = new Map(customers.map((doc) => [String(doc._id), doc.fullName]));
  const roomNames = new Map(rooms.map((doc) => [String(doc._id), doc.name]));

  const byMethod: Record<string, number> = {};
  let collected = 0;
  let refunded = 0;
  for (const payment of allInWindow) {
    if (payment.paymentStatus === "REFUNDED") {
      refunded += payment.amount;
      continue;
    }
    collected += payment.amount;
    byMethod[payment.paymentMethod] = (byMethod[payment.paymentMethod] ?? 0) + payment.amount;
  }

  const rows: PaymentEntry[] = docs.map((payment) => {
    const reservation = payment.reservation;
    const when = new Date(payment.paymentDate);
    return {
      id: String(payment._id),
      // `reservation` is populated above, so its `_id` is the id — stringifying the
      // document itself would hand the UI "[object Object]" as a link.
      reservationId: reservation ? String(reservation._id) : "",
      reference: reservation?.reservationReference ?? "—",
      customerName: reservation ? (names.get(String(reservation.customer)) ?? "Unknown guest") : "Deleted booking",
      roomName: reservation ? (roomNames.get(String(reservation.room)) ?? "Room removed") : "—",
      date: payment.paymentDate.toISOString().slice(0, 10),
      time: when.toLocaleTimeString("en-GB", { timeZone: club.timezone, hour: "2-digit", minute: "2-digit" }),
      amount: payment.amount,
      method: payment.paymentMethod,
      status: payment.paymentStatus,
      referenceNumber: payment.referenceNumber ?? null,
      notes: payment.notes ?? null,
      recordedBy: payment.recordedBy?.name ?? null,
    };
  });

  return {
    page: paginate(rows, total, query.page, query.perPage),
    totals: { collected, refunded, net: collected - refunded, byMethod },
    window: { from, to },
    currency: club.currency,
  };
}

async function customerIdsFor(term: string): Promise<{ $in: unknown[] }> {
  const normalized = term.replace(/[^\d+]/g, "");
  const docs = await Customer.find({
    $or: [
      { fullName: containsRegex(term) },
      ...(normalized.length >= 7 ? [{ mobileNumber: { $regex: normalized.slice(-11), $options: "i" } }] : []),
    ],
  })
    .select("_id")
    .lean();
  return { $in: docs.map((doc) => doc._id) };
}

/** Sum of what the club has actually taken in, for the dashboard. */
export async function revenueBetween(fromDate: string, toDate: string, timezone: string) {
  const startAt = clubDateTimeToUtc(fromDate, "00:00", timezone);
  const endAt = clubDateTimeToUtc(addDaysToDateString(toDate, 1), "00:00", timezone);
  const rows = await Payment.aggregate<{ _id: string; total: number }>([
    { $match: { paymentDate: { $gte: startAt, $lt: endAt } } },
    { $group: { _id: "$paymentStatus", total: { $sum: "$amount" } } },
  ]);
  let collected = 0;
  let refunded = 0;
  for (const row of rows) {
    if (row._id === "REFUNDED") refunded += row.total;
    else collected += row.total;
  }
  return { collected, refunded, net: collected - refunded };
}

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function issueFields(issues: Array<{ path: (string | number)[]; message: string }>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_form";
    if (fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}
