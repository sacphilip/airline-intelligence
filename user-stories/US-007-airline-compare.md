# US-007 — Compare airline reliability scores (Epic 4: Airline Reliability Score)

**As a** traveler,  
**I want to** compare reliability scores across multiple airlines  
**so that** I can choose the most reliable carrier for my route.

## Acceptance criteria

- Shows a ranked list of all airlines that have enough data for a score (minimum 5 flights)
- Each row shows: airline name, IATA code, Reliability Score (0–100), on-time %, avg delay, cancellation rate
- List is sorted by Reliability Score descending by default
- Scores use the same formula as US-006
- Airlines with fewer than 5 observed flights are excluded
- Clicking an airline navigates to its full profile (US-006)

## Example

| Rank | Airline | Score | On-time | Avg delay | Cancellation |
|------|---------|-------|---------|-----------|--------------|
| 1 | IndiGo (6E) | 80 | 84% | 18 min | 1.2% |
| 2 | Air India (AI) | 69 | 72% | 24 min | 2.1% |
| 3 | SpiceJet (SG) | 60 | 65% | 31 min | 3.4% |

Scores assume delay standard deviations of 16, 24 and 30 min respectively.

## Reliability Score formula

```
Score (0–100) =
  On-time performance   × 40 pts   (onTimePct × 40)
+ Cancellation rate     × 20 pts   (max 0, 20 × (1 − cancelRate × 5))
+ Average delay         × 25 pts   (max 0, 25 × (1 − avgDelay / 60))
+ Delay consistency     × 15 pts   (max 0, 15 × (1 − stddev / 45))
```

Minimum 5 flights observed for a score to be shown.

## Implementation

- Frontend: Airlines tab — leaderboard view above or alongside the search box
- Backend: `GET /api/airline/rankings`
- Data source: `movements` PostgreSQL table, grouped and aggregated per airline IATA code
- Returns only airlines that meet the minimum-flight threshold
