# Gmail booking emails

This project sends guest confirmations and cancellations and staff booking
alerts through a dedicated Gmail account; no custom domain is required. Google
sign-in for guests is a separate configuration. Email delivery has only been
simulated locally; do not accept live bookings until the other launch blockers
in the main README and controlled live tests are complete.

## 1. Set up the sending account

1. Create or choose a dedicated `@gmail.com` account owned by PUBLIQ. Keep its
   recovery information safe and restrict who can manage it. Use a real mailbox
   you can access, not a placeholder. Replies go to this Gmail address.
2. Enable **2-Step Verification** on that Google account. This is for Gmail,
   not a change to the admin console's sign-in.
3. Visit [Google App Passwords](https://myaccount.google.com/apppasswords), sign
   in as that Gmail account, and create an app password named e.g. PUBLIQ.
   Google says app passwords require 2-Step Verification and may be unavailable
   for some accounts; changing your Google password revokes them. See
   [Google's app password help](https://support.google.com/accounts/answer/185833).
4. Store the app password securely. **Do not use your normal Google password**
   and do not send either password, the cron secret or database URI in chat.

## 2. Configure Vercel

Under Project → Settings → Environment Variables, add each value privately:

| Name | Value |
|---|---|
| `GMAIL_USER` | The dedicated sending account, e.g. `publiq-example@gmail.com` |
| `GMAIL_APP_PASSWORD` | The Google app password (not the normal account password) |
| `NOTIFICATION_STAFF_EMAIL` | A real inbox monitored by staff; it may be Gmail and may be the sending account. One address only. |
| `CRON_SECRET` | A unique cryptographically random secret of 32 or more characters. |

Choose Preview for isolated staging, and Production when approved. Redeploy
once environment values change. Never prefix these variables `NEXT_PUBLIC_`.
Do not share or commit environment files. The From address is automatically
`PUBLIQ <your Gmail address>`; no Resend domain or Resend key is used.

## 3. Start an external scheduler

The Vercel Hobby deployment has no built-in scheduled jobs. Configure an
external HTTPS scheduler, such as https://cron-job.org/, to call your deployment's
`/api/cron/notifications` route using GET every 5 minutes. Set request header
`Authorization` to `Bearer ` followed by your exact `CRON_SECRET`. Store the
header privately, enable failure alerts and check execution history. Use a
separate secret/database and test mailboxes for staging. Protected Preview
deployments may also require an automation bypass; do not make a protected
preview public just to test. A 401 means authentication failed. There is no
email delivery without a working scheduler. Queued emails normally wait until
the next invocation; outages, retries and backlogs may extend this.

## 4. Test safely

With a disposable staging database and consenting test inboxes, make a booking,
check the guest and staff receive their separate confirmation messages, then
cancel it and verify the guest cancellation message arrives. Test Google login,
authenticated scheduler runs, failures and recovery. Check Gmail Sent, recipient
spam folders and scheduler history. Sender acceptance is not proof of inbox
receipt. SMTP offers no exactly-once guarantee; a retry after an ambiguous
failure can duplicate a message. A confirmation already being sent can race a
cancellation. Old bookings do not automatically generate new emails.

Google may throttle or block sending; Gmail is best for low volume. Two emails
are sent per confirmed booking, plus an email when staff cancel. Monitor delivery,
quota, failures and credentials, and consider a transactional provider if volume
or reliability needs grow. If the Gmail password changes or the app password is
revoked, create a new app password, update Vercel, and redeploy.
