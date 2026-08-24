import assert from "node:assert/strict";
import test from "node:test";
import {
  JudgmentSchema,
  RepositoryRunEnvelopeSchema,
  parseEnvelope,
  validate,
} from "../../src/protocol/schemas.js";
import { HASH, run } from "./fixtures.js";

test("strict envelopes reject unknown properties without coercion or defaults", () => {
  const input = {
    schema: "sce.repository-run",
    version: 1,
    payload: run(),
    unexpected: true,
  };
  const result = validate(RepositoryRunEnvelopeSchema, input);
  assert.equal(result.ok, false);
  assert.deepEqual(input.unexpected, true);
  assert.equal(input.payload.revision, 0);
});

test("envelope parsing rejects corrupt and oversized wire input", () => {
  assert.equal(
    parseEnvelope(RepositoryRunEnvelopeSchema, "not json").ok,
    false,
  );
  assert.equal(
    parseEnvelope(RepositoryRunEnvelopeSchema, " ".repeat(131_073)).ok,
    false,
  );
});

test("judgments bind role, model identity, revision, and bounded decision", () => {
  const valid = {
    schemaVersion: 1,
    kind: "review_verdict",
    role: "reviewer",
    sessionId: "session-1",
    requestedModel: "frontier",
    returnedModel: "frontier-2026",
    aggregateRevision: 4,
    promptHash: HASH,
    responseHash: HASH,
    decision: "approve",
    rationale: "Bound to the reviewed pair.",
  };
  assert.equal(validate(JudgmentSchema, valid).ok, true);
  assert.equal(
    validate(JudgmentSchema, { ...valid, extra: "rejected" }).ok,
    false,
  );
  assert.equal(
    validate(JudgmentSchema, { ...valid, decision: "maybe" }).ok,
    false,
  );
});
