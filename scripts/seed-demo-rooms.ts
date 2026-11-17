/**
 * Optional demo content: room categories and bookable rooms.
 *
 * Idempotent — safe to re-run. Rooms are real database records the customer site
 * reads; nothing here is hardcoded into the UI.
 *
 *   npm run seed:rooms
 *
 * Replace/extend this content through the admin dashboard in Phase 3.
 */
import mongoose from "mongoose";
import { getServerEnv } from "../src/config/env";
import { Room, RoomCategory } from "../src/lib/db/models";

const CATEGORIES = [
  {
    slug: "standard",
    name: "Standard",
    description: "Intimate private rooms for small groups.",
    accent: "neutral" as const,
    sortOrder: 1,
  },
  {
    slug: "vip",
    name: "VIP",
    description: "Larger suites with upgraded sound and seating.",
    accent: "gold" as const,
    sortOrder: 2,
  },
  {
    slug: "premium-vip",
    name: "Premium VIP",
    description: "Our flagship suites with private service.",
    accent: "gold" as const,
    sortOrder: 3,
  },
  {
    slug: "private-area",
    name: "Private Area",
    description: "Full private areas with an in-room bar.",
    accent: "purple" as const,
    sortOrder: 4,
  },
];

const ROOMS = [
  {
    slug: "sapphire-room",
    name: "Sapphire Room",
    categorySlug: "standard",
    shortDescription: "A warm, soundproofed room for up to 6 guests.",
    description:
      "Our smallest room, and the easiest place to start the night. Full acoustic panelling, a 65-inch screen, wireless mics and table service throughout. Ideal for couples and small celebrations.",
    capacity: 6,
    hourlyRate: 80000,
    minimumDuration: 60,
    images: ["/images/room-standard.jpg"],
    coverImage: "/images/room-standard.jpg",
    amenities: [
      "65-inch display",
      "2 wireless microphones",
      "Bluetooth & YouTube queue",
      "Table service",
      "Air conditioning",
      "Soundproofed walls",
    ],
    sortOrder: 1,
  },
  {
    slug: "onyx-room",
    name: "Onyx Room",
    categorySlug: "standard",
    shortDescription: "Slightly larger standard room with lounge seating.",
    description:
      "A step up from Sapphire with an L-shaped lounge and room for eight. Same acoustic treatment, extra floor space for a birthday cake and gifts.",
    capacity: 8,
    hourlyRate: 100000,
    minimumDuration: 60,
    images: ["/images/room-standard.jpg"],
    coverImage: "/images/room-standard.jpg",
    amenities: [
      "75-inch display",
      "2 wireless microphones",
      "Lounge seating",
      "Table service",
      "Air conditioning",
      "Soundproofed walls",
    ],
    sortOrder: 2,
  },
  {
    slug: "velvet-suite",
    name: "Velvet Suite",
    categorySlug: "vip",
    shortDescription: "VIP suite with deep velvet seating for 12.",
    description:
      "Our most-booked VIP room: velvet lounges, a marble table and warm cove lighting. Includes priority service and a dedicated host for the evening.",
    capacity: 12,
    hourlyRate: 180000,
    minimumDuration: 90,
    images: ["/images/room-vip.jpg"],
    coverImage: "/images/room-vip.jpg",
    amenities: [
      "85-inch display",
      "4 wireless microphones",
      "Dedicated host",
      "Champagne service",
      "Marble table",
      "Soundproofed walls",
      "Private restroom",
    ],
    sortOrder: 3,
  },
  {
    slug: "gold-room",
    name: "Gold Room",
    categorySlug: "vip",
    shortDescription: "Gold-accented VIP room for up to 14 guests.",
    description:
      "Brass and gold detailing, a long lounge and a screen big enough for the whole group. Popular for corporate nights and family celebrations.",
    capacity: 14,
    hourlyRate: 220000,
    minimumDuration: 90,
    images: ["/images/room-vip.jpg", "/images/hero-lounge.jpg"],
    coverImage: "/images/room-vip.jpg",
    amenities: [
      "85-inch display",
      "4 wireless microphones",
      "Dedicated host",
      "In-room bottle service",
      "Lounge + bar seating",
      "Private restroom",
    ],
    sortOrder: 4,
  },
  {
    slug: "nocturne-premium",
    name: "PUBLIQ Premium",
    categorySlug: "premium-vip",
    shortDescription: "Flagship suite with private stage for 20.",
    description:
      "Our flagship Premium VIP suite. Sculptural chandelier, black marble, a small stage for the brave, and a dedicated service team for the whole booking.",
    capacity: 20,
    hourlyRate: 350000,
    minimumDuration: 120,
    images: ["/images/room-premium.jpg", "/images/hero-lounge.jpg"],
    coverImage: "/images/room-premium.jpg",
    amenities: [
      "100-inch display",
      "6 wireless microphones",
      "Private stage",
      "Dedicated service team",
      "Premium sound system",
      "In-room bar",
      "Private restroom",
      "Cake & décor service",
    ],
    sortOrder: 5,
  },
  {
    slug: "the-parlour",
    name: "The Parlour",
    categorySlug: "private-area",
    shortDescription: "Full private area with in-room bar for 25.",
    description:
      "A separate private area with its own bar, backlit bottle display and lounge seating. Perfect for launches, team nights and celebrations that run long.",
    capacity: 25,
    hourlyRate: 450000,
    minimumDuration: 120,
    images: ["/images/room-private.jpg", "/images/room-premium.jpg"],
    coverImage: "/images/room-private.jpg",
    amenities: [
      "Private bar",
      "Backlit bottle display",
      "Two screens",
      "6 wireless microphones",
      "Dedicated bartender",
      "Private restroom",
      "DJ booth input",
      "Event lighting",
    ],
    sortOrder: 6,
  },
];

async function main() {
  const { MONGODB_URI, MONGODB_DB_NAME } = getServerEnv();

  console.log("→ Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB_NAME, serverSelectionTimeoutMS: 15000 });
  console.log(`✓ Connected (db: ${mongoose.connection.name})`);

  for (const category of CATEGORIES) {
    await RoomCategory.findOneAndUpdate(
      { slug: category.slug },
      { $set: { ...category, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    console.log(`  ✓ category ${category.slug}`);
  }

  for (const room of ROOMS) {
    await Room.findOneAndUpdate(
      { slug: room.slug },
      {
        $set: {
          ...room,
          isActive: true,
          isAvailable: true,
          maintenanceStatus: "OPERATIONAL",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    console.log(`  ✓ room ${room.slug} (${room.capacity} guests)`);
  }

  await Room.syncIndexes();
  await RoomCategory.syncIndexes();

  console.log(
    `✓ Ready: ${await RoomCategory.countDocuments()} categories, ${await Room.countDocuments()} rooms`,
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("✗ Demo seed failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
