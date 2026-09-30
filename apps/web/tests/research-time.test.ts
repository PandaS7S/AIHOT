import assert from "node:assert/strict";
import { test } from "node:test";
import { researchTime } from "../app/lib/research-time.ts";

test("a source day remains a day instead of a guessed Auckland midnight", () => {
  assert.equal(researchTime("2026-09-30T00:00:00Z", "day", "2026-09-30"), "2026-09-30");
  assert.equal(researchTime(null), "未知");
  assert.ok(!researchTime("2026-09-30T00:00:00Z", "unknown").includes("13:00"));
});
test("precise instants display Auckland DST without changing the stored UTC value", () => {
  assert.match(researchTime("2026-09-30T00:00:00Z"), /13:00/);
  assert.match(researchTime("2026-06-30T00:00:00Z"), /12:00/);
});
