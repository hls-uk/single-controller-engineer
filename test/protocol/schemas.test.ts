import assert from "node:assert/strict";
import test from "node:test";
import {
  JudgmentSchema,
  MaterialisationDestinationIdentitySchema,
  ProtocolEventSchema,
  RepositoryRunEnvelopeSchema,
  RuntimeEffectSchema,
  parseEnvelope,
  validate,
  type ProtocolEvent,
} from "../../src/protocol/schemas.js";
import {
  deriveIdempotencyKey,
  runInvariantErrors,
} from "../../src/protocol/reducer.js";
import { HASH, OID_A, OID_B, OID_C, event, run, unit } from "./fixtures.js";

const OID_64 = "e".repeat(64);

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

test("journal checkpoint counters have an exact safe-integer ceiling", () => {
  const initial = run();
  const envelope = {
    payload: {
      ...initial,
      journalCheckpoint: {
        ...initial.journalCheckpoint,
        compactedEffects: Number.MAX_SAFE_INTEGER,
        compactedEvents: Number.MAX_SAFE_INTEGER,
        compactedIdempotencyKeys: Number.MAX_SAFE_INTEGER,
      },
    },
    schema: "sce.repository-run" as const,
    version: 1 as const,
  };
  assert.equal(validate(RepositoryRunEnvelopeSchema, envelope).ok, true);
  for (const field of [
    "compactedEffects",
    "compactedEvents",
    "compactedIdempotencyKeys",
  ] as const)
    assert.equal(
      validate(RepositoryRunEnvelopeSchema, {
        ...envelope,
        payload: {
          ...envelope.payload,
          journalCheckpoint: {
            ...envelope.payload.journalCheckpoint,
            [field]: Number.MAX_SAFE_INTEGER + 1,
          },
        },
      }).ok,
      false,
    );
});

test("knowledge destination identities use canonical unsigned 20-digit bounds", () => {
  const identity = {
    canonicalPath: "/mnt/knowledge",
    device: "12345678901234567890",
    inode: "99999999999999999999",
  };
  assert.equal(
    validate(MaterialisationDestinationIdentitySchema, identity).ok,
    true,
  );
  assert.equal(
    validate(MaterialisationDestinationIdentitySchema, {
      ...identity,
      device: "123456789012345678901",
    }).ok,
    false,
  );
  assert.equal(
    validate(MaterialisationDestinationIdentitySchema, {
      ...identity,
      inode: "01",
    }).ok,
    false,
  );
});

test("provenance observations are strict disjoint variants", () => {
  const base = {
    effectId: "effect-provenance",
    effectKind: "provenance_commit",
    eventId: "event-provenance",
    expectedRevision: 1,
    gateEntryId: "gate-provenance",
    observationHash: HASH,
    type: "provenance_commit_observed",
    unitId: null,
  };
  assert.equal(
    validate(ProtocolEventSchema, {
      ...base,
      result: {
        attemptedBaseOid: OID_A,
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
    }).ok,
    true,
  );
  assert.equal(
    validate(ProtocolEventSchema, {
      ...base,
      result: {
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
    }).ok,
    false,
  );
  assert.equal(
    validate(ProtocolEventSchema, {
      ...base,
      result: {
        attemptedBaseOid: OID_A,
        attemptedCommitOid: OID_B,
        commitOid: OID_B,
        status: "committed",
        treeOid: OID_C,
      },
    }).ok,
    false,
  );
  assert.equal(
    validate(ProtocolEventSchema, {
      ...base,
      result: {
        condition: "dirty_worktree",
        expectedBaseOid: OID_A,
        observedHeadOid: OID_A,
        reasonDigest: HASH,
        status: "worktree_refused",
      },
    }).ok,
    true,
  );
  assert.equal(
    validate(ProtocolEventSchema, {
      ...base,
      result: {
        condition: "dirty",
        expectedBaseOid: OID_A,
        observedHeadOid: OID_A,
        reasonDigest: HASH,
        status: "worktree_refused",
      },
    }).ok,
    false,
  );
});

test("knowledge refusal codes are scoped to their exact effect boundary", () => {
  const base = {
    effectId: "effect-knowledge",
    eventId: "event-knowledge",
    expectedRevision: 1,
    gateEntryId: "gate-knowledge",
    observationHash: HASH,
    unitId: null,
  } as const;
  const cases = [
    {
      effectKind: "materialisation_resolve",
      type: "materialisation_sources_observed",
      valid: "evidence_budget_exceeded",
      invalid: "invalid_destination",
    },
    {
      effectKind: "destination_probe",
      type: "destination_probe_observed",
      valid: "optional_alias_unmounted",
      invalid: "hard_links_unsupported",
    },
    {
      effectKind: "materialise",
      type: "materialise_observed",
      valid: "hard_links_unsupported",
      invalid: "optional_alias_unmounted",
    },
  ] as const;
  for (const item of cases) {
    const value = (code: string) => ({
      ...base,
      effectKind: item.effectKind,
      result: { refusal: { code, detailHash: HASH }, status: "refused" },
      type: item.type,
    });
    assert.equal(validate(ProtocolEventSchema, value(item.valid)).ok, true);
    assert.equal(validate(ProtocolEventSchema, value(item.invalid)).ok, false);
  }
});

test("text fields enforce both character and UTF-8 byte limits", () => {
  const atByteLimit = "🙂".repeat(2_048);
  const overByteLimit = "🙂".repeat(2_049);
  assert.equal(
    validate(RepositoryRunEnvelopeSchema, {
      schema: "sce.repository-run",
      version: 1,
      payload: {
        ...run(),
        units: {
          "unit-1": { ...run().units["unit-1"]!, worktreePath: atByteLimit },
        },
      },
    }).ok,
    true,
  );
  assert.equal(
    validate(RepositoryRunEnvelopeSchema, {
      schema: "sce.repository-run",
      version: 1,
      payload: {
        ...run(),
        units: {
          "unit-1": {
            ...run().units["unit-1"]!,
            worktreePath: overByteLimit,
          },
        },
      },
    }).ok,
    false,
  );
  const state = run();
  const dispatch = {
    ...event(state, "dispatch_intent"),
    requestedModel: atByteLimit,
  };
  assert.equal(validate(ProtocolEventSchema, dispatch).ok, true);
  assert.equal(
    validate(ProtocolEventSchema, {
      ...dispatch,
      requestedModel: overByteLimit,
    }).ok,
    false,
  );
});

test("merge-group integration is not advertised without Phase 2 evidence", () => {
  assert.equal(
    validate(RepositoryRunEnvelopeSchema, {
      schema: "sce.repository-run",
      version: 1,
      payload: { ...run(), integrationProfile: "github-merge-group" },
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

test("Git object observations reject abbreviated OIDs", () => {
  assert.equal(
    validate(ProtocolEventSchema, {
      eventId: "candidate-1",
      expectedRevision: 0,
      unitId: "unit-1",
      type: "candidate_observed",
      effectId: "candidate-intent:candidate_collect",
      effectKind: "candidate_collect",
      observationHash: HASH,
      headOid: "a".repeat(39),
      treeOid: OID_C,
      candidateDiffHash: HASH,
    }).ok,
    false,
  );
});

test("runtime effects are strict executable discriminants, not opaque hashes", () => {
  const effect = {
    kind: "dispatch",
    effectId: "dispatch-1",
    unitId: "unit-1",
    idempotencyKey: "dispatch-key",
    paramsHash: HASH,
    schemaVersion: 1,
    params: {
      branchRef: "sce/unit-1",
      worktreePath: "/tmp/unit-1",
      requestedModel: "workhorse-1",
      promptHash: HASH,
      packet: (
        event(run(), "dispatch_intent") as Extract<
          ProtocolEvent,
          { type: "dispatch_intent" }
        >
      ).packet,
    },
  };
  assert.equal(validate(RuntimeEffectSchema, effect).ok, true);
  assert.equal(
    validate(RuntimeEffectSchema, { ...effect, params: { paramsHash: HASH } })
      .ok,
    false,
  );
});

test("repair-context OIDs obey the selected repository object format", () => {
  const sha256Context = {
    ...run([
      {
        ...unit("unit-1", "repair_required"),
        baseOid: OID_64,
        repairContext: {
          baseOid: OID_A,
          headOid: OID_B,
          treeOid: OID_C,
          responseHash: HASH,
          rationale: "repair",
          findings: [
            { id: "finding-1", severity: "blocking" as const, detail: "fix" },
          ],
        },
      },
    ]),
    gitObjectFormat: "sha256" as const,
  };
  assert.ok(
    runInvariantErrors(sha256Context).some((error) =>
      error.includes("OID incompatible"),
    ),
  );
});

test("idempotency digest stays bounded while 160-character IDs remain valid", () => {
  const runId = "r".repeat(160);
  const incarnationId = "i".repeat(160);
  const holder = `${runId}/${incarnationId}`;
  const state = {
    controller: {
      ...run().controller,
      runId,
      incarnationId,
      holder,
    },
  };
  const unitId = "u".repeat(160);
  const key = deriveIdempotencyKey(
    state,
    Number.MAX_SAFE_INTEGER,
    unitId,
    "reservation_release",
  );
  assert.match(key, /^sce:[0-9a-f]{64}$/);
  assert.equal(
    validate(RepositoryRunEnvelopeSchema, {
      schema: "sce.repository-run",
      version: 1,
      payload: {
        ...run(),
        storeIdentity: "s".repeat(160),
        repositoryIdentity: "p".repeat(160),
        integrationBranch: "b".repeat(160),
        controller: state.controller,
      },
    }).ok,
    true,
  );
  assert.equal(
    validate(ProtocolEventSchema, {
      eventId: "e".repeat(160),
      expectedRevision: Number.MAX_SAFE_INTEGER,
      unitId,
      type: "reservation_release_intent",
      idempotencyKey: key,
    }).ok,
    true,
  );
  const base = deriveIdempotencyKey(run(), 1, "unit-1", "repair");
  assert.notEqual(
    base,
    deriveIdempotencyKey(
      { controller: { ...run().controller, runId: "another-run" } },
      1,
      "unit-1",
      "repair",
    ),
  );
  assert.notEqual(base, deriveIdempotencyKey(run(), 2, "unit-1", "repair"));
  assert.notEqual(base, deriveIdempotencyKey(run(), 1, "unit-2", "repair"));
  assert.notEqual(base, deriveIdempotencyKey(run(), 1, "unit-1", "park"));
});

test("hydrated aggregates cannot exceed the durable envelope budget", () => {
  const oversized = run(
    Array.from({ length: 64 }, (_, index) => ({
      ...unit(`unit-${index + 1}`),
      worktreePath: `/${"x".repeat(8_191)}`,
    })),
  );
  assert.ok(
    runInvariantErrors(oversized).includes(
      "repository run envelope exceeds byte limit",
    ),
  );
});
