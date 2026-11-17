import { PERMISSIONS } from "@/config/app";
import {
  Activity,
  CheckCircle2,
  CircleSlash,
  Database,
  KeyRound,
  ServerCog,
  ShieldCheck,
  Users,
} from "lucide-react";
import { requireAdminPermission } from "@/lib/auth/guards";
import { getSystemStatus } from "@/lib/services/system-status";
import { getClubSettings } from "@/lib/services/club-settings";
import { ADMIN_ROLE_LABELS, ROLE_PERMISSIONS } from "@/config/app";
import { formatClubDateTime } from "@/lib/utils/datetime";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/ui/empty-state";

/**
 * Phase 1 dashboard overview.
 * Every number below is read live from MongoDB — there are no hardcoded stats.
 * Reservation/room/payment analytics arrive in Phase 3, once those features exist.
 */
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await requireAdminPermission(PERMISSIONS.SYSTEM_VIEW);
  const [status, settings] = await Promise.all([
    getSystemStatus().catch(() => null),
    getClubSettings().catch(() => null),
  ]);

  if (!status) {
    return (
      <ErrorState
        title="Cannot read the database"
        description="The admin console is running, but MongoDB did not respond. Verify MONGODB_URI and network access, then reload."
      />
    );
  }

  const uniqueIndexesPresent =
    status.collections.find((c) => c.collection === "admin_users")?.indexes.includes("uniq_email") &&
    status.collections.find((c) => c.collection === "reservations")?.indexes.includes("uniq_reference") &&
    status.collections.find((c) => c.collection === "customers")?.indexes.includes("uniq_mobile") &&
    status.collections.find((c) => c.collection === "rooms")?.indexes.includes("uniq_slug");

  const ttlPresent = status.collections
    .find((c) => c.collection === "admin_sessions")
    ?.indexes.includes("ttl_expiry");

  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    {
      label: "Database connection",
      ok: status.database.connected,
      detail: status.database.connected
        ? `${status.database.database} · ${status.database.latencyMs ?? 0}ms`
        : (status.database.error ?? "unreachable"),
    },
    {
      label: "Super Admin account provisioned",
      ok: status.activeAdmins > 0,
      detail: `${status.adminUsers} admin account${status.adminUsers === 1 ? "" : "s"}`,
    },
    {
      label: "Unique indexes created",
      ok: Boolean(uniqueIndexesPresent),
      detail: uniqueIndexesPresent ? "references, email, mobile, slug" : "run npm run seed:admin",
    },
    {
      label: "Session TTL index",
      ok: Boolean(ttlPresent),
      detail: ttlPresent ? "expired sessions auto-purge" : "missing ttl_expiry",
    },
    {
      label: "Club settings initialised",
      ok: status.clubSettingsReady,
      detail: status.clubSettingsReady ? "singleton document present" : "missing",
    },
    {
      label: "Notification delivery",
      ok: status.notifications.failed === 0 && status.notifications.emailConfigured && status.notifications.smsConfigured && status.notifications.staffConfigured,
      detail: `${status.notifications.pending} queued · ${status.notifications.sending} sending · ${status.notifications.failed} failed · Email ${status.notifications.emailConfigured ? "configured" : "not configured"} · SMS ${status.notifications.smsConfigured ? "configured" : "not configured"} · Staff email ${status.notifications.staffConfigured ? "configured" : "not configured"}`,
    },
    {
      label: "Admin session active",
      ok: true,
      detail: `expires ${formatClubDateTime(session.expiresAt, settings?.timezone ?? "Asia/Manila")}`,
    },
  ];

  const permissions = ROLE_PERMISSIONS[session.user.role] ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      {/* Greeting */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
            Phase 1 · Foundation
          </p>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">
            Welcome back, {session.user.name.split(" ")[0]}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {settings?.clubName ?? "Club"} · {ADMIN_ROLE_LABELS[session.user.role]} access
          </p>
        </div>
        <Badge variant={status.database.connected ? "success" : "danger"}>
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${status.database.connected ? "bg-success" : "bg-danger"}`}
          />
          {status.database.connected ? "System healthy" : "Database offline"}
        </Badge>
      </section>

      {/* Live infrastructure stats */}
      <section aria-label="System statistics" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={Database}
          label="DB latency"
          value={status.database.connected ? `${status.database.latencyMs ?? 0} ms` : "—"}
          hint={status.database.database ?? "unavailable"}
        />
        <StatCard
          icon={Users}
          label="Admin accounts"
          value={String(status.adminUsers)}
          hint={`${status.activeAdmins} active`}
        />
        <StatCard
          icon={KeyRound}
          label="Live sessions"
          value={String(status.activeSessions)}
          hint="non-expired"
        />
        <StatCard
          icon={ServerCog}
          label="Collections"
          value={String(status.collections.length)}
          hint="models registered"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Readiness checklist */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck aria-hidden className="size-4 text-gold" />
              Foundation verification
            </CardTitle>
            <p className="text-sm text-muted">
              Live checks executed against the database on this request.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line">
              {checks.map((check) => (
                <li key={check.label} className="flex items-start gap-3 py-3">
                  {check.ok ? (
                    <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-foreground">{check.label}</p>
                    <p className="truncate text-[12px] text-faint">{check.detail}</p>
                  </div>
                  <Badge variant={check.ok ? "success" : "warning"}>
                    {check.ok ? "Pass" : "Check"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Session + permissions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity aria-hidden className="size-4 text-gold" />
              Your session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Account" value={session.user.email} />
              <Row label="Role" value={ADMIN_ROLE_LABELS[session.user.role]} />
              <Row
                label="Expires"
                value={formatClubDateTime(session.expiresAt, settings?.timezone ?? "Asia/Manila")}
              />
              <Row
                label="Last sign-in"
                value={
                  session.user.lastLoginAt
                    ? formatClubDateTime(
                        new Date(session.user.lastLoginAt),
                        settings?.timezone ?? "Asia/Manila",
                      )
                    : "—"
                }
              />
            </dl>

            <Separator />

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
                Permissions ({permissions.length})
              </p>
              <ul className="flex min-w-0 flex-wrap gap-1.5">
                {permissions.map((permission) => (
                  <li key={permission}>
                    <span className="max-w-full break-all rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                      {permission}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Schema + indexes */}
      <Card>
        <CardHeader>
          <CardTitle>Models &amp; indexes</CardTitle>
          <p className="text-sm text-muted">
            Inspected from MongoDB on this request. Rows show registered collections and
            their live index names.
          </p>
        </CardHeader>
        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="h-10 pr-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Model
                  </th>
                  <th className="h-10 px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Collection
                  </th>
                  <th className="h-10 px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Docs
                  </th>
                  <th className="h-10 pl-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
                    Indexes
                  </th>
                </tr>
              </thead>
              <tbody>
                {status.collections.map((collection) => (
                  <tr key={collection.collection} className="border-b border-line last:border-0">
                    <td className="py-3 pr-4 font-medium">{collection.model}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-muted">
                      {collection.collection}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted">{collection.documents}</td>
                    <td className="py-3 pl-4">
                      <div className="flex min-w-0 flex-wrap gap-1">
                        {collection.indexes.length === 0 ? (
                          <span className="text-[12px] text-faint">none yet</span>
                        ) : (
                          collection.indexes.map((index) => (
                            <span
                              key={index}
                              className="max-w-full break-all rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                            >
                              {index}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {status.collections.map((collection) => (
              <li key={collection.collection} className="min-w-0 rounded-md border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13.5px] font-semibold">{collection.model}</p>
                  <span className="text-[11px] tabular-nums text-faint">
                    {collection.documents} docs
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-faint">{collection.collection}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {collection.indexes.length === 0 ? (
                    <span className="text-[11px] text-faint">no indexes yet</span>
                  ) : (
                    collection.indexes.map((index) => (
                      <span
                        key={index}
                        className="max-w-full break-all rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted"
                      >
                        {index}
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="pb-2 text-center text-[11.5px] text-faint">
        Reservation management, spaces, customers, payments and the calendar arrive in
        Phase 3. The customer booking site arrives in Phase 2.
      </p>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          {label}
        </p>
        <Icon aria-hidden className="size-4 text-gold/80" />
      </div>
      <p className="mt-2.5 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted">{hint}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
