import { cn } from "@/lib/utils/cn";

/** Consistent section heading + actions row for every admin screen. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        <span aria-hidden="true" className="mb-3 block h-px w-9 bg-gold" />
        <h2 className="font-display text-[24px] font-semibold leading-tight tracking-tight text-foreground sm:text-[26px]">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  dataStatId,
}: {
  label: string;
  value: string | number;
  hint?: React.ReactNode;
  tone?: "neutral" | "gold" | "warning" | "success" | "danger";
  dataStatId?: string;
}) {
  const toneClass = {
    neutral: "text-foreground",
    gold: "text-gold",
    warning: "text-warning",
    success: "text-success",
    danger: "text-danger",
  }[tone];

  return (
    <div
      data-stat={dataStatId}
      className="min-w-0 rounded-md border border-line bg-surface p-5 shadow-[inset_0_1px_0_rgba(212,188,134,0.08)]"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</p>
      <p className={cn("mt-3 text-[28px] font-semibold leading-none tracking-tight", toneClass)}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}
