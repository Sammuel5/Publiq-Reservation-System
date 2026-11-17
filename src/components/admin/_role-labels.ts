import { ADMIN_ROLE_LABELS, PERMISSIONS, ROLE_PERMISSIONS, type AdminRole } from "@/config/app";

export const ROLE_LABELS: Record<AdminRole, string> = ADMIN_ROLE_LABELS;

/**
 * Human summary of each role, derived from the real permission matrix rather
 * than a hand-typed description that could drift out of sync with it.
 */
const CAPABILITY_LABELS: Partial<Record<keyof typeof PERMISSIONS, string>> = {
  RESERVATION_VIEW: "see bookings",
  RESERVATION_CHECK_IN: "check in guests",
  RESERVATION_STATUS: "close out / cancel",
  RESERVATION_DECIDE: "approve or decline bookings and cancellation requests",
  RESERVATION_EDIT: "edit and move bookings",
  ROOM_VIEW: "see spaces",
  ROOM_MANAGE: "create, edit and delete rooms",
  CUSTOMER_VIEW: "search guests",
  PAYMENT_VIEW: "see payments",
  PAYMENT_RECORD: "record payments",
  PAYMENT_MANAGE: "manage refunds and payment corrections",
  SETTINGS_VIEW: "read club settings",
  SETTINGS_MANAGE: "change club settings",
  ADMIN_MANAGE: "manage staff accounts",
  SYSTEM_VIEW: "view system information",
};

export const PERMISSION_GROUPS: Array<{ role: AdminRole; capabilities: string[] }> = (
  ["STAFF", "ADMIN", "SUPER_ADMIN"] as AdminRole[]
).map((role) => ({
  role,
  capabilities: ROLE_PERMISSIONS[role]
    .map((permission) => {
      const key = permissionKeyFor(permission);
      return key ? (CAPABILITY_LABELS[key] ?? null) : null;
    })
    .filter((label): label is string => Boolean(label)),
}));

export const PERMISSIONS_BY_ROLE: Record<AdminRole, string> = PERMISSION_GROUPS.reduce(
  (accumulator, group) => {
    accumulator[group.role] = group.capabilities.slice(0, 6).join(" · ");
    return accumulator;
  },
  {} as Record<AdminRole, string>,
);

function permissionKeyFor(value: string): keyof typeof PERMISSIONS | undefined {
  return (Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>).find(
    (key) => PERMISSIONS[key] === value,
  );
}
