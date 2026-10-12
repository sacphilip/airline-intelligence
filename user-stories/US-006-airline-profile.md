# US-006 — View airline profile (Epic 4: Airline Reliability Score)

**As a** traveler,  
**I want to** see an airline's reliability metrics  
**so that** I can make informed booking decisions.

## Acceptance criteria

- Shows airline name and IATA/ICAO codes
- Shows Reliability Score (0–100)
- Shows on-time performance percentage
- Shows average delay in minutes
- Shows cancellation rate percentage
- Shows score breakdown by component
- Shows delay distribution (early / on-time / slight / moderate / severe)
- Shows top routes operated
- Shows top airports served
- Shows known fleet (tail numbers)

## Example

**IndiGo (6E)**  
Reliability Score: 80/100

| Metric | Value |
|--------|-------|
| On-time | 84% |
| Avg delay | 18 min |
| Cancellation | 1.2% |
| Delay std dev | 16 min |

Worked out: 0.84 × 40 + 20 × (1 − 0.012 × 5) + 25 × (1 − 18/60) + 15 × (1 − 16/45) = 33.6 + 18.8 + 17.5 + 9.7 = 79.6 → 80.

## Reliability Score formula

```
Score (0–100) =
  On-time performance   × 40 pts   (onTimePct × 40)
+ Cancellation rate     × 20 pts   (max 0, 20 × (1 − cancelRate × 5))
+ Average delay         × 25 pts   (max 0, 25 × (1 − avgDelay / 60))
+ Delay consistency     × 15 pts   (max 0, 15 × (1 − stddev / 45))
```

Minimum 5 flights required for a score.

## Sections

1. **Overview** — score ring, key metrics, rating badge
2. **Reliability breakdown** — score bars per component
3. **Delay analysis** — 5-bucket distribution histogram
4. **Routes** — top departure routes ranked by frequency
5. **Airports** — top airports served
6. **Fleet** — unique aircraft registrations seen

## Implementation

- Frontend: Airlines tab (`AirlineTab.tsx`), accessible via nav or by clicking airline name on a flight card
- Backend: `GET /api/airline/profile?iata=6E`
- Data source: `movements` PostgreSQL table (built up as users search flights)
- Hash routing: `#airline/6E` opens the tab and pre-fills search
