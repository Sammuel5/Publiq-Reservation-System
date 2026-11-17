import { formatClubTime12h } from "@/lib/utils/datetime";
import { Customer, Payment, Reservation } from "@/lib/db/models";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getClubSettings } from "@/lib/services/club-settings";
import { todayInClubTime } from "@/lib/services/availability";
import { customerQuerySchema, customerUpdateSchema } from "@/lib/validation/admin";
import { containsRegex, paginate, pageSkip, type Actor } from "@/lib/services/admin/shared";
import { formatMobileNumber, normalizeEmail, normalizeMobileNumber, normalizePersonName, sanitizeText } from "@/lib/utils/normalize";
import { blankToNull } from "@/lib/utils/normalize";

/**
 * Customer profiles (Phase 3).
 *
 * A customer is keyed on their normalized mobile number — that is the number
 * the club actually uses to find someone at the door, and it is the same key the
 * public lookup form uses. Names are therefore treated as editable display data
 * and the mobile number as identity: the unique index `uniq_mobile` is what
 * makes two bookings for the same guest collapse into one profile.
 */

export type CustomerRow = {
  id: string;
  name: string;
  mobile: string;
  mobileMasked: string;
  email: string | null;
  visits: number;
  upcoming: number;
  cancelled: number;
  spend: number;
  lastVisit: string | null;
  joinedAt: string;
  notes: string | null;
  vip: boolean;
};

export type CustomerList = {
  page: ReturnType<typeof paginate<CustomerRow>>;
  totals: { customers: number; withBookings: number; revenue: number };
  today: string;
};

export async function listCustomers(raw: unknown): Promise<CustomerList> {
  const parsed = customerQuerySchema.safeParse(asObject(raw));
  const query = parsed.success ? parsed.data : customerQuerySchema.parse({});
  const club = await getClubSettings();
  const today = todayInClubTime(club);

  const filter: Record<string, unknown> = {};
  if (query.q) {
    const mobile = normalizeMobileNumber(query.q);
    const or: Record<string, unknown>[] = [
      { fullName: containsRegex(query.q) },
      { email: containsRegex(query.q) },
      { mobileNumber: containsRegex(query.q) },
    ];
    if (mobile) or.push({ mobileNumber: mobile });
    filter.$or = or;
  }

  // "visits"/"spend" are computed after enrichment, so the query itself sorts
  // by recency and the page is re-ordered in memory.
  const sortSpec: Record<string, 1 | -1> =
    query.sort === "name" ? { fullName: 1 } : { createdAt: -1 };

  const [docs, customers] = await Promise.all([
    Customer.find(filter)
      .sort(sortSpec)
      .skip(pageSkip(query.page, query.perPage))
      .limit(query.perPage)
      .lean(),
    Customer.countDocuments(filter),
  ]);

  const ids = docs.map((doc) => doc._id);
  const [bookingStats, spendStats] = await Promise.all([
    Reservation.aggregate<{
      _id: unknown;
      visits: number;
      upcoming: number;
      cancelled: number;
      lastVisit: Date | null;
    }>([
      { $match: { customer: { $in: ids } } },
      {
        $group: {
          _id: "$customer",
          visits: { $sum: 1 },
          upcoming: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ["$reservationDate", today] }, { $in: ["$status", ["PENDING", "CONFIRMED", "CHECKED_IN"]] }] },
                1,
                0,
              ],
            },
          },
          cancelled: { $sum: { $cond: [{ $in: ["$status", ["CANCELLED", "REJECTED", "NO_SHOW"]] }, 1, 0] } },
          lastVisit: { $max: "$startAt" },
        },
      },
    ]),
    Reservation.aggregate<{ _id: unknown; spend: number }>([
      { $match: { customer: { $in: ids }, status: { $in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] } } },
      { $group: { _id: "$customer", spend: { $sum: "$estimatedAmount" } } },
    ]),
  ]);

  const bookings = new Map(bookingStats.map((row) => [String(row._id), row]));
  const spend = new Map(spendStats.map((row) => [String(row._id), row.spend]));

  let rows: CustomerRow[] = docs.map((doc) => {
    const stats = bookings.get(String(doc._id));
    const totalSpend = spend.get(String(doc._id)) ?? 0;
    return {
      id: String(doc._id),
      name: doc.fullName,
      mobile: formatMobileNumber(doc.mobileNumber),
      mobileMasked: `••••••${doc.mobileNumber.replace(/\D/g, "").slice(-4)}`,
      email: doc.email ?? null,
      visits: stats?.visits ?? 0,
      upcoming: stats?.upcoming ?? 0,
      cancelled: stats?.cancelled ?? 0,
      spend: totalSpend,
      lastVisit: stats?.lastVisit ? new Date(stats.lastVisit).toISOString() : null,
      joinedAt: new Date(doc.createdAt).toISOString(),
      notes: doc.notes ?? null,
      // A "regular" is somebody the club has actually seated twice with no
      // cancellations — not a marketing label someone can tick.
      vip: (stats?.visits ?? 0) >= 3 && (stats?.cancelled ?? 0) === 0,
    };
  });

  if (query.sort === "visits" || query.sort === "spend") {
    rows = rows.sort((a, b) => (query.sort === "visits" ? b.visits - a.visits : b.spend - a.spend));
  }

  const allTimeRevenue = await Reservation.aggregate<{ total: number }>([
    { $match: { status: { $in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] } } },
    { $group: { _id: null, total: { $sum: "$estimatedAmount" } } },
  ]);

  return {
    page: paginate(rows, customers, query.page, query.perPage),
    totals: {
      customers,
      withBookings: bookingStats.length,
      revenue: allTimeRevenue[0]?.total ?? 0,
    },
    today,
  };
}

export type CustomerProfile = {
  customer: CustomerRow;
  reservations: Array<{
    id: string;
    reference: string;
    status: string;
    date: string;
    startLabel: string;
    endLabel: string;
    roomName: string;
    guests: number;
    amount: number;
  }>;
  payments: Array<{ id: string; amount: number; method: string; status: string; date: string }>;
  stats: {
    visits: number;
    completed: number;
    cancelled: number;
    noShows: number;
    spend: number;
    collected: number;
    cancellationRate: number | null;
    firstVisit: string | null;
    lastVisit: string | null;
  };
};

export async function getCustomerProfile(id: string): Promise<CustomerProfile> {
  const club = await getClubSettings();
  const today = todayInClubTime(club);
  const customer = await Customer.findById(id).lean();
  if (!customer) throw new NotFoundError("That customer profile no longer exists.");

  const [reservations, payments] = await Promise.all([
    Reservation.find({ customer: customer._id })
      .sort({ startAt: -1 })
      .limit(50)
      .populate<{ room: { name: string } | null }>("room", "name")
      .lean(),
    Payment.find({})
      .sort({ paymentDate: -1 })
      .limit(200)
      .lean(),
  ]);

  const reservationIds = new Set(reservations.map((doc) => String(doc._id)));
  const theirPayments = payments
    .filter((payment) => reservationIds.has(String(payment.reservation)))
    .map((payment) => ({
      id: String(payment._id),
      amount: payment.amount,
      method: payment.paymentMethod,
      status: payment.paymentStatus,
      date: new Date(payment.paymentDate).toISOString(),
    }));

  const completed = reservations.filter((doc) => doc.status === "COMPLETED").length;
  const cancelled = reservations.filter((doc) => doc.status === "CANCELLED" || doc.status === "REJECTED").length;
  const noShows = reservations.filter((doc) => doc.status === "NO_SHOW").length;
  const spend = reservations
    .filter((doc) => ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(doc.status))
    .reduce((sum, doc) => sum + doc.estimatedAmount, 0);
  const collected = theirPayments
    .filter((payment) => payment.status === "PAID" || payment.status === "PARTIALLY_PAID")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const decided = completed + cancelled + noShows;

  return {
    customer: {
      id: String(customer._id),
      name: customer.fullName,
      mobile: formatMobileNumber(customer.mobileNumber),
      mobileMasked: `••••••${customer.mobileNumber.replace(/\D/g, "").slice(-4)}`,
      email: customer.email ?? null,
      visits: reservations.length,
      upcoming: reservations.filter(
        (doc) => doc.reservationDate >= today && ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(doc.status),
      ).length,
      cancelled,
      spend,
      lastVisit: reservations[0] ? new Date(reservations[0].startAt).toISOString() : null,
      joinedAt: new Date(customer.createdAt).toISOString(),
      notes: customer.notes ?? null,
      vip: reservations.length >= 3 && cancelled === 0,
    },
    reservations: reservations.map((doc) => ({
      id: String(doc._id),
      reference: doc.reservationReference,
      status: doc.status,
      date: doc.reservationDate,
      startLabel: formatClubTime12h(doc.startTime),
      endLabel: formatClubTime12h(doc.endTime),
      roomName: doc.room?.name ?? "Room removed",
      guests: doc.guestCount,
      amount: doc.estimatedAmount,
    })),
    payments: theirPayments.slice(0, 25),
    stats: {
      visits: reservations.length,
      completed,
      cancelled,
      noShows,
      spend,
      collected,
      cancellationRate: decided === 0 ? null : Math.round((cancelled / decided) * 100),
      firstVisit: (() => {
        const earliest = reservations[reservations.length - 1];
        return earliest ? new Date(earliest.startAt).toISOString() : null;
      })(),
      lastVisit: (() => {
        const latest = reservations[0];
        return latest ? new Date(latest.startAt).toISOString() : null;
      })(),
    },
  };
}

export async function updateCustomer(
  id: string,
  raw: unknown,
  actor: Actor,
): Promise<{ ok: true; changed: string[] }> {
  const parsed = customerUpdateSchema.safeParse(asObject(raw));
  if (!parsed.success) {
    throw new ValidationError("Some fields need your attention.", {
      fields: Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "_form", issue.message]),
      ),
    });
  }

  const customer = await Customer.findById(id).lean();
  if (!customer) throw new NotFoundError("That customer profile no longer exists.");

  const set: Record<string, unknown> = {};
  const changed: string[] = [];
  if (parsed.data.fullName !== undefined) {
    const fullName = normalizePersonName(parsed.data.fullName);
    if (fullName !== customer.fullName) {
      set.fullName = fullName;
      changed.push("name");
    }
  }
  if (parsed.data.email !== undefined) {
    const email = parsed.data.email ? normalizeEmail(parsed.data.email) : null;
    if ((customer.email ?? null) !== email) {
      set.email = email;
      changed.push("email");
    }
  }
  if (parsed.data.notes !== undefined) {
    const notes = blankToNull(sanitizeText(parsed.data.notes ?? ""));
    if ((customer.notes ?? null) !== notes) {
      set.notes = notes;
      changed.push("note");
    }
  }

  if (changed.length > 0) await Customer.updateOne({ _id: customer._id }, { $set: set });
  void actor;
  return { ok: true, changed };
}

/**
 * "Guests who booked this room before" style helper for the room editor's
 * delete guard, and the dashboard's new-this-month count.
 */
export async function countNewCustomersSince(dateString: string): Promise<number> {
  const from = new Date(`${dateString}T00:00:00Z`);
  return Customer.countDocuments({ createdAt: { $gte: from } });
}

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}
