import { Type, type Static } from "@sinclair/typebox";

/**
 * The reproduced diff is bounded exactly as the collector bounds the bytes it
 * hashes: a larger diff, or one carrying a NUL byte, is refused before any
 * candidate exists, so it can never match a recorded candidateDiffHash.
 */
export const MAX_CANDIDATE_DIFF_BYTES = 65_536;

/**
 * The domain `deriveCandidateDiffHash` separates with, restated beside the
 * public command that advertises it so an operator can reproduce the digest by
 * hand. A fast test pins this string against the reducer; the two cannot drift.
 */
export const CANDIDATE_DIFF_DOMAIN = "sce.protocol.candidate-diff/v1";

/** The exact UTF-8 diff bytes a packet's canonical Git command prints. */
export const CandidateDigestRequestSchema = Type.Object(
  {
    diff: Type.String({
      minLength: 1,
      maxLength: MAX_CANDIDATE_DIFF_BYTES,
      maxUtf8Bytes: MAX_CANDIDATE_DIFF_BYTES,
      pattern: "^[^\\u0000]*$",
    }),
    raw: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CandidateDigestRequest = Static<
  typeof CandidateDigestRequestSchema
>;

export const CandidateDigestCommandSchema = Type.Object(
  {
    command: Type.Literal("candidate-digest"),
    options: Type.Object(
      { json: Type.Boolean(), request: CandidateDigestRequestSchema },
      { additionalProperties: false },
    ),
    schema: Type.Literal("sce.command.request"),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);
