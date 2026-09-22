import assert from "node:assert/strict";
import test from "node:test";

import { parseDoltDiff } from "../../../src/adapters/beads-embedded/dolt-diff-json.js";

test("wrapped byte-buffer text cells decode to the exact text, nothing else changes", () => {
  const text = "x".repeat(1_000) + " and a trailing ✓";
  const wrapped = Buffer.from(text, "utf8").toString("base64");
  const parsed = parseDoltDiff(
    JSON.stringify({
      tables: [
        {
          name: "issues",
          data_diff: [
            {
              from_row: {
                id: "sce-1",
                description: {
                  Addr: Array.from({ length: 20 }, () => 7),
                  Buf: wrapped,
                },
                n: 1,
              },
              to_row: { id: "sce-1", description: text, n: 1 },
            },
          ],
        },
      ],
    }),
  ) as { tables: { data_diff: { from_row: Record<string, unknown> }[] }[] };
  assert.equal(parsed.tables[0]?.data_diff[0]?.from_row.description, text);
  // A one-key object whose value is not an exact base64 round trip stays as is.
  const kept = parseDoltDiff(JSON.stringify({ Buf: "not base64!" })) as {
    Buf: string;
  };
  assert.deepEqual(kept, { Buf: "not base64!" });
  assert.equal(parseDoltDiff("{"), undefined);
});
