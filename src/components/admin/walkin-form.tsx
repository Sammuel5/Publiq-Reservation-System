"use client";

import { TimeSelect } from "@/components/ui/time-select";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminFetch, type FieldErrors } from "@/components/admin/api-client";
import { formatMoney } from "@/lib/utils/money";

/**
 * Front-desk booking.
 *
 * The public wizard forbids starts inside 30 minutes and holds a booking as
 * PENDING for two hours; neither is right at a counter, so this form posts to
 * the staff endpoint, which creates the booking already confirmed and measures
 * the lead time from the moment the party walks in.
 */
type Room = {
  id: string;
  slug: string;
  name: string;
  capacity: number;
  hourlyRate: number;
  minimumDuration: number;
};

export function WalkInDialog({
  rooms,
  today,
  currency,
  defaultDate,
}: {
  rooms: Room[];
  today: string;
  currency: string;
  defaultDate?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<FieldErrors>({});
  const [created, setCreated] = React.useState<{ reference: string; amount: number } | null>(null);
  const [form, setForm] = React.useState({
    roomSlug: rooms[0]?.slug ?? "",
    date: defaultDate ?? today,
    startTime: "20:00",
    durationMinutes: "120",
    fullName: "",
    mobileNumber: "",
    email: "",
    guestCount: "4",
    specialRequests: "",
    confirmNow: true,
  });

  const room = rooms.find((candidate) => candidate.slug === form.roomSlug);
  const estimate = room ? Math.round((room.hourlyRate * Number(form.durationMinutes || 0)) / 60) : 0;

  React.useEffect(() => {
    if (open) {
      setCreated(null);
      setError(null);
      setFields({});
    }
  }, [open]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const target = event.target as HTMLInputElement;
    setForm((prev) => ({
      ...prev,
      [key]: target.type === "checkbox" ? target.checked : target.value,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          New booking
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Seat a walk-in party</DialogTitle>
          <DialogDescription>
            Same rules as the website — capacity, operating hours and the space's minimum stay are
            enforced, and the price is calculated here, not typed in.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3 rounded-md border border-success/35 bg-success/[0.07] p-4">
            <p className="flex items-center gap-2 text-[13.5px] text-foreground">
              <Sparkles aria-hidden className="size-4 text-success" />
              Booking <span className="font-semibold">{created.reference}</span> created ·{" "}
              {formatMoney(created.amount, { currency })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/reservations" onClick={() => setOpen(false)}>
                  Back to the board
                </Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Book another
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              setFields({});
              const result = await adminFetch<{ reference: string; amount: number }>(
                "/api/admin/reservations",
                { method: "POST", body: form },
              );
              setPending(false);
              if (!result.ok) {
                setError(result.message);
                setFields(result.fields);
                return;
              }
              setCreated(result.data);
              toast.success(`${result.data.reference} seated.`);
              router.refresh();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="walkin-room" label="Space" error={fields.roomSlug} required>
                <select
                  id="walkin-room"
                  className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
                  value={form.roomSlug}
                  onChange={set("roomSlug")}
                >
                  {rooms.map((candidate) => (
                    <option key={candidate.id} value={candidate.slug}>
                      {candidate.name} · seats {candidate.capacity}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                id="walkin-guests"
                label="Guests"
                hint={room ? `capacity ${room.capacity}` : undefined}
                error={fields.guestCount}
                required
              >
                <Input id="walkin-guests" type="number" min={1} max={100} value={form.guestCount} onChange={set("guestCount")} />
              </FormField>

              <FormField id="walkin-date" label="Date" error={fields.date} required>
                <Input id="walkin-date" type="date" value={form.date} min={today} onChange={set("date")} />
              </FormField>

              <FormField id="walkin-time" label="Start time" error={fields.startTime} required>
                <TimeSelect id="walkin-time" value={form.startTime} onChange={set("startTime")} required />
              </FormField>

              <FormField
                id="walkin-duration"
                label="Duration (minutes)"
                hint={room ? `from ${formatMoney(estimate, { currency })}` : undefined}
                error={fields.durationMinutes}
                required
              >
                <Input
                  id="walkin-duration"
                  type="number"
                  min={room?.minimumDuration ?? 30}
                  max={720}
                  step={30}
                  value={form.durationMinutes}
                  onChange={set("durationMinutes")}
                />
              </FormField>

              <FormField id="walkin-name" label="Guest name" error={fields.fullName} required>
                <Input id="walkin-name" value={form.fullName} maxLength={120} onChange={set("fullName")} placeholder="Maria Santos" />
              </FormField>

              <FormField id="walkin-mobile" label="Mobile number" error={fields.mobileNumber} required>
                <Input id="walkin-mobile" inputMode="tel" value={form.mobileNumber} onChange={set("mobileNumber")} placeholder="0917 123 4567" />
              </FormField>

              <FormField id="walkin-email" label="Email" error={fields.email}>
                <Input id="walkin-email" type="email" value={form.email} onChange={set("email")} />
              </FormField>

              <FormField id="walkin-requests" label="Requests" className="sm:col-span-2" error={fields.specialRequests}>
                <Textarea id="walkin-requests" rows={2} maxLength={1000} value={form.specialRequests} onChange={set("specialRequests")} />
              </FormField>
            </div>

            <label className="flex min-h-9 items-start gap-2.5 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={form.confirmNow}
                onChange={set("confirmNow")}
                className="mt-0.5 size-4 accent-[#c9a45c]"
              />
              <span>
                Confirm immediately (recommended at the counter). Uncheck to leave it pending for an
                admin to approve.
              </span>
            </label>

            {error ? (
              <p role="alert" className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || rooms.length === 0}>
                {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
                Create booking
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
