import { formatClubTime12h } from "@/lib/utils/datetime";
import type { Metadata } from "next";
import { requireAdminPermission, can } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/config/app";
import { readSettings } from "@/lib/services/admin/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/page-section";
import { SettingsForm } from "@/components/admin/settings-form";
import { isOvernight } from "@/lib/utils/opening-hours";

/**
 * Club settings.
 *
 * Read-only for Staff, editable for Admin and above — and the panel spells out
 * what each number does, because "minimum booking 60 minutes" is a pricing
 * decision disguised as a form field.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireAdminPermission(PERMISSIONS.SETTINGS_VIEW);
  const settings = await readSettings();
  const canManage = can(session, PERMISSIONS.SETTINGS_MANAGE);

  const rules = [
    {
      label: "Night",
      value: `${formatClubTime12h(settings.openingTime)} → ${formatClubTime12h(settings.closingTime)}${isOvernight(settings.openingTime, settings.closingTime) ? " (next morning)" : ""}`,
      note: `Timezone ${settings.timezone}`,
    },
    {
      label: "Booking length",
      value: `${settings.minimumDuration}–720 min, default ${settings.defaultDuration}`,
      note: "Spaces may set their own minimum on top of this",
    },
    {
      label: "Holds",
      value: `Expire after ${settings.pendingExpirationMinutes} min unpaid`,
      note: "Releasing a hold puts the slot straight back on the site",
    },
    {
      label: "Self-cancellation",
      value:
        settings.cancellationCutoffHours === 0
          ? "Allowed any time before start"
          : `Allowed up to ${settings.cancellationCutoffHours} h before start`,
      note: "Inside the cutoff, the guest's request waits for a decision on their booking page",
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Club settings"
        description="One document drives the public site's copy and the booking engine's rules. Save and the next page request uses the new values."
        actions={
          canManage ? <Badge variant="gold">Editable by your role</Badge> : <Badge variant="neutral">Read-only for your role</Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <SettingsForm settings={settings} canManage={canManage} />

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">In force right now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rules.map((rule) => (
                <div key={rule.label}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{rule.label}</p>
                  <p className="text-[13.5px] text-foreground">{rule.value}</p>
                  <p className="text-[12px] leading-relaxed text-muted">{rule.note}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Contact &amp; links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-[13px]">
              <p>{settings.clubName}</p>
              <p className="text-muted">{settings.address}</p>
              <p className="text-muted">{settings.contactNumber} · {settings.email}</p>
              <p className="pt-1 text-[12px] text-faint">
                {settings.mapUrl ? "Maps link set" : "No maps link"} ·{" "}
                {[settings.socials.facebook, settings.socials.instagram, settings.socials.tiktok].filter(Boolean).length}/3
                social links
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
