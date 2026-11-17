import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody } from "@/lib/api/admin";
import { readSettings, updateSettings } from "@/lib/services/admin/settings";

/**
 * Club settings. One document drives the site copy, the opening hours and the booking rules, so this is the highest-leverage screen in the console.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.SETTINGS_VIEW,
  rate: { bucket: "admin:settings:read", limit: 240, windowMs: 5 * 60_000 },
  run: async () => ({ settings: await readSettings() }),
});

export const PUT = adminRoute({
  permission: PERMISSIONS.SETTINGS_MANAGE,
  mutating: true,
  rate: { bucket: "admin:settings:update", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, actor }) => {
    const body = await readBody(request);
    return updateSettings(body, actor);
  },
});
