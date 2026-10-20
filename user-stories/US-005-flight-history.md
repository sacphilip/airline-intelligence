# US-005 — View flight history

**As a** traveler,  
**I want to** see previous instances of the same flight  
**so that** I can judge how reliable or punctual it typically is.

## Acceptance criteria

- Shows last 7 days of the same flight number
- Each row shows: date, delay, status
- Delay shown as relative value (e.g. +12m, On time)
- Visual delay bar proportional to worst delay in the set

## Example

| Date | Delay |
|------|-------|
| Sep 29 | +12m |
| Sep 28 | +4m |
| Sep 27 | +31m |
| Sep 26 | On time |
| Sep 25 | +8m |

## Implementation

- Frontend: `FlightHistory` component below `FlightCard` in `FlightSearchTab.tsx`
- Backend: `GET /api/flight/history?number=6E839&days=7`
- Source: AeroDataBox `/flights/number/{number}/{YYYY-MM-DD}` per day
- Cached: 1 hour per flight+days pair
- Delay = arrival delay (ETA − STA), fallback to departure delay
- Requires AeroDataBox key; returns empty if not configured
