# US-016 — Airport conditions for my flight (Epic 7: Airport Delays)

**As a** traveller who has looked up my flight,  
**I want to** see how my departure airport and my airline are running today  
**so that** I can judge whether my flight is likely to be late before the airline announces it.

## Acceptance criteria

### On the flight card
- The flight card (US-003) shows an **Airport today** strip when the flight's scheduled departure is within the next 6 hours (or departed within the last 6 hours):  
  "BLR departures: 38% delayed, avg 27 min · IndiGo at BLR: avg 31 min late (12 flights)"
- If US-015 is available, it adds the rating: "· Worse than normal"
- The strip links to the Delays tab for that airport with the flight highlighted: `#delays/BLR/6E5321`
- Outside that 6-hour period the strip isn't shown (the board wouldn't cover the flight)

### In the Delays tab
- Opening `#delays/BLR/6E5321` loads BLR and highlights 6E 5321 in the flight list (scrolled into view, highlighted row)
- A banner above the list: "Your flight 6E 5321 · scheduled 18:40 · now estimated 19:25 (+45 min)"
- If the flight isn't on the board: "6E 5321 isn't on the BLR board for this period."

### Airline figure
- "IndiGo at BLR" uses the board's flights for the flight's airline and direction, excluding the user's own flight
- Shown only when the airline has ≥ 3 flights with a known delay on the board; otherwise just the airport figure

### Cost and failure
- Uses the cached board (`GET /api/delays`, 15 min cache); an uncached airport costs one AeroDataBox call, the same as opening the Delays tab
- If the board can't be loaded (no key, upstream error) the strip is hidden; the flight card still works

## Example

**6E 5321 BLR → DEL, departs 18:40, it's 16:10**

> **Airport today** — BLR departures: 38% delayed, avg 27 min · IndiGo at BLR: avg 31 min late (12 flights) · Worse than normal  
> [See BLR delays →]

## Implementation

- Frontend: new `frontend/src/components/flight/AirportTodayStrip.tsx` on the flight card; reads `api.delays(depAirport)`
- `DelaysTab.tsx`: accept an optional flight number from the hash (`#delays/<airport>/<flight>`), highlight its row and show the banner
- `page.tsx` hash routing: pass the flight number through, like `#route/BLR/DEL` (US-009)
- No backend changes

## Out of scope

- The arrival airport's conditions (departure only)
- Predicting a specific delay for the user's flight (see the prediction module)
