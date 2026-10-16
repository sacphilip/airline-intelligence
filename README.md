# Flight Intelligence System



Flight delay prediction and airline reliability analytics powered by data-driven intelligence.



## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 · React 19 · TypeScript · Tailwind CSS · shadcn/ui · react-leaflet |
| Backend | NestJS · TypeScript · REST + SSE |
| Database | PostgreSQL (via TypeORM) |
| Cache | Redis (via cache-manager) |
| Queue | BullMQ (airport history collector) |
| Data | adsb.lol (live positions, free) · AeroDataBox (schedules, paid quota) · Open-Meteo (weather, free) |

## Quick start

### 1. Start PostgreSQL + Redis

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env       # add your AERODATABOX_KEY
npm install
npm run start:dev
# → http://localhost:3100
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
# → http://localhost:3000
```

## Environment variables

See [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example).

The only required key is `AERODATABOX_KEY` (get a free one at [rapidapi.com](https://rapidapi.com/aedbx-aedbx/api/aerodatabox)).
Without it the app falls back to live positions from adsb.lol, with no scheduled times or delays.

## AeroDataBox quota

The free RapidAPI plan gives 400 units/month. Pro ($8/month) gives 5,000 units.
Costs: flight-number search ≈ 1 unit, route search ≈ 4 units, airport board ≈ 2 units.
Results are cached (15–30 min) so reloads cost nothing.

**To avoid burning quota during development**, the backend caches all AeroDataBox responses and never retries within the TTL.
Keep `COLLECT_AIRPORTS` unset unless you want background history collection.

## API endpoints (NestJS)

All endpoints match the original server.js routes exactly.

| Method | Path | Description |
|---|---|---|
| GET | `/api/aircraft` | Live aircraft near a point |
| GET | `/api/airlines` | Airline ICAO → name map |
| GET | `/api/flight` | Aircraft detail (route, ETA, chain) |
| GET | `/api/search` | Search by flight number |
| GET | `/api/route` | Flights between two airports on a date |
| GET | `/api/delays` | Airport arrivals/departures with delays |
| GET | `/api/history` | Recorded movement count |
| GET | `/api/place` | Place search (geocode) |

## Legacy plain-JS app

The original `server.js` + `public/` + `lib/` is still present and still works (`npm start` in the root).
The new stack lives in `backend/` and `frontend/`.
