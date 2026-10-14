export const AirlineLocators = {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  iataInput:   /IATA code/i,
  searchButton: 'Search',

  // ── State indicators ────────────────────────────────────────────────────────
  loadingText:     'Loading airline profile…',
  errorBanner:     '[class*="destructive"]',
  scoreText:       /\/100/,
  notEnoughData:   'Not enough data',
  errorPattern:    /invalid|error|not found/i,
  emptyStateText:  /No historical data/i,

  // ── Metric labels ────────────────────────────────────────────────────────────
  onTimeLabel:      'On-time',
  avgDelayLabel:    'Avg delay',
  cancellationLabel:'Cancellation',

  // ── Section headings ─────────────────────────────────────────────────────────
  scoreBreakdownHeading: 'Reliability score breakdown',
  delayAnalysisHeading:  'Delay analysis',
  routesHeading:         'Routes',
  airportsHeading:       'Airports',
  fleetHeading:          /Fleet/,

  // ── Score breakdown component labels ────────────────────────────────────────
  breakdownLabels: [
    'On-time performance',
    'Cancellation rate',
    'Average delay',
    'Delay consistency',
  ] as const,

  // ── Delay distribution bucket labels ────────────────────────────────────────
  delayBuckets: [
    'Early',
    'On time',
    '+15–30 min',
    '+30–60 min',
    '+60 min',
  ] as const,

  // ── Route & airport chips ────────────────────────────────────────────────────
  routeArrow:   /→/,
  airportChip:  'span.font-mono',
};
