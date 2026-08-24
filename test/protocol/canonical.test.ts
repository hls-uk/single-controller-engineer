import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  canonicalJson,
  preserveStrings,
  stringNormalizationPolicy,
  type JsonValue,
} from "../../src/protocol/canonical.js";
import {
  EVIDENCE_SCHEMA_VERSION,
  evidence,
  evidenceMatches,
} from "../../src/protocol/evidence.js";

const exactEvidence = {
  schemaVersion: EVIDENCE_SCHEMA_VERSION,
  stringPolicy: preserveStrings,
};

test("RFC 8785 number vector uses ECMAScript JSON number serialization", () => {
  assert.equal(
    canonicalJson({
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
    }),
    '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
  );
});

test("RFC 8785 Unicode key ordering follows UTF-16 code units", () => {
  assert.equal(
    canonicalJson({
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    }),
    '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
  );
});

test("declared field and key normalization happens before JCS serialization", () => {
  const policy = stringNormalizationPolicy([
    { path: ["title"], target: "value", normalization: "nfc" },
    { path: ["prompt"], target: "value", normalization: "exact" },
    { path: ["e\u0301"], target: "key", normalization: "nfc" },
  ]);
  assert.equal(
    canonicalJson(
      { title: "e\u0301", prompt: "e\u0301", "e\u0301": "key" },
      policy,
    ),
    '{"prompt":"é","title":"é","é":"key"}',
  );
  assert.throws(
    () =>
      canonicalJson(
        { "e\u0301": 1, é: 2 },
        stringNormalizationPolicy([
          { path: ["e\u0301"], target: "key", normalization: "nfc" },
          { path: ["é"], target: "key", normalization: "nfc" },
        ]),
      ),
    /duplicate normalized object keys/,
  );
});

test("declared NFC normalization is stable for generated text", () => {
  const policy = stringNormalizationPolicy([
    { path: ["title"], target: "value", normalization: "nfc" },
  ]);
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("a", "e", "\u0301", " ", "😀")),
      (parts) => {
        const title = parts.join("");
        assert.equal(
          canonicalJson({ title }, policy),
          canonicalJson({ title: title.normalize("NFC") }, policy),
        );
      },
    ),
  );
});

test("canonicalization is deterministic under arbitrary key reordering", () => {
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

test("evidence is privacy-safe, deterministic, and domain-bound", () => {
  const value = { a: "text", z: [true, null, 1] };
  const record = evidence("fixture", value, exactEvidence);
  assert.equal(
    record.hash,
    "3326646388351bcf5609fdaa69529a79c846a3eafba29023eb733321f36dc143",
  );
  assert.deepEqual(Object.keys(record).sort(), [
    "hash",
    "kind",
    "schemaVersion",
  ]);
  assert.ok(
    evidenceMatches(
      record,
      "fixture",
      { z: [true, null, 1], a: "text" },
      exactEvidence,
    ),
  );
  assert.ok(!evidenceMatches(record, "other-kind", value, exactEvidence));
  assert.ok(
    !evidenceMatches(record, "fixture", value, {
      ...exactEvidence,
      schemaVersion: EVIDENCE_SCHEMA_VERSION + 1,
    }),
  );
  assert.notEqual(
    evidence("fixture", value, exactEvidence).hash,
    evidence("other-kind", value, exactEvidence).hash,
  );
});

test("declared prompt and response fields remain byte-exact", () => {
  const policy = stringNormalizationPolicy([
    { path: ["title"], target: "value", normalization: "nfc" },
    { path: ["prompt"], target: "value", normalization: "exact" },
    { path: ["response"], target: "value", normalization: "exact" },
  ]);
  const options = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    stringPolicy: policy,
  };
  assert.equal(
    evidence(
      "judgment",
      { title: "e\u0301", prompt: "p", response: "r" },
      options,
    ).hash,
    evidence("judgment", { title: "é", prompt: "p", response: "r" }, options)
      .hash,
  );
  assert.notEqual(
    evidence(
      "judgment",
      { title: "é", prompt: "e\u0301", response: "r" },
      options,
    ).hash,
    evidence("judgment", { title: "é", prompt: "é", response: "r" }, options)
      .hash,
  );
  assert.notEqual(
    evidence(
      "judgment",
      { title: "é", prompt: "p", response: "e\u0301" },
      options,
    ).hash,
    evidence("judgment", { title: "é", prompt: "p", response: "é" }, options)
      .hash,
  );
});

test("canonical JSON rejects invalid Unicode and non-finite values", () => {
  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])
    assert.throws(() => canonicalJson(value));
  assert.throws(() => canonicalJson("\ud800"));
  assert.throws(() => canonicalJson("\udc00"));
});

test("generated byte-exact prompt and response values remain distinct", () => {
  const options = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    stringPolicy: stringNormalizationPolicy([
      { path: ["prompt"], target: "value", normalization: "exact" },
      { path: ["response"], target: "value", normalization: "exact" },
    ]),
  };
  fc.assert(
    fc.property(fc.array(fc.constantFrom("a", "b", " ", "\n")), (padding) => {
      const bytes = `${padding.join("")}e\u0301`;
      const normalized = bytes.normalize("NFC");
      assert.notEqual(
        evidence("judgment", { prompt: bytes, response: "ok" }, options).hash,
        evidence("judgment", { prompt: normalized, response: "ok" }, options)
          .hash,
      );
      assert.notEqual(
        evidence("judgment", { prompt: "ok", response: bytes }, options).hash,
        evidence("judgment", { prompt: "ok", response: normalized }, options)
          .hash,
      );
    }),
  );
});
