// The browser's formatting helpers are plain ES modules, so they run in Node too.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { delayClass, esc, fmtClock, fmtDelay, fmtDuration, fmtHoursMinutes } from "../public/js/format.js";

describe("format", () => {
  it("formats delays as signed HHmm", () => {
    assert.deepEqual([85, -10, 0, 135, 1500].map(fmtDelay), ["+0125", "-0010", "0000", "+0215", "+2500"]);
  });

  it("formats durations as unsigned HHmm and never negative", () => {
    assert.equal(fmtDuration(185), "0305");
    assert.equal(fmtDuration(-20), "0000");
    assert.equal(fmtDuration(24.6), "0025");
  });

  it("formats flight times", () => {
    assert.equal(fmtHoursMinutes(125), "2h 05m");
    assert.equal(fmtHoursMinutes(null), "–");
  });

  it("shows clock times in the airport's time zone, or UTC with a Z", () => {
    const t = Date.parse("2026-09-28T14:30:00Z");
    assert.equal(fmtClock(t, "America/New_York"), "10:30");
    assert.equal(fmtClock(t, "Asia/Kolkata"), "20:00");
    assert.equal(fmtClock(t), "14:30Z");
    assert.equal(fmtClock(t, "Not/AZone"), "14:30Z");
    assert.equal(fmtClock(null), "–");
  });

  it("classes delays at the 15-minute threshold", () => {
    assert.deepEqual([null, -3, 0, 14, 15, 90].map(delayClass), ["", "early", "", "", "late", "late"]);
  });

  it("escapes HTML", () => {
    assert.equal(esc(`<b a="1">'&'</b>`), "&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;");
    assert.equal(esc(null), "");
  });
});
