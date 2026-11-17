"use client";

import { TimeSelect } from "@/components/ui/time-select";

import * as React from "react";
import {
  ArrowLeftRight,
  Ban,
  Check,
  CheckCircle2,
  CreditCard,
  Flag,
  Hourglass,
  Loader2,
  MessageSquarePlus,
  TimerReset,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionError, AdminForm, PromptActionButton, useAdminAction } from "@/components/admin/action-controls";
import { Money } from "@/components/admin/money";
import { formatMoney } from "@/lib/utils/money";
import type { AdminAction, ReservationDetail } from "@/lib/services/admin/reservations";

/**
 * The reservation console: everything staff can do to one booking.
 *
 * It is one client island rather than a client component per button for a
 * practical reason — the panels share state. Recording a payment changes the
 * balance shown beside it; moving a booking changes the price shown above it;
 * approving a cancellation makes the status buttons disappear. Splitting them
 * would mean duplicating the "reload everything" dance in five places.
 */

type Props = {
  reservationId: string;
  detail: ReservationDetail;
  rooms: Array<{ id: string; slug: string; name: string; capacity: number; hourlyRate: number; minimumDuration: number }>;
  currency: string;
  timezone: string;
  can: {
    status: boolean;
    checkIn: boolean;
    paymentManage: boolean;
    decide: boolean;
    edit: boolean;
    payment: boolean;
  };
};

const ACTION_COPY: Record<
  AdminAction,
  { label: string; success: string; icon: React.ReactNode; destructive?: boolean; reason?: boolean }
> = {
  CONFIRM: {
    label: "Confirm booking",
    success: "Booking confirmed — the guest keeps their room.",
    icon: <Check aria-hidden />,
  },
  CHECK_IN: {
    label: "Check in",
    success: "Guest checked in.",
    icon: <CheckCircle2 aria-hidden />,
  },
  COMPLETE: {
    label: "Close out",
    success: "Night closed out for this booking.",
    icon: <Flag aria-hidden />,
  },
  REJECT: {
    label: "Reject",
    success: "Booking rejected and the room released.",
    icon: <Ban aria-hidden />,
    destructive: true,
    reason: true,
  },
  NO_SHOW: {
    label: "No-show",
    success: "Marked as a no-show.",
    icon: <Hourglass aria-hidden />,
    destructive: true,
    reason: true,
  },
  CANCEL: {
    label: "Cancel booking",
    success: "Booking cancelled and the room released.",
    icon: <XCircle aria-hidden />,
    destructive: true,
    reason: true,
  },
  EXPIRE: {
    label: "Release hold",
    success: "Pending hold released.",
    icon: <TimerReset aria-hidden />,
    destructive: true,
    reason: true,
  },
};

export function ReservationConsole({ reservationId, detail, rooms, currency, timezone, can }: Props) {
  const { reservation } = detail;
  const actions = detail.allowedActions.filter((action) =>
    action === "CONFIRM" || action === "REJECT" ? can.decide : action === "CHECK_IN" ? can.checkIn && (reservation.status !== "PENDING" || can.decide) : can.status,
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[15px]">Actions</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {actions.length === 0 ? (
              <p className="text-[13px] text-muted">
                Nothing left to do — this booking is {reservation.status.toLowerCase().replace("_", "-")}.
              </p>
            ) : null}
            {actions.map((action) => {
              const copy = ACTION_COPY[action];
              const href = `/api/admin/reservations/${reservationId}/action`;
              const payload = { action, ...(copy.reason ? {} : { reason: undefined }) };

              if (copy.reason) {
                return (
                  <PromptActionButton
                    key={action}
                    href={href}
                    label={
                      <>
                        {copy.icon}
                        {copy.label}
                      </>
                    }
                    title={`${copy.label} · ${reservation.reference}`}
                    description={
                      action === "CANCEL"
                        ? "The room becomes bookable again immediately. Anything already paid should be refunded at the counter — record it below."
                        : action === "REJECT"
                          ? "Use this when the night cannot take the booking. The guest keeps their reference for the record."
                          : "Record what happened so the timeline explains the outcome later."
                    }
                    reasonRequired={action !== "EXPIRE"}
                    reasonPlaceholder={
                      action === "NO_SHOW" ? "Waited 30 minutes, called twice…" : "Why is this happening?"
                    }
                    payload={(reason) => ({ action, reason: reason || undefined })}
                    successMessage={copy.success}
                    destructive={copy.destructive}
                  />
                );
              }

              return (
                <QuickAction
                  key={action}
                  href={href}
                  payload={payload}
                  success={copy.success}
                  variant={action === "CONFIRM" ? "default" : "secondary"}
                >
                  {copy.icon}
                  {copy.label}
                </QuickAction>
              );
            })}
          </div>
        </CardHeader>
        {detail.advisory ? (
          <CardContent>
            <ActionError message={detail.advisory} />
          </CardContent>
        ) : null}
      </Card>

      {detail.cancellation.status === "PENDING" ? (
        <Card className="border-warning/40 bg-warning/[0.06]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[15px] text-warning">
              <MessageSquarePlus aria-hidden className="size-4" />
              Cancellation request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13.5px] leading-relaxed text-muted">
              The guest asked to cancel inside the {detail.cancellation.cutoffHours}-hour window, so the
              website could not do it without you.
              {detail.cancellation.reason ? (
                <>
                  {" "}
                  They said: <span className="text-foreground">“{detail.cancellation.reason}”</span>
                </>
              ) : null}
            </p>
            {can.decide ? (
              <div className="flex flex-wrap gap-2">
                <PromptActionButton
                  href={`/api/admin/reservations/${reservationId}/cancellation`}
                  label="Approve cancellation"
                  title={`Cancel ${reservation.reference}?`}
                  description="The booking is cancelled, the space is released, and any payment needs refunding at the counter."
                  reasonLabel="Note for the guest (optional)"
                  payload={(reason) => ({ decision: "APPROVED", note: reason || undefined })}
                  successMessage="Cancellation approved."
                  destructive
                />
                <PromptActionButton
                  href={`/api/admin/reservations/${reservationId}/cancellation`}
                  label="Decline request"
                  title={`Keep ${reservation.reference}?`}
                  description="The space stays held. Call the guest on the number shown above."
                  reasonLabel="Why? (goes in their timeline)"
                  reasonRequired
                  payload={(reason) => ({ decision: "DECLINED", note: reason || undefined })}
                  successMessage="Request declined — the booking stands."
                  triggerVariant="outline"
                />
              </div>
            ) : (
              <p className="text-[13px] text-faint">Your role can see requests but not decide them.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="guest">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="guest">Guest</TabsTrigger>
          <TabsTrigger value="money">Money</TabsTrigger>
          <TabsTrigger value="move">Move</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="guest">
          <GuestPanel reservationId={reservationId} detail={detail} editable={can.edit} />
        </TabsContent>
        <TabsContent value="money">
          <MoneyPanel
            reservationId={reservationId}
            detail={detail}
            currency={currency}
            timezone={timezone}
            canRecord={can.payment}
            canManage={can.paymentManage}
          />
        </TabsContent>
        <TabsContent value="move">
          <MovePanel reservationId={reservationId} detail={detail} rooms={rooms} currency={currency} enabled={can.edit} />
        </TabsContent>
        <TabsContent value="notes">
          <NotePanel reservationId={reservationId} detail={detail} enabled={can.edit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** POST a simple action without a prompt, with the result surfaced as a toast. */
function QuickAction({
  href,
  payload,
  success,
  variant = "secondary",
  children,
}: {
  href: string;
  payload: unknown;
  success: string;
  variant?: ButtonProps["variant"];
  children: React.ReactNode;
}) {
  const action = useAdminAction(href);

  return (
    <>
      <Button
        size="sm"
        variant={variant}
        disabled={action.pending}
        onClick={async () => {
          const result = await action.run(payload);
          const { toast } = await import("sonner");
          if (result.ok) toast.success(success);
          else toast.error(result.message);
        }}
      >
        {action.pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {children}
      </Button>
    </>
  );
}

// ------------------------------------------------------------------- panels --

function GuestPanel({
  reservationId,
  detail,
  editable,
}: {
  reservationId: string;
  detail: ReservationDetail;
  editable: boolean;
}) {
  const { reservation } = detail;
  const action = useAdminAction<{ changed: string[] }>(`/api/admin/reservations/${reservationId}`);
  const [form, setForm] = React.useState({
    fullName: reservation.customerName,
    mobileNumber: reservation.customerMobile,
    email: reservation.customerEmail ?? "",
    guestCount: String(reservation.guestCount),
    specialRequests: reservation.specialRequests ?? "",
  });

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="text-[15px]">Guest details</CardTitle>
        {reservation.source === "ADMIN" ? <Badge variant="purple">Front desk</Badge> : <Badge variant="outline">Website</Badge>}
      </CardHeader>
      <CardContent>
        {editable ? (
          <AdminForm
            submitLabel="Save guest details"
            error={action.error}
            onSubmit={async () => {
              const result = await action.run(form, { method: "PATCH" });
              if (!result.ok) return;
              const { toast } = await import("sonner");
              if (result.data.changed?.length) {
                toast.success(`Updated ${result.data.changed.join(", ")}.`);
              } else {
                toast.info("Nothing changed.");
              }
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="guest-name" label="Guest name" error={action.fields.fullName} required>
                <Input id="guest-name" value={form.fullName} onChange={update("fullName")} maxLength={120} />
              </FormField>
              <FormField
                id="guest-mobile"
                label="Mobile number"
                hint="Identity — bookings are matched on this"
                error={action.fields.mobileNumber}
                required
              >
                <Input id="guest-mobile" value={form.mobileNumber} onChange={update("mobileNumber")} inputMode="tel" />
              </FormField>
              <FormField id="guest-email" label="Email" error={action.fields.email}>
                <Input id="guest-email" type="email" value={form.email} onChange={update("email")} />
              </FormField>
              <FormField
                id="guest-count"
                label="Guests"
                hint={`Room capacity ${reservation.roomCapacity}`}
                error={action.fields.guestCount}
              >
                <Input id="guest-count" type="number" min={1} max={100} value={form.guestCount} onChange={update("guestCount")} />
              </FormField>
              <FormField id="guest-requests" label="Special requests" className="sm:col-span-2" error={action.fields.specialRequests}>
                <Textarea id="guest-requests" rows={3} value={form.specialRequests} onChange={update("specialRequests")} maxLength={1000} />
              </FormField>
            </div>
          </AdminForm>
        ) : (
          <dl className="grid gap-3 text-[13.5px] sm:grid-cols-2">
            <Row label="Name" value={reservation.customerName} />
            <Row label="Mobile" value={reservation.customerMobile} />
            <Row label="Email" value={reservation.customerEmail ?? "—"} />
            <Row label="Party size" value={`${reservation.guestCount} of ${reservation.roomCapacity} seats`} />
            <Row label="Requests" value={reservation.specialRequests ?? "None"} className="sm:col-span-2" />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function MoneyPanel({
  reservationId,
  detail,
  currency,
  timezone,
  canRecord,
  canManage,
}: {
  reservationId: string;
  detail: ReservationDetail;
  currency: string;
  timezone: string;
  canRecord: boolean;
  canManage: boolean;
}) {
  const action = useAdminAction<{ message: string }>(`/api/admin/reservations/${reservationId}/payments`);
  const [form, setForm] = React.useState({
    amount: (detail.balances.outstanding / 100).toFixed(2),
    paymentMethod: "CASH",
    paymentStatus: "PAID",
    referenceNumber: "",
    notes: "",
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Balance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="space-y-2 text-[13.5px]">
            <Row label="Estimated total" value={<Money centavos={detail.balances.expected} currency={currency} />} />
            <Row label="Collected" value={<Money centavos={detail.balances.collected} currency={currency} />} />
            <Row label="Refunded" value={<Money centavos={detail.balances.refunded} currency={currency} />} />
            <Row
              label="Outstanding"
              value={
                <span className={detail.balances.outstanding > 0 ? "font-semibold text-warning" : "font-semibold text-success"}>
                  <Money centavos={detail.balances.outstanding} currency={currency} />
                </span>
              }
            />
          </dl>
          {canRecord ? (
            <AdminForm
              submitLabel={form.paymentStatus === "REFUNDED" ? "Record refund" : "Record payment"}
              error={action.error}
              onSubmit={async () => {
                const result = await action.run({ ...form, referenceNumber: form.referenceNumber || undefined });
                if (!result.ok) return;
                const { toast } = await import("sonner");
                toast.success((result.data as { message?: string }).message ?? "Recorded.");
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="pay-amount"
                  label="Amount (pesos)"
                  hint={`Outstanding ${currency === "PHP" ? "₱" : ""}${(detail.balances.outstanding / 100).toFixed(2)}`}
                  error={action.fields.amount}
                  required
                >
                  <Input
                    id="pay-amount"
                    value={form.amount}
                    inputMode="decimal"
                    onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
                  />
                </FormField>
                <FormField id="pay-method" label="Method" error={action.fields.paymentMethod}>
                  <select
                    id="pay-method"
                    className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
                    value={form.paymentMethod}
                    onChange={(event) => setForm((prev) => ({ ...prev, paymentMethod: event.target.value }))}
                  >
                    <option value="CASH">Cash</option>
                    <option value="GCASH">GCash</option>
                    <option value="MAYA">Maya</option>
                    <option value="OTHER">Other</option>
                  </select>
                </FormField>
                <FormField id="pay-status" label="Type" error={action.fields.paymentStatus}>
                  <select
                    id="pay-status"
                    className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
                    value={form.paymentStatus}
                    onChange={(event) => setForm((prev) => ({ ...prev, paymentStatus: event.target.value }))}
                  >
                    <option value="PAID">Payment</option>
                    <option value="PARTIALLY_PAID">Deposit / partial</option>
                    {canManage ? <option value="REFUNDED">Refund</option> : null}
                  </select>
                </FormField>
                <FormField id="pay-ref" label="Reference" hint="GCash/Maya txn id" error={action.fields.referenceNumber}>
                  <Input
                    id="pay-ref"
                    value={form.referenceNumber}
                    maxLength={120}
                    onChange={(event) => setForm((prev) => ({ ...prev, referenceNumber: event.target.value }))}
                  />
                </FormField>
                <FormField id="pay-notes" label="Note" className="sm:col-span-2" error={action.fields.notes}>
                  <Input
                    id="pay-notes"
                    value={form.notes}
                    maxLength={300}
                    placeholder="Settled at the counter…"
                    onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </FormField>
              </div>
            </AdminForm>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[15px]">
            <CreditCard aria-hidden className="size-4 text-gold" />
            Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.payments.length === 0 ? (
            <p className="text-[13.5px] text-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {detail.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface/60 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium">
                      <Money centavos={payment.amount} currency={currency} />
                      {payment.status === "REFUNDED" ? (
                        <Badge variant="danger" className="ml-2">
                          Refund
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block text-[12px] text-faint">
                      {payment.method} · {formatEntryDate(payment.paymentDate, timezone)}
                      {payment.recordedBy ? ` · ${payment.recordedBy}` : ""}
                      {payment.referenceNumber ? ` · ${payment.referenceNumber}` : ""}
                    </span>
                  </span>
                  {canManage ? (
                    <PromptDeletePayment paymentId={payment.id} amount={payment.amount} currency={currency} timezone={timezone} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PromptDeletePayment({
  paymentId,
  amount,
  currency,
  timezone,
}: {
  paymentId: string;
  amount: number;
  currency: string;
  timezone: string;
}) {
  return (
    <PromptActionButton
      href={`/api/admin/payments/${paymentId}`}
      label={
        <>
          <Trash2 aria-hidden />
          Remove
        </>
      }
      title={`Remove this entry of ${formatMoney(amount, { currency })}?`}
      description="Use this only when the entry itself was a mistake. A genuine refund should be recorded as a refund instead, so the ledger still adds up."
      askForReason={false}
      method="DELETE"
      successMessage="Entry removed."
      triggerVariant="ghost"
      destructive
    />
  );
}

function MovePanel({
  reservationId,
  detail,
  rooms,
  currency,
  enabled,
}: {
  reservationId: string;
  detail: ReservationDetail;
  rooms: Props["rooms"];
  currency: string;
  enabled: boolean;
}) {
  const action = useAdminAction<{ message: string }>(`/api/admin/reservations/${reservationId}/move`);
  const [form, setForm] = React.useState({
    roomId: detail.roomId ?? rooms[0]?.id ?? "",
    date: detail.reservation.date,
    startTime: detail.reservation.startTime,
    durationMinutes: String(detail.reservation.durationMinutes),
    reason: "",
  });

  const selected = rooms.find((room) => room.id === form.roomId);
  const preview =
    selected && form.durationMinutes
      ? Math.round((selected.hourlyRate * Number(form.durationMinutes || 0)) / 60)
      : null;

  if (!enabled) {
    return (
      <Card>
        <CardContent className="text-[13.5px] text-muted">
          Your role can view bookings but not move them.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <ArrowLeftRight aria-hidden className="size-4 text-gold" />
          Move this booking
        </CardTitle>
        {preview !== null && preview !== detail.reservation.amount ? (
          <Badge variant="gold">
            New price <Money centavos={preview} currency={currency} />
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        <p className="pb-3 text-[13px] leading-relaxed text-muted">
          Availability, capacity and the closing-hour rule are all re-checked when you save — the same
          rules the website applies. The slot is released and re-held atomically, so two staff cannot
          move the party into the same space twice.
        </p>
        <AdminForm
          submitLabel="Move booking"
          error={action.error}
          onSubmit={async () => {
            const result = await action.run(form);
            if (!result.ok) return;
            const { toast } = await import("sonner");
            toast.success((result.data as { message?: string }).message ?? "Moved.");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="move-room" label="Space" error={action.fields.roomId}>
              <select
                id="move-room"
                className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none sm:min-h-10"
                value={form.roomId}
                onChange={(event) => setForm((prev) => ({ ...prev, roomId: event.target.value }))}
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} · seats {room.capacity}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="move-duration" label="Duration (minutes)" error={action.fields.durationMinutes} hint={selected ? `min ${selected.minimumDuration}` : undefined}>
              <Input
                id="move-duration"
                type="number"
                min={30}
                max={720}
                step={30}
                value={form.durationMinutes}
                onChange={(event) => setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))}
              />
            </FormField>
            <FormField id="move-date" label="Date" error={action.fields.date}>
              <Input
                id="move-date"
                type="date"
                value={form.date}
                onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
              />
            </FormField>
            <FormField id="move-time" label="Start time" error={action.fields.startTime}>
              <TimeSelect
                id="move-time"
                value={form.startTime}
                onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))}
              />
            </FormField>
            <FormField
              id="move-reason"
              label="Why is it moving?"
              hint="Required — goes in the timeline"
              error={action.fields.reason}
              className="sm:col-span-2"
              required
            >
              <Textarea
                id="move-reason"
                rows={2}
                maxLength={500}
                value={form.reason}
                placeholder="Bigger party called ahead…"
                onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
              />
            </FormField>
          </div>
        </AdminForm>
      </CardContent>
    </Card>
  );
}

function NotePanel({
  reservationId,
  detail,
  enabled,
}: {
  reservationId: string;
  detail: ReservationDetail;
  enabled: boolean;
}) {
  const action = useAdminAction(`/api/admin/reservations/${reservationId}/note`);
  const [body, setBody] = React.useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Internal notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {detail.notes.length === 0 ? (
          <p className="text-[13.5px] text-muted">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.notes
              .slice()
              .reverse()
              .map((note) => (
                <li key={note.id} className="rounded-md border border-line bg-surface/60 px-3 py-2">
                  <p className="text-[13.5px] leading-relaxed text-foreground">{note.body}</p>
                  <p className="pt-1 text-[11.5px] text-faint">
                    {note.author ?? "System"} ·{" "}
                    {new Date(note.createdAt).toLocaleString("en-PH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                  </p>
                </li>
              ))}
          </ul>
        )}

        {enabled ? (
          <AdminForm
            submitLabel="Add note"
            error={action.error}
            onSubmit={async () => {
              if (body.trim().length < 2) return;
              const result = await action.run({ body });
              if (!result.ok) return;
              setBody("");
              const { toast } = await import("sonner");
              toast.success("Note added.");
            }}
          >
            <FormField id="note-body" label="Add a note" error={action.fields.body} hint="Never shown to the guest">
              <Textarea
                id="note-body"
                rows={3}
                maxLength={1000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Prefers the corner booth, pays by GCash…"
              />
            </FormField>
          </AdminForm>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className="pt-0.5 text-[13.5px] text-foreground">{value}</dd>
    </div>
  );
}


function formatEntryDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
