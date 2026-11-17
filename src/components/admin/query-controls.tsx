import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * Filter and pagination controls built as plain HTML forms and links.
 *
 * Admin lists are read far more often than they are mutated, and a `GET` form
 * needs no client bundle at all: the URL is the state, so "back", bookmarking
 * and sharing a filtered view with a colleague all work for free.
 */

export type QueryValue = string | number | undefined | null;

export function buildQuery(
  base: Record<string, QueryValue>,
  overrides: Record<string, QueryValue> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function FilterForm({
  action,
  children,
  hidden,
  resetHref,
}: {
  action: string;
  /** Values that must survive a filter change but have no visible control. */
  hidden?: Record<string, string>;
  children: React.ReactNode;
  resetHref?: string;
}) {
  return (
    <form
      action={action}
      method="get"
      className="grid gap-3 rounded-lg border border-line bg-card/40 p-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))_auto] lg:items-end"
      data-testid="admin-filters"
    >
      {children}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {resetHref ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={resetHref}>Reset</Link>
          </Button>
        ) : null}
      </div>
      {Object.entries(hidden ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </form>
  );
}

export function FilterField({
  label,
  name,
  children,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <label className="min-w-0 space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      <span className="block" data-filter={name}>
        {children}
      </span>
    </label>
  );
}

const CONTROL =
  "w-full min-w-0 rounded-md border border-line bg-surface px-2.5 py-2 text-[13.5px] text-foreground outline-none transition-colors focus-visible:border-gold/60 focus-visible:ring-2 focus-visible:ring-gold/25";

export function SelectFilter({
  name,
  value,
  options,
}: {
  name: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select name={name} defaultValue={value ?? ""} className={cn(CONTROL, "min-h-9")} data-filter-name={name}>
      {options.map((option) => (
        <option key={`${option.value}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TextFilter({
  name,
  value,
  placeholder,
  type = "text",
}: {
  name: string;
  value?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      name={name}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      className={cn(CONTROL, "min-h-9 placeholder:text-faint/70")}
      data-filter-name={name}
    />
  );
}

export function Pager({
  page,
  totalPages,
  buildHref,
  unit = "record",
  total,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
  unit?: string;
  total: number;
}) {
  if (totalPages <= 1) {
    return (
      <p className="px-1 text-[12.5px] text-faint">
        {total} {unit}
        {total === 1 ? "" : "s"}
      </p>
    );
  }

  const pages = Array.from({ length: totalPages }, (_unused, index) => index + 1)
    .filter(
      (candidate) =>
        candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 1,
    )
    .filter((candidate, index, list) => list.indexOf(candidate) === index);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 px-1 pt-1"
    >
      <p className="text-[12.5px] text-faint">
        Page {page} of {totalPages} · {total} {unit}
        {total === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {page > 1 ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={buildHref(page - 1)} aria-label="Previous page">
              <ChevronLeft aria-hidden />
              Prev
            </Link>
          </Button>
        ) : null}
        {pages.map((candidate, index) => (
          <span key={candidate} className="flex items-center gap-1">
            {index > 0 && candidate - pages[index - 1]! > 1 ? (
              <span aria-hidden className="px-1 text-[12px] text-faint">
                …
              </span>
            ) : null}
            <Link
              href={buildHref(candidate)}
              aria-current={candidate === page ? "page" : undefined}
              className={cn(
                "grid size-9 place-items-center rounded-md border text-[13px] transition-colors",
                candidate === page
                  ? "border-gold/45 bg-gold/10 font-semibold text-gold"
                  : "border-line text-muted hover:border-line-strong hover:text-foreground",
              )}
            >
              {candidate}
            </Link>
          </span>
        ))}
        {page < totalPages ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={buildHref(page + 1)} aria-label="Next page">
              Next
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
