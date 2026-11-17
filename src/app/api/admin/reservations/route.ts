import { PERMISSIONS } from "@/config/app";
import { adminRoute, parse, readBody, readQuery } from "@/lib/api/admin";
import {
  createStaffReservation,
  listReservations,
} from "@/lib/services/admin/reservations";
import { staffReservationSchema } from "@/lib/validation/admin";
/**
 * Admin reservation board data. The page and the client filters both read this single endpoint, so a shared URL is the only source of truth for what the board shows.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.RESERVATION_VIEW,
  rate: { bucket: "admin:reservations:list", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ request }) => listReservations(readQuery(request)),
});

export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  mutating: true,
  rate: { bucket: "admin:reservations:create", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, actor }) => {
    const input = parse(staffReservationSchema, await readBody(request));
    return createStaffReservation(input, actor);
  },
});
