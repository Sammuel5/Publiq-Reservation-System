import { formatClubTime12h } from "@/lib/utils/datetime";
import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPermission, can } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/config/app";
import { listPayments } from "@/lib/services/admin/payments";
import { filterParams, paymentQuerySchema } from "@/lib/validation/admin";
import { getClubSettings } from "@/lib/services/club-settings";
import { addDaysToDateString } from "@/lib/utils/datetime";
import { todayInClubTime } from "@/lib/services/availability";
import { formatMoney } from "@/lib/utils/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  buildQuery,
  FilterField,
  FilterForm,
  Pager,
  SelectFilter,
  TextFilter,
} from "@/components/admin/query-controls";
import { PageHeader, StatTile } from "@/components/admin/page-section";

/**
 * The payments ledger — what the club has actually been handed.
 *
 * Booked value and collected money are different numbers on purpose: a booking
 * is "expected" the moment it is confirmed, and "collected" only when someone at
 * the counter records a receipt. The gap between them is the outstanding figure
 * a manager needs to see, not a smoothed average.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminPermission(PERMISSIONS.PAYMENT_VIEW);
  const settings = await getClubSettings();
  const raw = filterParams(await searchParams);
  const parsed = paymentQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : paymentQuerySchema.parse({});
  const ledger = await listPayments(parsed.success ? raw : {});
  const today = todayInClubTime(settings);
  const canRecord = can(session, PERMISSIONS.PAYMENT_RECORD);

  const baseHref = {
    from: ledger.window.from,
    to: ledger.window.to,
    method: query.method ?? "",
    q: query.q ?? "",
    perPage: String(query.perPage),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description={`Receipts between ${ledger.window.from} and ${ledger.window.to}. Amounts are recorded against a booking from its page — this screen is for reconciling, not for typing money in.`}
        actions={
          <span className="flex flex-wrap gap-1.5">
            {[
              { label: "Tonight", from: today, to: today },
              { label: "7 days", from: addDaysToDateString(today, -6), to: today },
              { label: "30 days", from: addDaysToDateString(today, -29), to: today },
            ].map((preset) => (
              <a
                key={preset.label}
                href={`/admin/payments?from=${preset.from}&to=${preset.to}`}
                className="min-h-9 rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-foreground"
              >
                {preset.label}
              </a>
            ))}
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          dataStatId="collected"
          label="Collected"
          value={formatMoney(ledger.totals.collected, { currency: ledger.currency })}
          tone="success"
        />
        <StatTile
          dataStatId="refunded"
          label="Refunded"
          value={formatMoney(ledger.totals.refunded, { currency: ledger.currency })}
          tone={ledger.totals.refunded > 0 ? "danger" : "neutral"}
        />
        <StatTile
          dataStatId="net"
          label="Net in window"
          value={formatMoney(ledger.totals.net, { currency: ledger.currency })}
          tone="gold"
        />
        <StatTile
          dataStatId="entries"
          label="Receipts"
          value={ledger.page.total}
          hint={Object.entries(ledger.totals.byMethod)
            .map(([method, amount]) => `${method} ${formatMoney(amount, { currency: ledger.currency })}`)
            .join(" · ") || "no methods used"}
        />
      </div>

      <FilterForm
        action="/admin/payments"
        resetHref="/admin/payments"
        hidden={{ page: "1", perPage: String(query.perPage) }}
      >
        <FilterField label="From" name="from">
          <TextFilter name="from" type="date" value={ledger.window.from} />
        </FilterField>
        <FilterField label="To" name="to">
          <TextFilter name="to" type="date" value={ledger.window.to} />
        </FilterField>
        <FilterField label="Method" name="method">
          <SelectFilter
            name="method"
            value={query.method ?? ""}
            options={[
              { value: "", label: "All methods" },
              { value: "CASH", label: "Cash" },
              { value: "GCASH", label: "GCash" },
              { value: "MAYA", label: "Maya" },
              { value: "OTHER", label: "Other" },
              { value: "REFUNDED", label: "Refunds" },
            ]}
          />
        </FilterField>
        <FilterField label="Search" name="q">
          <TextFilter name="q" value={query.q} placeholder="Reference or guest name…" />
        </FilterField>
      </FilterForm>

      <Card className="overflow-hidden">
        {ledger.page.rows.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No receipts in this window"
              description="Nothing has been recorded against bookings between these dates. Record a payment from the reservation page."
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Booking</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.page.rows.map((row) => (
                <TableRow key={row.id} data-payment={row.id}>
                  <TableCell className="text-[13px]">
                    {row.date}
                    <span className="block text-[11.5px] text-faint">{formatClubTime12h(row.time)}</span>
                  </TableCell>
                  <TableCell>
                    {row.reservationId ? (
                      <Link href={`/admin/reservations/${row.reservationId}`} className="text-[13px] text-gold hover:underline">
                        {row.reference}
                      </Link>
                    ) : (
                      <span className="text-[13px] text-faint">{row.reference}</span>
                    )}
                    <span className="block text-[11.5px] text-muted">
                      {row.customerName} · {row.roomName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.status === "REFUNDED" ? "danger" : row.status === "PARTIALLY_PAID" ? "warning" : "success"}>
                      {row.method}
                      {row.status === "PARTIALLY_PAID" ? " · deposit" : row.status === "REFUNDED" ? " · refund" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-[12.5px] text-muted">
                    {row.referenceNumber ?? row.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-[13px]">{row.recordedBy ?? "—"}</TableCell>
                  <TableCell className="text-right text-[13px] font-semibold">
                    {formatMoney(row.amount, { currency: ledger.currency })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-faint">
          {canRecord
            ? "Entries can be corrected from the booking page: record a refund for a genuine one, delete the row only when the entry itself was a mistake."
            : "Your role can read the ledger but not change it."}
        </p>
        <Pager
          page={ledger.page.page}
          totalPages={ledger.page.totalPages}
          total={ledger.page.total}
          unit="receipt"
          buildHref={(page) => `/admin/payments${buildQuery({ ...baseHref, page })}`}
        />
      </div>
    </div>
  );
}
