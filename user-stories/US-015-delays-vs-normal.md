# US-015 — Delays compared to normal (Epic 7: Airport Delays)

**As a** traveller,  
**I want to** know whether today's delays at an airport are unusual  
**so that** I can tell a normal busy evening from a real disruption.

## Acceptance criteria

### Headline
- The Delays tab shows a comparison under the period line, e.g.  
  **"42% delayed now vs 15% usually at this time · Much worse than normal"**
- "Now" = the current board (last 6 h of flights with an actual or estimated time)
- "Usually" = the same airport, same direction filter, same local hours of the day, over the **previous 28 days**, from stored history
- A rating badge, based on the difference in % delayed:
  - ≥ +20 points → **Much worse than normal** (red)
  - +8 to +19 → **Worse than normal** (amber)
  - −7 to +7 → **Normal** (neutral)
  - ≤ −8 → **Better than normal** (green)
- A second figure compares average delay: "avg 34 min vs 12 min usually"

### Per airline
- The airline ranking gets a "vs usual" column: each airline's % delayed now vs its own 28-day figure at this airport, shown only when the airline has ≥ 10 historical flights here

### Not enough history
- Needs ≥ 50 historical flights in the matching hours, spread over ≥ 7 different days; otherwise the headline says  
  "Not enough history for BLR yet to compare (12 flights over 3 days)."
- History only exists for airports whose board has been fetched before, by users or the collector (`COLLECT_AIRPORTS`); the message says so

### Freshness
- Today's flights are excluded from the baseline so they don't dilute it
- The baseline is cached for 6 hours per airport + direction + hour range

## Example

**BLR departures, Monday evening**

> **42% delayed now** vs 15% usually at this time · avg 34 min vs 12 min usually  
> 🔴 Much worse than normal

| Airline | Delayed now | Usually |
|---------|-------------|---------|
| IndiGo | 48% | 14% |
| Air India | 30% | 21% |

## Implementation

- Backend: `GET /api/delays/baseline?airport=BLR&direction=Departure&fromHour=14&toHour=20`
  - SQL on `movements` in `movement/movement.repository.ts`: `airport_iata`/`airport_icao` = code, `direction`, local hour of `scheduled` within the range, `scheduled` in the previous 28 days excluding today, `actual = true` or `cancelled = true`
  - Returns `{ flights, days, delayedPct, avgDelayMin, cancelledPct, byAirline: [{ iata, name, flights, delayedPct }] }`
  - Uses the existing `movements_airport` index; cached 6 h (`CACHE_MANAGER`)
- Frontend: `DelaysTab.tsx` calls the baseline after the board loads and renders the headline + "vs usual" column
- No AeroDataBox calls: history only

## Out of scope

- Seasonal or day-of-week baselines (28 days, all weekdays)
- Explaining the cause (weather, ATC)
