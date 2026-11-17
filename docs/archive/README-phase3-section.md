> **Historical archive:** This document describes earlier project phases and may be outdated. The current [project README](../../README.md) and [documentation index](../README.md) take precedence. Do not use this file as a deployment guide.

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
- `npm run test:ui:phase3` → **UI_RESULTS_PLACEHOLDER** Playwright checks in real
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

---

## 9. Next: Phase 4 — Hardening

Move rate limiting out of memory and into MongoDB (shared across instances),
run the pending-hold expiry sweep on a schedule rather than only when someone
loads the board, add notification delivery (email/SMS confirmations and the
staff queue), plus index and query review under realistic volume. **Awaiting
your explicit approval to start.**
