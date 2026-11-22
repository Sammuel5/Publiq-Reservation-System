> **Status:** This guide includes older reservation-system material. The [documentation index](README.md) and [current project status](../README.md#current-status) take precedence. Do not accept real bookings until the launch blockers are resolved.

# PUBLIQ: Google sign-in and booking setup

This guide is for the owner setting up PUBLIQ on their own computer and later in
a staging environment. Keep this file and `LOCAL-SETUP.md` with the project.

> **Important: not ready for real customers.** The individual-VIP booking flow
> has been tested with fabricated sign-in sessions in an isolated database, but
> a real Google sign-in has not been tested. Couch and combined VIP 3 + 4
> capacities are not yet confirmed; those spaces cannot be booked online.
> Confirmation and staff notification emails and staff cancellation emails are
> queued, but live delivery needs provider and scheduler setup and testing. Guest
> cancellation, check-in, payment recording and integration with the old admin
> calendar/blocking system are not implemented; that legacy workflow is disabled.
> Security issues need review.
> Keep `CUSTOMER_BOOKINGS_ENABLED="false"` except in an isolated local test.
> **Do not accept live reservations or deploy this as a live booking service yet.**

## 1. What you need

- The latest `zzz-PUBLIQ-Source.zip`, extracted to a folder named `publiq`.
- Node.js 22 LTS and npm.
- A MongoDB **replica set** for transactions. For local tests, Docker plus the
  local single-node replica-set instructions in `LOCAL-SETUP.md` are simplest.
- A Google account and a Google Cloud project to create a **Web application**
  OAuth client. The Google account used for setup is yours; do not share it.
- A private local file named `.env.local`, created from `.env.example`.
- Later, a separately configured staging database and an HTTPS staging domain.

**Never send anyone your `.env.local`, Google client secret, database URI with
credentials, admin password or session secret.** They must not go into Git,
chat, screenshots or the ZIP. The example values below are placeholders only.

## 2. Start the project locally

1. Extract the ZIP and open a terminal in the `publiq` folder.
2. Install dependencies:

   ```sh
   npm ci
   ```

3. Start the local MongoDB replica set using steps 3–4 in `LOCAL-SETUP.md`.
   A standalone MongoDB without replica-set transactions is not sufficient.
4. Create `.env.local` from `.env.example`:

   **Windows PowerShell:**
   ```powershell
   Copy-Item .env.example .env.local
   ```

   **macOS / Linux:**
   ```sh
   cp .env.example .env.local
   ```

5. Edit `.env.local` using the sections below. Do not replace an existing file
   without backing it up first. Never use your live database for experiments.
6. On a **fresh, disposable local database only**, run:

   ```sh
   npm run seed:admin
   npm run dev
   ```

   `seed:admin` synchronizes indexes and can alter existing indexes; do not run
   it or `db:indexes` against an existing production database without review.
   Do not run `seed:rooms` for PUBLIQ seating; it creates legacy room demos.
7. Open `http://localhost:3000`. Admin is at
   `http://localhost:3000/admin/login`.

## 3. Create Google OAuth credentials

Google's [setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
and [OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect)
contain the latest Google Cloud screens; their labels can change.

1. Open [Google Cloud Console](https://console.cloud.google.com/), sign in, and
   create or select a project for PUBLIQ.
2. Open **Google Auth Platform**. Configure **Branding** with the application
   name and support contact. Configure **Audience** for your intended users.
   For an external app in testing mode, add the Google accounts you will use as
   test users. Follow Google's requirements before making the app public.
3. Under **Clients**, create a client. Choose **Web application**, not Android,
   iOS, desktop or service account. This server-side website uses the web client
   for visitors on both phones and computers.
4. Add this exact value under **Authorized redirect URIs**:

   ```text
   http://localhost:3000/api/customer-auth/google/callback
   ```

   The URI must match `.env.local` exactly. A different port, path, protocol or
   `127.0.0.1` instead of `localhost` is a different URI. For local testing,
   open the website using `http://localhost:3000`, not `127.0.0.1`.
5. Create the client. Store the **Client ID** and **Client secret** privately.
   Add them to `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. The app asks Google for `openid`, `email` and `profile`; it does not need
   broad Google Drive or Gmail access. Google sign-in verifies control of a
   Google account, not the real-world identity or honesty of every customer.

A staging or production domain later needs its own exact **HTTPS** callback in
Google Cloud and a matching environment value. A sandbox preview URL is not
the same origin as `localhost`. Google may require application verification or
additional information depending on the project and publication settings.

## 4. Fill in `.env.local`

Edit the copied file. Remove the `#` from a line when you enable a commented
setting. Replace the text in angle brackets yourself; the placeholders are not
working credentials. Use unique secrets and a test database.

```env
# Local, disposable MongoDB replica set
MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0"
MONGODB_DB_NAME="publiq_local_test"

# Admin session and venue timezone
AUTH_SESSION_TTL_HOURS="8"
AUTH_COOKIE_NAME="ktv_admin_session"
CLUB_TIMEZONE="Asia/Manila"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"

# Used only to create the first admin on a fresh test database
SEED_SUPER_ADMIN_NAME="<your name>"
SEED_SUPER_ADMIN_EMAIL="<your private admin email>"
SEED_SUPER_ADMIN_PASSWORD="<your strong private password>"

# From your Google Cloud Web application OAuth client
GOOGLE_CLIENT_ID="<your Google client ID>"
GOOGLE_CLIENT_SECRET="<your Google client secret>"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/customer-auth/google/callback"

# Generate a separate random private secret using the command below
CUSTOMER_SESSION_SECRET="<your random customer session secret>"

# Leave false unless deliberately testing in an isolated local database
CUSTOMER_BOOKINGS_ENABLED="false"
```

Generate a random customer session secret in a terminal:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy the generated value directly into `.env.local`. It must be at least 32
characters; use a different secret for each environment. Changing it signs out
existing customer sessions. The seed admin password must be at least 12
characters and contain uppercase, lowercase, a number and a symbol. After
bootstrapping the admin, remove seed credentials from `.env.local` when they are
no longer needed; this does not change the existing account's password.

For local `npm run dev`, leave `AUTH_COOKIE_SECURE` unset. The admin cookie is
normally Secure in production. **Do not set `AUTH_COOKIE_SECURE=false` on a
public HTTPS deployment.** For Google, the callback URL determines whether
customer cookies are marked Secure; HTTPS is required for non-local hosts.

### What each variable is for

| Variable | Where to obtain it / purpose | Private? |
|---|---|---|
| `MONGODB_URI` | Local replica-set URI, or Atlas driver connection URI with a database user | Yes, if it contains credentials |
| `MONGODB_DB_NAME` | Your chosen, separate database name | Treat as configuration |
| `AUTH_SESSION_TTL_HOURS`, `AUTH_COOKIE_NAME` | Admin session lifetime and cookie name | No password, but configure carefully |
| `AUTH_COOKIE_SECURE` | Optional admin-cookie override; leave unset for HTTPS production | Configuration |
| `CLUB_TIMEZONE` | `Asia/Manila` | No |
| `NEXT_PUBLIC_SITE_URL` | Website origin, local or HTTPS staging | Public |
| `SEED_SUPER_ADMIN_NAME`, `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | Your own first-admin details, only for fresh-database bootstrap | Password is secret |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth Web client | Not a password; handle responsibly |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth Web client | **Secret** |
| `GOOGLE_REDIRECT_URI` | Exact registered callback for the current environment | Configuration |
| `CUSTOMER_SESSION_SECRET` | Random value you generate, at least 32 characters | **Secret** |
| `CUSTOMER_BOOKINGS_ENABLED` | Feature gate; `false` for normal use until readiness checks pass | Configuration |

## 5. Test Google sign-in locally

1. Save `.env.local`, stop the app with **Ctrl+C**, and restart with
   `npm run dev`. Configuration changes require a restart.
2. Go to `http://localhost:3000/reserve` and select **Sign in with Google**.
   If the button is absent, one or more Google settings are missing or invalid.
3. Sign in with a Google account authorized as a test user. After returning,
   confirm the website shows the correct signed-in email. Use **Sign out** and
   confirm you are signed out.
4. Test on your own iPhone and Android browser too. `localhost` on a phone
   refers to the phone itself, not your computer. For phone testing use a
   properly secured HTTPS staging or tunnel URL, register that exact callback
   in Google Cloud, and update the matching environment values on the test
   server. Google may block an embedded browser or iframe; open the actual
   test URL directly in Safari or Chrome. Use only an isolated test database.

A successful sign-in **does not create a reservation**. With the flag false,
booking remains disabled. This project has not yet been verified against real
Google credentials; if sign-in fails, do not send secrets in your report.

## 6. Optional isolated booking test — not real customers

Only after Google sign-in works and only with a **fresh disposable replica-set
DB**, you can test the unfinished VIP flow locally:

1. Back up any existing data. Confirm `MONGODB_DB_NAME` names the disposable
   test database, not a real one.
2. In that test setup only, set `CUSTOMER_BOOKINGS_ENABLED="true"` and restart
   the app. Admin → Settings must show opening `21:00`, closing `04:00` and
   correct operating days. The app refuses bookings if the hours don't match.
3. Sign in with your authorized Google test account. Choose an individual VIP,
   a future night, arrival time, guest count, name and phone number. Submit.
   The app confirms on screen and shows a reference. Check **My booking** and
   the admin **Seating bookings** list.
4. Repeat the same physical VIP and night with a different test account: it
   should be unavailable. Confirm pricing matches the guest count, and confirm
   the record stays reserved until 4 a.m. Test with actual phone browsers too.
5. Return `CUSTOMER_BOOKINGS_ENABLED` to `false` and restart. Treat test entries
   as test data; do not wipe any real database to clean them up.

The new flow does **not** send a confirmation email or SMS. It does not yet
support cancellation, staff editing, or integration with legacy staff blocks and
calendar. Unknown-capacity couches and VIP 3 + 4 cannot be booked. The public
legacy room-booking endpoint is intentionally disabled (HTTP 410).

## 7. Database and deployment preparation for later

For a future hosted staging test, you can use MongoDB Atlas with a **separate**
staging database and least-privilege database user. Atlas database users are
separate from your Atlas console account. Configure network access carefully,
copy the Atlas driver connection string into `MONGODB_URI`, and keep it secret.
See [MongoDB's Atlas connection guide](https://www.mongodb.com/docs/atlas/driver-connection/).
Never point staging or test scripts at real customer data. Atlas/Vercel network
rules need a security review; opening access to all addresses permits public
network reachability and is not a substitute for strong credentials.

If you later use Vercel, add environment variables to the appropriate
**Preview** or **Production** environment in project settings, using separate
values and an HTTPS callback for each domain. A redeploy is needed after
changing variables; see [Vercel's environment guide](https://vercel.com/docs/environment-variables/managing-environment-variables).
Do not upload `.env.local`. **Do not deploy this revision for real bookings.**
`vercel.json` currently contains five-minute legacy cron schedules that may not
be supported on the chosen Vercel plan; review `DEPLOYMENT-STAGING.md` first.

### Guest and staff confirmation email

New confirmed website seating bookings now create two email jobs in the same
transaction: one to the verified Google account email and one to a designated
staff email address. When staff cancel a website seating booking, the transaction
releases its physical-seat claims and queues a cancellation email for the guest. Configure Gmail and the authenticated external scheduler as described in
[Gmail setup](GMAIL-SETUP.md). Use a dedicated Gmail account and an app
password, not your Google account password. SMS and legacy notification jobs
are disabled.

Emails are queued, not sent during the booking request. Gmail and the scheduler
must be configured and tested with controlled recipients. SMTP acceptance is not
proof of inbox delivery. SMTP has no provider idempotency guarantee: retries can
occasionally duplicate a message. The System dashboard does not track this new
outbox. Earlier seating bookings are not automatically backfilled. An already
in-flight confirmation can race with a cancellation. See `DEPLOYMENT-STAGING.md`.

## 8. Before opening real reservations

- [ ] Confirm all couch capacities and combined VIP 3 + 4 capacity and pricing.
- [ ] Complete and test Google login with a real test account.
- [ ] Implement and test guest-initiated cancellations, staff editing, new-booking
      calendar/block integration; verify live notification delivery separately.
- [ ] Use a fresh database with no prior reservations; legacy records are not migrated. Do not take phone/walk-in bookings outside the website inventory unless staff have a safe manual process.
- [ ] Test concurrent bookings and retries against isolated staging data.
- [ ] Test on physical iPhone and Android devices and accessibility tools.
- [ ] Resolve `npm audit` findings and perform a security/privacy review. The
      last local check reported three production-dependency advisories (two high,
      one moderate). Recheck; do not blindly run `npm audit fix --force`.
- [ ] Review Atlas network access, account permissions, backups and recovery.
- [ ] Review the Google app's publishing and privacy requirements.
- [ ] Only after all checks pass, plan a controlled production launch.

## Troubleshooting

- **`redirect_uri_mismatch`:** the Google Cloud authorized redirect URI must
  exactly match `GOOGLE_REDIRECT_URI`, including protocol, host, port and path.
- **`access_denied` / app in testing:** add the Google account as a test user in
  the project's Audience configuration.
- **No Google button:** confirm all four Google/session values are present,
  the session secret is at least 32 characters, the callback is valid, and you
  restarted the app. Do not post the values publicly.
- **Booking unavailable:** this is expected with `CUSTOMER_BOOKINGS_ENABLED`
  false, or for unknown-capacity spaces. Do not enable on a real database.
- **Mongo connection/transaction errors:** confirm the URI, replica-set primary,
  access permissions and network rules. Use a separate test database.
- **Hours error:** set saved Admin → Settings hours to 21:00–04:00; changing a
  default in code does not overwrite saved settings.
- **Mobile tap issue:** open the live site in Safari/Chrome, reload after an
  update, and specify the phone, browser and page when reporting a problem.
