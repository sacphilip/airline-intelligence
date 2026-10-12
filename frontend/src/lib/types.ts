export interface Airport {
  iata: string | null;
  icao: string | null;
  name: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  timeZone: string | null;
}

export interface Airline {
  icao: string | null;
  iata: string | null;
  name: string | null;
}

export interface LiveAircraft {
  hex: string;
  callsign: string | null;
  registration: string | null;
  type: string | null;
  description: string | null;
  lat: number;
  lon: number;
  onGround: boolean;
  altitude: number | null;
  groundSpeed: number | null;
  track: number | null;
  verticalRate: number | null;
  squawk: string | null;
  emergency: string | null;
  distance: number | null;
  seen: number | null;
}

export interface FlightMovement {
  airport: Airport | null;
  scheduled: number | null;
  estimated: number | null;
  terminal: string | null;
  gate: string | null;
}

export interface SearchLeg {
  number: string | null;
  callsign: string | null;
  airline: Airline | null;
  status: string | null;
  statusInferred: boolean;
  origin: FlightMovement;
  destination: FlightMovement;
  aircraft: { registration: string | null; model: string | null; hex: string | null } | null;
  live: LiveAircraft | null;
  liveError: string | null;
}

export interface SearchResult {
  query: string;
  source: string | null;
  scheduleAvailable: boolean;
  legs: SearchLeg[];
}

export interface DelayFlight {
  number: string | null;
  direction: 'Arrival' | 'Departure';
  status: string | null;
  statusInferred: boolean;
  cargo: boolean;
  airline: Airline | null;
  other: { iata: string | null; icao: string | null; name: string | null } | null;
  scheduled: number | null;
  scheduledLocal: string | null;
  best: number | null;
  bestLocal: string | null;
  actual: boolean;
  cancelled: boolean;
  delayMin: number | null;
}

export interface DelaysResult {
  airport: string;
  fetchedAt: number;
  flights: DelayFlight[];
}

export interface PredictionReason {
  kind: string;
  severity: 0 | 1 | 2;
  text: string;
}

export interface LegPrediction {
  index: number;
  level: 'low' | 'moderate' | 'high';
  depDelay: number;
  window: [number, number];
  expectedDep: [number | null, number | null];
  expectedArr: [number | null, number | null];
  reasons: PredictionReason[];
}

export interface ChainLeg {
  number: string | null;
  callSign: string | null;
  status: string | null;
  index: number;
  state: string;
  depDelay: number | null;
  arrDelay: number | null;
  arrSource: string | null;
  dep: { airport: Airport | null; sched: number | null; best: number | null; actual: boolean; terminal: string | null; gate: string | null };
  arr: { airport: Airport | null; sched: number | null; best: number | null; actual: boolean; terminal: string | null; gate: string | null };
}

// US-009 — route analytics (GET /api/route/analytics)
export interface RouteReliability {
  flights: number;                 // completed + cancelled
  avgDelay: number | null;         // minutes; early flights count as 0
  onTimePct: number | null;        // 0..1, of completed flights
  cancellationRate: number | null; // 0..1
}

export interface RouteAirline extends RouteReliability {
  iata: string;
  name: string | null;
  completed: number;
  score: number;                   // Reliability Score (US-006 formula), on this route only
}

export interface RouteAnalytics {
  from: string;
  to: string;
  since: number | null;            // epoch ms of the earliest flight counted
  minFlights: number;
  summary: RouteReliability;
  airlines: RouteAirline[];        // scored, best first
  insufficient: { iata: string; name: string | null; flights: number; completed: number }[];
}
