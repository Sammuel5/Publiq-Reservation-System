/** Read-only checks for a provisioned staging environment. Never prints env values. */
import mongoose from "mongoose";

let failures = 0, warnings = 0;
function check(ok, label) { console.log(`${ok ? "✓" : "✗"} ${label}`); if (!ok) failures++; }
function warn(ok, label) { console.log(`${ok ? "✓" : "!"} ${label}`); if (!ok) warnings++; }
const env = process.env;
const localTest = env.PREFLIGHT_ALLOW_LOCAL === "1";
let site;
try { site = new URL(env.NEXT_PUBLIC_SITE_URL ?? ""); } catch { /* reported below */ }
check(Boolean(env.MONGODB_URI && /^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)), "MongoDB connection string present");
check(Boolean(env.MONGODB_DB_NAME && /^[A-Za-z0-9_-]+$/.test(env.MONGODB_DB_NAME)), "Explicit database name present");
check(Boolean(site && (site.protocol === "https:" || (localTest && site.protocol === "http:")) && !site.username && !site.password && site.pathname === "/" && !site.search && !site.hash), "Public site URL is an HTTPS origin");
check(env.AUTH_COOKIE_SECURE !== "false", "Secure session cookies are not disabled");
check(Boolean(env.CRON_SECRET && env.CRON_SECRET.length >= 32 && /^[\x21-\x7e]+$/.test(env.CRON_SECRET)), "Cron secret has at least 32 printable, non-space characters");
warn(Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD && env.NOTIFICATION_STAFF_EMAIL), "Email and staff-notification settings present (not a delivery test)");
warn(Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER), "SMS settings present (not a delivery test)");
if (env.MONGODB_URI && env.MONGODB_DB_NAME) {
  try {
    await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 8_000, autoIndex: false });
    const db = mongoose.connection.db;
    const hello = await db.admin().command({ hello: 1 });
    check(Boolean(hello.setName || hello.msg === "isdbgrid"), "Replica set or sharded topology detected (transaction-capable topology)");
    const required = [
      ["admin_users", "uniq_email", { email: 1 }, { unique: true }],
      ["admin_sessions", "ttl_expiry", { expiresAt: 1 }, { expireAfterSeconds: 0 }],
      ["customers", "uniq_mobile", { mobileNumber: 1 }, { unique: true }],
      ["rooms", "uniq_slug", { slug: 1 }, { unique: true }],
      ["room_categories", "uniq_slug", { slug: 1 }, { unique: true }],
      ["room_slot_locks", "uniq_room_slot", { room: 1, slotStart: 1 }, { unique: true }],
      ["reservations", "uniq_reference", { reservationReference: 1 }, { unique: true }],
      ["reservations", "uniq_submission_key", { submissionKey: 1 }, { unique: true }],
      ["reservations", "pending_expiry", { status: 1, pendingExpiresAt: 1 }, {}],
      ["reservations", "room_availability", { room: 1, status: 1, startAt: 1, endAt: 1 }, {}],
      ["reservations", "notification_due", { "notifications.state": 1, "notifications.nextAttemptAt": 1 }, {}],
      ["rate_limits", "rate_limit_expiry", { expiresAt: 1 }, { expireAfterSeconds: 0 }],
    ];
    const cache = new Map();
    for (const [name, index, expectedKey, properties] of required) {
      if (!cache.has(name)) cache.set(name, await db.collection(name).indexes().catch(() => []));
      const found = cache.get(name).find((item) => item.name === index);
      const partialOk = index !== "uniq_submission_key" || found?.partialFilterExpression?.submissionKey?.$type === "string";
      check(Boolean(found && JSON.stringify(found.key) === JSON.stringify(expectedKey) && partialOk && Object.entries(properties).every(([key, value]) => found[key] === value)), `Index ${name}.${index}`);
    }
    check((await db.collection("admin_users").countDocuments({ role: "SUPER_ADMIN", isActive: true }, { limit: 1 })) > 0, "Active Super Admin exists");
    check((await db.collection("club_settings").countDocuments({ singleton: true }, { limit: 1 })) === 1, "Club settings exist");
    warn((await db.collection("rooms").countDocuments({ isActive: true }, { limit: 1 })) > 0, "At least one active room exists");
  } catch {
    check(false, "Database connection or read-only inspection failed (check access and credentials privately)");
  } finally { await mongoose.disconnect().catch(() => {}); }
}
console.log(`\n${failures} blocking issue(s), ${warnings} provider/content warning(s).`);
console.log("Not checked: actual provider delivery, hosted scheduler, domain, proxy trust, backups, or live environment variables.");
if (failures) process.exitCode = 1;
