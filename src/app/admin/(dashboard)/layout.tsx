import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guards";
import { ROLE_PERMISSIONS } from "@/config/app";
import { getClubSettings } from "@/lib/services/club-settings";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Protected admin layout.
 *
 * Every request is authenticated on the server before any admin markup is
 * produced, so an unauthenticated visitor never receives dashboard HTML.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  const settings = await getClubSettings().catch(() => null);

  // Formatted here, once, on the server. A client component that ran `new Date()`
  // through `Intl` on both sides produced a hydration mismatch on every admin page
  // — and "today" in a club console means today in the club's timezone anyway.
  const todayLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: settings?.timezone ?? "Asia/Manila",
  }).format(new Date());

  return (
    <AdminShell
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        permissions: ROLE_PERMISSIONS[session.user.role],
      }}
      clubName={settings?.clubName ?? "PUBLIQ"}
      todayLabel={todayLabel}
    >
      {children}
    </AdminShell>
  );
}
