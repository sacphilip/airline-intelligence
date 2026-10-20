# US-009 — Compare airlines on a route (Epic 5: Route Analytics)

**As a** traveler,  
**I want to** compare the airlines operating a route  
**so that** I can choose the most reliable airline.

## Acceptance criteria

### Route overview

- User enters origin and destination airport codes (IATA or ICAO); no date is needed
- The route is directional: BLR → DEL and DEL → BLR are analysed separately
- Shows route summary for all airlines combined:
  - Flights analyzed (completed or cancelled flights in the data period)
  - Average delay in minutes (early flights count as 0)
  - On-time rate (% of completed flights departing less than 15 min late)
  - Cancellation rate (% of scheduled flights cancelled)
- Shows the data period, e.g. "Based on flights since 1 Sep 2026"

### Airline comparison

- Shows one row per airline that operated the route in the data period
- Each row shows: airline name, IATA code, flights analyzed, on-time %, avg delay, cancellation rate, Reliability Score (0–100)
- Reliability Score uses the same formula as US-006, applied to that airline's flights on this route only
- Sorted by Reliability Score descending by default; every column is sortable
- Airlines with fewer than 5 completed flights on the route are listed separately as "Not enough data" with their flight count, and no score
- Codeshares are counted once, under the operating airline
- Clicking an airline opens its full profile (US-006)
- If no flights have been recorded for the route, shows "No data for this route yet" instead of an empty table

## Example

**Bengaluru (BLR) → Delhi (DEL)**  
Based on flights since 1 Sep 2026

| Flights analyzed | Average delay | On-time rate | Cancellation rate |
|------------------|---------------|--------------|-------------------|
| 42,381 | 23 min | 78% | 1.7% |

| Airline | Flights | OTP | Avg delay | Cancellation | Reliability |
|---------|---------|-----|-----------|--------------|-------------|
| IndiGo (6E) | 18,673 | 84% | 18 min | 1.2% | 80 |
| Akasa Air (QP) | 6,112 | 82% | 21 min | 1.5% | 76 |
| Air India (AI) | 9,840 | 76% | 29 min | 2.4% | 67 |
| Air India Express (IX) | 3,444 | 67% | 27 min | 1.6% | 65 |
| SpiceJet (SG) | 4,312 | 60% | 31 min | 2.6% | 58 |

The rows add up to the summary: 42,381 flights, flight-weighted 78% on time, 23 min average delay and 1.7% cancelled.
Scores follow the US-006 formula with delay standard deviations of 16, 19, 27, 26 and 31 min respectively.
For example, IndiGo: 0.84 × 40 + 20 × (1 − 0.012 × 5) + 25 × (1 − 18/60) + 15 × (1 − 16/45) = 33.6 + 18.8 + 17.5 + 9.7 = 79.6 → 80.

## Definitions

```
Completed flight  = departure movement with actual = true, cancelled = false, delay_min known
On-time           = completed flight with delay_min < 15
Average delay     = mean of max(delay_min, 0) over completed flights
Cancellation rate = cancelled / (completed + cancelled)
Reliability Score = computeScore(...) from US-006, minimum 5 completed flights
```

Departure movements only (`direction = 'Departure'`, `airport = origin`, `other = destination`), so each flight is counted once.

## Implementation

- Frontend: Find Flight tab → Route mode, a "Route analytics" panel above the day's flight list (US-002); also reachable by hash `#route/BLR/DEL`
- Backend: `GET /api/route/analytics?from=BLR&to=DEL`
- Response shape: `{ from: "BLR", to: "DEL", since: 1788220800000, summary: { flights, avgDelay, onTimePct, cancellationRate }, airlines: [ { iata, name, flights, onTimePct, avgDelay, cancellationRate, score } ], insufficient: [ { iata, name, flights } ] }`
- Data source: `movements` PostgreSQL table, filtered by origin and destination, grouped by airline IATA code
- Reuses `computeScore`, `DELAYED_MIN` and `MIN_FLIGHTS` from `movement.repository.ts`
- Cached: 1 hour per from+to pair
