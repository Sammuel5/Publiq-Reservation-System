# Run PUBLIQ locally

This guide starts the website and admin console on your own computer using a
local MongoDB database. No hosting account or paid notification service is
needed to review the app. Commands work in **Windows PowerShell**, macOS
Terminal and Linux Terminal unless stated otherwise.

## 1. Install the prerequisites

1. Install **Node.js 22 LTS**, which includes npm: https://nodejs.org/ .
2. Install **Docker Desktop** (Windows/macOS) or Docker Engine (Linux):
   https://docs.docker.com/get-docker/ . Start Docker and wait until it is ready.
3. Extract `zzz-PUBLIQ-Source.zip`. Open a terminal in the extracted
   `publiq` folder (the folder containing `package.json`).
4. Confirm the tools are available:

```sh
node --version
npm --version
docker --version
```

If a command is not recognized, reopen the terminal after installation. The
Docker commands below require Docker to be running. On Linux, configure Docker
permissions if needed; do not run npm as root.

## 2. Install the app

In the `publiq` folder run:

```sh
npm ci
```

This downloads the dependencies; the ZIP intentionally does not contain
`node_modules`.

## 3. Start a local MongoDB replica set

The app needs MongoDB's replica-set mode for transactions. Start a single local
instance using Docker (this command is one line):

```sh
docker run -d --name nocturne-mongo -p 127.0.0.1:27017:27017 -v nocturne-mongo-data:/data/db mongo:7.0 --replSet rs0 --bind_ip_all
```

Wait until Docker finishes downloading the image and starts the container, then
initialize the replica set:

```sh
node scripts/init-replset.mjs
```

The script defaults to `127.0.0.1:27017`. If you already have a `MONGODB_URI`
or `MONGO_PORT` set in your terminal, unset it first so initialization targets
this local container. Wait for the primary to become ready. If it is still
starting, retry the initialization command after a few seconds.

The database is stored in the Docker volume `nocturne-mongo-data`; stopping the
container does not erase your bookings. The port is bound to your computer only.
Do not remove that volume unless you deliberately want to delete the database.

## 4. Create your private configuration

Copy the included `.env.example` to a new file named **`.env.local`** in the
same folder as `package.json`:

- Windows PowerShell: `Copy-Item .env.example .env.local`
- macOS/Linux: `cp .env.example .env.local`

Open `.env.local` in a text editor. Replace the MongoDB and seed settings with
values like these; **choose your own unique email and strong password**:

```env
MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0"
MONGODB_DB_NAME="ktv_club"
AUTH_SESSION_TTL_HOURS="8"
AUTH_COOKIE_NAME="ktv_admin_session"
CLUB_TIMEZONE="Asia/Manila"
SEED_SUPER_ADMIN_NAME="Club Owner"
SEED_SUPER_ADMIN_EMAIL="your-admin@example.com"
SEED_SUPER_ADMIN_PASSWORD="Replace-with-your-own-Strong-Password-123!"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
```

Replace the example email and password before saving. The password must have at
least 12 characters, with uppercase, lowercase, a number and a symbol. Keep the
remaining commented-out provider settings as they are. `.env.local` is private:
never send it to anyone or commit it to Git. It is deliberately absent from the
ZIP. Local development uses HTTP, so leave `AUTH_COOKIE_SECURE` unset; the app
sets an appropriate cookie for development.

## 5. Create the admin and demo rooms

```sh
npm run seed:admin
npm run seed:rooms
npm run db:indexes
```

These create the first admin account, club settings, indexes, and sample room
records. Use the email and password you chose in `.env.local` to sign in. The
room names, rates and settings are demo data; edit them in the console. The
seed commands and index sync may alter indexes, so use these instructions only
on the fresh local database, not on an existing production database.

## 6. Start and view the app

```sh
npm run dev
```

Keep the terminal open, and open:

- Customer website: **http://localhost:3000**
- Admin login: **http://localhost:3000/admin/login**

Sign in using the admin email and password you chose. Try the rooms, booking
flow and admin console, then tell me what you want improved. Press **Ctrl+C**
in the terminal to stop the website.

The sample email/SMS providers and automatic cron scheduler are not configured
locally. The former hourly-room public booking API is now disabled. The new
experimental seating flow does not yet send confirmation notifications; do not
use this version for live bookings. Provider and scheduler setup for legacy
features is covered in `DEPLOYMENT-STAGING.md`.

## 7. Start it again later

From the same project folder:

```sh
docker start nocturne-mongo
npm run dev
```

You do not need to repeat `npm ci`, initialization or seeding every time. To
stop the database after stopping the app, run `docker stop nocturne-mongo`.
Your Docker volume keeps the data. Do not run `docker volume rm` unless you
intend to permanently delete your local data.

## 8. Getting updates and keeping your data

When you ask me to change the project in this conversation, I can make the
changes and regenerate the ZIP for you to download. ZIPs do **not** update
themselves after you download them; download the newly supplied ZIP each time.

For an update, back up your project and database first, stop the app, then
extract the new archive into a new folder. Copy your existing **private**
`.env.local` into the new folder on your own computer; the ZIP never contains
it. Run `npm ci` in that folder, then `npm run dev`. Your local bookings remain
in the Docker volume, not in the source folder or ZIP. If an update requires a
database migration or changed configuration, follow the instructions supplied
with that update rather than blindly reseeding.

### One-time PUBLIQ update for an existing local database

If you used the earlier Nocturne ZIP, keep your existing Docker container,
volume, database name, and `.env.local`. After installing the updated ZIP and
running `npm ci`, run this once against **your local database only**:

```sh
npm run rebrand:publiq
```

It changes the old default club name and example email to PUBLIQ and renames the
old default demo suite, only if their values still match the old defaults. It
preserves custom values, bookings, room slugs, accounts and other settings. If
you previously customized the club name, change it manually under Admin →
Settings. Make a backup first, and check that `MONGODB_URI` points to your local
database—not a production or shared database.

If you change source files yourself and want to create a fresh ZIP, install
Python 3 from https://www.python.org/ and run one of:

```sh
python scripts/package_release.py
```

On macOS/Linux, use `python3 scripts/package_release.py` if `python` is not
available. This recreates `zzz-PUBLIQ-Source.zip` in the project folder. It
packages source, images, scripts and documentation, but excludes private env
files, local database data, dependencies, build outputs and test logs. The ZIP
is source code, not a database backup. Back up both the project and database
separately when needed.

## 9. Deploy it yourself later

After reviewing the app locally, follow `DEPLOYMENT-STAGING.md`. It explains
staging, MongoDB Atlas, Vercel, safe secrets, cron jobs, email/SMS, and the
checks needed before production. Provision services yourself and keep your
credentials private. Deployment and live notifications are not yet verified.

## Troubleshooting

- **`docker` cannot connect:** start Docker Desktop / the Docker daemon and retry.
- **Name already in use:** if it is your existing container, run
  `docker start nocturne-mongo` instead of creating it again. Check its
  configuration before assuming it uses the expected database.
- **Port 27017 already in use:** stop the conflicting local MongoDB/container or
  choose another port and update both the replica-set initialization and URI.
- **`node scripts/init-replset.mjs` fails:** wait for MongoDB to finish starting,
  then retry. Verify `docker logs nocturne-mongo`; make sure no other MongoDB is
  running on port 27017 and no conflicting `MONGODB_URI` is set in the terminal.
- **Cannot connect to MongoDB:** run `docker ps` and check `.env.local`; the
  URI must use `127.0.0.1:27017` and `replicaSet=rs0` for the setup above.
- **Too many sign-in attempts:** the rate-limit window is 15 minutes from the
  start of the relevant IP/email window; repeated wrong passwords can also lock
  the account for 15 minutes. The sign-in page now shows the server-provided
  time remaining and enables Sign in again when that timer ends. An account lock
  or email-specific limit applies to that email; a network limit can affect all
  accounts on the same connection, including local users. A separate limit can
  still require additional waiting. Refreshing the same tab keeps the displayed
  countdown; the browser stores the affected email temporarily, never the
  password. Do not keep retrying while waiting.
- **Incorrect email or password:** use the email and password set *before*
  `seed:admin` was run. Re-running the seed does not reset an existing account.
  Do not use `--force` casually: it resets the password/role and revokes sessions.
- **Port 3000 is taken:** stop the other program, or run `npm run dev -- -p 3001`
  and visit `http://localhost:3001`. Update `NEXT_PUBLIC_SITE_URL` in
  `.env.local` and restart the app when using another port.
- **Commands fail after an update:** check the new ZIP's instructions, use the
  supported Node version, and rerun `npm ci` in the new project folder.

## Mobile checks

The public pages, reservation wizard and admin interface adapt to phone screens.
The admin night grid scrolls horizontally so its timeline remains readable.
To run the automated phone-layout checks against a **local test database** with
its seeded admin account, first install the Playwright browsers (and their OS
requirements; see Playwright's documentation):

```sh
npx playwright install chromium webkit
```

Start the app in a separate terminal with `npm run dev`, then run:

```sh
npm run test:ui:mobile
```

The old `test:ui:mobile` suite targets the retired hourly-room wizard and does
not represent the new seating flow. Use `npm run test:ui:menu`,
`npm run test:ui:seating` and `npm run test:ui:seat-photos` instead. These
use phone emulation. Emulation is not a substitute
for checking real phones, browsers, keyboards and accessibility tools. If testing
a local **production-mode** server over plain HTTP, set
`AUTH_COOKIE_SECURE=false` only for that local test process; secure cookies are
required on HTTPS production deployments and should not be disabled there.

### PUBLIQ seating conversion status

Fresh databases default to 9:00 p.m.–4:00 a.m. Existing databases retain saved
hours; update Admin → Settings if needed. Seven VIP booths and five couches
appear publicly. VIP photo mappings are confirmed; couch photo-to-space mappings
and couch/combined-VIP guest capacities are still unconfirmed.

A new, separate Google-authenticated VIP booking flow is implemented behind the
`CUSTOMER_BOOKINGS_ENABLED` flag, which defaults to off. Its server calculates
consumable minimums, confirms bookings, and atomically claims a space through
closing. The legacy unauthenticated hourly booking endpoint now returns 410.
Couches and combined VIP 3 + 4 remain unavailable online until their capacities
are confirmed. The combined option will use one VIP tier for the whole group.

**Do not enable this for real reservations yet.** Google sign-in has not been
tested with real credentials. New seating bookings currently have no email/SMS
confirmation, cancellation, staff editing, reconciliation with legacy inventory,
or integration with the legacy admin block/calendar system. The admin's new
Seating bookings page is read-only. Existing demo records are not migrated or
removed. A replica-set MongoDB is required for atomic seat claims. Package
security audit findings and staging checks must also be resolved before launch.

## Customer Google sign-in setup

Customer sign-in is separate from staff sign-in. Google Cloud configuration is
not supplied in this ZIP. To test it locally:

1. In Google Cloud Console, create/select a project and configure Google Auth
   Platform branding and audience. If the app is in testing mode, add your own
   Google account as a test user.
2. Create an OAuth client of type **Web application**. Register the exact redirect
   URI `http://localhost:3000/api/customer-auth/google/callback`. Use `localhost`
   consistently when opening the site; `127.0.0.1` is a different origin.
3. In `.env.local`, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_REDIRECT_URI` and a distinct `CUSTOMER_SESSION_SECRET` of at least
   32 random characters. Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   Keep secrets private; never paste them in chat or commit them.
4. Restart the app, open `http://localhost:3000/reserve`, and choose **Sign in
   with Google**. Signing in alone does not create a booking. The booking feature
   remains disabled by default. For isolated local testing only, you may set
   `CUSTOMER_BOOKINGS_ENABLED=true` in the test server environment after
   configuring Google and an isolated replica-set database. Never do so with a
   real customer database until the outstanding work above has been addressed.
5. A hosted environment needs its own exact HTTPS redirect URI registered with
   Google, matching `GOOGLE_REDIRECT_URI`, and separate secure secrets.

The Google flow uses state, nonce, PKCE and server-side ID-token verification.
Google login verifies control of an account, not the identity or honesty of a
person. The integration has not been tested with a real Google account. See
https://developers.google.com/identity/openid-connect/openid-connect.

## Preview through ngrok

A tunnel exposes your local server on the internet. Use test data only, protect
the ngrok endpoint with access controls, and stop ngrok when finished. Never
share `.env.local`, passwords, or session secrets. A tunnel is not a deployment.

1. In the `publiq` folder, run `npm ci` if this is a fresh extraction. Start your
   database and run `npm run dev`; leave that terminal open. Confirm
   `http://localhost:3000` works. If Next reports another port, use that port
   in the next step instead of 3000.
2. In another terminal run `ngrok http 3000` (or your actual Next.js port).
   Open the HTTPS Forwarding URL directly in a browser, not inside a website
   preview frame. On a free ngrok endpoint, visitors may first have to click
   **Visit Site** on ngrok's warning page.
3. For Next.js development resources, put the **exact hostname** from the
   forwarding URL in `.env.local`, without `https://` or a trailing slash:

   ```env
   NEXT_DEV_ALLOWED_HOST="example.ngrok-free.app"
   ```

   Replace the example with your own hostname. Stop `npm run dev` with Ctrl+C
   and start it again. If ngrok gives you a new hostname, update the value and
   restart the development server again. Never use `*`. This allows the hostname
   to access development resources; it does not protect your server.
4. Refresh the ngrok URL. If it is still white, open the browser's developer
   tools, check **Console** and **Network** for failed JavaScript/CSS requests,
   and check both the Next.js and ngrok terminals. A 502 or ngrok connection
   error usually means ngrok is pointing to the wrong port or the app stopped.
   Share the error text and status codes, but redact cookies, tokens and secrets.

For a more production-like visual preview, stop the development server, run
`npm run build` followed by `npm start`, and tunnel the port shown. The dev-host
setting is only for `npm run dev`; it doesn't enable Google sign-in or bypass
security. To test Google sign-in, configure the exact HTTPS tunnel callback URL
in both Google Cloud and `GOOGLE_REDIRECT_URI`, and set
`NEXT_PUBLIC_SITE_URL` to the HTTPS tunnel origin; restart the app. A changing
tunnel URL requires updating these settings again. See
`GOOGLE-AND-BOOKING-SETUP.md`. Do not test with real guest data until the
booking systems and role restrictions have been fully verified.
