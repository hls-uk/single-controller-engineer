import assert from "node:assert/strict";
import test from "node:test";
import {
  JudgmentSchema,
  ProtocolEventSchema,
  RepositoryRunEnvelopeSchema,
  parseEnvelope,
  validate,
} from "../../src/protocol/schemas.js";
import { HASH, OID_A, OID_B, OID_C, run } from "./fixtures.js";

test("strict schemas reject unknown properties, coercion, and incomplete effect observations", () => {
  assert.equal(
    validate(RepositoryRunEnvelopeSchema, {
      schema: "sce.repository-run",
      version: 1,
      payload: run(),
      unexpected: true,
    }).ok,
    false,
  );
  assert.equal(
    validate(ProtocolEventSchema, {
      eventId: "e-1",
      expectedRevision: "0",
      unitId: "unit-1",
      type: "dispatch_intent",
      idempotencyKey: "key-1",
      paramsHash: HASH,
    }).ok,
    false,
  );
  assert.equal(
    validate(ProtocolEventSchema, {
      eventId: "e-1",
      expectedRevision: 0,
      unitId: "unit-1",
      type: "dispatch_observed",
      effectId: "e-0:dispatch",
      observationHash: HASH,
    }).ok,
    false,
  );
});

test("closed judgment variants enforce reviewer role and exact fact bindings", () => {
  const review = {
    schemaVersion: 1,
    role: "reviewer",
    kind: "review_verdict",
    unitId: "unit-1",
    sessionId: "reviewer-1",
    requestedModel: "frontier",
    returnedModel: "frontier-1",
    aggregateRevision: 4,
    promptHash: HASH,
    responseHash: HASH,
    rationale: "exact reviewed pair",
    baseOid: OID_A,
    headOid: OID_B,
    treeOid: OID_C,
    decision: "approve",
    findings: [],
  };
  assert.equal(validate(JudgmentSchema, review).ok, true);
  assert.equal(
    validate(JudgmentSchema, { ...review, role: "worker" }).ok,
    false,
  );
  assert.equal(
    validate(JudgmentSchema, { ...review, decision: "maybe" }).ok,
    false,
  );
  assert.equal(
    validate(JudgmentSchema, { ...review, extra: "nope" }).ok,
    false,
  );
});

test("envelope parsing remains bounded and corrupt inputs fail closed", () => {
  assert.equal(
    parseEnvelope(RepositoryRunEnvelopeSchema, "not json").ok,
    false,
  );
  assert.equal(
    parseEnvelope(RepositoryRunEnvelopeSchema, " ".repeat(131_073)).ok,
    false,
  );
});
