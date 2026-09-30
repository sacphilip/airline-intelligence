// Shared types used across the backend, mirroring the shapes from the original lib/.

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

export interface FlightEnd {
  airport: Airport | null;
  sched: number | null;   // epoch ms
  best: number | null;
  actual: boolean;
  terminal: string | null;
  gate: string | null;
}

export interface FlightLeg {
  number: string | null;
  callSign: string | null;
  status: string | null;
  statusInferred: boolean;
  cancelled: boolean;
  airline: Airline | null;
  reg: string | null;
  model: string | null;
  hex: string | null;
  dep: FlightEnd;
  arr: FlightEnd;
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

export interface WeatherAssessment {
  severity: 1 | 2;
  text: string;
}

export interface PredictionReason {
  kind: 'inbound' | 'turnaround' | 'airline' | 'weather' | 'history' | 'airport' | 'rotation';
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

export interface Turnaround {
  minutes: number;
  kind: 'wide-body' | 'narrow-body' | 'regional';
}

export interface ChainResult {
  legs: (FlightLeg & { index: number; state: string; depDelay: number | null; arrDelay: number | null; arrSource: string | null })[];
  predictions: LegPrediction[];
  turnaround: Turnaround;
  flightIndex: number;
}

export interface Movement {
  direction: 'Departure' | 'Arrival';
  number: string;
  scheduled: number;
  airport: Airport | null;
  other: Airport | null;
  airline: Airline | null;
  reg: string | null;
  best: number | null;
  actual: boolean;
  cancelled: boolean;
  delayMin: number | null;
  status: string | null;
  source: string | null;
}

export interface FlightHistoryRecord {
  observed: number;
  delayed: number;
  delayedPct: number | null;
  avgDelay: number | null;
  cancelled: number;
  since: number | null;
}

export interface AirportHourRecord {
  observed: number;
  delayedPct: number;
  avgDelay: number;
}
