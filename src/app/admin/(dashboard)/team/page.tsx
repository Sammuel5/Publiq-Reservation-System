import type { Metadata } from "next";
import { requireAdminPermission } from "@/lib/auth/guards";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/config/app";
import { listAdminUsers } from "@/lib/services/admin/team";
import { getClubSettings } from "@/lib/services/club-settings";
import { PageHeader } from "@/components/admin/page-section";
import { TeamAdmin } from "@/components/admin/team-admin";

/**
 * Staff accounts.
 *
 * `requireAdminPermission` guards the whole page — the API routes repeat the
 * same check, because a page guard protects rendering while the route guard is
 * what actually stops the write.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireAdminPermission(PERMISSIONS.ADMIN_MANAGE);
  const [{ users }, settings] = await Promise.all([
    listAdminUsers({
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    }),
    getClubSettings(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team & access"
        description={`Signed in as ${session.user.email} (${session.user.role === "SUPER_ADMIN" ? "Super Admin" : session.user.role}) · session valid until ${new Date(
          session.expiresAt,
        ).toLocaleString("en-PH")}. Your role holds ${ROLE_PERMISSIONS[session.user.role].length} of ${
          Object.keys(PERMISSIONS).length
        } capabilities.`}
      />
      <TeamAdmin users={users} timezone={settings.timezone} />
    </div>
  );
}
