import { PERMISSIONS } from "@/config/app";
import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPermission } from "@/lib/auth/guards";
import { listCustomers } from "@/lib/services/admin/customers";
import { customerQuerySchema, filterParams } from "@/lib/validation/admin";
import { formatMoney } from "@/lib/utils/money";
import { getClubSettings } from "@/lib/services/club-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 * Guest book.
 *
 * A profile is created the first time a mobile number books — there is no
 * account system to sign up for, which is why the number is the identity. The
 * cancellation rate column is here because it is the number that decides whether
 * a no-deposit booking for a big group is worth honouring.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const settings = await getClubSettings();
  await requireAdminPermission(PERMISSIONS.CUSTOMER_VIEW);
  const raw = filterParams(await searchParams);
  const parsed = customerQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : customerQuerySchema.parse({});

  const result = await listCustomers(parsed.success ? raw : {});
  const baseHref = { q: query.q ?? "", sort: query.sort, perPage: String(query.perPage) };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Guests"
        description="Search by name, mobile or email. Every guest also has a self-service lookup on the website — this is the same data, from the front desk."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile dataStatId="customers" label="Profiles" value={result.totals.customers} hint="Created automatically on first booking" />
        <StatTile
          dataStatId="with-bookings"
          label="With bookings"
          value={result.page.rows.filter((row) => row.visits > 0).length}
          hint="In this page of results"
        />
        <StatTile
          dataStatId="lifetime-revenue"
          label="Lifetime value booked"
          value={formatMoney(result.totals.revenue, { currency: settings.currency })}
          tone="gold"
          hint="Confirmed, in-space and completed bookings"
        />
      </div>

      <FilterForm
        action="/admin/customers"
        resetHref="/admin/customers"
        hidden={{ perPage: String(query.perPage), page: "1" }}
      >
        <FilterField label="Search" name="q">
          <TextFilter name="q" value={query.q} placeholder="Name, 0917…, or email…" />
        </FilterField>
        <FilterField label="Sort by" name="sort">
          <SelectFilter
            name="sort"
            value={query.sort}
            options={[
              { value: "recent", label: "Newest profiles" },
              { value: "name", label: "Name A→Z" },
              { value: "visits", label: "Most visits" },
              { value: "spend", label: "Highest value" },
            ]}
          />
        </FilterField>
      </FilterForm>

      <Card className="overflow-hidden">
        {result.page.rows.length === 0 ? (
          <CardContent>
            <EmptyState
              title={query.q ? `No guest matches “${query.q}”` : "No guests yet"}
              description="A profile appears the first time a mobile number books a space."
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Visits</TableHead>
                <TableHead>Upcoming</TableHead>
                <TableHead>Cancelled</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Profile</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.page.rows.map((row) => (
                <TableRow key={row.id} data-customer={row.id}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                      {row.name}
                      {row.vip ? <Badge variant="gold">Regular</Badge> : null}
                    </span>
                    <span className="block text-[11.5px] text-faint">
                      {row.lastVisit ? `last seen ${new Date(row.lastVisit).toLocaleDateString("en-PH")}` : "no bookings yet"}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {row.mobile}
                    {row.email ? <span className="block text-[11.5px] text-faint">{row.email}</span> : null}
                  </TableCell>
                  <TableCell className="text-[13px]">{row.visits}</TableCell>
                  <TableCell className="text-[13px]">
                    {row.upcoming > 0 ? <Badge variant="info">{row.upcoming}</Badge> : <span className="text-faint">—</span>}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {row.cancelled > 0 ? (
                      <span className={row.cancelled > row.visits / 2 ? "text-danger" : undefined}>{row.cancelled}</span>
                    ) : (
                      <span className="text-faint">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px]">{formatMoney(row.spend, { currency: settings.currency })}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/customers/${row.id}`}>Open</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Pager
        page={result.page.page}
        totalPages={result.page.totalPages}
        total={result.page.total}
        unit="guest"
        buildHref={(page) => `/admin/customers${buildQuery({ ...baseHref, page })}`}
      />
    </div>
  );
}
