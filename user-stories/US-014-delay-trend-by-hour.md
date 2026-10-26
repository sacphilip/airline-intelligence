# US-014 — Delay trend by hour (Epic 7: Airport Delays)

**As a** traveller or someone meeting a flight,  
**I want to** see how an airport's delays change hour by hour  
**so that** I can tell whether a bad spell is building up or clearing.

## Acceptance criteria

### Chart
- The Delays tab shows a **Delays by hour** chart under the stats row, covering the board's period (last 6 h · next 6 h)
- One bar per scheduled hour, in the airport's local time (e.g. `14:00`): **average delay in minutes** of the flights scheduled in that hour
- Each bar is split or coloured by severity, using the existing delay classes: on time (< 15 min), delayed (15–59 min), heavily delayed (≥ 60 min)
- Cancelled flights in an hour show as a separate count marker on that bar, not as delay minutes
- A "now" marker separates past hours (actual times) from future hours (estimated times); future bars are visibly lighter and labelled "estimated"
- Hovering or tapping a bar shows: hour, flights, delayed, cancelled, average delay
- The chart follows the Both / Departure / Arrival filter

### Trend summary
- A one-line summary above the chart compares the last 2 hours with the 2 hours before:
  - average delay up by ≥ 10 min → "Delays are building up (avg 18 → 34 min)"
  - down by ≥ 10 min → "Delays are clearing (avg 41 → 22 min)"
  - otherwise → "Delays are steady (avg ~20 min)"
- No summary if either 2-hour span has fewer than 5 flights with a known delay

### Edge cases
- Hours with no flights show an empty slot (not a zero bar), so gaps are visible
- Flights with no delay information (no scheduled or estimated time) are left out of the averages but counted in "flights"
- Cargo flights follow the same rules as the flight list (included unless the list excludes them)

## Example

**BLR, departures, 14:00–02:00 local**

| Hour | Flights | Delayed | Avg delay |
|------|---------|---------|-----------|
| 17:00 | 14 | 3 | 9 min |
| 18:00 | 16 | 9 | 28 min |
| 19:00 | 12 | 10 | 47 min |

> Delays are building up (avg 12 → 41 min)

## Implementation

- Frontend only: computed from the flights already returned by `GET /api/delays` (no new API call, no extra AeroDataBox units)
- Group by the airport-local hour of `scheduledLocal`; past/future split by comparing `scheduled` with `now`
- New component `frontend/src/components/delays/DelayTrendChart.tsx`, styled like the existing airline ranking bars

## Out of scope

- Hours outside the board's 12-hour period (history belongs to US-015)
- Splitting by terminal or gate
