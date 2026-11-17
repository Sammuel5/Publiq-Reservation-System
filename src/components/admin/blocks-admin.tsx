"use client";

import { TimeSelect } from "@/components/ui/time-select";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionButton, ActionError } from "@/components/admin/action-controls";
import { adminFetch, type FieldErrors } from "@/components/admin/api-client";

/**
 * Blocked windows.
 *
 * The conflict path is the interesting part: a clash with live bookings is
 * reported with the references involved, and the admin has to tick "block
 * anyway" to proceed. Silence would mean losing a guest's evening without anyone
 * deciding to.
 */
type Block = {
  id: string;
  roomName: string;
  scope: "VENUE" | "ROOM";
  startLabel: string;
  endLabel: string;
  reason: string | null;
  isActive: boolean;
  createdBy: string | null;
  overlaps: { reservations: number; references: string[] };
};

export function BlocksAdmin({
  blocks,
  rooms,
  today,
}: {
  blocks: Block[];
  rooms: Array<{ id: string; name: string }>;
  today: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<FieldErrors>({});
  const [force, setForce] = React.useState(false);
  const [form, setForm] = React.useState({
    roomId: "",
    date: today,
    startTime: "14:00",
    endTime: "18:00",
    reason: "",
  });

  const set = (key: "roomId" | "date" | "startTime" | "endTime" | "reason") => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const router = useRouter();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    const result = await adminFetch<{ warning: string | null }>("/api/admin/blocks", {
      method: "POST",
      body: { ...form, roomId: form.roomId || "", force },
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      setFields(result.fields);
      return;
    }
    toast.success(result.data.warning ?? "Window blocked.");
    setForce(false);
    setOpen(false);
    // Without this the new window exists but stays off the list until a reload.
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Blocks hide spaces on the website for the listed window. They do not cancel bookings — you decide
          what happens to the guests caught in one.
        </p>
        <Button size="sm" onClick={() => setOpen((prev) => !prev)}>
          <Plus aria-hidden />
          {open ? "Close form" : "Block a window"}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">New blocked window</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              <FormField id="block-scope" label="Scope" hint="Leave on “whole venue” to close the club" error={fields.roomId}>
                <select
                  id="block-scope"
                  className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
                  value={form.roomId}
                  onChange={set("roomId")}
                >
                  <option value="">Whole venue</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField id="block-date" label="Date" error={fields.date} required>
                <Input id="block-date" type="date" value={form.date} onChange={set("date")} />
              </FormField>

              <FormField id="block-start" label="From" error={fields.startTime} required>
                <TimeSelect id="block-start" value={form.startTime} onChange={set("startTime")} required />
              </FormField>

              <FormField
                id="block-end"
                label="Until"
                hint="Before “from” means overnight"
                error={fields.endTime}
                required
              >
                <TimeSelect id="block-end" value={form.endTime} onChange={set("endTime")} required />
              </FormField>

              <FormField id="block-reason" label="Reason" className="sm:col-span-2" error={fields.reason}>
                <Textarea
                  id="block-reason"
                  rows={2}
                  maxLength={300}
                  value={form.reason}
                  placeholder="Annual deep clean · private event on Level 3…"
                  onChange={set("reason")}
                />
              </FormField>

              <label className="flex min-h-9 items-start gap-2.5 text-[13px] text-muted sm:col-span-2">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(event) => setForce(event.target.checked)}
                  className="mt-0.5 size-4 accent-[#c9a45c]"
                />
                <span>Block anyway, even if live bookings overlap this window.</span>
              </label>

              {error ? <div className="sm:col-span-2"><ActionError message={error} /></div> : null}

              <div className="flex items-center gap-2 sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
                  Block window
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {blocks.length === 0 ? (
        <Card>
          <CardContent className="text-[13.5px] text-muted">
            Nothing is blocked in this window. Use the form above to close a space for maintenance or the
            whole venue for an event.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {blocks.map((block) => (
            <li
              key={block.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-card/50 p-3.5"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                  {block.roomName}
                  <Badge variant={block.scope === "VENUE" ? "danger" : "neutral"}>
                    {block.scope === "VENUE" ? "Venue" : "Room"}
                  </Badge>
                  {!block.isActive ? <Badge variant="outline">Closed</Badge> : null}
                  {block.overlaps.reservations > 0 ? (
                    <Badge variant="warning">
                      {block.overlaps.reservations} booking
                      {block.overlaps.reservations === 1 ? "" : "s"} inside
                    </Badge>
                  ) : null}
                </p>
                <p className="text-[12.5px] text-muted">
                  {block.startLabel} → {block.endLabel}
                  {block.reason ? ` · ${block.reason}` : ""}
                </p>
                {block.overlaps.references.length > 0 ? (
                  <p className="text-[12px] text-faint">
                    Affects {block.overlaps.references.join(", ")}
                    {block.createdBy ? ` · set by ${block.createdBy}` : ""}
                  </p>
                ) : null}
              </div>

              {/* One control per state, and each one posts the action its label
                  promises: an open window is closed, a closed one is reopened. */}
              {block.isActive ? (
                <ActionButton
                  href={`/api/admin/blocks/${block.id}`}
                  payload={{ action: "close" }}
                  successMessage="Window closed — the site can sell that night again."
                  size="sm"
                  variant="outline"
                >
                  <ShieldOff aria-hidden />
                  Close window
                </ActionButton>
              ) : (
                <ActionButton
                  href={`/api/admin/blocks/${block.id}`}
                  payload={{ action: "reopen" }}
                  successMessage="Window reopened."
                  size="sm"
                  variant="secondary"
                >
                  <ShieldCheck aria-hidden />
                  Reopen
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
