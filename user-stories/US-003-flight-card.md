# US-003 — Flight card (Epic 2: Flight Details)

**As a** traveler,  
**I want to** see detailed timing and status for a specific flight  
**so that** I know exactly when to expect departure and arrival.

## Acceptance criteria

- Shows flight number and airline
- Shows STD (Scheduled Time of Departure)
- Shows ETD (Estimated Time of Departure)
- Shows STA (Scheduled Time of Arrival)
- Shows ETA (Estimated Time of Arrival)
- Shows delay (calculated as ETA − STA for arrival delay)
- Shows current status with icon

## Display

| STD | ETD | STA | ETA | Delay | Status |
|-----|-----|-----|-----|-------|--------|
| 07:05 | 07:12 | 08:25 | 08:43 | +18 min | In the air |

## Status values

| Raw status | Display |
|---|---|
| Expected | Scheduled |
| Delayed | Delayed |
| Departed / EnRoute | In the air |
| Arrived | Landed |
| Canceled | Cancelled |

## Implementation

- Frontend: `FlightCard` component in `FlightSearchTab.tsx`
- Backend: `GET /api/search` response `legs[]`
- Delay = `arrDelay` (ETA − STA) preferred, fallback to `depDelay` (ETD − STD)
