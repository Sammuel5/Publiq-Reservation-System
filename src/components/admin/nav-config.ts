import {
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  ServerCog,
  Settings,
  Shield,
  Sofa,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PERMISSIONS, type Permission } from "@/config/app";

export type AdminNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
  /** Routes that do not exist yet are rendered disabled, never as dead links. */
  available: boolean;
  phase?: number;
  /** Shown next to the label when the section is small enough to not need its own page. */
  hint?: string;
};

/**
 * Single navigation source of truth for the sidebar, the mobile drawer and the
 * breadcrumb resolver.
 *
 * Items are also filtered by permission in `AdminShell`: a Staff member never
 * sees "Team" or "Settings → manage", so the console does not litter itself with
 * links that would only produce a 403.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
    permission: PERMISSIONS.DASHBOARD_VIEW,
    available: true,
  },
  {
    label: "Reservations",
    href: "/admin/reservations",
    icon: CalendarDays,
    permission: PERMISSIONS.RESERVATION_VIEW,
    available: true,
  },
  {
    label: "Seating bookings",
    href: "/admin/seating-bookings",
    icon: CalendarDays,
    permission: PERMISSIONS.RESERVATION_VIEW,
    available: true,
  },
  {
    label: "Night grid",
    href: "/admin/calendar",
    icon: LayoutDashboard,
    permission: PERMISSIONS.RESERVATION_VIEW,
    available: true,
    hint: "One night, all spaces",
  },
  {
    label: "Seating",
    href: "/admin/rooms",
    icon: Sofa,
    permission: PERMISSIONS.ROOM_VIEW,
    available: true,
  },
  {
    label: "Blocked dates",
    href: "/admin/blocks",
    icon: Shield,
    permission: PERMISSIONS.RESERVATION_EDIT,
    available: true,
  },
  {
    label: "Customers",
    href: "/admin/customers",
    icon: Users,
    permission: PERMISSIONS.CUSTOMER_VIEW,
    available: true,
  },
  {
    label: "Payments",
    href: "/admin/payments",
    icon: CreditCard,
    permission: PERMISSIONS.PAYMENT_VIEW,
    available: true,
  },
  {
    label: "Settings",
    href: "/admin/settings",
    icon: Settings,
    permission: PERMISSIONS.SETTINGS_VIEW,
    available: true,
  },
  {
    label: "Team",
    href: "/admin/team",
    icon: Users,
    permission: PERMISSIONS.ADMIN_MANAGE,
    available: true,
  },
  {
    label: "System",
    href: "/admin/system",
    icon: ServerCog,
    permission: PERMISSIONS.SYSTEM_VIEW,
    available: true,
    hint: "Indexes, DB health, auth matrix",
  },
];

export function titleForPath(pathname: string): string {
  const match = [...ADMIN_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return match?.label ?? "Admin";
}
