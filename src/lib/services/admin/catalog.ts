import { Types, type FilterQuery } from "mongoose";
import { Payment, Reservation, Room, RoomBlock, RoomCategory, RoomSlotLock } from "@/lib/db/models";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getClubSettings } from "@/lib/services/club-settings";
import { todayInClubTime } from "@/lib/services/availability";
import {
  categorySchema,
  categoryUpdateSchema,
  roomCreateSchema,
  roomOrderSchema,
  roomUpdateSchema,
  type CategoryInput,
  type RoomCreateInput,
} from "@/lib/validation/admin";
import { normalizePersonName, sanitizeText, slugify } from "@/lib/utils/normalize";
import { parsePesosToCentavos } from "@/lib/utils/money";
import type { Actor } from "@/lib/services/admin/shared";

/**
 * Rooms, categories and their ordering (the club's "catalog").
 *
 * Two things this file is strict about, because the customer site renders the
 * output directly:
 *
 * - **Slugs are derived, validated and unique.** A missing slug is generated
 *   from the name; a duplicate is reported as a field error on the slug input
 *   rather than a Mongo duplicate-key 500.
 * - **Image paths are whitelisted.** Only same-origin paths (`/images/…`) and
 *   `https://` URLs are stored, so a room record can never smuggle a
 *   `javascript:` or `data:` URL into the public gallery.
 *
 * Deleting a room that has ever been booked is refused: the reservation history
 * references it, and the club needs that history for disputes and reporting.
 * Staff deactivate instead — the guard says so explicitly.
 */

const SAFE_IMAGE = /^(\/[^\s]*|https:\/\/[^\s]+)$/;

export type AdminRoom = {
  id: string;
  name: string;
  slug: string;
  categorySlug: string;
  categoryName: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  hourlyRate: number;
  minimumDuration: number;
  slotMinutes: number;
  amenities: string[];
  images: string[];
  coverImage: string | null;
  isActive: boolean;
  isAvailable: boolean;
  maintenanceStatus: string;
  maintenanceNote: string | null;
  sortOrder: number;
  stats: {
    bookings: number;
    todayBookings: number;
    upcomingBookings: number;
    revenue: number;
    openBlocks: number;
  };
};

/** Prices are stored in centavos; forms and imports may speak either unit. */
export async function listRooms(): Promise<{ rooms: AdminRoom[]; categories: Array<{ id: string; name: string; slug: string }> }> {
  const [docs, categories, today] = await Promise.all([
    Room.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
    RoomCategory.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
    todayInClubTime(await getClubSettings()),
  ]);

  const ids = docs.map((room) => room._id);
  const [bookingStats, revenueRows, blockRows] = await Promise.all([
    Reservation.aggregate<{ _id: string; total: number; today: number; upcoming: number }>([
      { $match: { room: { $in: ids } } },
      {
        $group: {
          _id: "$room",
          total: { $sum: 1 },
          today: { $sum: { $cond: [{ $eq: ["$reservationDate", today] }, 1, 0] } },
          upcoming: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$reservationDate", today] },
                    { $in: ["$status", ["PENDING", "CONFIRMED", "CHECKED_IN"]] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    // Revenue = completed or live bookings, in centavos.
    Reservation.aggregate<{ _id: string; revenue: number }>([
      { $match: { room: { $in: ids }, status: { $in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] } } },
      { $group: { _id: "$room", revenue: { $sum: "$estimatedAmount" } } },
    ]),
    RoomBlock.aggregate<{ _id: string; open: number }>([
      { $match: { isActive: true, endAt: { $gte: new Date() } } },
      { $group: { _id: "$room", open: { $sum: 1 } } },
    ]),
  ]);

  const bookingBy = new Map(bookingStats.map((row) => [String(row._id), row]));
  const revenueBy = new Map(revenueRows.map((row) => [String(row._id), row.revenue]));
  const blockBy = new Map(blockRows.map((row) => [String(row._id ?? ""), row.open]));
  const categoryNames = new Map(categories.map((category) => [category.slug, category.name]));

  return {
    rooms: docs.map((room) => ({
      id: String(room._id),
      name: room.name,
      slug: room.slug,
      categorySlug: room.categorySlug,
      categoryName: categoryNames.get(room.categorySlug) ?? room.categorySlug,
      shortDescription: room.shortDescription ?? null,
      description: room.description ?? null,
      capacity: room.capacity,
      hourlyRate: room.hourlyRate,
      minimumDuration: room.minimumDuration,
      slotMinutes: room.slotMinutes,
      amenities: room.amenities ?? [],
      images: room.images ?? [],
      coverImage: room.coverImage ?? null,
      isActive: room.isActive,
      isAvailable: room.isAvailable,
      maintenanceStatus: room.maintenanceStatus,
      maintenanceNote: room.maintenanceNote ?? null,
      sortOrder: room.sortOrder,
      stats: {
        bookings: bookingBy.get(String(room._id))?.total ?? 0,
        todayBookings: bookingBy.get(String(room._id))?.today ?? 0,
        upcomingBookings: bookingBy.get(String(room._id))?.upcoming ?? 0,
        revenue: revenueBy.get(String(room._id)) ?? 0,
        openBlocks: blockBy.get(String(room._id)) ?? 0,
      },
    })),
    categories: categories.map((category) => ({
      id: String(category._id),
      name: category.name,
      slug: category.slug,
    })),
  };
}

export type RoomInput = RoomCreateInput & { hourlyRate: number };

async function assertImages(images: string[], coverImage: string | null): Promise<void> {
  const all = [...images, ...(coverImage ? [coverImage] : [])];
  const bad = all.filter((value) => !SAFE_IMAGE.test(value));
  if (bad.length > 0) {
    throw new ValidationError("Image paths must be same-origin (e.g. /images/room.jpg) or https:// URLs.", {
      fields: { images: "Only /images/… or https://… paths are allowed." },
    });
  }
}

async function uniqueSlug(
  desired: string | undefined,
  name: string,
  model: typeof Room | typeof RoomCategory,
  ignoreId?: string,
): Promise<string> {
  const base = slugify(desired && desired.length > 0 ? desired : name) || slugify(name);
  if (!base) throw new ValidationError("Give this a name we can build a web address from.");

  const taken = async (candidate: string) => {
    const filter: FilterQuery<{ slug: string }> = { slug: candidate };
    if (ignoreId) filter._id = { $ne: new Types.ObjectId(ignoreId) };
    return model.exists(filter);
  };

  if (desired && desired.trim().length > 0) {
    if (await taken(desired.trim().toLowerCase())) {
      throw new ValidationError("That web address is already used by another record.", {
        fields: { slug: "Already taken — try another." },
      });
    }
    return desired.trim().toLowerCase();
  }

  let candidate = base;
  for (let suffix = 2; await taken(candidate); suffix += 1) {
    candidate = `${base}-${suffix}`;
    if (suffix > 40) throw new ValidationError("Too many records share that name — set a slug yourself.");
  }
  return candidate;
}

export async function createRoom(raw: unknown): Promise<{ id: string; slug: string }> {
  const parsed = roomCreateSchema.safeParse(asObject(raw));
  if (!parsed.success) throw fieldError(parsed.error.issues);

  const data = parsed.data;
  await assertImages(data.images ?? [], data.coverImage ?? null);

  const category = await RoomCategory.findOne({ slug: data.categorySlug }).lean();
  if (!category) {
    throw new ValidationError("Choose a room category that exists.", {
      fields: { categorySlug: "Unknown category." },
    });
  }

  const slug = await uniqueSlug(data.slug, data.name, Room);
  const last = await Room.findOne({}).sort({ sortOrder: -1 }).select("sortOrder").lean();

  const doc = await Room.create({
    ...data,
    slug,
    shortDescription: blankToNullish(data.shortDescription),
    description: blankToNullish(data.description),
    amenities: (data.amenities ?? []).map((item) => sanitizeText(item)).filter(Boolean),
    maintenanceNote: blankToNullish(data.maintenanceNote),
    sortOrder: (last?.sortOrder ?? 0) + 10,
  });

  logger.info("admin.rooms.create", "Room created", { slug: doc.slug });
  return { id: String(doc._id), slug: doc.slug };
}

export async function updateRoom(id: string, raw: unknown): Promise<{ id: string; changed: string[] }> {
  const existing = await Room.findById(id).lean();
  if (!existing) throw new NotFoundError("That room no longer exists.");

  const parsed = roomUpdateSchema.safeParse(asObject(raw));
  if (!parsed.success) throw fieldError(parsed.error.issues);

  const data = parsed.data as Partial<RoomInput>;
  const set: Record<string, unknown> = {};
  const changed: string[] = [];

  if (data.name !== undefined && data.name !== existing.name) {
    set.name = data.name;
    changed.push("name");
  }
  if (data.slug !== undefined && data.slug !== existing.slug) {
    set.slug = await uniqueSlug(data.slug, data.name ?? existing.name, Room, id);
    changed.push("slug");
  }
  if (data.categorySlug !== undefined && data.categorySlug !== existing.categorySlug) {
    const category = await RoomCategory.findOne({ slug: data.categorySlug }).lean();
    if (!category) {
      throw new ValidationError("Choose a room category that exists.", {
        fields: { categorySlug: "Unknown category." },
      });
    }
    set.categorySlug = data.categorySlug;
    changed.push("category");
  }
  for (const key of [
    "shortDescription",
    "description",
    "capacity",
    "hourlyRate",
    "minimumDuration",
    "slotMinutes",
    "isActive",
    "isAvailable",
    "maintenanceStatus",
    "maintenanceNote",
  ] as const) {
    const value = (data as Record<string, unknown>)[key];
    if (value === undefined) continue;
    set[key] = value;
    changed.push(key);
  }
  if (data.amenities !== undefined) {
    set.amenities = data.amenities.map((item) => sanitizeText(item)).filter(Boolean);
    changed.push("amenities");
  }
  if (data.images !== undefined || data.coverImage !== undefined) {
    await assertImages(
      data.images ?? existing.images ?? [],
      (data.coverImage ?? existing.coverImage ?? null) as string | null,
    );
    if (data.images !== undefined) set.images = data.images;
    if (data.coverImage !== undefined) set.coverImage = data.coverImage || null;
    changed.push("images");
  }

  if (changed.length === 0) return { id, changed };

  await Room.updateOne({ _id: id }, { $set: set });
  return { id, changed };
}

export async function deleteRoom(id: string): Promise<{ ok: true }> {
  const room = await Room.findById(id).lean();
  if (!room) throw new NotFoundError("That room no longer exists.");

  const booked = await Reservation.countDocuments({ room: id });
  if (booked > 0) {
    throw new ValidationError(
      `${room.name} has ${booked} reservation${booked === 1 ? "" : "s"} on record, so it cannot be deleted. Switch it off ("Visible on the site") instead — the history stays intact.`,
      { fields: { isActive: "Deactivate this room instead of deleting it." } },
    );
  }

  await Room.deleteOne({ _id: id });
  await Promise.all([
    RoomBlock.deleteMany({ room: id }),
    RoomSlotLock.deleteMany({ room: id }),
  ]);
  logger.warn("admin.rooms.delete", "Room deleted", { slug: room.slug });
  return { ok: true };
}

export async function reorderRooms(raw: unknown): Promise<{ ok: true; order: string[] }> {
  const parsed = roomOrderSchema.safeParse(asObject(raw));
  if (!parsed.success) throw fieldError(parsed.error.issues);

  const order = [...new Set(parsed.data.order)];
  const known = await Room.find({ _id: { $in: order.map((id) => new Types.ObjectId(id)) } })
    .select("_id")
    .lean();
  const knownIds = new Set(known.map((room) => String(room._id)));
  const missing = order.filter((id) => !knownIds.has(id));
  if (missing.length > 0) {
    throw new ValidationError("Some rooms in that list no longer exist. Reload and try again.");
  }

  // Anything not mentioned keeps its relative order at the end, so a partial
  // drag never silently scrambles the rest of the catalogue.
  const rest = await Room.find({ _id: { $nin: order.map((id) => new Types.ObjectId(id)) } })
    .sort({ sortOrder: 1 })
    .select("_id")
    .lean();

  const finalOrder = [...order, ...rest.map((room) => String(room._id))];
  await Promise.all(
    finalOrder.map((id, index) => Room.updateOne({ _id: id }, { $set: { sortOrder: (index + 1) * 10 } })),
  );

  return { ok: true, order: finalOrder };
}

// ----------------------------------------------------------------- categories --

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  accent: string;
  sortOrder: number;
  isActive: boolean;
  roomCount: number;
};

export async function listCategories(): Promise<AdminCategory[]> {
  const [categories, counts] = await Promise.all([
    RoomCategory.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
    Room.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$categorySlug", count: { $sum: 1 } } },
    ]),
  ]);
  const countBy = new Map(counts.map((row) => [row._id, row.count]));

  return categories.map((category) => ({
    id: String(category._id),
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    accent: category.accent,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    roomCount: countBy.get(category.slug) ?? 0,
  }));
}

export async function createCategory(raw: unknown): Promise<{ id: string; slug: string }> {
  const parsed = categorySchema.safeParse(asObject(raw));
  if (!parsed.success) throw fieldError(parsed.error.issues);

  const data = parsed.data as CategoryInput;
  const slug = await uniqueSlug(data.slug, data.name, RoomCategory);
  const doc = await RoomCategory.create({ ...data, slug, description: blankToNullish(data.description) });
  return { id: String(doc._id), slug: doc.slug };
}

export async function updateCategory(id: string, raw: unknown): Promise<{ id: string }> {
  const existing = await RoomCategory.findById(id).lean();
  if (!existing) throw new NotFoundError("That category no longer exists.");

  const parsed = categoryUpdateSchema.safeParse(asObject(raw));
  if (!parsed.success) throw fieldError(parsed.error.issues);

  const set: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) set.name = parsed.data.name;
  if (parsed.data.description !== undefined) set.description = blankToNullish(parsed.data.description);
  if (parsed.data.accent !== undefined) set.accent = parsed.data.accent;
  if (parsed.data.sortOrder !== undefined) set.sortOrder = parsed.data.sortOrder;
  if (parsed.data.isActive !== undefined) set.isActive = parsed.data.isActive;
  if (parsed.data.slug !== undefined && parsed.data.slug !== existing.slug) {
    set.slug = await uniqueSlug(parsed.data.slug, parsed.data.name ?? existing.name, RoomCategory, id);
  }

  if (Object.keys(set).length > 0) await RoomCategory.updateOne({ _id: id }, { $set: set });

  // Renaming a slug must follow the rooms that point at it, or the public site
  // would silently drop every room in the category.
  if (set.slug && set.slug !== existing.slug) {
    const moved = await Room.updateMany({ categorySlug: existing.slug }, { $set: { categorySlug: set.slug } });
    logger.info("admin.categories.rename", "Rooms re-pointed to the new category slug", {
      from: existing.slug,
      to: set.slug,
      rooms: moved.modifiedCount ?? 0,
    });
  }

  return { id };
}

export async function deleteCategory(id: string): Promise<{ ok: true }> {
  const category = await RoomCategory.findById(id).lean();
  if (!category) throw new NotFoundError("That category no longer exists.");

  const inUse = await Room.countDocuments({ categorySlug: category.slug });
  if (inUse > 0) {
    throw new ValidationError(
      `${inUse} room${inUse === 1 ? "" : "s"} still sit in ${category.name}. Move them to another category first.`,
      { fields: { slug: "Category is not empty." } },
    );
  }

  await RoomCategory.deleteOne({ _id: id });
  return { ok: true };
}

// --------------------------------------------------------------------- shared --

function asObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function blankToNullish(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fieldError(issues: Array<{ path: (string | number)[]; message: string }>): ValidationError {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_form";
    if (fields[key] === undefined) fields[key] = issue.message;
  }
  return new ValidationError("Some fields need your attention.", { fields });
}

/** Used by the walk-in form's room picker; keeps one source of truth. */
export async function roomOptions(): Promise<Array<{ id: string; slug: string; name: string; capacity: number; hourlyRate: number; minimumDuration: number }>> {
  const rooms = await Room.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .select("slug name capacity hourlyRate minimumDuration")
    .lean();
  return rooms.map((room) => ({
    id: String(room._id),
    slug: room.slug,
    name: room.name,
    capacity: room.capacity,
    hourlyRate: room.hourlyRate,
    minimumDuration: room.minimumDuration,
  }));
}

export { normalizePersonName };
