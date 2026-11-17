import { getClubSettings } from "@/lib/services/club-settings";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

/**
 * Customer website shell: sticky navigation, main content, footer.
 * Business information (name, contact, hours, address) is read from ClubSettings
 * so the admin can change it without a deploy.
 */
export const dynamic = "force-dynamic";

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getClubSettings();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader clubName={settings.clubName} contactNumber={settings.contactNumber} />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter settings={settings} />
    </div>
  );
}
