import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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
import { compareProtocolText } from "../../src/protocol/reducer.js";

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

/**
 * sce-7g9.2.3 / DEC-20260922-019: protocol order is UTF-16 code-unit order.
 *
 * Collations are not a property of the bytes; they are a property of the host
 * that happened to write them. These helpers give every ordering assertion
 * below three collations to disagree with: two named ones, and whichever one
 * `LANG` or `LC_ALL` selected for this process. A sample that survives all
 * three cannot have been ordered by `localeCompare` on any machine.
 */
const COLLATIONS = ["en-US", "de-DE"] as const;

function collatedOrders(
  values: readonly string[],
): readonly (readonly string[])[] {
  return [
    ...COLLATIONS.map((locale) =>
      [...values].sort(new Intl.Collator(locale).compare),
    ),
    [...values].sort((left, right) => left.localeCompare(right)),
  ];
}

function byteOrder(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
}

/** Identifiers, as `identifier()` in the schemas admits them. */
const IDENTIFIERS = [
  "unit-b",
  "unit-A",
  "unit-10",
  "unit-2",
  "sce:gate:a1",
  "sce:gate:A1",
  "target_1",
  "target-1",
  "unit-1/review",
] as const;

/** Repository paths, as owned paths and materialisation sources spell them. */
const PATHS = [
  "single-controller-engineer/SKILL.md",
  "single-controller-engineer/agents/claude.yaml",
  "single-controller-engineer/references/contract.md",
  "single-controller-knowledge/SKILL.md",
  "docs/_index.md",
  "docs/README.md",
] as const;

test("protocol text ordering is code-unit order, never a collation", () => {
  for (const sample of [IDENTIFIERS, PATHS]) {
    // Schemas restrict identifiers and paths to ASCII, so code-unit order is
    // byte order and the two pins below are the same claim twice.
    assert.ok(sample.every((value) => /^[\u0020-\u007e]+$/u.test(value)));
    const ordered = [...sample].sort(compareProtocolText);
    assert.deepEqual(ordered, [...sample].sort());
    assert.deepEqual(ordered, byteOrder(sample));
    // Every collation reorders this sample, so the pins above are evidence and
    // not a coincidence of the fixture.
    for (const collated of collatedOrders(sample))
      assert.notDeepEqual(ordered, collated);
  }
});

test("materialise stage, gate entry, and observation tuples keep their canonical order", () => {
  // The tuple `compareProtocolText(stage) || compareProtocolText(gateEntryId)`
  // that `actionsForGate` and the reducer's materialise scheduling use: stage
  // is the major key, so every unit-stage entry runs before any gate-stage one
  // can be scheduled behind it.
  const entries = [
    { gateEntryId: "sce:gate:b1", stage: "unit" },
    { gateEntryId: "sce:gate:A1", stage: "unit" },
    { gateEntryId: "sce:gate:a1", stage: "gate" },
    { gateEntryId: "sce:gate:B1", stage: "gate" },
  ] as const;
  const scheduled = [...entries].sort(
    (left, right) =>
      compareProtocolText(left.stage, right.stage) ||
      compareProtocolText(left.gateEntryId, right.gateEntryId),
  );
  assert.deepEqual(
    scheduled.map((entry) => `${entry.stage}/${entry.gateEntryId}`),
    [
      "gate/sce:gate:B1",
      "gate/sce:gate:a1",
      "unit/sce:gate:A1",
      "unit/sce:gate:b1",
    ],
  );
  for (const collated of collatedOrders(
    entries.map((entry) => `${entry.stage}/${entry.gateEntryId}`),
  ))
    assert.notDeepEqual(
      scheduled.map((entry) => `${entry.stage}/${entry.gateEntryId}`),
      collated,
    );

  // The observation tuple the closure snapshot carries: origin unit, then the
  // numeric target ordinal, then the target id.
  const observations = [
    { originUnitId: "unit-a", targetId: "sce:tgt:b", targetOrdinal: 0 },
    { originUnitId: "unit-A", targetId: "sce:tgt:a", targetOrdinal: 1 },
    { originUnitId: "unit-A", targetId: "sce:tgt:B", targetOrdinal: 0 },
    { originUnitId: "unit-A", targetId: "sce:tgt:A", targetOrdinal: 0 },
  ] as const;
  assert.deepEqual(
    [...observations]
      .sort(
        (left, right) =>
          compareProtocolText(left.originUnitId, right.originUnitId) ||
          left.targetOrdinal - right.targetOrdinal ||
          compareProtocolText(left.targetId, right.targetId),
      )
      .map(
        (entry) =>
          `${entry.originUnitId}:${entry.targetOrdinal}:${entry.targetId}`,
      ),
    [
      "unit-A:0:sce:tgt:A",
      "unit-A:0:sce:tgt:B",
      "unit-A:1:sce:tgt:a",
      "unit-a:0:sce:tgt:b",
    ],
  );
});

/**
 * Every runtime file under `src` is an ordered protocol surface: effect
 * scheduling and invariants, the Git, Beads, and materialisation adapters, the
 * commands and CLI that drive them, the harness launch packet, the installed
 * skill manifest, the feedback outbox, and the fencing projections. The scan
 * below enumerates that tree instead of a hand-kept list, so a new top-level
 * entry is covered the day it lands, and `EXPECTED_SURFACES` only pins that the
 * enumeration still reaches everything `src` holds today. Behavioural order
 * pins stay with their surfaces, such as the launch packet's in
 * test/harness/harness.test.ts.
 */
const EXPECTED_SURFACES = [
  "src/adapters",
  "src/cli.ts",
  "src/commands",
  "src/compose",
  "src/controller-config.ts",
  "src/feedback",
  "src/fencing",
  "src/harness",
  "src/install",
  "src/preflight",
  "src/protocol",
] as const;

const LOCALE_SENSITIVE = /localeCompare|Intl\.Collator|toLocale[A-Z]/u;

function typeScriptFiles(root: string): readonly string[] {
  const found: string[] = [];
  // Ordered by the comparator this file pins, so the enumeration and anything
  // it reports read the same on every host.
  const entries = readdirSync(root, { withFileTypes: true }).sort(
    (left, right) => compareProtocolText(left.name, right.name),
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new Error(`refusing symlinked source path: ${entry.name}`);
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...typeScriptFiles(path));
    else if (entry.isFile() && path.endsWith(".ts")) found.push(path);
  }
  return found;
}

test("no ordered protocol surface compares text by locale", () => {
  const repository = resolve(import.meta.dirname, "../..");
  const scanned = typeScriptFiles(join(repository, "src"));
  // An enumerated scan that quietly stopped reaching a surface would make the
  // refusal below vacuous there, so pin every top-level entry of `src`.
  for (const surface of EXPECTED_SURFACES) {
    const root = join(repository, surface);
    assert.ok(
      scanned.some((file) => file === root || file.startsWith(`${root}${sep}`)),
      `scanned no TypeScript file under ${surface}`,
    );
  }
  const offending: string[] = [];
  for (const file of scanned)
    for (const [index, line] of readFileSync(file, "utf8")
      .split("\n")
      .entries())
      if (LOCALE_SENSITIVE.test(line))
        offending.push(`${relative(repository, file)}:${index + 1}`);
  assert.deepEqual(offending, []);
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
        const canonical = canonicalJson(input as JsonValue);
        const reversed = Object.fromEntries(Object.entries(input).reverse());
        assert.equal(canonical, canonicalJson(reversed as JsonValue));
        assert.deepEqual(
          JSON.parse(canonical),
          JSON.parse(JSON.stringify(input)),
        );
        assert.doesNotThrow(() => JSON.parse(canonical));
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
test("canonical JSON rejects leading, middle, trailing, and nested sparse arrays", () => {
  const leading = new Array(1) as unknown as JsonValue;
  const middle = [1, , 3] as unknown as JsonValue;
  const trailing = ["x"] as unknown as JsonValue[];
  trailing.length = 2;
  for (const sparse of [leading, middle, trailing])
    assert.throws(() => canonicalJson(sparse), /sparse arrays/);
  assert.throws(() => canonicalJson({ nested: trailing }), /sparse arrays/);
  assert.equal(
    canonicalJson([0, null, { dense: [true] }]),
    '[0,null,{"dense":[true]}]',
  );
});
test("generated trailing and nested sparse arrays are rejected", () => {
  fc.assert(
    fc.property(fc.array(fc.jsonValue()), (values) => {
      const sparse = [...values] as JsonValue[];
      sparse.length += 1;
      assert.throws(() => canonicalJson(sparse), /sparse arrays/);
      assert.throws(() => canonicalJson({ nested: sparse }), /sparse arrays/);
    }),
  );
});
