# PUBLIQ documentation

Start with the [main project README](../README.md) for the current status and launch blockers. These guides are preserved for local review and self-deployment preparation.

| Document | Purpose |
| --- | --- |
| [Local setup](LOCAL-SETUP.md) | Install Node dependencies, start a local MongoDB replica set, create a Super Admin, and preview through ngrok. |
| [Google and booking setup](GOOGLE-AND-BOOKING-SETUP.md) | Configure the Google OAuth client, callback URL and guest-booking environment. |
| [PUBLIQ venue specification](PUBLIQ-VENUE-SPEC.md) | Seating inventory, photo assignments, pricing rules and unconfirmed capacities. |
| [Staging deployment guide](DEPLOYMENT-STAGING.md) | Staging prerequisites, provider setup, checks and rollback planning. Not a production go-ahead. |
| [Original README](archive/README-original.md) | Historical project and phase notes. |
| [Phase 3 notes](archive/README-phase3-section.md) | Historical admin-console phase notes. |

> **Documentation priority:** The main README's current-status section supersedes older claims in the archived documents and older reservation-system guides. The old front-desk workflow is disabled, not reconciled with website seating; do not accept real bookings yet.

The screenshot in [`images/`](images/publiq-homepage.png) is a local homepage preview and uses example contact information.

- [Gmail setup](GMAIL-SETUP.md) — dedicated Gmail sender, scheduler and safe testing.
