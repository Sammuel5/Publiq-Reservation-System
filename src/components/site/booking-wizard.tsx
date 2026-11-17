"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Lock,
  Music4,
  RefreshCw,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, calculateReservationAmount } from "@/lib/utils/money";
import { addDaysToDateString, formatClubDateLong, formatClubTime12h } from "@/lib/utils/datetime";
import { normalizeMobileNumber } from "@/lib/utils/normalize";
import { categoryLabel } from "@/components/site/room-card";

/**
 * Multi-step booking wizard.
 *
 * Steps: 1 Date & time → 2 Room → 3 Your details → 4 Review → 5 Confirmation.
 *
 * Availability is fetched from the server on every change; nothing here decides
 * whether a room is free. The final word comes from POST /api/reservations,
 * which also recalculates the price.
 */

export type WizardSettings = {
  clubName: string;
  openingTime: string;
  closingTime: string;
  timezone: string;
  minimumDuration: number;
  defaultDuration: number;
  cancellationPolicy: string;
  cancellationCutoffHours: number;
  contactNumber: string;
};

type Slot = { time: string; endTime: string; available: boolean; roomsAvailable: number };

type AvailabilityRoom = {
  slug: string;
  name: string;
  categorySlug: string;
  capacity: number;
  hourlyRate: number;
  estimatedAmount: number;
  minimumDuration: number;
  image: string | null;
  amenities: string[];
  available: boolean;
  code: string;
  message: string | null;
};

type AvailabilityResponse = {
  date: string;
  duration: number;
  operating: {
    isOpen: boolean;
    openingTime: string;
    closingTime: string;
    closed: boolean;
    reason: string | null;
  };
  slots: Slot[];
  rooms: AvailabilityRoom[];
  limits: { minLeadMinutes: number; maxAdvanceDays: number };
};

const STEPS = [
  { id: 1, label: "Date & time" },
  { id: 2, label: "Room" },
  { id: 3, label: "Your details" },
  { id: 4, label: "Review" },
  { id: 5, label: "Confirmed" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const DURATION_OPTIONS = [60, 90, 120, 180, 240, 300];

type CustomerFields = {
  fullName: string;
  mobileNumber: string;
  email: string;
  guestCount: string;
  specialRequests: string;
};

type FieldErrors = Partial<Record<keyof CustomerFields | "acceptPolicy" | "form", string>>;

export function BookingWizard({
  settings,
  initial,
  today,
  maxDate,
}: {
  settings: WizardSettings;
  initial: { room?: string; date?: string; time?: string };
  today: string;
  maxDate: string;
}) {
  const router = useRouter();

  const [step, setStep] = React.useState<StepId>(1);
  const [date, setDate] = React.useState(initial.date ?? today);
  const [duration, setDuration] = React.useState(settings.defaultDuration);
  const [guestCount, setGuestCount] = React.useState("4");
  const [startTime, setStartTime] = React.useState<string | null>(initial.time ?? null);
  const [roomSlug, setRoomSlug] = React.useState<string | null>(initial.room ?? null);

  const [customer, setCustomer] = React.useState<CustomerFields>({
    fullName: "",
    mobileNumber: "",
    email: "",
    guestCount: "4",
    specialRequests: "",
  });
  const [accepted, setAccepted] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const [dayData, setDayData] = React.useState<AvailabilityResponse | null>(null);
  const [dayState, setDayState] = React.useState<"idle" | "loading" | "error">("loading");
  const [roomData, setRoomData] = React.useState<AvailabilityRoom[] | null>(null);
  const [roomState, setRoomState] = React.useState<"idle" | "loading" | "error">("idle");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const guests = Number(customer.guestCount) || Number(guestCount) || 1;

  // --- Step 1 data: slots for the chosen date + duration -------------------
  const loadDay = React.useCallback(
    async (signal?: AbortSignal) => {
      setDayState("loading");
      try {
        const query = new URLSearchParams({ date, duration: String(duration) });
        const response = await fetch(`/api/availability?${query}`, { signal });
        if (!response.ok) throw new Error("availability failed");
        const payload = (await response.json()) as AvailabilityResponse;
        setDayData(payload);
        setDayState("idle");
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setDayState("error");
      }
    },
    [date, duration],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void loadDay(controller.signal);
    return () => controller.abort();
  }, [loadDay]);

  // Drop a selected time that is no longer offered after a date/duration change.
  React.useEffect(() => {
    if (!dayData || !startTime) return;
    const stillValid = dayData.slots.some((slot) => slot.time === startTime && slot.available);
    if (!stillValid) {
      setStartTime(null);
      setRoomSlug(null);
      setRoomData(null);
    }
  }, [dayData, startTime]);

  // --- Step 2 data: rooms available for the chosen window ------------------
  const loadRooms = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!startTime) return;
      setRoomState("loading");
      try {
        const query = new URLSearchParams({
          date,
          duration: String(duration),
          startTime,
          guests: String(guests),
        });
        const response = await fetch(`/api/availability?${query}`, { signal });
        if (!response.ok) throw new Error("availability failed");
        const payload = (await response.json()) as AvailabilityResponse;
        setRoomData(payload.rooms);
        setRoomState("idle");
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setRoomState("error");
      }
    },
    [date, duration, startTime, guests],
  );

  React.useEffect(() => {
    if (step < 2) return;
    const controller = new AbortController();
    void loadRooms(controller.signal);
    return () => controller.abort();
  }, [loadRooms, step]);

  const selectedRoom = React.useMemo(
    () => roomData?.find((room) => room.slug === roomSlug) ?? null,
    [roomData, roomSlug],
  );

  const estimatedAmount = selectedRoom
    ? calculateReservationAmount(selectedRoom.hourlyRate, duration)
    : 0;

  const endTime = React.useMemo(() => {
    if (!startTime) return null;
    const [hours, minutes] = startTime.split(":").map(Number);
    const total = (hours ?? 0) * 60 + (minutes ?? 0) + duration;
    return `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }, [startTime, duration]);

  // --- Navigation ----------------------------------------------------------
  function goToStep(next: StepId) {
    setStep(next);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleDateChange(value: string) {
    setDate(value);
    setStartTime(null);
    setRoomSlug(null);
  }

  function validateDetails(): boolean {
    const next: FieldErrors = {};
    if (customer.fullName.trim().length < 2) next.fullName = "Enter your full name.";
    if (!normalizeMobileNumber(customer.mobileNumber)) {
      next.mobileNumber = "Enter a valid PH mobile number (e.g. 0917 123 4567).";
    }
    const guestsNumber = Number(customer.guestCount);
    if (!Number.isInteger(guestsNumber) || guestsNumber < 1) {
      next.guestCount = "Enter the number of guests.";
    } else if (selectedRoom && guestsNumber > selectedRoom.capacity) {
      next.guestCount = `This room fits up to ${selectedRoom.capacity} guests.`;
    }
    if (customer.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customer.email.trim())) {
      next.email = "Enter a valid email address.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!selectedRoom || !startTime) return;
    if (!accepted) {
      setErrors({ acceptPolicy: "Please accept the cancellation policy." });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setErrors({});

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomSlug: selectedRoom.slug,
          date,
          startTime,
          durationMinutes: duration,
          fullName: customer.fullName,
          mobileNumber: customer.mobileNumber,
          email: customer.email.trim(),
          guestCount: Number(customer.guestCount),
          specialRequests: customer.specialRequests.trim(),
          acceptPolicy: true,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            reservation?: { reference: string };
            accessToken?: string;
            error?: { message?: string; code?: string; details?: unknown };
          }
        | null;

      if (!response.ok || !payload?.reservation?.reference) {
        const message =
          payload?.error?.message ??
          "We could not complete your reservation. Please try again.";

        setSubmitError(message);

        // A conflict means someone took the room: send the customer back to the
        // room list with fresh availability.
        if (response.status === 409) {
          setRoomSlug(null);
          await loadRooms();
          goToStep(2);
        }
        return;
      }

      goToStep(5);
      router.push(
        `/confirmation/${payload.reservation.reference}?t=${payload.accessToken ?? ""}`,
      );
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canContinueStep1 = Boolean(startTime) && dayState === "idle";
  const canContinueStep2 = Boolean(roomSlug) && roomState === "idle";

  return (
    <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:gap-10">
      <div className="min-w-0">
        <WizardProgress step={step} />

        <div className="mt-6 rounded-lg border border-line bg-card p-5 sm:p-7">
          {/* ------------------------------------------------------- step 1 -- */}
          {step === 1 ? (
            <section aria-labelledby="step-date-time">
              <StepHeading
                id="step-date-time"
                title="When are you coming in?"
                body={`Choose a date, how long you need the room, and your party size. We're open ${formatClubTime12h(settings.openingTime)}–${formatClubTime12h(settings.closingTime)}.`}
              />

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <FormField id="date" label="Reservation date" required>
                  <Input
                    type="date"
                    value={date}
                    min={today}
                    max={maxDate}
                    onChange={(event) => handleDateChange(event.target.value)}
                  />
                </FormField>

                <FormField
                  id="guestCount"
                  label="Number of guests"
                  required
                  hint="Used to match room capacity"
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={customer.guestCount}
                    onChange={(event) => {
                      setCustomer((prev) => ({ ...prev, guestCount: event.target.value }));
                      setGuestCount(event.target.value);
                    }}
                  />
                </FormField>
              </div>

              <fieldset className="mt-5">
                <legend className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">
                  Duration
                </legend>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {DURATION_OPTIONS.map((minutes) => {
                    const disabled = minutes < settings.minimumDuration;
                    return (
                      <button
                        key={minutes}
                        type="button"
                        disabled={disabled}
                        onClick={() => setDuration(minutes)}
                        aria-pressed={duration === minutes}
                        className={cn(
                          "min-h-11 rounded-md border px-4 text-[13px] font-medium transition-colors",
                          duration === minutes
                            ? "border-gold/60 bg-gold/15 text-gold"
                            : "border-line text-muted hover:border-line-strong hover:text-foreground",
                          disabled && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {minutes / 60 < 1
                          ? `${minutes} min`
                          : `${minutes / 60} hr${minutes / 60 > 1 ? "s" : ""}`}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted">
                    Start time
                  </h3>
                  {dayState === "idle" && dayData ? (
                    <span className="text-[11.5px] text-faint">
                      {dayData.slots.filter((slot) => slot.available).length} slots open
                    </span>
                  ) : null}
                </div>

                {dayState === "loading" ? (
                  <SlotSkeleton />
                ) : dayState === "error" ? (
                  <Alert tone="danger" title="Could not load availability" className="mt-3">
                    <span>Please check your connection and try again.</span>
                    <button
                      type="button"
                      onClick={() => void loadDay()}
                      className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground underline"
                    >
                      <RefreshCw className="size-3.5" /> Retry
                    </button>
                  </Alert>
                ) : dayData && !dayData.operating.isOpen ? (
                  <Alert tone="warning" title="We're closed on this date" className="mt-3">
                    {dayData.operating.reason ?? "Please choose another date."}
                  </Alert>
                ) : dayData && dayData.slots.length === 0 ? (
                  <Alert tone="warning" title="No slots for this duration" className="mt-3">
                    Try a shorter duration or another date.
                  </Alert>
                ) : (
                  <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {(dayData?.slots ?? []).map((slot) => (
                      <button
                        key={slot.time}
                        type="button"
                        data-testid="slot-option"
                        disabled={!slot.available}
                        onClick={() => {
                          setStartTime(slot.time);
                          setRoomSlug(null);
                          setRoomData(null);
                        }}
                        aria-pressed={startTime === slot.time}
                        title={
                          slot.available
                            ? `${slot.roomsAvailable} room(s) available`
                            : "Fully booked"
                        }
                        className={cn(
                          "min-h-11 rounded-md border px-2 text-[12.5px] font-medium transition-colors",
                          startTime === slot.time
                            ? "border-gold/60 bg-gold/15 text-gold"
                            : slot.available
                              ? "border-line text-[#d4d4d8] hover:border-line-strong hover:text-foreground"
                              : "cursor-not-allowed border-line/60 text-faint/50 line-through",
                        )}
                      >
                        {formatClubTime12h(slot.time)}
                      </button>
                    ))}
                  </div>
                )}

                {dayData ? (
                  <p className="mt-3 text-[11.5px] text-faint">
                    {formatClubDateLong(date)} · {duration} minutes
                    {startTime && endTime ? ` · ${formatClubTime12h(startTime)} – ${formatClubTime12h(endTime)}` : ""}
                  </p>
                ) : null}
              </div>

              <WizardFooter>
                <Button
                  size="lg"
                  disabled={!canContinueStep1}
                  onClick={() => goToStep(2)}
                  className="w-full sm:w-auto"
                >
                  Choose a room
                  <ArrowRight className="size-4" />
                </Button>
              </WizardFooter>
            </section>
          ) : null}

          {/* ------------------------------------------------------- step 2 -- */}
          {step === 2 ? (
            <section aria-labelledby="step-room">
              <StepHeading
                id="step-room"
                title="Pick your room"
                body="Only rooms that fit your party and are free for your slot are shown as available."
              />

              <div className="mt-5 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-[12.5px] text-muted">
                <CalendarDays className="size-3.5 text-gold" />
                {formatClubDateLong(date)}
                <span className="text-faint">·</span>
                <Clock className="size-3.5 text-gold" />
                {startTime ? formatClubTime12h(startTime) : "—"}
                {endTime ? ` – ${formatClubTime12h(endTime)}` : ""}
                <span className="text-faint">·</span>
                <Users className="size-3.5 text-gold" />
                {guests} guests
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="ml-auto text-[12px] font-medium text-gold underline-offset-4 hover:underline"
                >
                  Change
                </button>
              </div>

              {roomState === "loading" ? (
                <div className="mt-4 space-y-3">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-24 w-full" />
                  ))}
                </div>
              ) : roomState === "error" ? (
                <Alert tone="danger" title="Could not load rooms" className="mt-4">
                  <button
                    type="button"
                    onClick={() => void loadRooms()}
                    className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-medium underline"
                  >
                    <RefreshCw className="size-3.5" /> Retry
                  </button>
                </Alert>
              ) : roomData && roomData.length === 0 ? (
                <Alert tone="warning" title="No rooms configured" className="mt-4">
                  Please call us on {settings.contactNumber} and we&apos;ll book you in.
                </Alert>
              ) : (
                <ul className="mt-4 space-y-3">
                  {(roomData ?? []).map((room) => {
                    const selected = roomSlug === room.slug;
                    return (
                      <li key={room.slug}>
                        <button
                          type="button"
                          data-testid="room-option"
                          disabled={!room.available}
                          onClick={() => {
                            setRoomSlug(room.slug);
                            setCustomer((prev) => ({ ...prev, guestCount: String(guests) }));
                          }}
                          aria-pressed={selected}
                          className={cn(
                            "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
                            selected
                              ? "border-gold/60 bg-gold/[0.07]"
                              : "border-line hover:border-line-strong",
                            !room.available && "cursor-not-allowed opacity-60 hover:border-line",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={room.image ?? "/images/room-standard.jpg"}
                            alt=""
                            className="size-20 shrink-0 rounded-md object-cover sm:size-24"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[14px] font-semibold">{room.name}</p>
                              <Badge variant={room.categorySlug === "standard" ? "neutral" : "gold"}>
                                {categoryLabel(room.categorySlug)}
                              </Badge>
                              {!room.available ? (
                                <Badge variant="danger">{room.message ?? "Unavailable"}</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-[12px] text-faint">
                              Up to {room.capacity} guests · min {room.minimumDuration} min
                            </p>
                            <p className="mt-2 text-[13px]">
                              <span className="font-semibold">
                                {formatMoney(room.estimatedAmount)}
                              </span>
                              <span className="text-faint">
                                {" "}
                                for {duration} min · {formatMoney(room.hourlyRate)}/hr
                              </span>
                            </p>
                          </div>
                          <span
                            aria-hidden
                            className={cn(
                              "mt-1 grid size-5 shrink-0 place-items-center rounded-full border",
                              selected
                                ? "border-gold bg-gold text-[#1a1408]"
                                : "border-line-strong",
                            )}
                          >
                            {selected ? <Check className="size-3" /> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <WizardFooter>
                <Button variant="ghost" size="lg" onClick={() => goToStep(1)}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  size="lg"
                  disabled={!canContinueStep2}
                  onClick={() => goToStep(3)}
                  className="w-full sm:w-auto"
                >
                  Continue
                  <ArrowRight className="size-4" />
                </Button>
              </WizardFooter>
            </section>
          ) : null}

          {/* ------------------------------------------------------- step 3 -- */}
          {step === 3 ? (
            <section aria-labelledby="step-details">
              <StepHeading
                id="step-details"
                title="Your details"
                body="We use these to confirm the booking and to find it for you later. No account needed."
              />

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <FormField
                  id="fullName"
                  label="Full name"
                  required
                  error={errors.fullName}
                  className="sm:col-span-2"
                >
                  <Input
                    autoComplete="name"
                    placeholder="Juan Dela Cruz"
                    value={customer.fullName}
                    onChange={(event) => {
                      setCustomer((prev) => ({ ...prev, fullName: event.target.value }));
                      if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
                    }}
                  />
                </FormField>

                <FormField
                  id="mobileNumber"
                  label="Mobile number"
                  required
                  hint="For confirmation"
                  error={errors.mobileNumber}
                >
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0917 123 4567"
                    value={customer.mobileNumber}
                    onChange={(event) => {
                      setCustomer((prev) => ({ ...prev, mobileNumber: event.target.value }));
                      if (errors.mobileNumber) {
                        setErrors((prev) => ({ ...prev, mobileNumber: undefined }));
                      }
                    }}
                  />
                </FormField>

                <FormField
                  id="guests"
                  label="Guests"
                  required
                  error={errors.guestCount}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={customer.guestCount}
                    onChange={(event) => {
                      setCustomer((prev) => ({ ...prev, guestCount: event.target.value }));
                      if (errors.guestCount) setErrors((prev) => ({ ...prev, guestCount: undefined }));
                    }}
                  />
                </FormField>

                <FormField
                  id="email"
                  label="Email (optional)"
                  error={errors.email}
                  className="sm:col-span-2"
                >
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={customer.email}
                    onChange={(event) => {
                      setCustomer((prev) => ({ ...prev, email: event.target.value }));
                      if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                  />
                </FormField>

                <FormField
                  id="specialRequests"
                  label="Special requests (optional)"
                  hint={`${customer.specialRequests.length}/1000`}
                  className="sm:col-span-2"
                >
                  <Textarea
                    rows={3}
                    maxLength={1000}
                    placeholder="Birthday setup, cake service, extra microphones…"
                    value={customer.specialRequests}
                    onChange={(event) =>
                      setCustomer((prev) => ({ ...prev, specialRequests: event.target.value }))
                    }
                  />
                </FormField>
              </div>

              <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-faint">
                <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Your details are only used to manage this reservation. We never share them
                or show them to other guests.
              </p>

              <WizardFooter>
                <Button variant="ghost" size="lg" onClick={() => goToStep(2)}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    if (validateDetails()) goToStep(4);
                  }}
                >
                  Review booking
                  <ArrowRight className="size-4" />
                </Button>
              </WizardFooter>
            </section>
          ) : null}

          {/* ------------------------------------------------------- step 4 -- */}
          {step === 4 && selectedRoom && startTime ? (
            <section aria-labelledby="step-review">
              <StepHeading
                id="step-review"
                title="Review your booking"
                body="Check everything below, then submit. Your room is held while our team confirms."
              />

              {submitError ? (
                <Alert tone="danger" title="We couldn't submit this reservation" className="mt-5" role="alert">
                  {submitError}
                </Alert>
              ) : null}

              <dl className="mt-5 divide-y divide-line rounded-lg border border-line bg-surface">
                <SummaryRow label="Room" value={`${selectedRoom.name} · ${categoryLabel(selectedRoom.categorySlug)}`} />
                <SummaryRow label="Date" value={formatClubDateLong(date)} />
                <SummaryRow
                  label="Time"
                  value={`${formatClubTime12h(startTime)} – ${endTime ? formatClubTime12h(endTime) : "—"} (${duration} min)`}
                />
                <SummaryRow label="Guests" value={`${customer.guestCount} guest(s)`} />
                <SummaryRow label="Name" value={customer.fullName} />
                <SummaryRow label="Mobile" value={customer.mobileNumber} />
                {customer.email.trim() ? <SummaryRow label="Email" value={customer.email} /> : null}
                {customer.specialRequests.trim() ? (
                  <SummaryRow label="Requests" value={customer.specialRequests} />
                ) : null}
                <div className="flex items-baseline justify-between gap-3 p-4">
                  <dt className="text-[13px] font-medium text-muted">Estimated total</dt>
                  <dd className="text-xl font-semibold">{formatMoney(estimatedAmount)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex items-start gap-2.5 rounded-md border border-line bg-card p-3.5">
                <CreditCard aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
                <div className="text-[12.5px] leading-relaxed text-muted">
                  <p className="font-medium text-foreground">Payment at the club</p>
                  <p className="mt-0.5">
                    Nothing is charged online. Your reservation starts as{" "}
                    <span className="text-warning">Pending</span> until our team confirms it.
                  </p>
                </div>
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-3.5">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => {
                    setAccepted(event.target.checked);
                    if (event.target.checked) {
                      setErrors((prev) => ({ ...prev, acceptPolicy: undefined }));
                    }
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-[#C9A45C]"
                  aria-invalid={errors.acceptPolicy ? true : undefined}
                  aria-describedby={errors.acceptPolicy ? "policy-error" : undefined}
                />
                <span className="text-[12.5px] leading-relaxed text-muted">
                  I understand the{" "}
                  <span className="text-foreground">cancellation policy</span>:{" "}
                  {settings.cancellationPolicy}
                </span>
              </label>
              {errors.acceptPolicy ? (
                <p id="policy-error" role="alert" className="mt-1.5 text-[12.5px] font-medium text-danger">
                  {errors.acceptPolicy}
                </p>
              ) : null}

              <WizardFooter>
                <Button variant="ghost" size="lg" onClick={() => goToStep(3)} disabled={submitting}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => void handleSubmit()}
                  loading={submitting}
                >
                  {submitting ? "Holding your room" : "Submit reservation"}
                  {!submitting ? <CheckCircle2 className="size-4" /> : null}
                </Button>
              </WizardFooter>
            </section>
          ) : null}

          {/* ------------------------------------------------------- step 5 -- */}
          {step === 5 ? (
            <section className="flex flex-col items-center py-10 text-center" aria-live="polite">
              <Loader2 aria-hidden className="size-8 animate-spin text-gold" />
              <h2 className="mt-4 text-lg font-semibold">Confirming your reservation…</h2>
              <p className="mt-1 text-[13px] text-muted">
                Taking you to your reference number.
              </p>
            </section>
          ) : null}
        </div>

        <p className="mt-4 text-center text-[11.5px] text-faint lg:text-left">
          Need help? Call{" "}
          <a href={`tel:${settings.contactNumber.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-9 items-center text-gold underline-offset-4 hover:underline">
            {settings.contactNumber}
          </a>{" "}
          — our team can book you in directly.
        </p>
      </div>

      {/* ---------------------------------------------------------- summary -- */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-lg border border-line bg-card p-5">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
            <Music4 className="size-3.5 text-gold" />
            Your reservation
          </h2>

          <dl className="mt-4 space-y-3 text-[13px]">
            <SummaryLine label="Date" value={formatClubDateLong(date)} />
            <SummaryLine
              label="Time"
              value={
                startTime
                  ? `${formatClubTime12h(startTime)}${endTime ? ` – ${formatClubTime12h(endTime)}` : ""}`
                  : "Not selected"
              }
            />
            <SummaryLine label="Duration" value={`${duration} minutes`} />
            <SummaryLine label="Guests" value={`${customer.guestCount || guestCount}`} />
            <SummaryLine label="Room" value={selectedRoom?.name ?? "Not selected"} />
          </dl>

          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-muted">Estimated total</span>
              <span className="text-lg font-semibold">
                {estimatedAmount > 0 ? formatMoney(estimatedAmount) : "—"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-faint">
              Final amount is confirmed by our team. Pay at the club.
            </p>
          </div>

          <ul className="mt-4 space-y-2 border-t border-line pt-4 text-[11.5px] text-muted">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-gold" />
              Live availability, no double bookings
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-gold" />
              Instant reference number
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-gold" />
              Cancel online subject to policy
            </li>
          </ul>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface/60 p-4">
          <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-faint">
            <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            Reservations are held for a limited time while pending. Our team confirms by
            text or call.
          </p>
        </div>

        <p className="mt-4 text-center text-[11.5px] text-faint">
          Already booked?{" "}
          <Link href="/lookup" className="inline-flex min-h-9 items-center text-gold underline-offset-4 hover:underline">
            Check your reservation
          </Link>
        </p>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces -- */

function WizardProgress({ step }: { step: StepId }) {
  return (
    <nav aria-label="Booking progress">
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEPS.map((item, index) => {
          const done = step > item.id;
          const current = step === item.id;
          return (
            <li key={item.id} className="flex flex-1 items-center gap-1.5 sm:gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors",
                    done && "border-gold bg-gold text-[#1a1408]",
                    current && "border-gold text-gold",
                    !done && !current && "border-line text-faint",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : item.id}
                </span>
                <span
                  className={cn(
                    "truncate text-[11.5px] font-medium sm:text-[12.5px]",
                    current ? "text-foreground" : "hidden text-faint sm:block",
                  )}
                >
                  {item.label}
                </span>
              </div>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px flex-1 rounded-full transition-colors",
                    step > item.id ? "bg-gold/60" : "bg-line",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] text-faint sm:hidden">
        Step {step} of {STEPS.length} · {STEPS.find((item) => item.id === step)?.label}
      </p>
    </nav>
  );
}

function StepHeading({
  id,
  title,
  body,
}: {
  id: string;
  title: string;
  body: string;
}) {
  return (
    <header>
      <h2 id={id} className="font-display text-2xl tracking-tight sm:text-[26px]">
        {title}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
    </header>
  );
}

function WizardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-7 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-between">
      {children}
    </div>
  );
}

function SlotSkeleton() {
  return (
    <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-11" />
      ))}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 p-4">
      <dt className="shrink-0 text-[12.5px] text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[13.5px] font-medium">{value}</dd>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

export { addDaysToDateString };
