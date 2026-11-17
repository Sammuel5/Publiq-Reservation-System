import type { Metadata } from "next";
import { requireAdminPermission, can } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/config/app";
import { getClubSettings } from "@/lib/services/club-settings";
import { listCategories, listRooms } from "@/lib/services/admin/catalog";
import { PageHeader } from "@/components/admin/page-section";
import { RoomsAdmin } from "@/components/admin/rooms-admin";
import { ErrorState } from "@/components/ui/empty-state";

/**
 * Rooms and categories.
 *
 * This screen writes what the customer site sells, so the counts beside each
 * room are read live: "8 bookings all time · 2 tonight · ₱14,000 earned" is the
 * context that makes a price change a considered decision instead of a guess.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Spaces" };

export default async function RoomsPage() {
  const session = await requireAdminPermission(PERMISSIONS.ROOM_VIEW);
  const [data, settings, categories] = await Promise.all([
    listRooms().catch(() => null),
    getClubSettings(),
    listCategories().catch(() => []),
  ]);

  if (!data) {
    return (
      <ErrorState
        title="Spaces could not be read"
        description="The database did not answer. Check the system page before editing anything."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Spaces & categories"
        description="Names, prices and ordering here drive the booking wizard's space picker and the public spaces page."
      />
      <RoomsAdmin
        rooms={data.rooms}
        categories={categories}
        currency={settings.currency}
        canManage={can(session, PERMISSIONS.ROOM_MANAGE)}
      />
    </div>
  );
}
