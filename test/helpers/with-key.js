// Import before any lib/ module in tests that exercise the AeroDataBox code paths (with fetch
// mocked): config.js reads the key once, at import.
process.env.AERODATABOX_KEY = "test-key";
