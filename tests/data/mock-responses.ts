// Deterministic mock data for API interception in tests.
// All timestamps are ISO-8601 UTC strings. Adjust dates when needed.

export const MOCK_SEARCH_RESULT = {
  query: '6E5321',
  source: 'aerodatabox',
  scheduleAvailable: true,
  legs: [
    {
      number: '6E 5321',
      airline: { iata: '6E', icao: 'IGO', name: 'IndiGo' },
      aircraft: { model: 'Airbus A320neo', reg: 'VT-IEV' },
      status: 'Arrived',
      origin: {
        airport: {
          iata: 'BLR', icao: 'VOBL',
          name: 'Kempegowda International Airport',
          municipalityName: 'Bengaluru',
          timeZone: 'Asia/Kolkata',
        },
        scheduled:  '2026-09-30T01:35:00+00:00',
        estimated:  '2026-09-30T01:35:00+00:00',
        actual:     '2026-09-30T01:33:00+00:00',
      },
      destination: {
        airport: {
          iata: 'DEL', icao: 'VIDP',
          name: 'Indira Gandhi International Airport',
          municipalityName: 'New Delhi',
          timeZone: 'Asia/Kolkata',
        },
        scheduled:  '2026-09-30T04:05:00+00:00',
        estimated:  '2026-09-30T04:23:00+00:00',
        actual:     '2026-09-30T04:20:00+00:00',
      },
    },
  ],
};

export const MOCK_FLIGHT_HISTORY = [
  { date: '2026-09-29', delay: 12,  status: 'Arrived',  cancelled: false },
  { date: '2026-09-28', delay: 4,   status: 'Arrived',  cancelled: false },
  { date: '2026-09-27', delay: 31,  status: 'Arrived',  cancelled: false },
  { date: '2026-09-26', delay: 0,   status: 'Arrived',  cancelled: false },
  { date: '2026-09-25', delay: 8,   status: 'Arrived',  cancelled: false },
  { date: '2026-09-24', delay: null, status: 'Canceled', cancelled: true },
  { date: '2026-09-23', delay: 5,   status: 'Arrived',  cancelled: false },
];

export const MOCK_ROUTE_RESULT = {
  source: 'aerodatabox',
  flights: [
    {
      number: '6E 2101',
      airline: { iata: '6E', icao: 'IGO', name: 'IndiGo' },
      status: 'Arrived',
      delayMin: 0,
      origin: {
        airport: { iata: 'BLR', icao: 'VOBL', name: 'Kempegowda International Airport', municipalityName: 'Bengaluru', timeZone: 'Asia/Kolkata' },
        scheduled: '2026-09-30T00:40:00+00:00',
        estimated: '2026-09-30T00:40:00+00:00',
      },
      destination: {
        airport: { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International Airport', municipalityName: 'New Delhi', timeZone: 'Asia/Kolkata' },
        scheduled: '2026-09-30T03:20:00+00:00',
        estimated: '2026-09-30T03:20:00+00:00',
      },
    },
    {
      number: 'AI 501',
      airline: { iata: 'AI', icao: 'AIC', name: 'Air India' },
      status: 'Delayed',
      delayMin: 22,
      origin: {
        airport: { iata: 'BLR', icao: 'VOBL', name: 'Kempegowda International Airport', municipalityName: 'Bengaluru', timeZone: 'Asia/Kolkata' },
        scheduled: '2026-09-30T02:00:00+00:00',
        estimated: '2026-09-30T02:22:00+00:00',
      },
      destination: {
        airport: { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International Airport', municipalityName: 'New Delhi', timeZone: 'Asia/Kolkata' },
        scheduled: '2026-09-30T04:40:00+00:00',
        estimated: '2026-09-30T05:02:00+00:00',
      },
    },
    {
      number: 'SG 1234',
      airline: { iata: 'SG', icao: 'SEJ', name: 'SpiceJet' },
      status: 'Canceled',
      delayMin: null,
      origin: {
        airport: { iata: 'BLR', icao: 'VOBL', name: 'Kempegowda International Airport', municipalityName: 'Bengaluru', timeZone: 'Asia/Kolkata' },
        scheduled: '2026-09-30T05:00:00+00:00',
        estimated: '2026-09-30T05:00:00+00:00',
      },
      destination: {
        airport: { iata: 'DEL', icao: 'VIDP', name: 'Indira Gandhi International Airport', municipalityName: 'New Delhi', timeZone: 'Asia/Kolkata' },
        scheduled: '2026-09-30T07:40:00+00:00',
        estimated: '2026-09-30T07:40:00+00:00',
      },
    },
  ],
};

export const MOCK_AIRLINE_PROFILE = {
  iata: '6E',
  airline: { name: 'IndiGo', iata: '6E', icao: 'IGO' },
  observed: 45,
  total: 47,
  cancelled: 2,
  score: 86,
  onTimePct: 0.84,
  avgDelay: 18,
  cancellationRate: 0.012,
  delayStddev: 12.5,
  delayDist: { early: 5, ontime: 33, slight: 4, moderate: 2, severe: 1 },
  topRoutes: [
    { from: 'BLR', to: 'DEL', count: 12 },
    { from: 'BOM', to: 'DEL', count: 8 },
  ],
  topAirports: [
    { iata: 'DEL', count: 20 },
    { iata: 'BLR', count: 15 },
  ],
  regs: ['VT-IEV', 'VT-IEW', 'VT-IEX'],
};

// Flight numbers / routes used in tests
export const TEST_DATA = {
  validFlightNumber:   '6E 5321',
  validDate:           '2026-09-30',
  validRouteFrom:      'BLR',
  validRouteTo:        'DEL',
  invalidFlightNumber: 'XX 9999',
  invalidAirportCode:  'X',
  validAirlineIata:    '6E',
  validAirlineName:    'IndiGo',
};
