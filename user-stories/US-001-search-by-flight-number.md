# US-001 — Search by flight number

**As a** traveler,  
**I want to** search for a flight using its flight number  
**so that** I can see its current status.

## Acceptance criteria

- User enters a flight number (e.g. `6E 5321`)
- System validates the flight number format
- Shows matching flight(s)
- Shows airline, origin, destination and scheduled times
- Shows current status

## Example

Input: `6E 5321`

Expected output:
- Airline: IndiGo
- Origin → Destination
- STD, ETD, STA, ETA
- Status: Scheduled / Departed / In the air / Landed / Delayed / Cancelled

## Implementation

- Frontend: Find Flight tab → Flight number mode
- Backend: `GET /api/search?number=6E5321&date=YYYY-MM-DD`
- Source: AeroDataBox (primary), adsb.lol route fallback
