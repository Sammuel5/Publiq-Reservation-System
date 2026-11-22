> **Status:** This guide includes older reservation-system material. Seating emails use the authenticated notifications cron and require controlled live testing. Legacy notification jobs are no longer processed; this deployment uses email only. The [documentation index](README.md) and [current project status](../README.md#current-status) take precedence. Do not accept real bookings until the launch blockers are resolved.

# Staging deployment runbook

**Status: preparation only.** No hosting account, Atlas cluster, domain, email/SMS
account or scheduler has been provisioned or deployed in this workspace. The
commands below are for an authorized operator after those services exist. Do
not paste secrets into chat, tickets, source control or command-line arguments.

## 1. Decide and provision

- This project is prepared for Vercel Hobby: `vercel.json` contains no built-in
  cron schedules. Configure an external scheduler to call both authenticated
  cron routes every five minutes. Without it, queued emails will not be sent.
  Verify your scheduler supports HTTPS GET requests with a secret Authorization
  header and supports the required frequency; do not put secrets in URLs.
  Check function time limits and cost. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- Create a **separate staging** MongoDB Atlas project/cluster, database and
  database user. Use a replica set/Atlas with transaction support. Grant only
  the application permissions it needs; use a separate privileged operator
  identity for bootstrapping and index management. Establish backup/restore,
  monitoring and an access-list policy. Vercel commonly uses dynamic egress:
  Atlas's Vercel integration describes `0.0.0.0/0`, which opens the network
  allowlist to the internet, **not** anonymous database access; weigh that risk,
  use strong credentials and least privilege, and investigate private or static
  networking appropriate to the plan. [Atlas/Vercel](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/)
- For delivery testing, configure a dedicated Gmail account and app password as
  described in [Gmail setup](GMAIL-SETUP.md). Live delivery is untested. SMS is
  disabled by default and is not needed for the requested email-only setup.
  Use consenting test recipients and a staff test inbox. Leave provider values
  unset until ready: messages queue rather than sending. Do not use real guest
  contact details for staging. Provider credentials, test sends and provider
  charges are the operator's responsibility.
- Keep preview deployment protection on. Use a Vercel automation bypass for
  authorized automated HTTP checks instead of making the preview public. The
  bypass secret is distinct from `CRON_SECRET`; neither belongs in Git or logs.
  [Vercel automation access](https://vercel.com/docs/deployment-protection/automated-agent-access)

## 2. Set staging-only environment values

Configure **Preview** environment variables in Vercel for a staging branch or
separate project, not Production. Supply:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB_NAME` | Staging-only Atlas URI and explicit database name. |
| `AUTH_SESSION_TTL_HOURS`, `AUTH_COOKIE_NAME` | Session lifetime and unique cookie name. |
| `AUTH_COOKIE_SECURE` | Leave unset (production builds default secure) or set `true`; never `false` on HTTPS. |
| `CLUB_TIMEZONE` | Club's IANA timezone, e.g. `Asia/Manila`. |
| `NEXT_PUBLIC_SITE_URL` | The actual HTTPS staging origin; no path, slash suffix beyond `/`, query or credentials. |
| `CRON_SECRET` | Unique cryptographically random secret, at least 32 printable non-space characters; keep private. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NOTIFICATION_STAFF_EMAIL` | Optional until email testing; server-only. |

Generate a secret locally with `openssl rand -hex 32` and store it directly in
the hosting secret manager. Environment changes generally require a fresh
build/deployment. Never store `SEED_SUPER_ADMIN_PASSWORD` in Vercel build/runtime
variables: bootstrap only from a secure operator environment, then remove the
seed credentials. Do not reuse production secrets or data in staging.

## 3. Bootstrap a fresh, isolated database

Confirm the target is the **new staging database** before writing anything.
Prepare an operator-only `.env.staging.local` with the staging values plus
`SEED_SUPER_ADMIN_NAME`, `SEED_SUPER_ADMIN_EMAIL` and a strong, unique
`SEED_SUPER_ADMIN_PASSWORD`; restrict file access and delete the file securely
when done. `.gitignore` and `.vercelignore` exclude env files, but verify the
upload and commit contents independently. Never use `--force` unless an account
reset and session revocation have been explicitly approved.

From the project root after `npm ci`:

```sh
node --env-file=.env.staging.local node_modules/tsx/dist/cli.mjs scripts/seed-super-admin.ts
node --env-file=.env.staging.local node_modules/tsx/dist/cli.mjs scripts/sync-indexes.ts
node --env-file=.env.staging.local scripts/deployment-preflight.mjs
```

**Index safety:** the existing bootstrap and index scripts call Mongoose
`syncIndexes()`, which can drop indexes not in the application schemas. Use them
on a fresh staging database only; review index differences, backups and a
change plan before any existing or production database. Preflight is read-only:
it checks index names, keys and key properties, cluster topology, an active
Super Admin and settings. Warnings for missing providers or rooms do not mean
those items are ready. A topology check does not prove a transaction succeeds.

Log in as the new admin, rotate/remove bootstrap secrets, set real opening hours,
timezone and policies. Do not seed legacy rooms.

## 4. Create a protected preview

1. Import the project into the selected Vercel team or use the Vercel CLI after
   authenticating in the operator's own environment. This workspace is not
   already linked to a Vercel project or repository; create/link one deliberately.
   Review `.vercelignore` and the actual upload/commit file list first.
2. Deploy a **Preview**, not a production promotion. Verify the preview uses the
   staging database and Preview-scoped variables. Set the actual preview origin
   as `NEXT_PUBLIC_SITE_URL` and redeploy if necessary. Confirm the session cookie
   is `Secure`, `HttpOnly`, and has the expected SameSite scope.
3. Run a read-only remote smoke check using environment variables set privately:

```sh
# STAGING_BASE_URL and optional VERCEL_AUTOMATION_BYPASS_SECRET are already in
# your protected shell environment. Do not include secrets in the command.
npm run deploy:smoke
```

The smoke script checks health, homepage, signed-out admin redirect and that
both cron routes deny an unauthenticated request. It does not send email/SMS,
create a booking, invoke authorized cron jobs, verify proxy trust or inspect
Vercel's deployed environment values. Read-only database preflight must be run
separately with the staging environment and database access.

## 5. Exercise staging safely

- Verify a fresh, consented test reservation end-to-end: price and availability,
  idempotent retry, admin authorization and confirmation, cancellation, and slot
  release. Check the database and UI; delete only your test fixtures. Never test
  using a production database.
- Vercel's built-in cron runs only against **production deployments**, not
  Preview. For staging, invoke the two cron routes manually or from an authorized
  external scheduler with `Authorization: Bearer <CRON_SECRET>`; if Preview
  protection is enabled, the scheduler also needs its automation bypass. Store
  both secrets in its secret manager, not a URL or log. Verify a deliberately
  expired staging hold moves to `EXPIRED` once and releases its locks. Check
  scheduler logs and that neither a redirect nor deployment protection blocked
  the invocation. [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- Enable provider credentials only when ready. Send a controlled email
  to opted-in staging recipients; confirm provider acceptance **and receipt**,
  as well as the staff inbox. Verify retries/backlog and inspect the System page.
  Provider acceptance is not a delivery receipt. Do not allow a scheduler to
  send old or real-customer jobs from an imported database.
- Test that the deployed edge overwrites or sanitizes client-provided forwarded
  IP headers before relying on per-IP limits. Vercel documents overwriting
  `X-Forwarded-For` to prevent spoofing; verify the actual setup, especially if
  another proxy sits in front. Direct untrusted access can bypass quotas by
  spoofing forwarding headers. [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- Existing `test:phase1`, `test:phase2`, `test:phase3`, and browser suites perform
  writes, create accounts/bookings and change settings. Run them only on an
  explicitly disposable staging database with notifications safely disabled or
  isolated and the scheduler paused. **Never run them on production.**

## 6. Release gate — do not promote automatically

Record staging URL and deployment ID, successful read-only checks, a verified
restore, authorized scheduler execution, actual email receipt, approved
sender identities, proxy behavior, monitoring/alerts, data-retention decisions,
rollback procedure and named owners. Review failures and costs. Production needs
separate database/users/secrets/provider settings and an explicit go-live
approval; this preparation does not create or deploy them.

### Local preparation evidence

- Next production build and TypeScript checks passed locally.
- The read-only preflight passed its database and index checks against the local
  replica set with a synthetic HTTPS origin and test secret; the unconfigured
  provider warnings were expected. An empty database, insecure cookie setting,
  weak secret and non-HTTPS origin were rejected.
- Five read-only smoke checks passed against the **local** server. An insecure
  non-local HTTP target was rejected. These are not results from a Vercel preview.
