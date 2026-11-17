/**
 * Application-level constants that are safe to import anywhere
 * (client or server).
 */

export const APP_NAME = "PUBLIQ";
export const APP_TAGLINE = "Private rooms. Signature nights.";

/** Admin UI roles. Mirrored by the AdminUser schema enum. */
export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "STAFF"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  STAFF: "Staff",
};

/**
 * Permission matrix — foundation for role-aware authorization.
 * Phase 3 screens and Phase 4 mutations are guarded by these keys, so adding a
 * capability later only requires updating this map (plus the call site).
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard:view",
  RESERVATION_VIEW: "reservation:view",
  RESERVATION_DECIDE: "reservation:decide", // approve / reject
  RESERVATION_EDIT: "reservation:edit",
  RESERVATION_CHECK_IN: "reservation:check-in",
  RESERVATION_STATUS: "reservation:status", // check-in / complete / no-show / cancel
  ROOM_VIEW: "room:view",
  ROOM_MANAGE: "room:manage",
  CUSTOMER_VIEW: "customer:view",
  PAYMENT_VIEW: "payment:view",
  PAYMENT_RECORD: "payment:record",
  PAYMENT_MANAGE: "payment:manage",
  SETTINGS_VIEW: "settings:view",
  SETTINGS_MANAGE: "settings:manage",
  ADMIN_MANAGE: "admin:manage",
  SYSTEM_VIEW: "system:view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const STAFF_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.RESERVATION_VIEW,
  PERMISSIONS.RESERVATION_CHECK_IN,
  PERMISSIONS.PAYMENT_VIEW,
  PERMISSIONS.PAYMENT_RECORD,
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  PERMISSIONS.RESERVATION_DECIDE,
  PERMISSIONS.RESERVATION_EDIT,
  PERMISSIONS.RESERVATION_STATUS,
  PERMISSIONS.ROOM_VIEW,
  PERMISSIONS.ROOM_MANAGE,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.PAYMENT_MANAGE,
  PERMISSIONS.SETTINGS_VIEW,
  PERMISSIONS.SETTINGS_MANAGE,
];

const SUPER_ADMIN_PERMISSIONS: Permission[] = [
  ...ADMIN_PERMISSIONS,
  PERMISSIONS.ADMIN_MANAGE,
  PERMISSIONS.SYSTEM_VIEW,
];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: SUPER_ADMIN_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  STAFF: STAFF_PERMISSIONS,
};

export function roleHasPermission(
  role: AdminRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
