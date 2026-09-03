import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";

import { canonicalJson, type JsonValue } from "../../protocol/canonical.js";
import { sha256 } from "../../protocol/evidence.js";
import {
  LIMITS,
  MaterialisationSidecarSchema,
  type DestinationProbeRefusal,
  type MaterialisationResolveRefusal,
  type MaterialiseRefusal,
  type MaterialisationSource,
  type RuntimeEffect,
  validate,
} from "../../protocol/schemas.js";
import {
  materialisationAggregateExpansionCost,
  materialisationProjectionExpansionCost,
} from "../../protocol/reducer.js";
type ResolveEffect = Extract<
  RuntimeEffect,
  { kind: "materialisation_resolve" }
>;
type ProbeEffect = Extract<RuntimeEffect, { kind: "destination_probe" }>;
type MaterialiseEffect = Extract<RuntimeEffect, { kind: "materialise" }>;

export type ResolutionResult =
  | Readonly<{ status: "observed"; sources: readonly MaterialisationSource[] }>
  | Readonly<{ status: "refused"; refusal: MaterialisationResolveRefusal }>
  | Readonly<{ status: "ambiguous"; observationHash?: string }>;

export type MaterialiseResult =
  | Readonly<{
      status: "observed";
      observation: Readonly<{
        artifactByteCount: number;
        artifactSha256: string;
        artifactStatus: "already_present" | "published";
        sidecarByteCount: number;
        sidecarSha256: string;
        sidecarStatus: "already_present" | "published";
      }>;
    }>
  | Readonly<{ status: "refused"; refusal: MaterialiseRefusal }>
  | Readonly<{ status: "ambiguous"; observationHash?: string }>;

export type MaterialisationDiscoveryResult =
  MaterialiseResult | Readonly<{ status: "absent" }>;

export type DestinationProbeResult =
  | Readonly<{
      status: "observed";
      identity: Readonly<{
        canonicalPath: string;
        device: string;
        inode: string;
      }>;
    }>
  | Readonly<{ status: "refused"; refusal: DestinationProbeRefusal }>
  | Readonly<{ status: "ambiguous"; observationHash?: string }>;

export interface MaterialisationAdapter {
  discoverMaterialise(
    effect: MaterialiseEffect,
  ): Promise<MaterialisationDiscoveryResult>;
  materialise(effect: MaterialiseEffect): Promise<MaterialiseResult>;
  probe(effect: ProbeEffect): Promise<DestinationProbeResult>;
  resolve(effect: ResolveEffect): Promise<ResolutionResult>;
}

async function readNoFollow(
  root: string,
  name: string,
  maximumBytes: number,
): Promise<
  | Readonly<{ status: "absent" }>
  | Readonly<{
      status: "file";
      bytes: Buffer;
      device: string;
      inode: string;
      nlink: bigint;
    }>
  | Readonly<{ status: "ambiguous" }>
> {
  try {
    const first = await lstat(join(root, name), { bigint: true });
    if (
      !first.isFile() ||
      first.isSymbolicLink() ||
      first.size > BigInt(maximumBytes)
    )
      return { status: "ambiguous" };
    const handle = await open(
      join(root, name),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const second = await handle.stat({ bigint: true });
      if (
        !second.isFile() ||
        first.dev !== second.dev ||
        first.ino !== second.ino ||
        second.size > BigInt(maximumBytes)
      )
        return { status: "ambiguous" };
      return {
        bytes: await handle.readFile(),
        device: String(second.dev),
        inode: String(second.ino),
        nlink: second.nlink,
        status: "file",
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "absent" }
      : { status: "ambiguous" };
  }
}

type ProcessResult = Readonly<{
  code: number | null;
  signal: string | null;
  stderr: Buffer;
  stdout: Buffer;
}>;

type TreeProcessResult = ProcessResult &
  Readonly<{
    parsingValid: boolean;
    retainedMatches: number;
    unsafeMatchedPathHash?: string;
  }>;

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface MaterialisationProcessPort {
  run(
    executable: string,
    argv: readonly string[],
    options: Readonly<{
      cwd: string;
      env: Readonly<Record<string, string>>;
      input?: Buffer;
      maxOutputBytes: number;
    }>,
  ): Promise<ProcessResult>;
  runTree?(
    executable: string,
    argv: readonly string[],
    options: Readonly<{
      cwd: string;
      env: Readonly<Record<string, string>>;
      maxOutputBytes: number;
    }>,
    sourcePattern: string,
  ): Promise<TreeProcessResult>;
}

export const nodeMaterialisationProcess: MaterialisationProcessPort = {
  run: async (executable, argv, options) =>
    await new Promise((resolveResult) => {
      let settled = false;
      const finish = (result: ProcessResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveResult(result);
      };
      const child = spawn(executable, argv, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let exceeded = false;
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > options.maxOutputBytes) {
          exceeded = true;
          child.kill("SIGKILL");
          return;
        }
        chunks.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", () =>
        finish({
          code: null,
          signal: null,
          stderr: Buffer.alloc(0),
          stdout: Buffer.alloc(0),
        }),
      );
      child.on("close", (code, signal) =>
        finish({
          code,
          signal,
          stderr: exceeded ? Buffer.alloc(0) : Buffer.concat(stderr),
          stdout: exceeded ? Buffer.alloc(0) : Buffer.concat(stdout),
        }),
      );
      if (options.input === undefined) child.stdin.end();
      else child.stdin.end(options.input);
    }),
  runTree: async (executable, argv, options, sourcePattern) =>
    await new Promise((resolveResult) => {
      let settled = false;
      let parsingValid = true;
      let retainedMatches = 0;
      let unsafeMatchedPathHash: string | undefined;
      let header: number[] = [];
      let path: number[] = [];
      let pathLength = 0;
      let inPath = false;
      let pathHash = createHash("sha256");
      const pattern = Buffer.from(sourcePattern, "ascii");
      let matcherState = globInitialState(pattern);
      const retained: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stderrBytes = 0;
      const finish = (result: TreeProcessResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveResult(result);
      };
      const child = spawn(executable, argv, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (!parsingValid) return;
        for (const byte of chunk) {
          if (!inPath) {
            if (byte === 0 || header.length > 255) {
              parsingValid = false;
              child.kill("SIGKILL");
              return;
            }
            if (byte === 0x09) {
              if (header.length === 0) {
                parsingValid = false;
                child.kill("SIGKILL");
                return;
              }
              inPath = true;
            } else header.push(byte);
            continue;
          }
          if (byte !== 0) {
            pathLength += 1;
            pathHash.update(Buffer.from([byte]));
            matcherState = globAdvanceState(pattern, matcherState, byte);
            if (path.length < LIMITS.materialisationPathBytes) path.push(byte);
            continue;
          }
          const matched = globStateAccepts(pattern, matcherState);
          const digest = pathHash.digest("hex");
          if (matched) {
            retainedMatches += 1;
            if (pathLength > LIMITS.materialisationPathBytes) {
              unsafeMatchedPathHash ??= digest;
            } else if (retained.length <= LIMITS.materialisationMatches) {
              retained.push(
                Buffer.concat([
                  Buffer.from(header),
                  Buffer.from([0x09]),
                  Buffer.from(path),
                  Buffer.from([0]),
                ]),
              );
            }
          }
          header = [];
          path = [];
          pathLength = 0;
          inPath = false;
          pathHash = createHash("sha256");
          matcherState = globInitialState(pattern);
          if (!parsingValid) {
            parsingValid = false;
            child.kill("SIGKILL");
            return;
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > options.maxOutputBytes) {
          parsingValid = false;
          child.kill("SIGKILL");
        } else stderr.push(chunk);
      });
      child.on("error", () =>
        finish({
          code: null,
          parsingValid: false,
          retainedMatches,
          signal: null,
          stderr: Buffer.alloc(0),
          stdout: Buffer.alloc(0),
        }),
      );
      child.on("close", (code, signal) =>
        finish({
          code,
          parsingValid:
            parsingValid && !inPath && header.length === 0 && pathLength === 0,
          retainedMatches,
          signal,
          stderr: Buffer.concat(stderr),
          stdout: Buffer.concat(retained),
          ...(unsafeMatchedPathHash === undefined
            ? {}
            : { unsafeMatchedPathHash }),
        }),
      );
    }),
};

function globClosure(
  pattern: Buffer,
  positions: ReadonlySet<number>,
): ReadonlySet<number> {
  const closed = new Set(positions);
  const pending = [...positions];
  for (let index = 0; index < pending.length; index += 1) {
    const position = pending[index]!;
    if (pattern[position] === 0x2a && !closed.has(position + 1)) {
      closed.add(position + 1);
      pending.push(position + 1);
    }
  }
  return closed;
}

function globInitialState(pattern: Buffer): ReadonlySet<number> {
  return globClosure(pattern, new Set([0]));
}

function globAdvanceState(
  pattern: Buffer,
  positions: ReadonlySet<number>,
  byte: number,
): ReadonlySet<number> {
  const advanced = new Set<number>();
  for (const position of globClosure(pattern, positions)) {
    const token = pattern[position];
    if (token === 0x2a) {
      if (byte !== 0x2f) advanced.add(position);
    } else if (token === byte || (token === 0x3f && byte !== 0x2f)) {
      advanced.add(position + 1);
    }
  }
  return globClosure(pattern, advanced);
}

function globStateAccepts(
  pattern: Buffer,
  positions: ReadonlySet<number>,
): boolean {
  return globClosure(pattern, positions).has(pattern.byteLength);
}

function refusal<
  const Code extends
    | MaterialisationResolveRefusal["code"]
    | DestinationProbeRefusal["code"]
    | MaterialiseRefusal["code"],
>(
  code: Code,
  facts: JsonValue,
): Readonly<{
  refusal: Readonly<{ code: Code; detailHash: string }>;
  status: "refused";
}> {
  return {
    refusal: {
      code,
      detailHash: sha256(
        canonicalJson({ domain: "sce.materialisation-refusal.v1", facts }),
      ),
    },
    status: "refused",
  };
}

function ambiguous(
  facts: JsonValue,
): Extract<
  ResolutionResult | MaterialiseResult | DestinationProbeResult,
  { status: "ambiguous" }
> {
  return {
    observationHash: sha256(
      canonicalJson({ domain: "sce.materialisation-ambiguous.v1", facts }),
    ),
    status: "ambiguous",
  };
}

function exactOid(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function parseTree(data: Buffer):
  | Readonly<{
      entries: readonly Readonly<{
        blobOid: string;
        mode: string;
        path: Buffer;
        type: string;
      }>[];
      valid: true;
    }>
  | Readonly<{ valid: false }> {
  const entries: {
    blobOid: string;
    mode: string;
    path: Buffer;
    type: string;
  }[] = [];
  let start = 0;
  while (start < data.byteLength) {
    const end = data.indexOf(0, start);
    if (end < 0) return { valid: false };
    if (end === start) {
      start += 1;
      continue;
    }
    const record = data.subarray(start, end);
    const tab = record.indexOf(9);
    if (tab < 0) return { valid: false };
    const headerBytes = record.subarray(0, tab);
    if ([...headerBytes].some((byte) => byte > 0x7f)) return { valid: false };
    const raw = headerBytes.toString("ascii");
    const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})$/u.exec(
      raw,
    );
    if (match === null) return { valid: false };
    const path = record.subarray(tab + 1);
    if (path.byteLength === 0) return { valid: false };
    entries.push({
      blobOid: match[3]!,
      mode: match[1]!,
      path,
      type: match[2]!,
    });
    start = end + 1;
  }
  return { entries, valid: true };
}

function matchesPatternBytes(pattern: string, path: Uint8Array): boolean {
  const wanted = pattern.split("/").map((part) => Buffer.from(part, "ascii"));
  const actual: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index <= path.byteLength; index += 1) {
    if (index === path.byteLength || path[index] === 0x2f) {
      actual.push(path.subarray(start, index));
      start = index + 1;
    }
  }
  if (wanted.length !== actual.length) return false;
  return wanted.every((segment, index) => {
    const value = actual[index]!;
    const memo = new Map<string, boolean>();
    const match = (patternOffset: number, valueOffset: number): boolean => {
      const key = `${patternOffset}:${valueOffset}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      let result: boolean;
      if (patternOffset === segment.byteLength)
        result = valueOffset === value.byteLength;
      else if (segment[patternOffset] === 0x2a)
        result =
          match(patternOffset + 1, valueOffset) ||
          (valueOffset < value.byteLength &&
            match(patternOffset, valueOffset + 1));
      else
        result =
          valueOffset < value.byteLength &&
          (segment[patternOffset] === 0x3f ||
            segment[patternOffset] === value[valueOffset]) &&
          match(patternOffset + 1, valueOffset + 1);
      memo.set(key, result);
      return result;
    };
    return match(0, 0);
  });
}

async function readGit(
  processPort: MaterialisationProcessPort,
  cwd: string,
  argv: readonly string[],
  maxOutputBytes: number,
): Promise<ProcessResult> {
  return await processPort.run("/usr/bin/git", argv, {
    cwd,
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ASKPASS: "/usr/bin/false",
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_SSH_COMMAND: "/usr/bin/false",
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
      SSH_ASKPASS: "/usr/bin/false",
      TMPDIR: "/tmp",
    },
    maxOutputBytes,
  });
}

type GitObjectInfo =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "observed"; objectType: string; byteCount: number }>
  | Readonly<{ status: "ambiguous" }>;

async function readGitObjectInfo(
  processPort: MaterialisationProcessPort,
  cwd: string,
  oid: string,
): Promise<GitObjectInfo> {
  const result = await processPort.run(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "cat-file",
      "--batch-check=%(objectname) %(objecttype) %(objectsize)",
    ],
    {
      cwd,
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_ASKPASS: "/usr/bin/false",
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_SSH_COMMAND: "/usr/bin/false",
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
        SSH_ASKPASS: "/usr/bin/false",
        TMPDIR: "/tmp",
      },
      input: Buffer.from(`${oid}\n`, "ascii"),
      maxOutputBytes: 256,
    },
  );
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.stderr.byteLength !== 0
  )
    return { status: "ambiguous" };
  const output = result.stdout.toString("ascii");
  if (output === `${oid} missing\n`) return { status: "missing" };
  const match =
    /^([0-9a-f]{40}|[0-9a-f]{64}) ([a-z][a-z0-9_-]*) (0|[1-9][0-9]*)\n$/u.exec(
      output,
    );
  if (match === null || match[1] !== oid) return { status: "ambiguous" };
  const byteCount = Number(match[3]);
  return Number.isSafeInteger(byteCount)
    ? { byteCount, objectType: match[2]!, status: "observed" }
    : { status: "ambiguous" };
}

async function resolveSources(
  cwd: string,
  effect: ResolveEffect,
  processPort: MaterialisationProcessPort,
  objectFormat: "sha1" | "sha256",
): Promise<ResolutionResult> {
  if (!(await objectFormatMatches(cwd, processPort, objectFormat)))
    return ambiguous({ operation: "object-format" });
  const sourceInfo = await readGitObjectInfo(
    processPort,
    cwd,
    effect.params.sourceOid,
  );
  if (sourceInfo.status === "missing")
    return refusal("source_absent", { sourceOid: effect.params.sourceOid });
  if (sourceInfo.status === "ambiguous")
    return ambiguous({
      operation: "source-object",
      sourceOid: effect.params.sourceOid,
    });
  if (sourceInfo.objectType !== "commit")
    return refusal("non_blob", {
      objectType: sourceInfo.objectType,
      sourceOid: effect.params.sourceOid,
    });
  const treeArgv = [
    "--no-replace-objects",
    "ls-tree",
    "-rz",
    "-r",
    "--full-tree",
    effect.params.sourceOid,
  ];
  const tree =
    processPort.runTree === undefined
      ? await readGit(processPort, cwd, treeArgv, 4 * 1024 * 1024)
      : await processPort.runTree(
          "/usr/bin/git",
          treeArgv,
          {
            cwd,
            env: {
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_ASKPASS: "/usr/bin/false",
              GIT_NO_LAZY_FETCH: "1",
              GIT_NO_REPLACE_OBJECTS: "1",
              GIT_OPTIONAL_LOCKS: "0",
              GIT_SSH_COMMAND: "/usr/bin/false",
              GIT_TERMINAL_PROMPT: "0",
              LANG: "C",
              LC_ALL: "C",
              PATH: "/usr/bin:/bin",
              SSH_ASKPASS: "/usr/bin/false",
              TMPDIR: "/tmp",
            },
            maxOutputBytes: 8_192,
          },
          effect.params.sourcePattern,
        );
  if (
    tree.code !== 0 ||
    tree.signal !== null ||
    tree.stderr.byteLength !== 0 ||
    ("parsingValid" in tree && !tree.parsingValid)
  )
    return ambiguous({
      operation: "ls-tree",
      sourceOid: effect.params.sourceOid,
    });
  const unsafeMatchedPathHash = (tree as Partial<TreeProcessResult>)
    .unsafeMatchedPathHash;
  if (unsafeMatchedPathHash !== undefined)
    return refusal("unsafe_path", { pathHash: unsafeMatchedPathHash });
  const parsed = parseTree(tree.stdout);
  if (!parsed.valid) return ambiguous({ operation: "parse-tree" });
  const retainedMatches = (tree as Partial<TreeProcessResult>).retainedMatches;
  const matched =
    retainedMatches !== undefined
      ? parsed.entries
      : parsed.entries.filter((entry) =>
          matchesPatternBytes(effect.params.sourcePattern, entry.path),
        );
  const matchCount = retainedMatches ?? matched.length;
  if (matchCount === 0)
    return refusal("zero_matches", { pattern: effect.params.sourcePattern });
  if (
    matchCount > LIMITS.materialisationMatches ||
    matchCount > effect.params.remainingItemCapacity
  )
    return refusal(
      matchCount > LIMITS.materialisationMatches
        ? "too_many_matches"
        : "wave_item_limit",
      { matchCount },
    );
  if (
    matched.some(
      (entry) =>
        entry.type !== "blob" ||
        (entry.mode !== "100644" && entry.mode !== "100755"),
    )
  )
    return refusal("non_blob", {
      pathHashes: matched
        .filter(
          (entry) =>
            entry.type !== "blob" ||
            (entry.mode !== "100644" && entry.mode !== "100755"),
        )
        .map((entry) => hashBytes(entry.path)),
    });
  const ordered = [...matched].sort((left, right) =>
    left.path.compare(right.path),
  );
  const sources: MaterialisationSource[] = [];
  let total = 0;
  for (const entry of ordered) {
    let sourcePath: string;
    try {
      sourcePath = new TextDecoder("utf-8", { fatal: true }).decode(entry.path);
    } catch {
      return refusal("unsafe_path", { pathHash: hashBytes(entry.path) });
    }
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(
        sourcePath,
      ) ||
      Buffer.byteLength(sourcePath) > LIMITS.materialisationPathBytes ||
      !exactOid(entry.blobOid)
    )
      return refusal("unsafe_path", { pathHash: hashBytes(entry.path) });
    const blobInfo = await readGitObjectInfo(processPort, cwd, entry.blobOid);
    if (blobInfo.status === "missing")
      return refusal("source_absent", { blobOid: entry.blobOid });
    if (blobInfo.status === "ambiguous")
      return ambiguous({ blobOid: entry.blobOid, operation: "blob-object" });
    if (blobInfo.objectType !== "blob")
      return refusal("non_blob", {
        blobOid: entry.blobOid,
        objectType: blobInfo.objectType,
      });
    if (blobInfo.byteCount > LIMITS.materialisationBlobBytes)
      return refusal("blob_too_large", { blobOid: entry.blobOid });
    const blob = await readGit(
      processPort,
      cwd,
      ["--no-replace-objects", "cat-file", "blob", entry.blobOid],
      LIMITS.materialisationBlobBytes + 1,
    );
    if (
      blob.code !== 0 ||
      blob.signal !== null ||
      blob.stderr.byteLength !== 0 ||
      blob.stdout.byteLength !== blobInfo.byteCount
    )
      return ambiguous({ blobOid: entry.blobOid, operation: "cat-file" });
    total += blob.stdout.byteLength;
    if (total > effect.params.remainingSourceByteCapacity)
      return refusal("wave_byte_limit", { byteCount: total });
    sources.push({
      blobOid: entry.blobOid,
      byteCount: blob.stdout.byteLength,
      path: sourcePath,
      sha256: hashBytes(blob.stdout),
    });
  }
  const expansionBinding = {
    capacities: {
      remainingAggregateEnvelopeByteCapacity:
        effect.params.remainingAggregateEnvelopeByteCapacity,
      remainingItemCapacity: effect.params.remainingItemCapacity,
      remainingProjectionSnapshotByteCapacity:
        effect.params.remainingProjectionSnapshotByteCapacity,
      remainingSourceByteCapacity: effect.params.remainingSourceByteCapacity,
    },
    destinationProbeGateEntryId: effect.params.destinationProbeGateEntryId,
    domainScope: effect.params.domainScope,
    driver: effect.params.driver,
    executorTool: effect.params.executorTool,
    originUnitId: effect.params.originUnitId,
    resolutionGateEntryId: effect.params.gateEntryId,
    runId: effect.params.runId,
    sourceOid: effect.params.sourceOid,
    stage: effect.params.stage,
    target: effect.params.target,
    targetId: effect.params.targetId,
    targetOrdinal: effect.params.targetOrdinal,
    waveId: effect.params.waveId,
  };
  const projectionEvidenceBytes = materialisationProjectionExpansionCost(
    sources,
    expansionBinding,
  );
  const aggregateEvidenceBytes = materialisationAggregateExpansionCost(
    sources,
    expansionBinding,
  );
  if (
    projectionEvidenceBytes >
      effect.params.remainingProjectionSnapshotByteCapacity ||
    aggregateEvidenceBytes >
      effect.params.remainingAggregateEnvelopeByteCapacity
  )
    return refusal("evidence_budget_exceeded", {
      aggregateEvidenceBytes,
      gateEntryId: effect.gateEntryId,
      projectionEvidenceBytes,
    });
  return { sources, status: "observed" };
}

async function objectFormatMatches(
  cwd: string,
  processPort: MaterialisationProcessPort,
  expected: "sha1" | "sha256",
): Promise<boolean> {
  const result = await readGit(
    processPort,
    cwd,
    ["--no-replace-objects", "rev-parse", "--show-object-format"],
    128,
  );
  return (
    result.code === 0 &&
    result.signal === null &&
    result.stderr.byteLength === 0 &&
    result.stdout.toString("ascii") === `${expected}\n`
  );
}

const HELPER_SOURCE = String.raw`
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const chunks = [];
process.stdin.on("data", chunk => chunks.push(chunk));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks);
  let offset = 0;
  const u32 = () => { const value = input.readUInt32BE(offset); offset += 4; return value; };
  const take = length => { const value = input.subarray(offset, offset + length); offset += length; return value; };
  const respond = value => process.stdout.write(JSON.stringify(value));
  const fail = (status, code) => { respond({ status, code }); process.exit(0); };
  try {
    const metadata = JSON.parse(take(u32()).toString("utf8"));
    const sidecar = take(u32());
    const artifact = take(u32());
    if (offset !== input.length) return fail("ambiguous", "bad-frame");
    const basename = value => typeof value === "string" && path.basename(value) === value && value !== "." && value !== "..";
    for (const value of [metadata.artifactName, metadata.sidecarName, metadata.artifactTemp, metadata.sidecarTemp])
      if (!basename(value)) return fail("refused", "bad-name");
    const identity = () => {
      const value = fs.statSync(".", { bigint: true });
      return String(value.dev) === metadata.dev && String(value.ino) === metadata.ino && fs.realpathSync(".") === metadata.realpath;
    };
    if (!identity()) return fail("refused", "identity");
    const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
    const inspect = (name, maximumBytes) => {
      try {
        const first = fs.lstatSync(name, { bigint: true });
        if (!first.isFile() || first.isSymbolicLink() || first.size > BigInt(maximumBytes)) return { state: "special" };
        const fd = fs.openSync(name, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
          const second = fs.fstatSync(fd, { bigint: true });
          if (!second.isFile() || first.dev !== second.dev || first.ino !== second.ino || second.size > BigInt(maximumBytes)) return { state: "special" };
          const bytes = fs.readFileSync(fd);
          return { state: "file", bytes, dev: second.dev, ino: second.ino, nlink: second.nlink };
        } finally { fs.closeSync(fd); }
      } catch (error) {
        if (error && error.code === "ENOENT") return { state: "absent" };
        throw error;
      }
    };
    const matches = (found, bytes) => found.state === "file" && found.bytes.length === bytes.length && digest(found.bytes) === digest(bytes);
    const inspectPair = (finalName, tempName, bytes) => {
      const final = inspect(finalName, bytes.length);
      const temp = inspect(tempName, bytes.length);
      if (final.state === "special") return { status: "ambiguous", code: "special-final" };
      if (temp.state === "special") return { status: "ambiguous", code: "special-temp" };
      if (final.state === "file") {
        if (!matches(final, bytes)) return { status: "ambiguous", code: "different-final" };
        if (temp.state === "absent") return { status: "already_present", final, temp };
        if (!matches(temp, bytes) || final.dev !== temp.dev || final.ino !== temp.ino || final.nlink !== 2n || temp.nlink !== 2n)
          return { status: "ambiguous", code: "foreign-linked-temp" };
        return { status: "linked_crash", final, temp };
      }
      if (temp.state === "file" && temp.nlink !== 1n)
        return { status: "ambiguous", code: "foreign-temp-link" };
      return { status: "ready", final, temp };
    };
    const sidecarPreflight = inspectPair(metadata.sidecarName, metadata.sidecarTemp, sidecar);
    const artifactPreflight = inspectPair(metadata.artifactName, metadata.artifactTemp, artifact);
    for (const checked of [sidecarPreflight, artifactPreflight])
      if (checked.status === "ambiguous") return fail("ambiguous", checked.code);
    const fsyncDirectory = () => {
      const directory = fs.openSync(".", fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    };
    const publish = (finalName, tempName, bytes, preflight) => {
      if (preflight.status === "already_present") return { status: "already_present" };
      if (preflight.status === "linked_crash") {
        fs.unlinkSync(tempName);
        fsyncDirectory();
        if (!identity()) return { status: "ambiguous", code: "identity-drift" };
        const final = inspect(finalName, bytes.length);
        if (!matches(final, bytes) || final.nlink !== 1n)
          return { status: "ambiguous", code: "crash-cleanup-readback" };
        return { status: "already_present" };
      }
      let temp = preflight.temp;
      if (temp.state === "file" && !matches(temp, bytes)) { fs.unlinkSync(tempName); temp = { state: "absent" }; }
      if (temp.state === "absent") {
        let fd;
        try { fd = fs.openSync(tempName, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o600); }
        catch (error) { return error && error.code === "EEXIST" ? { status: "ambiguous", code: "temp-race" } : { status: "ambiguous", code: "temp-create" }; }
        try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        temp = inspect(tempName, bytes.length);
        if (temp.state !== "file" || temp.nlink !== 1n || !matches(temp, bytes)) return { status: "ambiguous", code: "temp-readback" };
      }
      if (!identity()) return { status: "ambiguous", code: "identity-drift" };
      let final;
      try { fs.linkSync(tempName, finalName); }
      catch (error) {
        if (error && error.code === "EEXIST") {
          final = inspect(finalName, bytes.length);
          if (!matches(final, bytes)) return { status: "ambiguous", code: "eexist-different" };
          const ownTemp = inspect(tempName, bytes.length);
          if (ownTemp.state !== "file" || ownTemp.nlink !== 1n || !matches(ownTemp, bytes))
            return { status: "ambiguous", code: "eexist-temp" };
          fs.unlinkSync(tempName);
          fsyncDirectory();
          if (!identity()) return { status: "ambiguous", code: "identity-drift" };
          final = inspect(finalName, bytes.length);
          if (!matches(final, bytes)) return { status: "ambiguous", code: "eexist-readback" };
          return { status: "already_present" };
        } else if (error && ["EXDEV", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(error.code)) {
          final = inspect(finalName, bytes.length);
          if (final.state !== "absent") return { status: "ambiguous", code: "unsupported-uncertain" };
          if (inspect(tempName, bytes.length).state === "file") fs.unlinkSync(tempName);
          return { status: "refused", code: "hard-links-unsupported" };
        } else return { status: "ambiguous", code: "link" };
      }
      final = inspect(finalName, bytes.length);
      temp = inspect(tempName, bytes.length);
      if (final.state !== "file" || temp.state !== "file" || final.dev !== temp.dev || final.ino !== temp.ino || final.nlink !== 2n || temp.nlink !== 2n || !matches(final, bytes) || !matches(temp, bytes))
        return { status: "ambiguous", code: "final-readback" };
      const publishedDev = final.dev;
      const publishedIno = final.ino;
      fsyncDirectory();
      fs.unlinkSync(tempName);
      fsyncDirectory();
      final = inspect(finalName, bytes.length);
      if (!matches(final, bytes) || final.dev !== publishedDev || final.ino !== publishedIno || final.nlink !== 1n)
        return { status: "ambiguous", code: "unlink-readback" };
      if (!identity()) return { status: "ambiguous", code: "identity-drift" };
      return { status: "published" };
    };
    const sidecarResult = publish(metadata.sidecarName, metadata.sidecarTemp, sidecar, sidecarPreflight);
    if (sidecarResult.status === "ambiguous") return fail("ambiguous", sidecarResult.code);
    if (sidecarResult.status === "refused")
      return artifactPreflight.status === "already_present" || artifactPreflight.status === "linked_crash"
        ? fail("ambiguous", "unsupported-with-existing-final")
        : fail("refused", sidecarResult.code);
    const artifactResult = publish(metadata.artifactName, metadata.artifactTemp, artifact, artifactPreflight);
    if (artifactResult.status === "ambiguous") return fail("ambiguous", artifactResult.code);
    if (artifactResult.status === "refused") return fail("ambiguous", "partial-unsupported");
    const finalArtifact = inspect(metadata.artifactName, artifact.length);
    const finalSidecar = inspect(metadata.sidecarName, sidecar.length);
    const finalArtifactTemp = inspect(metadata.artifactTemp, artifact.length);
    const finalSidecarTemp = inspect(metadata.sidecarTemp, sidecar.length);
    if (!matches(finalArtifact, artifact) || !matches(finalSidecar, sidecar) || finalArtifactTemp.state !== "absent" || finalSidecarTemp.state !== "absent")
      return fail("ambiguous", "final-readback");
    if (!identity()) return fail("ambiguous", "identity-drift");
    respond({ status: "observed", artifactStatus: artifactResult.status, sidecarStatus: sidecarResult.status });
  } catch { fail("ambiguous", "helper-exception"); }
});
`;

function frame(metadata: JsonValue, sidecar: Buffer, artifact: Buffer): Buffer {
  const header = Buffer.from(canonicalJson(metadata), "utf8");
  const length = (value: number) => {
    const output = Buffer.alloc(4);
    output.writeUInt32BE(value);
    return output;
  };
  return Buffer.concat([
    length(header.byteLength),
    header,
    length(sidecar.byteLength),
    sidecar,
    length(artifact.byteLength),
    artifact,
  ]);
}

async function admittedDestination(
  destination: MaterialiseEffect["params"]["destination"],
  destinationSubpath: string,
): Promise<
  | Readonly<{
      status: "observed";
      identity: { canonicalPath: string; device: string; inode: string };
    }>
  | Readonly<{
      status: "refused";
      reason: "alias_unmounted" | "invalid_destination";
    }>
  | Readonly<{ status: "ambiguous" }>
> {
  const root = destination.canonicalRoot;
  if (!isAbsolute(root) || normalize(resolve(root)) !== root || root === "/")
    return { reason: "invalid_destination", status: "refused" };
  try {
    let rootLink;
    try {
      rootLink = await lstat(root, { bigint: true });
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { reason: "alias_unmounted", status: "refused" }
        : { status: "ambiguous" };
    }
    if (!rootLink.isDirectory() || rootLink.isSymbolicLink())
      return { reason: "invalid_destination", status: "refused" };
    if ((await realpath(root)) !== root)
      return { reason: "invalid_destination", status: "refused" };
    let marker;
    try {
      marker = await lstat(join(root, destination.markerFile), {
        bigint: true,
      });
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { reason: "alias_unmounted", status: "refused" }
        : { status: "ambiguous" };
    }
    if (!marker.isFile() || marker.isSymbolicLink())
      return { reason: "invalid_destination", status: "refused" };
    let current = root;
    for (const segment of destinationSubpath.split("/")) {
      current = join(current, segment);
      let component;
      try {
        component = await lstat(current, { bigint: true });
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT"
          ? { reason: "invalid_destination", status: "refused" }
          : { status: "ambiguous" };
      }
      if (!component.isDirectory() || component.isSymbolicLink())
        return { reason: "invalid_destination", status: "refused" };
      const suffix = relative(root, current);
      if (suffix.startsWith("../") || isAbsolute(suffix))
        return { reason: "invalid_destination", status: "refused" };
    }
    const canonical = await realpath(current);
    if (canonical !== current)
      return { reason: "invalid_destination", status: "refused" };
    const identity = await stat(current, { bigint: true });
    return {
      identity: {
        canonicalPath: current,
        device: String(identity.dev),
        inode: String(identity.ino),
      },
      status: "observed",
    };
  } catch (error) {
    return { status: "ambiguous" };
  }
}

function sameDestinationIdentity(
  left: Readonly<{ canonicalPath: string; device: string; inode: string }>,
  right: Readonly<{ canonicalPath: string; device: string; inode: string }>,
): boolean {
  return (
    left.canonicalPath === right.canonicalPath &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

async function probeDestination(
  effect: ProbeEffect,
): Promise<DestinationProbeResult> {
  const result = await admittedDestination(
    effect.params.destination,
    effect.params.destinationSubpath,
  );
  if (result.status === "refused")
    return refusal(
      result.reason === "alias_unmounted"
        ? effect.params.destination.mountPolicy === "optional"
          ? "optional_alias_unmounted"
          : "required_alias_unmounted"
        : "invalid_destination",
      {
        alias: effect.params.destination.alias,
        mountPolicy: effect.params.destination.mountPolicy,
        reason: result.reason,
      },
    );
  if (result.status === "ambiguous")
    return ambiguous({
      alias: effect.params.destination.alias,
      operation: "containment",
    });
  if (
    effect.params.expectedPriorIdentity !== undefined &&
    !sameDestinationIdentity(
      result.identity,
      effect.params.expectedPriorIdentity,
    )
  )
    return ambiguous({
      alias: effect.params.destination.alias,
      operation: "destination-identity-mismatch",
    });
  return { identity: result.identity, status: "observed" };
}

async function materialiseBytes(
  cwd: string,
  effect: MaterialiseEffect,
  processPort: MaterialisationProcessPort,
  objectFormat: "sha1" | "sha256",
): Promise<MaterialiseResult> {
  if (!(await objectFormatMatches(cwd, processPort, objectFormat)))
    return ambiguous({ operation: "object-format" });
  const blobInfo = await readGitObjectInfo(
    processPort,
    cwd,
    effect.params.source.blobOid,
  );
  if (blobInfo.status === "missing")
    return refusal("source_absent", { blobOid: effect.params.source.blobOid });
  if (
    blobInfo.status !== "observed" ||
    blobInfo.objectType !== "blob" ||
    blobInfo.byteCount !== effect.params.source.byteCount
  )
    return ambiguous({
      blobOid: effect.params.source.blobOid,
      operation: "source-object",
    });
  const blob = await readGit(
    processPort,
    cwd,
    ["--no-replace-objects", "cat-file", "blob", effect.params.source.blobOid],
    LIMITS.materialisationBlobBytes + 1,
  );
  if (blob.code !== 0 || blob.signal !== null || blob.stderr.byteLength !== 0)
    return ambiguous({
      blobOid: effect.params.source.blobOid,
      operation: "cat-file",
    });
  if (
    blob.stdout.byteLength !== effect.params.source.byteCount ||
    hashBytes(blob.stdout) !== effect.params.source.sha256
  )
    return ambiguous({
      blobOid: effect.params.source.blobOid,
      operation: "source-changed",
    });
  const sidecar = Buffer.from(effect.params.sidecarBytes, "utf8");
  let sidecarValue: unknown;
  try {
    sidecarValue = JSON.parse(effect.params.sidecarBytes.slice(0, -1));
  } catch {
    return ambiguous({ operation: "sidecar-canonical-json" });
  }
  const parsedSidecar = validate(MaterialisationSidecarSchema, sidecarValue);
  if (
    sidecar.byteLength !== effect.params.sidecarByteCount ||
    hashBytes(sidecar) !== effect.params.sidecarSha256 ||
    !effect.params.sidecarBytes.endsWith("\n") ||
    effect.params.sidecarBytes.endsWith("\n\n") ||
    !parsedSidecar.ok ||
    parsedSidecar.value === undefined ||
    `${canonicalJson(parsedSidecar.value as unknown as JsonValue)}\n` !==
      effect.params.sidecarBytes
  )
    return ambiguous({ operation: "sidecar-binding" });
  if (effect.params.namespaceControl !== "exclusive")
    return ambiguous({ operation: "namespace-control" });
  const destination = await admittedDestination(
    effect.params.destination,
    effect.params.destinationSubpath,
  );
  if (destination.status === "refused")
    return ambiguous({
      alias: effect.params.destination.alias,
      operation: "destination-drift",
      reason: destination.reason,
    });
  if (destination.status === "ambiguous")
    return ambiguous({
      alias: effect.params.destination.alias,
      operation: "containment",
    });
  if (
    !sameDestinationIdentity(
      destination.identity,
      effect.params.destinationIdentity,
    )
  )
    return ambiguous({
      alias: effect.params.destination.alias,
      operation: "destination-identity-mismatch",
      observed: destination.identity,
    });
  const metadata = {
    artifactName: effect.params.artifactName,
    artifactTemp: `.${effect.params.artifactName}.sce-tmp`,
    dev: destination.identity.device,
    ino: destination.identity.inode,
    realpath: destination.identity.canonicalPath,
    sidecarName: effect.params.sidecarName,
    sidecarTemp: `.${effect.params.sidecarName}.sce-tmp`,
  };
  const result = await processPort.run(
    process.execPath,
    ["-e", HELPER_SOURCE],
    {
      cwd: destination.identity.canonicalPath,
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", TMPDIR: "/tmp" },
      input: frame(metadata, sidecar, blob.stdout),
      maxOutputBytes: 8_192,
    },
  );
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.stderr.byteLength !== 0
  )
    return ambiguous({ operation: "helper-process" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.toString("utf8"));
  } catch {
    return ambiguous({ operation: "helper-output" });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return ambiguous({ operation: "helper-shape" });
  const value = parsed as Record<string, unknown>;
  if (
    value.status === "refused" &&
    value.code === "hard-links-unsupported" &&
    Object.keys(value).sort().join(",") === "code,status"
  )
    return refusal("hard_links_unsupported", {
      alias: effect.params.destination.alias,
    });
  if (
    value.status !== "observed" ||
    !["already_present", "published"].includes(String(value.artifactStatus)) ||
    !["already_present", "published"].includes(String(value.sidecarStatus)) ||
    Object.keys(value).sort().join(",") !==
      "artifactStatus,sidecarStatus,status"
  )
    return ambiguous({
      operation: "helper-result",
      outputHash: hashBytes(result.stdout),
    });
  return {
    observation: {
      artifactByteCount: blob.stdout.byteLength,
      artifactSha256: effect.params.source.sha256,
      artifactStatus: value.artifactStatus as "already_present" | "published",
      sidecarByteCount: sidecar.byteLength,
      sidecarSha256: effect.params.sidecarSha256,
      sidecarStatus: value.sidecarStatus as "already_present" | "published",
    },
    status: "observed",
  };
}

async function discoverMaterialisation(
  cwd: string,
  effect: MaterialiseEffect,
  processPort: MaterialisationProcessPort,
  objectFormat: "sha1" | "sha256",
): Promise<MaterialisationDiscoveryResult> {
  if (!(await objectFormatMatches(cwd, processPort, objectFormat)))
    return ambiguous({ operation: "object-format" });
  const blobInfo = await readGitObjectInfo(
    processPort,
    cwd,
    effect.params.source.blobOid,
  );
  if (blobInfo.status === "missing")
    return refusal("source_absent", { blobOid: effect.params.source.blobOid });
  if (
    blobInfo.status !== "observed" ||
    blobInfo.objectType !== "blob" ||
    blobInfo.byteCount !== effect.params.source.byteCount
  )
    return ambiguous({ operation: "source-readback" });
  const blob = await readGit(
    processPort,
    cwd,
    ["--no-replace-objects", "cat-file", "blob", effect.params.source.blobOid],
    LIMITS.materialisationBlobBytes + 1,
  );
  if (
    blob.code !== 0 ||
    blob.signal !== null ||
    blob.stderr.byteLength !== 0 ||
    blob.stdout.byteLength !== effect.params.source.byteCount ||
    hashBytes(blob.stdout) !== effect.params.source.sha256
  )
    return ambiguous({ operation: "source-readback" });
  const sidecar = Buffer.from(effect.params.sidecarBytes, "utf8");
  let sidecarValue: unknown;
  try {
    sidecarValue = JSON.parse(effect.params.sidecarBytes.slice(0, -1));
  } catch {
    return ambiguous({ operation: "sidecar-canonical-json" });
  }
  const parsedSidecar = validate(MaterialisationSidecarSchema, sidecarValue);
  if (
    sidecar.byteLength !== effect.params.sidecarByteCount ||
    hashBytes(sidecar) !== effect.params.sidecarSha256 ||
    !effect.params.sidecarBytes.endsWith("\n") ||
    !parsedSidecar.ok ||
    parsedSidecar.value === undefined ||
    `${canonicalJson(parsedSidecar.value as unknown as JsonValue)}\n` !==
      effect.params.sidecarBytes
  )
    return ambiguous({ operation: "sidecar-binding" });
  const destination = await admittedDestination(
    effect.params.destination,
    effect.params.destinationSubpath,
  );
  if (
    destination.status !== "observed" ||
    !sameDestinationIdentity(
      destination.identity,
      effect.params.destinationIdentity,
    )
  )
    return ambiguous({ operation: "destination-drift" });
  const [artifact, sidecarFile, artifactTemp, sidecarTemp] = await Promise.all([
    readNoFollow(
      destination.identity.canonicalPath,
      effect.params.artifactName,
      effect.params.source.byteCount,
    ),
    readNoFollow(
      destination.identity.canonicalPath,
      effect.params.sidecarName,
      effect.params.sidecarByteCount,
    ),
    readNoFollow(
      destination.identity.canonicalPath,
      `.${effect.params.artifactName}.sce-tmp`,
      effect.params.source.byteCount,
    ),
    readNoFollow(
      destination.identity.canonicalPath,
      `.${effect.params.sidecarName}.sce-tmp`,
      effect.params.sidecarByteCount,
    ),
  ]);
  const classifyPair = (
    final: typeof artifact,
    temp: typeof artifact,
    expected: Buffer,
  ): "absent" | "final" | "recoverable" | "ambiguous" => {
    if (final.status === "ambiguous" || temp.status === "ambiguous")
      return "ambiguous";
    if (final.status === "absent") {
      if (temp.status === "absent") return "absent";
      return temp.nlink === 1n ? "recoverable" : "ambiguous";
    }
    if (!final.bytes.equals(expected)) return "ambiguous";
    if (temp.status === "absent") return "final";
    return temp.bytes.equals(expected) &&
      final.device === temp.device &&
      final.inode === temp.inode &&
      final.nlink === 2n &&
      temp.nlink === 2n
      ? "recoverable"
      : "ambiguous";
  };
  const artifactState = classifyPair(artifact, artifactTemp, blob.stdout);
  const sidecarState = classifyPair(sidecarFile, sidecarTemp, sidecar);
  if (artifactState === "ambiguous" || sidecarState === "ambiguous")
    return ambiguous({ operation: "final-readback" });
  if (artifactState !== "final" || sidecarState !== "final")
    return { status: "absent" };
  if (artifact.status !== "file" || sidecarFile.status !== "file")
    return ambiguous({ operation: "final-state" });
  return {
    observation: {
      artifactByteCount: artifact.bytes.byteLength,
      artifactSha256: hashBytes(artifact.bytes),
      artifactStatus: "already_present",
      sidecarByteCount: sidecarFile.bytes.byteLength,
      sidecarSha256: hashBytes(sidecarFile.bytes),
      sidecarStatus: "already_present",
    },
    status: "observed",
  };
}

export function createMaterialisationAdapter(
  repositoryCwd: string,
  objectFormat: "sha1" | "sha256",
  processPort: MaterialisationProcessPort = nodeMaterialisationProcess,
): MaterialisationAdapter {
  return {
    discoverMaterialise: async (effect) =>
      await discoverMaterialisation(
        repositoryCwd,
        effect,
        processPort,
        objectFormat,
      ),
    materialise: async (effect) =>
      await materialiseBytes(repositoryCwd, effect, processPort, objectFormat),
    probe: async (effect) => await probeDestination(effect),
    resolve: async (effect) =>
      await resolveSources(repositoryCwd, effect, processPort, objectFormat),
  };
}
