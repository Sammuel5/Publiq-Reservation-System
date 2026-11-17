# PUBLIQ — Reservation System

Premium KTV & entertainment-club reservation platform: a public booking website
and a private management console. **Phases 1 (Foundation), 2 (Customer Website),
and 3 (Admin Console) are complete; Phase 4 hardening is ready for review.**

- **Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS v4 ·
  shadcn/ui-style primitives on Radix · Lucide icons · MongoDB + Mongoose ·
  Zod · bcrypt · server-side sessions
- **Design system:** dark luxury — `#09090B` base, luxury gold `#C9A45C` accent,
  purple `#8B5CF6` for secondary highlights, Playfair Display + Inter.

---

## 1. What exists today

| Area | Status |
| --- | --- |
| Next.js + TS + Tailwind v4 + component primitives | ✅ |
| Design tokens, typography, motion, reduced-motion support | ✅ |
| Mongoose connection utility (pooled, cached, health-checked) | ✅ |
| 10 models with validation, indexes, TTL, unique constraints | ✅ |
| Admin auth: bcrypt (cost 12), DB-backed sessions, httpOnly cookie | ✅ |
| Protected admin routes (middleware + server-side re-validation) | ✅ |
| Role-aware permission matrix (Super Admin / Admin / Staff) | ✅ |
| Seed/bootstrap script (idempotent, env-driven, never hardcoded) | ✅ |
| Rate limiting, lockout, account-enumeration protection, CSRF guard | ✅ |
| Admin shell: sidebar, mobile drawer, header, logout | ✅ |
| Live verification dashboard (real DB introspection, no fake stats) | ✅ |
| Automated API test suite (18 checks) + browser UI suite (24 checks) | ✅ |
| Customer website: home, rooms, detail pages, galleries | ✅ Phase 2 |
| 5-step reservation wizard with live availability | ✅ Phase 2 |
| Public booking API: availability, create, lookup, cancel | ✅ Phase 2 |
| Idempotent submissions, atomic slot locking, price from DB | ✅ Phase 2 |
| Self-service lookup + cancellation / staff-request path | ✅ Phase 2 |
| Responsive sweep 320→1366 px + clean-console browser suite | ✅ Phase 2 |
| Reservations / rooms / customers / payments / calendar / settings | ✅ Phase 3 |
| Booking engine: overlap, concurrency, expiry, blocked dates | ✅ Phase 4 |
| Final security/responsive sweep + deployment | ⏳ Phase 5 |

---

## 2. Local setup

```bash
cp .env.example .env.local     # then fill in MONGODB_URI + seed values
npm install

# Local MongoDB (sandbox/dev only). Production uses MongoDB Atlas.
npm run db:up                  # starts mongod as a 1-node replica set (rs0)

npm run seed:admin             # creates indexes, club settings, Super Admin
npm run seed:rooms             # 4 room categories + 6 bookable demo rooms
npm run dev                    # http://localhost:3000
```

Production-style run:

```bash
npm run build && npm start
```

### Verification

```bash
npm run typecheck        # strict TypeScript, no errors
npm run test:phase1      # 18 API/auth/security checks against a running server
npm run test:ui          # 24 browser checks (Playwright) at 320→1920px

npm run test:phase2      # 28 booking-API checks (availability → create → cancel)
npm run test:ui:phase2   # 17 browser checks + screenshots in screenshots/phase2

npm run db:indexes       # sync model indexes into an existing database
```

`test:phase2` reuses the same running server as `test:phase1`; `test:ui:phase2`
spins up its own instance on port 3002 (plain HTTP) and writes
`screenshots/phase2/*.png`.

`test:phase1` and `test:ui` expect a running server (`npm start`, or
`AUTH_COOKIE_SECURE=false npx next start -p 3002` for the browser suite over
plain HTTP) and read seed credentials from `.env.local`.

---

## 3. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | ✅ | Atlas connection string (`mongodb+srv://…`) |
| `MONGODB_DB_NAME` | ✅ | Database name (`ktv_club`) |
| `AUTH_SESSION_TTL_HOURS` | ✅ | Admin session lifetime (default 8) |
| `AUTH_COOKIE_NAME` | ✅ | Session cookie name |
| `AUTH_COOKIE_SECURE` | – | Override the `Secure` flag (plain-HTTP setups only) |
| `CLUB_TIMEZONE` | ✅ | Business timezone (`Asia/Manila`) |
| `SEED_SUPER_ADMIN_NAME/EMAIL/PASSWORD` | seed only | Bootstrap credentials — delete after seeding |
| `NEXT_PUBLIC_SITE_URL` | – | Canonical URL for metadata |

`.env.example` documents every value with placeholders — no real credentials.
`.env.local` is gitignored.

---

## 4. Architecture

```
src/
├── app/
│   ├── layout.tsx                 # fonts, metadata, toast host, skip-link
│   ├── page.tsx                   # Phase 1 foundation landing (real DB status)
│   ├── globals.css                # design tokens (@theme) + base layer
│   ├── api/
│   │   ├── auth/login|logout|session/route.ts
│   │   └── health/route.ts
│   └── admin/
│       ├── login/page.tsx         # public sign-in (server component)
│       └── (dashboard)/           # protected route group — own layout
│           ├── layout.tsx         # requireAdmin() → AdminShell
│           ├── page.tsx           # live verification dashboard
│           └── forbidden/page.tsx
├── components/
│   ├── ui/                        # button, input, card, dialog, sheet, table,
│   │                              # badge, status-badge, form-field, toaster,
│   │                              # skeleton, empty/error states, tabs, …
│   └── admin/                     # admin-shell, nav-config, login-form, logout
├── config/
│   ├── app.ts                     # roles, permission matrix, permissions
│   └── env.ts                     # lazy Zod-validated server env
├── lib/
│   ├── db/
│   │   ├── mongoose.ts            # cached connection + health probe
│   │   └── models/                # 10 models + registry
│   ├── auth/                      # password, session, cookies, guards
│   ├── services/                  # admin-auth, club-settings, system-status
│   ├── validation/                # Zod schemas + field-error helper
│   ├── utils/                     # cn, money, datetime (timezone-safe), normalize
│   ├── errors.ts                  # AppError hierarchy + JSON envelope
│   ├── http.ts                    # client IP, same-origin/CSRF check
│   ├── logger.ts                  # structured JSON logging
│   └── rate-limit.ts              # fixed-window limiter
├── middleware.ts                  # /admin/* cookie gate (fast redirect)
└── scripts/
    ├── seed-super-admin.ts        # indexes + settings + Super Admin
    ├── dev-mongodb.sh             # local mongod (replica set)
    ├── init-replset.mjs
    ├── test-phase1.mjs            # API/security suite
    ├── ui-check.mjs               # full responsive suite
    └── ui-shot.mjs                # lean responsive suite + screenshots
```

### Security decisions

- **Sessions:** 256-bit random token in an `httpOnly`, `SameSite=Lax`,
  `Secure` (production) cookie. The database stores only `SHA-256(token)`, so a
  dump of `admin_sessions` cannot be replayed. Every request re-validates the
  session against MongoDB → logout, deactivation and password changes take
  effect immediately. TTL index auto-purges expired rows.
- **Passwords:** bcrypt cost 12 (`bcryptjs`, no native build step on Vercel).
  Policy enforced on seed and on future password changes. Unknown emails still
  burn a comparison to equalize timing; one generic error message for every
  failure mode.
- **Brute force:** per-IP and per-email rate limits, plus account lockout
  (5 failures → 15 min). Verified by test.
- **Authorization:** single permission matrix in `config/app.ts`. Server guards
  (`requireAdmin`, `requireAdminPermission`, `requireApiAdmin`) are the only
  authority; middleware only short-circuits unauthenticated navigation.
- **CSRF:** state-changing endpoints require a same-origin `Origin`, on top of
  `SameSite=Lax` cookies.
- **Secrets:** server env is read lazily through a Zod-validated getter; client
  bundles were scanned and contain no URI, password or `MONGODB_URI` reference.

### Data decisions

- **Money is integer centavos** (`hourlyRate`, `estimatedAmount`, `amount`), never
  floats. `formatMoney` handles ₱ display.
- **Time is dual-model:** `reservationDate` + `startTime`/`endTime` (club-local,
  what staff read) and `startAt`/`endAt` (UTC instants, what queries compare).
  `lib/utils/datetime.ts` converts with `Intl` only — no date library — and is
  DST-safe for any configured timezone.
- **Customers** are deduplicated on normalized E.164 mobile numbers
  (`0917…`, `917…`, `+63 917…` → `+63917…`).
- **Double-booking groundwork:** `RoomSlotLock` documents with a unique
  `(room, slotStart)` index rejects concurrent slot claims. Expiry transitions
  and lock release use transactions and require Atlas or a MongoDB replica set.
- **Statuses:** `PENDING, CONFIRMED, REJECTED, CANCELLED, CHECKED_IN, COMPLETED,
  NO_SHOW` plus `EXPIRED`. `EXPIRED` is the documented status for lapsed pending
  holds (history is never deleted), so "expired holds stop blocking availability"
  keeps an explicit, auditable state.
- **Reservation history** is append-only via `statusHistory`, and internal notes
  carry author + timestamp.

### Deliberate library choices

| Choice | Reason |
| --- | --- |
| Next.js **15.5** (not 16) | Mature App Router with a stable middleware/runtime model; upgrade path is open after Phase 5. |
| **Tailwind v4** with `@theme` tokens | One source of truth for colour/type/motion, no `tailwind.config.js` drift. |
| **zod 3.25** | Stable, broad ecosystem compatibility; schemas are shared client/server. |
| **bcryptjs** | Identical algorithm/work factor without native builds on serverless. |
| shadcn primitives **vendored** | Full control of the luxury theme; no runtime dependency on a CLI. |

---

## 5. Known limitations / notes

- The Phase 4 counters are shared in MongoDB and fail closed when it is unavailable.
  IP enforcement relies on a trusted edge proxy sanitizing forwarded headers;
  direct exposure with client-controlled `X-Forwarded-For` permits evasion.
  Masked IPs group a subnet, so unrelated users can share a quota.
- Scheduled jobs and actual outbound messages need deployment configuration;
  local verification uses a live MongoDB replica set and simulated providers,
  not real email/SMS delivery or a hosted scheduler. See §9.
- Room photography uses externally hosted URLs; image uploads are not implemented.
- `AUTH_COOKIE_SECURE=false` is for plain-HTTP verification only, never production.
- Historical bookings created before Phase 4 do not acquire notification jobs.

---

## 6. Phase 1 test evidence

- `npm run typecheck` → clean
- `npm run build` → production build succeeds (12 routes)
- `npm run test:phase1` → **18/18** checks (DB, indexes, seeding, login,
  wrong-password rejection, enumeration parity, CSRF block, cookie hardening,
  session/role payload, dashboard render, logout revocation, expired session,
  deactivated account, lockout + rate limit, permission matrix)
- `npm run test:ui` → **24/24** browser checks at 320 / 390 / 768 / 1366 / 1920 px:
  no horizontal scrolling, no overflowing elements, working mobile drawer
  (open + Escape), label→input focus, inline validation, wrong-password banner,
  login → dashboard, logout → protected route blocked
- Screenshots in `screenshots/`

Three defects were found and fixed during testing:

| Defect | Fix |
| --- | --- |
| `sanitizeFilter: true` mangled `{ $gt: date }` filters, breaking session expiry queries (dashboard error state). | Removed the global flag; injection safety comes from Zod + normalization + typed filters (documented in `mongoose.ts`). |
| `FormField` injected `id`/`aria-*` onto a wrapper `div` for the password field, so label clicks and screen-reader associations broke. | Render-prop API (`{(control) => …}`) so attributes always land on the real input; regression test added. |
| Long Mongo index names (underscores) could not wrap, forcing a 320 px horizontal overflow (359 px) on the dashboard. | `break-all` + `min-w-0` on chip rows and grid children; all 5 widths re-verified. |
| Login form showed the last Zod message per field instead of the first. | Shared `fieldErrorsFromZod()` helper keeps the first message; reused by Phase 2+ forms. |

---

## 7. Phase 2 — Customer Website

### 7.1 Pages

| Route | Contents |
| --- | --- |
| `/` | Hero (real photo), tonight's availability teaser, room categories, how-it-works, trust strip |
| `/rooms` | All bookable rooms, filterable by category, live "from ₱/hour" pricing |
| `/rooms/[slug]` | Gallery with keyboard-accessible photo switcher, capacity/amenities, per-category price, "Reserve this room" CTA that pre-selects the room in the wizard |
| `/reserve` | 4-step wizard: **date & time → room & guests → your details → review**, then redirect to the confirmation page |
| `/confirmation/[reference]` | Reference + copy button, booking summary, cancellation-policy card, deep link that expires without the access token |
| `/lookup` | Reference + mobile number → booking status, cancellation dialog with reason |
| `/about`, `/contact` | Club story, hours, address, phone/email (all read from `club_settings`, never hardcoded) |
| `not-found.tsx` (root **and** site group) | Shared "This page has left the room" 404, `robots: noindex`, works for unknown room slugs too |

All pages are server components; only the wizard, gallery, copy button and
lookup panel ship client JavaScript. Every string the customer can edit is
validated with the same Zod schemas the API uses.

### 7.2 Public API

| Method · path | Purpose | Guards |
| --- | --- | --- |
| `GET /api/availability?roomId=…&date=YYYY-MM-DD` | Per-room slot grid for one night, with price and conflict reason per slot | 120 req / 5 min / IP |
| `POST /api/reservations` | Create a booking; returns `201` (+`duplicate: true` on replay) | 8 req / h / IP · 5 req / h / mobile · Same-origin |
| `POST /api/reservations/lookup` | Find a booking by reference **and** mobile | 20 req / 15 min / IP · 15 / mobile |
| `POST /api/reservations/cancel` | Cancel, or file a staff request inside the cutoff | 10 req / h / IP · 6 / mobile · Same-origin |

Booking rules (all enforced on the server in `src/lib/services/availability.ts`
and `…/reservations.ts`):

- 30-minute slot grid, **30-minute minimum lead time**, **60-day** booking window
- Club hours come from `club_settings` (default `14:00–02:00`, `Asia/Manila`);
  a request that would cross closing time is rejected
- Duration must satisfy both the club minimum (60 min) and the room's own
  `minimumDuration`; guest count must fit the room capacity
- **Price is computed server-side** from `room.hourlyRate` in integer centavos —
  the client never sends an amount
- Cancel/lookup require the mobile number that made the booking; the
  confirmation page additionally requires the one-time `accessToken`

### 7.3 Concurrency, idempotency and cancellation

- **Idempotency first, availability second.** Every submission carries a
  `submissionKey`; a unique partial index
  (`uniq_submission_key`, filtered on `{ submissionKey: { $type: "string" } }`)
  makes a double-click or a network retry return the *same* reservation
  (`200 { duplicate: true }`) instead of booking twice.
- Only a **live** booking may own the key (`PENDING`, `CONFIRMED`, `CHECKED_IN`,
  `COMPLETED`). When a booking is cancelled, the key is released with
  `$unset`, so the same party can genuinely rebook the same room and time.
- **Slot locking** writes one document per 30-minute slot into
  `room_slot_locks` via `insertMany({ ordered: true })`; the unique
  `(room, slotStart)` index is the real conflict detector, so two simultaneous
  requests cannot both win. The loser gets `409 SLOT_TAKEN`. If the reservation
  insert fails afterwards, the locks are deleted in compensation — no orphans.
- Locks left behind by an expired `PENDING` hold are cleared in the same write
  path, so a slot is never advertised as free and then refused.
- Cancelling releases every lock immediately, keeps the booking in history with
  `statusHistory`, and is itself guarded (a second cancel returns `409`).
- Inside the cancellation cutoff (default **4 hours** before start, configurable
  in `club_settings.cancellationCutoffHours`) a customer cannot self-cancel; the
  request is recorded as `cancellationRequest.status = PENDING` for staff to
  action in Phase 3, and the customer is told so in the response and on screen.

### 7.4 Data seeded for the demo

`npm run seed:rooms` (idempotent, `--force` re-applies) writes 4 categories and
6 rooms — Sapphire ₱800 · Onyx ₱1,000 · Velvet ₱1,800 · Gold ₱2,200 · PUBLIQ
Premium ₱3,500 · The Parlour ₱4,500 per hour — each with capacity, minimum
duration, amenities and a cover image in `public/images/`.

`npm run db:indexes` runs `syncIndexes()` for the reservation and room models.
Run it once against an **existing** database after upgrading, because a plain
deploy will not drop a renamed/redefined index (this is what fixed
`uniq_submission_key` here).

### 7.5 Phase 2 test evidence

- `npm run typecheck` → clean · `npm run build` → succeeds
- `npm run test:phase2` → **29/29** checks (also green when re-run twice back to
  back on an empty database, i.e. repeatable): slot grid, server-side pricing,
  4 slots locked, replay returns the same reservation, `409` for
  double-booking / capacity / outside-hours / past date, `422` validation,
  immediate cancel + lock release + history, double-cancel `409`,
  rebooking the same room+time after a cancel, reclaiming a slot whose pending
  hold expired, cutoff → staff request,
  `429` rate limit, lookup authorisation, and no secrets in the HTML
- `npm run test:ui:phase2` → **17/17** Playwright checks at 320 / 390 / 1366 px:
  homepage, rooms → detail, gallery switching, CTA carrying the room into the
  wizard, the whole wizard through to a real confirmation page, policy card and
  copy button, lookup success and rejection of a wrong mobile number, the
  cancellation dialog, unknown-reference and expired-token empty states, mobile
  drawer, no horizontal overflow, no tap target under 32 px, and a clean
  browser console
- 15 screenshots in `screenshots/phase2/`

| Defect found in testing | Fix |
| --- | --- |
| Availability was evaluated before the idempotency check, so a legitimate retry after a cancel returned `409 CONFLICT` instead of the stored booking. | Reordered: key lookup first, then availability. |
| A **cancelled** booking kept its `submissionKey`, so rebooking the same room/time silently replayed the dead reservation (this is what broke the lookup browser tests). | `IDEMPOTENT_STATUSES` gate + release the key on cancel. |
| Releasing the key with `{ $set: { submissionKey: null } }` collided with the unique index on the *next* release → `E11000 dup key { submissionKey: null }` and a `500`. | Partial unique index (`$type: "string"`) + `$unset`; `npm run db:indexes` migrates existing databases. |
| Several footer/header/inline links were under the 32 px touch-target minimum. | `min-h-9` / `min-h-8` on the interactive elements; asserted by the browser suite. |
| Confirmation summary had a broken `Gap-3` class and a "guests" row using the wrong icon. | `gap-3 flex-wrap`, `UserRound` icon, and a cancellation-policy card added. |
| An expired `PENDING` hold released its slot in the availability engine but left its `room_slot_locks` rows behind, so the slot was advertised as free and then rejected by the unique index — permanently, until a manual fix. | The create path now clears locks whose owner is no longer live (or missing) immediately before claiming the slots; regression check added. |

---

## 8. Phase 3 — Admin Console

Everything the floor needs to run a night, behind the Phase 1 role matrix and
on top of the Phase 2 booking engine — the console never gets to be a second
source of truth about price, availability or who may do what.

### 8.1 Screens

| Route | Contents |
| --- | --- |
| `/admin` | Shift overview: tonight's counts and takings, pending-approval queue, a 7-night trend, `Seat a walk-in party`, `Release expired holds`, and the greeting Phase 1 promised |
| `/admin/reservations` | The board: `Tonight / Upcoming / Custom range` tabs, filters (status, room, source, sort) as a **plain GET form**, search that treats text literally, one-click Confirm / Decline-with-reason per row, pager |
| `/admin/reservations/[id]` | One booking: state + balance + held slots, action rail, and four tabs — **Guest** (edit details, capacity re-checked), **Money** (record a payment or a refund, see the ledger for this booking), **Move** (room/date/time with re-pricing and a required reason), **Notes** (internal timeline, never shown to the guest) — plus a print-ready summary |
| `/admin/calendar` | Night grid: every room × every 30-minute slot for one date, blocks and bookings distinguishable, click through to the booking |
| `/admin/rooms` | Rooms and categories: create/edit/delete, `sortOrder` up/down controls, maintenance switch with a note, delete refused while history exists |
| `/admin/blocks` | Blocked windows for one room or the whole venue, overnight wrap supported, overlap with live bookings needs an explicit acknowledgement, Close/Reopen are soft state changes |
| `/admin/customers` | Guest search by name, mobile (any spelling) or email; profile page with visits, lifetime spend, house notes; mobile number is not editable, because it is the lookup key |
| `/admin/payments` | The ledger: date window, method and reference filters, per-method breakdown, `Collected / Refunded / Net in window` |
| `/admin/settings` | Club identity, trading hours, hold expiry, cancellation policy and cutoff, timezone, currency, socials — with a **diff report** on save and advisories for changes that affect live bookings |
| `/admin/team` | Admin accounts: create, role change, password reset, enable/disable, live sessions per device with hand revocation; the last Super Admin cannot be demoted |
| `/admin/forbidden` | Where a permission guard sends you, naming the permission that was missing |
| `/admin/system` | Phase 1 health page (database, indexes, build info), still reachable |

Lists are **server components reading search params**, so every filtered view is
a URL you can bookmark or send to a colleague; only mutations ship JavaScript.
Each mutation goes through `useAdminAction` → `router.refresh()`, so the
server-rendered numbers on the page change together with the write.

### 8.2 Admin API

Every route is created by `adminRoute({ permission, mutating, rate, run })`
(`src/lib/api/admin.ts`), which is the **only** place that checks same-origin,
applies the rate bucket, resolves the session and enforces the permission.

| Method · path | Purpose | Permission |
| --- | --- | --- |
| `GET /api/admin/reservations` | Board page: filters, search, counts, attention queue | `reservation:view` |
| `POST /api/admin/reservations` | Seat a walk-in (server prices it; `confirmNow` skips the hold) | `reservation:edit` |
| `GET · PATCH /api/admin/reservations/[id]` | Detail (with `allowedActions` for *this* role) / edit guest details | `reservation:view` · `reservation:edit` |
| `POST /api/admin/reservations/[id]/action` | CONFIRM · REJECT · CHECK_IN · COMPLETE · NO_SHOW · CANCEL · EXPIRE | `reservation:status` (+ `reservation:decide` for the two decisions) |
| `POST /api/admin/reservations/[id]/move` | Re-room / re-time with re-pricing and a reason | `reservation:edit` |
| `POST /api/admin/reservations/[id]/note` | Internal note on the timeline | `reservation:edit` |
| `POST /api/admin/reservations/[id]/cancellation` | Approve or decline a guest's late cancellation request | `reservation:decide` |
| `POST /api/admin/reservations/[id]/payments` | Record a payment or a refund | `payment:record` |
| `POST /api/admin/reservations/sweep` | Expire lapsed holds and release their slots | `reservation:status` |
| `GET /api/admin/calendar` | Night grid for one date | `reservation:view` |
| `GET · POST /api/admin/rooms` · `PATCH · DELETE /[id]` | Room CRUD | `room:view` · `room:manage` |
| `POST /api/admin/rooms/[id]/maintenance` · `PUT /api/admin/rooms/order` | Take a room off sale · reorder the list | `room:manage` |
| `GET · POST /api/admin/categories` · `PATCH · DELETE /[id]` | Category CRUD | `room:view` · `room:manage` |
| `GET · POST /api/admin/blocks` · `POST /api/admin/blocks/[id]` | List/create windows · `close` / `reopen` | `reservation:view` · `reservation:edit` |
| `GET /api/admin/customers` · `GET · PATCH /[id]` | Search · profile and house notes | `customer:view` · `reservation:edit` for the write |
| `GET /api/admin/payments` · `DELETE /api/admin/payments/[id]` | Ledger · delete a bogus entry (logged, never a rewrite) | `payment:view` · `payment:record` |
| `GET · PUT /api/admin/settings` | Read the club document · save with a diff | `settings:view` · `settings:manage` |
| `GET · POST /api/admin/team` · `GET · PATCH · POST /[id]` | Accounts · create · sessions list · role/password/active · `unlock` / `revoke-session` | `admin:manage` |

Cross-cutting guards: unauthenticated → `401`; a role without the permission →
`403 "Your role does not include permission for this action."`; a mutation
without a same-origin `Origin` → `403`; malformed ObjectId in the path → `404`
(`readId` keeps junk out of Mongoose); validation → `422` with
`details.fields` keyed per input; a state conflict → `409`; buckets are
`240 / 5 min` for reads, `60 / 5 min` for writes and `30 / 5 min` for payment
deletions, keyed per client IP.

### 8.3 Authorization is per action, not per route

- Pages call `requireAdminPermission`, APIs call `requireApiAdmin` — the same
  matrix Phase 1 defined (`ROLE_PERMISSIONS` in `src/config/app.ts`).
  `can()` in the UI only decides what is *drawn*; a hidden button is never a
  control.
- A route can declare exactly one permission, but a booking action rail has two
  capabilities inside it. `applyReservationAction` therefore re-checks the
  action itself against `ACTION_PERMISSION` (`reservation:decide` for
  CONFIRM/REJECT, `reservation:status` for the rest) and answers `403`. Staff —
  who hold `status` but not `decide` — can check a guest in and release a lapsed
  hold, and cannot approve a booking, anywhere, including by POSTing directly.
- `GET /api/admin/reservations/[id]` returns `allowedActions` **filtered by the
  actor**, and the row controls split `canDecide` from `canStatus`, so the
  console never offers a control the server would refuse.
- Even a Super Admin is refused `admin:manage`-less roles' privileges… by the
  matrix, not by convention: `ADMIN` deliberately lacks `admin:manage`, so only
  a Super Admin can create or disable accounts.

### 8.4 The lifecycle is a state machine, not a set of buttons

`RESERVATION_TRANSITIONS` is the whole truth: CONFIRM `PENDING→CONFIRMED`,
REJECT `PENDING→REJECTED`, CHECK_IN `PENDING|CONFIRMED→CHECKED_IN`, COMPLETE
`CHECKED_IN|CONFIRMED→COMPLETED`, NO_SHOW, CANCEL, EXPIRE. Every mutation is a
conditional write with `status` inside the filter, so two operators clicking
Confirm at once produce one `200` and one `409` (and one history entry, not
two). A `COMPLETED` night cannot be re-opened by a stray click. Each accepted
action appends its own `statusHistory` row with `changedBy` = the acting admin,
and cancelling or completing releases every `room_slot_locks` row, which puts
the slot straight back on the public site.

### 8.5 Money is never typed by an admin

- Edits and moves re-price through `calculateReservationAmount`; the schemas are
  `strict()`, so a client-supplied `amount` is a `422`, not an instruction.
- A payment is validated against the outstanding balance: over-collecting is
  refused and writes nothing.
- `Payment` rows are immutable. A refund is a **new** `REFUNDED` row; the only
  delete is for a bogus entry, which is logged with actor and amount.
- The ledger's `Collected / Refunded / Net` always describe the **date window**,
  never the visible subset — filtering to CASH narrows the rows, and the totals
  stay the night's real takings, because a screen that quietly re-adds itself
  after a filter is worse than no screen.
- Payment notes are copied into the booking's timeline, since "why" is the only
  thing anybody wants six months later.

### 8.6 Deliberate omissions

No date-picker or data-grid dependency: filters are native inputs in a GET form.
No optimistic updates: a wrong number on a money screen costs more than a
200 ms wait. No hard deletes where history exists — rooms with bookings, and
any account that could still be named in a timeline, are deactivated instead.
Blocks are soft-closed so a night can be handed back without losing the record
of who closed it and when.

### 8.7 Phase 3 test evidence

- `npm run typecheck` → clean · `npm run build` → succeeds (19 static pages)
- `npm run test:phase1` → **18/18** · `npm run test:phase2` → **29/29**
  (re-run after the Phase 3 services were touched, because both suites share
  `availability.ts` and the reservation service)
- `npm run test:phase3` → **80/80** API checks against real MongoDB, with every
  expectation cross-checked against the document, not just the response: the
  auth matrix per role, CSRF, hold pricing, the confirm/check-in/complete
  trail, terminal states, parallel double-confirm, the sweep, filters and
  literal search, per-action permission enforcement, payments/refunds/delete,
  blocks (venue vs room, overnight wrap, overlap acknowledgement, close/reopen
  stamps), settings diff and advisories, team create/promote/reset/disable with
  session revocation, room reorder and delete protection, no secrets in the
  HTML, per-IP rate limiting, and self-cleaning fixtures
- `npm run test:ui:phase3` → **24/24** Playwright checks in real
  Chromium at 1366 and 390 px: signing in and being refused when wrong, the
  sidebar matching capability, walk-in seating through the dialog, declining a
  pending booking with a required reason, tab switching without navigation, an
  internal note landing on the timeline with its author, a counter payment
  closing the balance on the page, over-collection refused, a room created with
  `seats = 0` flagged on the field then created and deleted, a venue block
  closing a night on the public site and reopening it, customer notes surviving
  a reload, a settings mistake caught where it was typed and a good save
  reporting its diff, the floor account seeing a smaller console and being
  bounced from `/admin/team`, print media dropping the chrome, every screen
  fitting a phone, and no unnamed icon-only control anywhere
- Screenshots in `screenshots/phase3/`

| Defect found in testing | Fix |
| --- | --- |
| Routes validated a body and then the service validated the **transformed** result, so any payload a transform touches failed the second pass: a payment of `"100.00"` became `10000` and `422`ed, a customer notes-only edit became `email: null` and `422`ed, and `"1,800.00"` on a room broke the same way. | Exactly one validator per request. The route-level `parse` calls on payments and customers are gone, and the pre-schema `normalizeRateFields` helper was deleted so the schema attributes errors to the real field. |
| A stored `null` image URL failed `urlField` on the GET→PUT round trip, and `settingsSchema` rejected the nested `socials` object the same endpoint returns — so settings could never be re-saved unchanged. | `urlField` accepts `null`, the schema accepts both socials spellings, and `updateSettings` flattens, compares and diffs them (they had been silently skipped, so `changes` never listed them). |
| A booking action route guarded `reservation:status`, so a Staff account could have approved a booking by POSTing to it. | `ACTION_PERMISSION` + `actorMayPerform` enforced inside `applyReservationAction`; `allowedActions` filtered per actor; row controls split into `canDecide`/`canStatus`. |
| "Already confirmed", "someone moved this booking" and "no open cancellation request" all answered `422`, which reads to an operator as *fix your form*. | State conflicts now raise `ConflictError` → `409`; a missing document raises `NotFoundError` → `404`. |
| `GET /api/admin/team/not-a-real-id` threw a `500` from Mongoose. | `readId()` on every `:id` route. |
| `POST /api/admin/blocks/[id]` and `…/team/[id]` treated any unrecognised `action` as the default one — a typo in `{action:"clsoe"}` **closed** the window and returned `200`. | Explicit `switch`es that answer `422` for anything unlisted. |
| Trying to deactivate your own account reported "the last Super Admin cannot be removed", sending the operator to the wrong person. | The self-lockout guard is raised first, with its own message. |
| Closing a block left `closedBy/closedAt` unset, and reopening kept the stale stamps, so the record described a state it was no longer in. | Both stamps are written on close and `$unset` on reopen. |
| Filtering the ledger to one payment method also shrank the totals next to it — the screen re-reported the night's takings as only the CASH slice. | Totals are computed over a separate `windowFilter`; the CASH view keeps the window's figures, asserted from both the page and the API. |
| Ledger rows serialised the *populated* reservation document into `reservationId`, so the link to the booking was dead. | Read `reservation._id` from the populated doc and type the populate projection accordingly. |
| The blocks list had its two controls inverted: an open window offered **Reopen** and a closed one offered **Close window**, so the button an operator reaches for was always refused by the API. | Both rows use `ActionButton` with the payload their label promises, and the browser suite now closes a night, checks the public site sells it again, and reopens it. |
| The console greeting Phase 1 had shipped drifted onto `/admin/system`, silently breaking `npm run test:phase1`. | `/admin` greets the operator again (and says what the club's doors are), Phase 1 back to 18/18. |
| One interrupted run poisoned the shared dev database — a settings test left the club trading `20:00–20:00`, and the next 12 checks failed on `CLOSED_HOURS` for reasons that looked like app bugs. | The suite snapshots the club document and restores it, asserts up front that the configured night covers the hours it intends to book, and sweeps its own leftover fixtures (bookings, profiles, `QA …` rooms, its block reasons, its throwaway accounts) before it starts. |
| Wrong collection names in the harness (`admins` vs `admin_users`, `blocks` vs `room_blocks`) made Mongo return `null` instead of failing, which impersonated about fifteen application bugs. | The models set `collection:` explicitly; the suite reads through that one mapping and the ground-truth helpers assert on real names. |

| Client-rendered date formatting caused React hydration error #418 and left parts of the console unusable. | Compute the date label in the server layout and pass it to the shell. |
| Customer and reservation edits used POST against PATCH-only endpoints, producing 405 errors. | Specify PATCH for these actions. |
| An empty room slug was rejected instead of deriving a slug from the name. | Normalize blank slug to undefined before validation. |
| Room, category, block and team writes succeeded but server-rendered lists remained stale after modal saves. | Refresh the router following successful mutations. |
| Room, category and payment removal used POST against DELETE-only routes. | Allow explicit DELETE in the shared action control and use it for removal. |
| Deletion dialogs asked for a reason that those endpoints do not store. | Hide the reason field for these actions. |
| Saving settings left the dirty comparison based on the old values, preventing a proper revert. | Refresh the server-provided settings baseline after save. |
| Empty query parameters from filter forms incorrectly filtered out results. | Strip empty query values on both admin page and API paths. |

---

## 9. Phase 4 — Hardening

### Shared rate limits

All existing public, login and admin rate limits now use atomic MongoDB
fixed-window counters shared across application processes. Keys are SHA-256
hashes rather than raw emails, phone numbers or IPs. Bucket expiry is enforced
on every update; the `rate_limit_expiry` TTL index is only storage cleanup. If
MongoDB is unavailable, protected requests fail closed. Run `npm run db:indexes`
when provisioning the database. Clock synchronization between servers matters
because windows use application timestamps. Login email counters are reset
on a successful login; IP counters are not.

**Proxy trust is a deployment requirement:** `X-Forwarded-For` / `X-Real-IP`
are trusted as supplied. Configure the edge to remove client-supplied forwarding
headers and inject the genuine client address; never expose the app directly to
untrusted clients with these headers unsanitized. IPs are masked before hashing,
so quotas can be shared across a subnet. The limiter is not a replacement for
an edge WAF or account lockout.

### Expired holds and scheduling

`GET /api/cron/expire-holds` requires `Authorization: Bearer <CRON_SECRET>`,
with a secret of at least 32 characters. Each pending-to-expired transition and
its slot release are committed in one MongoDB transaction; an expired hold
cannot be confirmed or checked in. Runs are bounded to 200 candidates or about
40 seconds, and overlapping runs are safe. More work is picked up next time.
The board and its manual sweep remain available. MongoDB must be a replica set
or Atlas cluster with transaction support.

`vercel.json` proposes both jobs every five minutes. This frequency requires a
Vercel plan that permits it; alternatively configure an external scheduler to
make authenticated GET requests to both cron endpoints every five minutes.
Create a unique random `CRON_SECRET` in the deployment's secret store; never
put a real secret in source control. The endpoint was invoked and tested over
HTTP locally, but a hosted scheduler has not yet been exercised.

### Notification outbox

New customer bookings atomically store SMS, optional email, and staff-email
jobs in the reservation; confirmations also enqueue guest messages atomically
with the guarded status transition. A walk-in gets guest messages but not a
new-customer-request staff alert. Existing dashboard pending requests remain
the staff's in-app queue. `GET /api/cron/notifications` uses the same secret,
leases due jobs across instances and attempts a bounded batch. It skips jobs
whose expected status, time or room no longer matches. A move does not itself
generate a replacement message. This check cannot prevent a change racing with
an already in-flight provider request.

Resend delivers email and Twilio sends SMS; configure `RESEND_API_KEY`,
`NOTIFICATION_FROM_EMAIL`, `NOTIFICATION_STAFF_EMAIL`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` in the server environment. The
sender identities must be approved by their providers. Unconfigured channels
remain queued; the System page reports configuration and pending/failed
counts without displaying credentials. Provider HTTP success means accepted,
not necessarily delivered; no delivery-status webhook is implemented.

Failures use exponential backoff and stop after eight attempts as `failed`;
inspect and resolve failed jobs operationally before retrying. Inspect the
specific reservation and notification id using privileged database access. To
retry **only a failed job** after reviewing the provider outcome, run in mongosh:

```js
db.reservations.updateOne(
  { reservationReference: "NK-...", notifications: { $elemMatch: { id: "job-id", state: "failed" } } },
  { $set: { "notifications.$.state": "pending", "notifications.$.attempts": 0,
            "notifications.$.nextAttemptAt": new Date(), "notifications.$.lastError": null } }
)
```

Delivery is at-least-once. A crash after provider acceptance but before the
acknowledgement can cause a repeat, particularly for SMS; Resend receives an
idempotency key, but exactly-once delivery is not guaranteed. Jobs retain
recipient and message data inside the reservation, so restrict database access
and establish a retention policy before production. Retry manually only after
checking whether the provider already accepted the message.

### Evidence and remaining external validation

- `npm run typecheck` and `npm run build`: pass.
- Phase 1, 2 and 3 API regressions: **18/18, 29/29, 80/80**; Phase 2 and 3
  browser regressions: **17/17 and 24/24**. The Phase 3 suite also checks that
  racing confirmations produce one notification and that expired holds cannot
  be revived.
- `CRON_SECRET=<same-secret-as-server> npm run test:phase4`: **5/5** against
  MongoDB and HTTP, including 40 simultaneous consumes from two separate
  processes, TTL-independent reset, scheduler authentication and overlapping
  expiry sweeps.
- `npm run test:notifications`: **4/4**, using real isolated MongoDB and a
  simulated provider transport; exercises concurrent leases, backoff/retry,
  stale messages and missing configuration. No live email or SMS was sent.
- `npm run test:query-plans`: two index checks on 15,000 synthetic documents:
  expiry examined 5 documents for 5 results; room availability examined 1
  document for 1 result. This is a local query-plan check, not a production
  load or latency benchmark.

Before accepting production readiness, configure real provider accounts and
scheduler, verify a controlled real email/SMS and scheduled execution, test the
edge header trust configuration, choose a retention policy, and monitor failed
jobs and backlog. These external checks cannot be performed without the actual
services and credentials.

---

## 10. Phase 5 — Staging preparation

The requested scope is **prepare only, staging first**. No hosting, database or
provider account has been provisioned and nothing has been deployed. See
[DEPLOYMENT-STAGING.md](DEPLOYMENT-STAGING.md) for the operator runbook, required
accounts and secrets, safe bootstrap, preview/scheduler limitations, checks,
rollback gate and external validation still required. `npm run deploy:preflight`
checks a provisioned database and environment without writes; `npm run
deploy:smoke` runs five read-only HTTP checks against a configured staging URL.
Both have been exercised locally, not against a hosted staging deployment.

Production promotion requires separate explicit approval after staging review.
