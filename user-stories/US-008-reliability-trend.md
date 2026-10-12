# US-008 — Airline reliability trend (Epic 4: Airline Reliability Score)

**As a** traveler,  
**I want to** see how an airline's reliability score has changed over time  
**so that** I can tell whether it is improving or declining.

## Acceptance criteria

- Shows monthly Reliability Score for the last N months (default 9)
- Displays a line chart with month on the x-axis and score (0–100) on the y-axis
- Shows a summary headline: "Reliability improved X% over the last N months" or "declined X%"
- Percentage change is calculated as `(latestScore − earliestScore) / earliestScore × 100`
- Trend direction is indicated visually (📈 improved / 📉 declined / — stable)
- Only months with at least 5 observed flights are included as data points
- Months with insufficient data are shown as gaps, not zero

## Example

| Month | Score |
|-------|-------|
| Jan   | 78 |
| Feb   | 80 |
| Mar   | 81 |
| Apr   | 79 |
| May   | 83 |
| Jun   | 85 |
| Jul   | 84 |
| Aug   | 87 |
| Sep   | 86 |

Summary: 📈 Reliability improved 10.3% over the last 9 months.

## Calculation

```
pctChange = (86 − 78) / 78 × 100 = 10.26% ≈ 10.3%
```

Monthly score uses the same formula as US-006, applied to flights observed within that calendar month.

## Implementation

- Frontend: Trend chart section inside the airline profile page (US-006), shown below the overview ring
- Backend: `GET /api/airline/trend?iata=6E&months=9`
- Response shape: `{ iata: "6E", months: [ { month: "2026-01", score: 78, observed: 12 }, … ], pctChange: 10.3, direction: "up" }`
- Data source: `movements` PostgreSQL table, grouped by `DATE_TRUNC('month', scheduled)` per airline
- Cached: 1 hour per iata+months pair
