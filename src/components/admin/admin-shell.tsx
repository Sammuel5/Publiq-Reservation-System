"use client";

import { PubliqEmblem } from "@/components/brand/publiq-logo";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ADMIN_ROLE_LABELS } from "@/config/app";
import { ADMIN_NAV, titleForPath } from "@/components/admin/nav-config";
import type { Permission } from "@/config/app";
import { LogoutButton } from "@/components/admin/logout-button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

export type AdminShellUser = {
  name: string;
  email: string;
  role: keyof typeof ADMIN_ROLE_LABELS;
  /**
   * Capabilities this account holds. The sidebar filters on them so a Staff
   * member is not offered links that can only answer 403.
   */
  permissions?: readonly Permission[];
};

/**
 * Admin dashboard shell: fixed sidebar on desktop, Radix drawer on mobile.
 * The shell is a client component only for drawer state and active-link
 * highlighting; all authorization happens on the server.
 */
export function AdminShell({
  user,
  clubName,
  todayLabel,
  children,
}: {
  user: AdminShellUser;
  clubName: string;
  /** Pre-formatted on the server: see the note in the dashboard layout. */
  todayLabel: string;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const pathname = usePathname();
  const pageTitle = titleForPath(pathname);
  const allowed = React.useMemo(
    () => new Set<Permission>(user.permissions ?? []),
    [user.permissions],
  );
  const navItems = ADMIN_NAV.filter((item) => allowed.has(item.permission));

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-[#0c0c0c] lg:flex print:hidden">
        <SidebarContent pathname={pathname} user={user} clubName={clubName} items={navItems} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="p-0" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Admin navigation</SheetTitle>
          <SidebarContent pathname={pathname} user={user} clubName={clubName} items={navItems} />
        </SheetContent>
      </Sheet>

      {/* Printing a booking is a front-desk routine: the slip has to come out as
          the slip, so none of the chrome — sidebar, header or menu button — does. */}
      <div className="lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-[#101010]/95 px-4 backdrop-blur-md sm:px-6 print:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="grid size-11 place-items-center rounded-md border border-line text-muted transition-colors hover:text-foreground lg:hidden"
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
          >
            <Menu className="size-5" />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight sm:text-base">
              {pageTitle}
            </h1>
            <p className="truncate text-[11px] text-faint">{todayLabel}</p>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <Badge variant="gold">
              <ShieldCheck className="size-3" />
              {ADMIN_ROLE_LABELS[user.role]}
            </Badge>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden text-right sm:block">
              <p className="text-[13px] font-medium leading-tight">{user.name}</p>
              <p className="text-[11px] leading-tight text-faint">{user.email}</p>
            </div>
            <div
              aria-hidden
              className="grid size-9 place-items-center rounded-full border border-line bg-card text-[12px] font-semibold text-gold"
            >
              {initials(user.name)}
            </div>
          </div>
        </header>

        <main id="main-content" className="mx-auto max-w-[1600px] px-4 pb-16 pt-6 sm:px-8 sm:pt-8">
          <div role="status" className="mb-5 rounded-lg border border-gold/30 bg-gold/5 p-4 text-sm leading-relaxed text-muted">Seating conversion in progress: the catalog and bookings below still contain legacy demo data and hourly rules. Do not use them for real reservations.</div>
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  pathname,
  user,
  clubName,
  items,
}: {
  pathname: string;
  user: AdminShellUser;
  clubName: string;
  items: typeof ADMIN_NAV;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gold/20 px-5 py-6">
        <PubliqEmblem className="h-10 w-9 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight">{clubName}</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-gold">Management</p>
        </div>
      </div>

      <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <p className="px-3 pb-3 pt-3 text-[10px] font-semibold uppercase tracking-[.18em] text-faint">Workspace</p>
        <ul className="space-y-1">
          {items.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            if (!item.available) {
              return (
                <li key={item.href}>
                  <span
                    aria-disabled="true"
                    title={`Available in Phase ${item.phase}`}
                    className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] text-faint/70"
                  >
                    <Icon aria-hidden className="size-4" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                      P{item.phase}
                    </span>
                  </span>
                </li>
              );
            }

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    isActive
                      ? "border-l-2 border-gold bg-gold/10 text-gold"
                      : "text-muted hover:bg-card hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-md px-2 py-2">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-card text-[11px] font-semibold text-gold"
          >
            {initials(user.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight">{user.name}</p>
            <p className="truncate text-[11px] leading-tight text-faint">
              {ADMIN_ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
        <LogoutButton />
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
