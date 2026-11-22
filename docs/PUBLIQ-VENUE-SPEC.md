# PUBLIQ venue conversion — work in progress

## Confirmed business requirements

- Seven VIP booths and five additional couches (2, 3, 4, 5 and 6).
- VIP 5 and VIP 6: up to 10 guests; other individual VIP booths: up to 12.
- VIP minimum consumable spend: 1–5 guests ₱0; 6–8 ₱7,000; 9 ₱8,500;
  10–12 ₱10,000. This is not an hourly charge or a deposit.
- Couch spaces have no price or minimum spend. Their capacities remain unknown.
- VIP 3 and 4 may also be booked together as a larger space. Its capacity is
  unknown. The combined booking uses one VIP tier for the whole group; it must
  atomically claim both booths and conflict with either individual booking.
- Hours: 9 p.m.–4 a.m. Reservations hold space until closing, even after early
  departure. No deposit. Cocktail-table details are pending.

## Implemented behind a disabled-by-default feature flag

- Google-authenticated individual VIP booking form; selected seat handoff.
- Server-side validation and consumable calculation; confirmed reservation,
  duplicate-request handling, per-user limits and one physical-space claim per
  night enforced by a MongoDB unique index and transaction.
- Google customer session, customer reservation list and read-only staff list.
- Phone-emulated form tests and disposable replica-set tests, using fabricated
  customer sessions (not actual Google sign-in). Combined-seat database claims
  were tested directly, but combined bookings remain disabled due to capacity.
- The former unauthenticated hourly-room public booking API returns HTTP 410.

## Not ready for live bookings

- Customer Google OAuth requires configuration and a real-account test.
- Couch and combined VIP capacities, couch photo assignments and cocktail-table
  details need owner confirmation; affected spaces remain unavailable online.
- Combined party-size pricing above 12 requires a confirmed capacity and policy.
- New seating booking emails are queued but live delivery is untested. They lack
  guest-initiated cancellations, check-in and staff edits. The legacy booking
  workflow is disabled, not integrated. Staff can cancel website bookings and
  release their seat claims from Reservations. Do not accept real bookings until
  the remaining launch checks are complete.
- `npm audit` reported dependency advisories; review and resolve before launch.
- Do not enable `CUSTOMER_BOOKINGS_ENABLED` outside isolated local testing.
- Old records are not migrated or counted in the new seating inventory. Use a fresh database.

Existing database settings override defaults and are not silently migrated.
