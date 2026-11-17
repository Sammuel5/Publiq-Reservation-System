"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/utils/money";
import { formatClubDateLong, formatClubTime12h } from "@/lib/utils/datetime";
import { categoryLabel } from "@/components/site/room-card";

type Reservation = {
  reference: string;
  status: string;
  customerName: string;
  mobileMasked: string;
  room: { slug: string; name: string; categorySlug: string; image: string | null };
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  guestCount: number;
  estimatedAmount: number;
  specialRequests: string | null;
  cancellation: { status: string; requestedAt: string | null; reason: string | null };
  canCancel: boolean;
  cancellationRequiresApproval: boolean;
  cancellationCutoffHours: number;
};

export function LookupPanel({
  cancellationPolicy,
  contactNumber,
}: {
  cancellationPolicy: string;
  contactNumber: string;
}) {
  const [reference, setReference] = React.useState("");
  const [mobileNumber, setMobileNumber] = React.useState("");
  const [errors, setErrors] = React.useState<{ reference?: string; mobileNumber?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [reservation, setReservation] = React.useState<Reservation | null>(null);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [cancelMessage, setCancelMessage] = React.useState<string | null>(null);

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (reference.trim().length < 4) nextErrors.reference = "Enter your reservation reference.";
    if (mobileNumber.replace(/\D/g, "").length < 10) {
      nextErrors.mobileNumber = "Enter the mobile number used for the booking.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setFormError(null);
    setReservation(null);
    setCancelMessage(null);

    try {
      const response = await fetch("/api/reservations/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, mobileNumber }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { reservation?: Reservation; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.reservation) {
        setFormError(
          payload?.error?.message ??
            "We couldn't find that reservation. Check the reference and mobile number.",
        );
        return;
      }
      setReservation(payload.reservation);
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitCancellation() {
    if (!reservation) return;
    setCancelling(true);
    setCancelError(null);

    try {
      const response = await fetch("/api/reservations/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, mobileNumber, reason }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            mode?: "CANCELLED" | "REQUESTED";
            message?: string;
            reservation?: Reservation;
            error?: { message?: string };
          }
        | null;

      if (!response.ok || !payload?.reservation) {
        setCancelError(payload?.error?.message ?? "We couldn't process that request.");
        return;
      }

      setReservation(payload.reservation);
      setCancelMessage(payload.message ?? "Your request has been submitted.");
      setCancelOpen(false);
      setReason("");
    } catch {
      setCancelError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
      {/* Form */}
      <form
        onSubmit={lookup}
        className="rounded-lg border border-line bg-card p-5 sm:p-6"
        noValidate
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-faint">
          <Search className="size-3.5 text-gold" />
          Find your reservation
        </h2>

        <div className="mt-5 space-y-4">
          {formError ? (
            <Alert tone="danger" role="alert" title="No match found">
              {formError}
            </Alert>
          ) : null}

          <FormField
            id="reference"
            label="Reservation reference"
            required
            hint="e.g. NK-7F3K9Q"
            error={errors.reference}
          >
            <Input
              value={reference}
              onChange={(event) => {
                setReference(event.target.value.toUpperCase());
                if (errors.reference) setErrors((prev) => ({ ...prev, reference: undefined }));
              }}
              placeholder="NK-XXXXXX"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono tracking-wider"
            />
          </FormField>

          <FormField
            id="lookupMobile"
            label="Mobile number"
            required
            hint="Used on the booking"
            error={errors.mobileNumber}
          >
            <Input
              type="tel"
              inputMode="tel"
              value={mobileNumber}
              onChange={(event) => {
                setMobileNumber(event.target.value);
                if (errors.mobileNumber) {
                  setErrors((prev) => ({ ...prev, mobileNumber: undefined }));
                }
              }}
              placeholder="0917 123 4567"
              autoComplete="tel"
            />
          </FormField>

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {loading ? "Looking up" : "View reservation"}
            {!loading ? <Search className="size-4" /> : null}
          </Button>
        </div>

        <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
          Both the reference and the mobile number must match. We never reveal whether a
          reference exists on its own.
        </p>
      </form>

      {/* Result */}
      <div>
        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface/40 text-center">
            <Loader2 aria-hidden className="size-5 animate-spin text-gold" />
            <p className="mt-3 text-[13px] text-muted">Looking up your reservation…</p>
          </div>
        ) : reservation ? (
          <article className="overflow-hidden rounded-lg border border-line bg-card">
            <header className="flex items-start justify-between gap-3 border-b border-line p-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                  Reference
                </p>
                <p className="mt-1 select-all font-mono text-xl font-semibold tracking-[0.1em]">
                  {reservation.reference}
                </p>
                <p className="mt-1 text-[12px] text-muted">{reservation.customerName}</p>
              </div>
              <StatusBadge status={reservation.status as never} />
            </header>

            <dl className="divide-y divide-line text-[13px]">
              <div className="flex items-center justify-between gap-4 p-4">
                <dt className="flex items-center gap-2 text-faint">
                  <Users className="size-3.5" /> Space
                </dt>
                <dd className="text-right font-medium">
                  {reservation.room.name}
                  <span className="block text-[11.5px] font-normal text-faint">
                    {categoryLabel(reservation.room.categorySlug)} · {reservation.guestCount} guests
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 p-4">
                <dt className="flex items-center gap-2 text-faint">
                  <CalendarDays className="size-3.5" /> Date
                </dt>
                <dd className="text-right font-medium">{formatClubDateLong(reservation.date)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 p-4">
                <dt className="flex items-center gap-2 text-faint">
                  <Clock className="size-3.5" /> Time
                </dt>
                <dd className="text-right font-medium">
                  {formatClubTime12h(reservation.startTime)} –{" "}
                  {formatClubTime12h(reservation.endTime)}
                  <span className="block text-[11.5px] font-normal text-faint">
                    {reservation.durationMinutes} minutes
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 p-4">
                <dt className="flex items-center gap-2 text-faint">
                  <CreditCard className="size-3.5" /> Estimated
                </dt>
                <dd className="text-right font-semibold">
                  {formatMoney(reservation.estimatedAmount)}
                  <span className="block text-[11.5px] font-normal text-faint">
                    Pay at the club
                  </span>
                </dd>
              </div>
            </dl>

            <div className="space-y-3 border-t border-line p-5">
              {cancelMessage ? (
                <Alert
                  tone={reservation.status === "CANCELLED" ? "warning" : "success"}
                  title={reservation.status === "CANCELLED" ? "Reservation cancelled" : "Request received"}
                >
                  {cancelMessage}
                </Alert>
              ) : null}

              {reservation.cancellation.status === "PENDING" ? (
                <Alert tone="info" title="Cancellation awaiting approval">
                  Our team is reviewing your request. We&apos;ll contact you on{" "}
                  {reservation.mobileMasked}.
                </Alert>
              ) : null}

              {reservation.canCancel ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setCancelError(null);
                    setCancelOpen(true);
                  }}
                >
                  <XCircle className="size-4" />
                  Request cancellation
                </Button>
              ) : null}

              <p className="text-[11.5px] leading-relaxed text-faint">
                Bookings starting in less than {reservation.cancellationCutoffHours} hours
                need staff approval to cancel. Call {contactNumber} for urgent changes.
              </p>
            </div>
          </article>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface/40 px-6 text-center">
            <CheckCircle2 aria-hidden className="size-5 text-gold" />
            <p className="mt-3 text-[13.5px] font-medium">Your reservation will appear here</p>
            <p className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted">
              Enter the reference from your confirmation and the mobile number you booked
              with.
            </p>
          </div>
        )}
      </div>

      {/* Cancellation dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request cancellation</DialogTitle>
            <DialogDescription>
              {reservation?.cancellationRequiresApproval
                ? `This booking starts in under ${reservation.cancellationCutoffHours} hours, so our team must approve the cancellation.`
                : "This booking is outside the cutoff window and will be cancelled immediately."}
            </DialogDescription>
          </DialogHeader>

          {cancelError ? (
            <Alert tone="danger" role="alert" className="mb-3">
              {cancelError}
            </Alert>
          ) : null}

          <div className="rounded-md border border-line bg-surface p-3 text-[12px] leading-relaxed text-muted">
            <p className="font-medium text-foreground">Policy</p>
            <p className="mt-1">{cancellationPolicy}</p>
          </div>

          <div className="mt-4">
            <FormField id="cancelReason" label="Reason (optional)">
              <Textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Tell us why — it helps us release the space to other guests."
              />
            </FormField>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep booking
            </Button>
            <Button variant="destructive" onClick={() => void submitCancellation()} loading={cancelling}>
              {cancelling ? "Submitting" : "Confirm cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { Link };
