# US-002 — Search by route

**As a** traveler,  
**I want to** search flights between two airports  
**so that** I can see available flights on a given day.

## Acceptance criteria

- User enters origin and destination airport codes (IATA or ICAO)
- User selects a date
- System returns all flights operating that route on that date
- Each result shows: airline, flight number, departure time, arrival time, duration, current status, delay

## Example

Input:
- From: `BLR`
- To: `DEL`
- Date: `2026-09-30`

Expected columns:
| Flight | Dep | Arr | Delay | Status |
|--------|-----|-----|-------|--------|
| 6E 2101 | 06:10 | 08:50 | — | Landed |

## Implementation

- Frontend: Find Flight tab → Route mode
- Backend: `GET /api/route?from=BLR&to=DEL&date=2026-09-30`
- Source: AeroDataBox airport board (full day, two API calls: 00:00–11:59 and 12:00–23:59)
- Cached: 30 minutes per origin+date pair
