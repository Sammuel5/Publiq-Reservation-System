import { cn } from "@/lib/utils/cn";

/**
 * Reservation status badge — single source of truth for status colours and
 * labels across the customer site, admin tables and calendar.
 *
 * Pending amber · Confirmed blue · Checked In green · Completed gray ·
 * Cancelled / Rejected red · No-show dark gray · Expired muted.
 */

export const RESERVATION_STATUS_META = {
  PENDING: { label: "Pending", tone: "warning" },
  CONFIRMED: { label: "Confirmed", tone: "info" },
  CHECKED_IN: { label: "Checked In", tone: "success" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
  NO_SHOW: { label: "No-show", tone: "dark" },
  EXPIRED: { label: "Expired", tone: "muted" },
} as const;

export type ReservationStatusKey = keyof typeof RESERVATION_STATUS_META;

const TONE_CLASSES: Record<string, string> = {
  warning: "border-warning/35 bg-warning/12 text-warning",
  info: "border-info/35 bg-info/12 text-info",
  success: "border-success/35 bg-success/12 text-success",
  neutral: "border-line-strong bg-card-elevated text-muted",
  danger: "border-danger/35 bg-danger/12 text-danger",
  dark: "border-[#3f3f46] bg-[#27272a] text-[#a1a1aa]",
  muted: "border-line bg-surface text-faint",
};

/** Solid dot colours, used by the reservation calendar. */
export const STATUS_DOT_CLASSES: Record<string, string> = {
  warning: "bg-warning",
  info: "bg-info",
  success: "bg-success",
  neutral: "bg-faint",
  danger: "bg-danger",
  dark: "bg-[#52525b]",
  muted: "bg-[#3f3f46]",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ReservationStatusKey;
  className?: string;
}) {
  const meta = RESERVATION_STATUS_META[status] ?? RESERVATION_STATUS_META.PENDING;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT_CLASSES[meta.tone])} />
      {meta.label}
    </span>
  );
}

export function statusLabel(status: ReservationStatusKey): string {
  return RESERVATION_STATUS_META[status]?.label ?? status;
}
