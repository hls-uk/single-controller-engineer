import assert from "node:assert/strict";
import test from "node:test";

import { outputBytesFor } from "../../../src/adapters/beads-embedded/index.js";

// A checkpoint proof reads the complete data diff of the changed projection
// rows. The projection reader admits 256 KiB per capture and a diff carries
// each changed row twice as base64-wrapped cells, so the 64 KiB budget every
// other capture keeps would report a legitimate delta as exceeded, and an
// exceeded capture is never a proof: the run would block on its own write.
test("a dolt diff capture is budgeted for two copies of the projection bound", () => {
  const projectionCapture = 262_144;
  const base64 = 4 / 3;
  assert.ok(
    outputBytesFor(["diff", "--data", "-r", "json", "HEAD"]) >=
      2 * projectionCapture * base64,
  );
  assert.equal(
    outputBytesFor(["diff", "--data", "-r", "json", "HEAD"]),
    1_048_576,
  );
});

test("every other dolt capture keeps the 64 KiB budget", () => {
  for (const argv of [
    ["sql", "-r", "json", "-q", "SELECT * FROM dolt_status"],
    ["version"],
    ["fetch", "origin"],
    ["log", "--oneline"],
  ])
    assert.equal(outputBytesFor(argv), 65_536);
});
