# US-017 — Airport delay alerts (Epic 7: Airport Delays)

**As a** logged-in user who flies often from the same airports,  
**I want to** be alerted when an airport's delays get bad  
**so that** I can change my plans without checking the app all day.

## Acceptance criteria

### Watching an airport
- Logged-in users (US-011 / US-012) see **Alert me** on the Delays tab for the loaded airport; logged-out users see "Log in to get delay alerts"
- An alert has: airport, direction (Both / Departures / Arrivals), threshold, and channel
- Thresholds (pick one):
  - % of flights delayed ≥ N (default 40%)
  - Average delay ≥ N minutes (default 30)
  - "Worse than normal" or "Much worse than normal" (needs US-015)
- Channels: **email** (to the account email) and **in-app** (a bell in the nav with unread alerts)
- A user can have up to **5** alerts; the account page lists them with pause, edit and delete

### Sending
- Alerts are checked every **30 minutes** against the airport's board (last 6 h of flights)
- An alert fires when the threshold is crossed, then not again for that alert until the airport has been back under the threshold for at least 2 hours (no repeated emails during one disruption)
- Optional quiet hours (default 22:00–07:00 in the user's time zone): in-app only, email is held until the quiet hours end and is dropped if the airport has recovered by then
- The email says what crossed, the current figures and links to the Delays tab:  
  "BLR departures: 46% delayed (avg 38 min) — over your 40% alert. See live delays →"
- Every email has a one-click link to pause that alert

### Cost limits (AeroDataBox)
- Each watched airport is fetched once per check, however many users watch it, through the existing board cache
- Total watched airports across all users is capped by `ALERT_MAX_AIRPORTS` (default 10); when full, new alerts for unwatched airports are refused with "Alerts are full right now — try an airport already being watched."
- Estimated cost: 10 airports × 48 checks/day ≈ 480 board calls/day. That's well over the current plan (see the AeroDataBox quota note), so the check interval and cap are configuration (`ALERT_CHECK_MINS`, `ALERT_MAX_AIRPORTS`) and alerts are **off unless `ALERTS_ENABLED=true`**
- Fetched boards are recorded in `movements` as usual, which also grows the US-015 history

### Edge cases
- If the board can't be fetched, the check is skipped (no alert, no "all clear"); after 3 skipped checks in a row the user's alert list shows "Couldn't check BLR recently"
- Deleting the account deletes its alerts
- Unverified or bouncing email addresses fall back to in-app only

## Example

**Alert:** BLR, departures, % delayed ≥ 40%, email + in-app

> **BLR departures are running late**  
> 46% of departures delayed in the last 6 hours (avg 38 min), over your 40% alert.  
> [See live delays →]  ·  [Pause this alert]

## Implementation

- Database: new table `delay_alerts` (`id`, `user_id` → `users.id`, `airport`, `direction`, `metric`, `threshold`, `channels`, `quiet_start`, `quiet_end`, `time_zone`, `paused`, `last_fired_at`, `last_recovered_at`, `created_at`) and `alert_events` (`id`, `alert_id`, `fired_at`, `figures`, `read_at`) for the in-app bell
- Backend:
  - `GET/POST /api/alerts`, `PATCH/DELETE /api/alerts/:id` (session required)
  - `GET /api/alerts/events`, `POST /api/alerts/events/read`
  - `GET /api/alerts/:id/pause?token=…` (signed one-click link from the email)
  - Bull repeatable job (like the collector) every `ALERT_CHECK_MINS`: unique watched airports → `airportDelays()` → evaluate each alert → write events → send email
- Email: new mailer (`nodemailer` + SMTP settings `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_FROM_EMAIL`); the backend has no mailer today
- Frontend: Alert me dialog on the Delays tab, bell + dropdown in the nav, alerts list on the account page

## Out of scope

- Push notifications (web push / mobile) and SMS
- Alerts for a specific flight (flight status alerts)
- Alerts for logged-out users
