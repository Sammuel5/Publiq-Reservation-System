import { PERMISSIONS } from "@/config/app";
import { formatClubTime12h } from "@/lib/utils/datetime";
import type { Metadata } from "next";
import { requireAdminPermission } from "@/lib/auth/guards";
import { listBlocks } from "@/lib/services/admin/blocks";
import { listRooms } from "@/lib/services/admin/catalog";
import { getClubSettings } from "@/lib/services/club-settings";
import { filterParams, roomBlockQuerySchema } from "@/lib/validation/admin";
import { addDaysToDateString } from "@/lib/utils/datetime";
import { PageHeader } from "@/components/admin/page-section";
import { BlocksAdmin } from "@/components/admin/blocks-admin";

/**
 * Blocked dates and maintenance windows.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Blocked dates" };

export default async function BlocksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission(PERMISSIONS.RESERVATION_EDIT);
  const raw = filterParams(await searchParams);
  const settings = await getClubSettings();
  const usable = roomBlockQuerySchema.safeParse({
    from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined,
    room: typeof raw.room === "string" && raw.room ? raw.room : undefined,
  });

  const [blocks, rooms] = await Promise.all([
    listBlocks(usable.success ? usable.data : {}),
    listRooms(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Blocked dates"
        description={`Windows listed from ${blocks.window.from} to ${blocks.window.to}. Anything blocked here is hidden on the website for that time — for one space, or for the whole venue.`}
        actions={
          <span className="flex flex-wrap gap-1.5">
            {[
              { label: "This week", from: blocks.today, to: addDaysToDateString(blocks.today, 7) },
              { label: "This month", from: blocks.today, to: addDaysToDateString(blocks.today, 30) },
            ].map((preset) => (
              <a
                key={preset.label}
                href={`/admin/blocks?from=${preset.from}&to=${preset.to}`}
                className="min-h-9 rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-foreground"
              >
                {preset.label}
              </a>
            ))}
          </span>
        }
      />
      <BlocksAdmin
        blocks={blocks.blocks}
        rooms={rooms.rooms.map((room) => ({ id: room.id, name: room.name }))}
        today={blocks.today}
      />
      <p className="text-[12px] text-faint">
        The club closes {formatClubTime12h(settings.closingTime)} in {settings.timezone}; an end time earlier than the start
        is read as “through to the next morning”.
      </p>
    </div>
  );
}
