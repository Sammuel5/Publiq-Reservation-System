"use client";

import { TimeSelect } from "@/components/ui/time-select";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionError } from "@/components/admin/action-controls";
import { adminFetch, type FieldErrors } from "@/components/admin/api-client";
import { DAY_LABELS_FULL } from "@/lib/utils/opening-hours";

/**
 * Club settings form.
 *
 * These inputs change what the customer website offers — hours, the booking
 * grid, when a hold expires, who may cancel — so the panel keeps each control
 * next to the consequence in plain words, and the server answers with a list of
 * what actually changed plus anything staff should know (a timezone change
 * moves every slot boundary, for instance).
 */

type Settings = {
  clubName: string;
  tagline: string | null;
  contactNumber: string;
  email: string;
  address: string;
  mapUrl: string | null;
  logoUrl: string | null;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  defaultDuration: number;
  minimumDuration: number;
  pendingExpirationMinutes: number;
  cancellationPolicy: string;
  cancellationCutoffHours: number;
  timezone: string;
  currency: string;
  socials: { facebook: string | null; instagram: string | null; tiktok: string | null };
};

type Result = {
  changes: Array<{ field: string; from: string; to: string }>;
  advisories: string[];
};

export function SettingsForm({ settings, canManage }: { settings: Settings; canManage: boolean }) {
  const [form, setForm] = React.useState(() => toForm(settings));
  const [days, setDays] = React.useState<number[]>(settings.operatingDays);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<FieldErrors>({});
  const [result, setResult] = React.useState<Result | null>(null);

  const dirty = React.useMemo(() => {
    const next = { ...toForm(settings), operatingDays: days };
    return JSON.stringify(next) !== JSON.stringify({ ...form, operatingDays: days });
  }, [form, days, settings]);

  const update = (key: keyof ReturnType<typeof toForm>) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleDay = (day: number) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((candidate) => candidate !== day) : [...prev, day].sort()));

  // The form compares itself against the settings it was rendered with, so after
  // a save that baseline has to be re-fetched — otherwise putting the old value
  // back looks like "no changes" and the Save button stays disabled.
  const router = useRouter();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    const payload = {
      ...form,
      operatingDays: days,
      tagline: form.tagline || undefined,
      mapUrl: form.mapUrl || undefined,
      logoUrl: form.logoUrl || undefined,
      facebook: form.facebook || undefined,
      instagram: form.instagram || undefined,
      tiktok: form.tiktok || undefined,
    };
    const response = await adminFetch<Result>("/api/admin/settings", { method: "PUT", body: payload });
    setPending(false);
    if (!response.ok) {
      setError(response.message);
      setFields(response.fields);
      return;
    }
    setResult(response.data);
    toast.success("Settings saved.");
    router.refresh();
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      {result && result.changes.length > 0 ? (
        <Card className="border-success/35 bg-success/[0.06]">
          <CardContent className="space-y-2">
            <p className="text-[13px] font-semibold text-success">
              Saved — {result.changes.length} value{result.changes.length === 1 ? "" : "s"} changed
            </p>
            <ul className="space-y-1 text-[12.5px] text-muted">
              {result.changes.map((change) => (
                <li key={change.field}>
                  <span className="font-mono text-[11.5px] text-faint">{change.field}</span>{" "}
                  {change.from} → {change.to}
                </li>
              ))}
            </ul>
            {result.advisories.length > 0 ? (
              <ul className="space-y-1 border-t border-line pt-2 text-[12.5px] text-warning">
                {result.advisories.map((advisory) => (
                  <li key={advisory} className="flex gap-2">
                    <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>{advisory}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="set-name" label="Club name" error={fields.clubName} required>
            <Input id="set-name" value={form.clubName} onChange={update("clubName")} disabled={!canManage} />
          </FormField>
          <FormField id="set-tagline" label="Tagline" error={fields.tagline}>
            <Input id="set-tagline" value={form.tagline} onChange={update("tagline")} disabled={!canManage} />
          </FormField>
          <FormField id="set-phone" label="Phone" error={fields.contactNumber} required>
            <Input id="set-phone" value={form.contactNumber} onChange={update("contactNumber")} disabled={!canManage} />
          </FormField>
          <FormField id="set-email" label="Email" error={fields.email} required>
            <Input id="set-email" type="email" value={form.email} onChange={update("email")} disabled={!canManage} />
          </FormField>
          <FormField id="set-address" label="Address" className="sm:col-span-2" error={fields.address} required>
            <Input id="set-address" value={form.address} onChange={update("address")} disabled={!canManage} />
          </FormField>
          <FormField id="set-map" label="Maps link" error={fields.mapUrl}>
            <Input id="set-map" value={form.mapUrl} onChange={update("mapUrl")} disabled={!canManage} placeholder="https://maps.google.com/…" />
          </FormField>
          <FormField id="set-logo" label="Logo URL" error={fields.logoUrl}>
            <Input id="set-logo" value={form.logoUrl} onChange={update("logoUrl")} disabled={!canManage} />
          </FormField>
          <FormField id="set-fb" label="Facebook" error={fields.facebook}>
            <Input id="set-fb" value={form.facebook} onChange={update("facebook")} disabled={!canManage} />
          </FormField>
          <FormField id="set-ig" label="Instagram" error={fields.instagram}>
            <Input id="set-ig" value={form.instagram} onChange={update("instagram")} disabled={!canManage} />
          </FormField>
          <FormField id="set-tt" label="TikTok" error={fields.tiktok}>
            <Input id="set-tt" value={form.tiktok} onChange={update("tiktok")} disabled={!canManage} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Trading hours &amp; booking grid</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset disabled={!canManage} className="space-y-2">
            <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
              Operating days
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS_FULL.map((label, index) => {
                const on = days.includes(index);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(index)}
                    className={`min-h-9 rounded-md border px-3 text-[12.5px] transition-colors ${
                      on
                        ? "border-gold/45 bg-gold/10 font-semibold text-gold"
                        : "border-line text-muted hover:border-line-strong hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-faint">
              Nights are not skipped — they are the ones most clubs close. Off days appear as unavailable
              on the website.
            </p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField id="set-open" label="Opens" error={fields.openingTime}>
              <TimeSelect id="set-open" value={form.openingTime} onChange={update("openingTime")} disabled={!canManage} />
            </FormField>
            <FormField id="set-close" label="Closes" hint="Before “opens” = overnight" error={fields.closingTime}>
              <TimeSelect id="set-close" value={form.closingTime} onChange={update("closingTime")} disabled={!canManage} />
            </FormField>
            <FormField id="set-tz" label="Timezone" hint="IANA name" error={fields.timezone}>
              <Input id="set-tz" value={form.timezone} onChange={update("timezone")} disabled={!canManage} />
            </FormField>
            <FormField id="set-cur" label="Currency" hint="3-letter code" error={fields.currency}>
              <Input id="set-cur" value={form.currency} maxLength={3} onChange={update("currency")} disabled={!canManage} />
            </FormField>
            <FormField id="set-min" label="Minimum booking (min)" error={fields.minimumDuration}>
              <Input
                id="set-min"
                type="number"
                min={30}
                max={720}
                step={30}
                value={form.minimumDuration}
                onChange={update("minimumDuration")}
                disabled={!canManage}
              />
            </FormField>
            <FormField id="set-default" label="Default duration (min)" error={fields.defaultDuration}>
              <Input
                id="set-default"
                type="number"
                min={30}
                max={720}
                step={30}
                value={form.defaultDuration}
                onChange={update("defaultDuration")}
                disabled={!canManage}
              />
            </FormField>
            <FormField
              id="set-expiry"
              label="Hold expires after (min)"
              hint="Unpaid pending bookings"
              error={fields.pendingExpirationMinutes}
            >
              <Input
                id="set-expiry"
                type="number"
                min={5}
                max={10080}
                value={form.pendingExpirationMinutes}
                onChange={update("pendingExpirationMinutes")}
                disabled={!canManage}
              />
            </FormField>
            <FormField
              id="set-cutoff"
              label="Self-cancel cutoff (hours)"
              hint="0 lets guests cancel any time"
              error={fields.cancellationCutoffHours}
            >
              <Input
                id="set-cutoff"
                type="number"
                min={0}
                max={168}
                value={form.cancellationCutoffHours}
                onChange={update("cancellationCutoffHours")}
                disabled={!canManage}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Cancellation policy text</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            id="set-policy"
            label="What guests read on the confirmation page and the reserve form"
            error={fields.cancellationPolicy}
            required
          >
            <Textarea
              id="set-policy"
              rows={4}
              maxLength={1000}
              value={form.cancellationPolicy}
              onChange={update("cancellationPolicy")}
              disabled={!canManage}
            />
          </FormField>
          {error ? <ActionError message={error} /> : null}
          {canManage ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending || !dirty}>
                <Save aria-hidden />
                {pending ? "Saving…" : "Save settings"}
              </Button>
              {dirty ? <span className="text-[12px] text-warning">Unsaved changes</span> : null}
              <span className="text-[12px] text-faint">
                Saved values apply to the next request; existing bookings keep the terms they were made under.
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Your role can read settings but not change them.</p>
          )}
        </CardContent>
      </Card>
    </form>
  );
}

function toForm(settings: Settings) {
  return {
    clubName: settings.clubName,
    tagline: settings.tagline ?? "",
    contactNumber: settings.contactNumber,
    email: settings.email,
    address: settings.address,
    mapUrl: settings.mapUrl ?? "",
    logoUrl: settings.logoUrl ?? "",
    openingTime: settings.openingTime,
    closingTime: settings.closingTime,
    defaultDuration: String(settings.defaultDuration),
    minimumDuration: String(settings.minimumDuration),
    pendingExpirationMinutes: String(settings.pendingExpirationMinutes),
    cancellationCutoffHours: String(settings.cancellationCutoffHours),
    cancellationPolicy: settings.cancellationPolicy,
    timezone: settings.timezone,
    currency: settings.currency,
    facebook: settings.socials.facebook ?? "",
    instagram: settings.socials.instagram ?? "",
    tiktok: settings.socials.tiktok ?? "",
  };
}
