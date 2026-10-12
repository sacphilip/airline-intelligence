# US-010 — Best airline for a route (Epic 5: Route Analytics)

**As a** traveler,  
**I want** the system to tell me which airline is most reliable on a route  
**so that** I don't have to interpret the comparison table myself.

## Acceptance criteria

- On the route analytics panel (US-009), shows a headline: "🏆 Most reliable airline: IndiGo"
- The headline names the metric used and the margin, e.g. "Reliability Score 80, 4 points ahead of Akasa Air"
- The ranking metric is configurable by the user:
  - Reliability Score (default)
  - On-time rate (highest wins)
  - Average delay (lowest wins)
  - Cancellation rate (lowest wins)
- Changing the metric updates the headline and the table order without a page reload
- The chosen metric is remembered for the next visit
- Only airlines with a Reliability Score (at least 5 completed flights on the route, as in US-009) are eligible
- Ties on the chosen metric are broken by Reliability Score, then by number of flights analyzed
- If only one airline is eligible, shows "Only IndiGo has enough data on this route" instead of a winner
- If no airline is eligible, shows "Not enough data to recommend an airline yet"
- The winning airline's row is highlighted in the comparison table

## Example

**Bengaluru (BLR) → Delhi (DEL)**

| Metric selected | Headline |
|-----------------|----------|
| Reliability Score | 🏆 Most reliable airline: IndiGo · Reliability Score 80, 4 points ahead of Akasa Air |
| On-time rate | 🏆 Most punctual airline: IndiGo · 84% on time, 2 points ahead of Akasa Air |
| Average delay | 🏆 Shortest delays: IndiGo · 18 min average, 3 min less than Akasa Air |
| Cancellation rate | 🏆 Fewest cancellations: IndiGo · 1.2%, 0.3 points below Akasa Air |

## Configuration

User-selectable metric (front end), plus server-side defaults in one place (backend config):

```
ROUTE_BEST_METRIC_DEFAULT = "score"     # score | onTime | avgDelay | cancellation
ROUTE_MIN_FLIGHTS         = 5           # same threshold as US-006 / US-007
```

## Implementation

- Frontend: headline and metric selector at the top of the route analytics panel (US-009); selection saved in local storage
- Backend: `GET /api/route/analytics?from=BLR&to=DEL&metric=score` adds `best: { iata, name, metric, value, runnerUp: { iata, name, value } | null }` to the US-009 response
- `best` is `null` when fewer than 2 airlines are eligible; the response's `airlines` array tells the frontend which message to show
- Ranking logic lives in the backend so the API, UI and QA tests agree on the winner
