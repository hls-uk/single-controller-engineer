import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  canonicalJson,
  normalizeNfc,
  type JsonValue,
} from "../../src/protocol/canonical.js";
import { evidence, evidenceMatches } from "../../src/protocol/evidence.js";

test("canonical JSON sorts object keys and has stable evidence", () => {
  const value = { z: [true, null, 1], a: "text" };
  assert.equal(canonicalJson(value), '{"a":"text","z":[true,null,1]}');
  const record = evidence("fixture", value);
  assert.ok(evidenceMatches(record, { a: "text", z: [true, null, 1] }));
});

test("Unicode normalization remains field-selectable", () => {
  const decomposed = "e\u0301";
  assert.notEqual(canonicalJson(decomposed), canonicalJson("é"));
  assert.equal(
    canonicalJson(decomposed, normalizeNfc),
    canonicalJson("é", normalizeNfc),
  );
});

test("canonicalization is deterministic under key reordering", () => {
  fc.assert(
    fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.jsonValue()),
      (input) => {
        const reversed = Object.fromEntries(Object.entries(input).reverse());
        assert.equal(
          canonicalJson(input as JsonValue),
          canonicalJson(reversed as JsonValue),
        );
      },
    ),
  );
});

test("canonical JSON rejects values outside its supported wire domain", () => {
  assert.throws(() => canonicalJson(Number.NaN));
  assert.throws(() => canonicalJson("\ud800"));
});
