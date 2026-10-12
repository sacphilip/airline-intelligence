/**
 * Inputs for the UI tests. There is no canned response data: every test runs
 * against the real backend and checks the UI against what the backend returned.
 */

export const TEST_DATA = {
  // A busy route, so there are always real flights today to search and pick from.
  routeFrom:          'BLR',
  routeTo:            'DEL',
  // Valid format, but no airline uses it: the backend really answers "not found".
  unknownFlightNumber: 'ZZ 9999',
  unknownAirlineIata:  'ZZ',
  invalidAirportCode:  'X',
};
