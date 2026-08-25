import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authorityFor,
  authorizes,
  discoverExisting,
  feedbackFingerprint,
  FeedbackOutbox,
  OUTBOX_MAX_BYTES,
  prepareFeedback,
  previewFeedback,
  reconcileExactDuplicates,
  validateFeedbackPacket,
  type FeedbackGitHubTransport,
  type FeedbackPacket,
  type FeedbackTarget,
} from "../../src/feedback/index.js";

const target: FeedbackTarget = {
  host: "github.com",
  repository: "hls-uk/single-controller-engineer",
  repositoryId: "R_kgDOUCvUmw",
};

function packet(n = "CAPABILITY"): FeedbackPacket {
  const value = prepareFeedback({
    kind: "bug",
    component: "runtime",
    toolVersion: "1.2.3",
    toolchain: "node-22",
    requestedModelTier: "workhorse",
    protocolState: "failed",
    stableErrorCode: `SCE_${n}`,
    capabilityId: "feedback.submit",
  });
  return requireValue(value);
}

function requireValue<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  if (value === undefined) throw new Error("expected value");
  return value;
}

function commonDirectory(): { readonly root: string; readonly common: string } {
  const root = mkdtempSync(join(tmpdir(), "sce-feedback-"));
  const common = join(root, "common");
  mkdirSync(common, { mode: 0o700 });
  return { root, common };
}

async function flushPacket(
  value: FeedbackPacket,
  authority: ReturnType<typeof authorityFor>,
  transport: FeedbackGitHubTransport,
) {
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common);
    if (opened.status !== "ok") throw new Error("outbox unavailable");
    assert.equal(opened.value.enqueue(value).status, "ok");
    return await opened.value.flush(
      value.telemetry.fingerprint,
      authority,
      transport,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function fakeTransport(
  issues: readonly {
    repositoryId: "R_kgDOUCvUmw";
    number: number;
    url: string;
    body: string;
    open: boolean;
  }[] = [],
): FeedbackGitHubTransport {
  return {
    async discoverExactMarker() {
      return {
        repositoryId: "R_kgDOUCvUmw",
        paginationComplete: true,
        issues,
      };
    },
    async createIssue(request) {
      return {
        repositoryId: "R_kgDOUCvUmw",
        number: 42,
        url: "https://github.com/hls-uk/single-controller-engineer/issues/42",
        body: request.body,
        open: true,
      };
    },
  };
}

test("safe packet only accepts allowlisted telemetry and fingerprints exact RFC8785 fields", () => {
  const decomposed = prepareFeedback({
    kind: "bug",
    component: "runtime",
    toolVersion: "1.2.3",
    toolchain: "node-22",
    requestedModelTier: "workhorse",
    protocolState: "failed",
    stableErrorCode: "SCE_FAILURE",
    capabilityId: "feedback.transport",
  });
  const composed = prepareFeedback({
    kind: "bug",
    component: "runtime",
    toolVersion: "1.2.3",
    toolchain: "node-22",
    requestedModelTier: "workhorse",
    protocolState: "failed",
    stableErrorCode: "SCE_FAILURE",
    capabilityId: "feedback.transport",
  });
  const normalizedDecomposed = requireValue(decomposed);
  const normalizedComposed = requireValue(composed);
  assert.equal(
    normalizedDecomposed.telemetry.fingerprint,
    normalizedComposed.telemetry.fingerprint,
  );
  assert.equal(
    normalizedDecomposed.target.repository,
    "hls-uk/single-controller-engineer",
  );
  assert.match(
    normalizedDecomposed.marker,
    /^<!-- sce-feedback:v1;kind=bug;component=runtime;tool=1\.2;fingerprint=[0-9a-f]{64} -->$/u,
  );
  assert.equal(
    normalizedDecomposed.telemetry.fingerprint,
    feedbackFingerprint(normalizedDecomposed.telemetry),
  );
  assert.equal(
    normalizedDecomposed.telemetry.fingerprint,
    "1bbbb159166e3bd56be71560c02a4db18d39cd24ab70c6239bbcad2c960a8eec",
  );
  assert.deepEqual(
    requireValue(previewFeedback(normalizedDecomposed)).targetUrl,
    "https://github.com/hls-uk/single-controller-engineer",
  );
  assert.equal(
    prepareFeedback({
      ...normalizedDecomposed.telemetry,
      capabilityId: "x\u202Ey",
    } as never),
    undefined,
  );
  assert.equal(
    prepareFeedback({
      ...normalizedDecomposed.telemetry,
      capabilityId: "SECRET=ghp_not_allowed",
    } as never),
    undefined,
  );
  assert.equal(
    prepareFeedback({
      kind: "bug",
      component: "runtime",
      toolVersion: "1.2.3",
      toolchain: "node-22",
      requestedModelTier: "workhorse",
      protocolState: "failed",
      stableErrorCode: "SCE_FAILURE",
      capabilityId: "feedback.submit",
      source: "do not collect this",
    } as never),
    undefined,
  );
  for (const unsafe of [
    { toolchain: "ghp_12345678901234567890" },
    { capabilityId: "github_pat_12345678901234567890" },
    { toolchain: "authorization=Bearer secret" },
    { capabilityId: "api_key=private" },
    { toolchain: "token_canary" },
    { capabilityId: "session_token_canary" },
    { toolchain: "https://user:password@example.test/repo.git" },
    { capabilityId: "xoxb-1234567890abcdef" },
    { toolchain: "npm_private-token" },
  ])
    assert.equal(
      prepareFeedback({
        kind: "bug",
        component: "runtime",
        toolVersion: "1.2.3",
        toolchain: "node-22",
        requestedModelTier: "workhorse",
        protocolState: "failed",
        stableErrorCode: "SCE_FAILURE",
        capabilityId: "feedback.submit",
        ...unsafe,
      } as never),
      undefined,
    );
});

test("narrative is explicitly reviewed, bounded, and warning-bearing previews block policy authority", () => {
  const reviewed = prepareFeedback(
    {
      kind: "enhancement",
      component: "capability",
      toolVersion: "1.2.3",
      toolchain: "node-22",
      requestedModelTier: "frontier",
      protocolState: "preflight",
      stableErrorCode: "SCE_LIMITATION",
      capabilityId: "feedback.transport",
    },
    { observed: "See https://example.test and /Users/alice/project/file.ts" },
  );
  const reviewedPacket = requireValue(reviewed);
  assert.deepEqual(reviewedPacket.narrativeFindings, ["url", "absolute_path"]);
  assert.equal(
    prepareFeedback(
      { ...reviewedPacket.telemetry },
      { observed: "x".repeat(4097) },
    ),
    undefined,
  );
  assert.equal(
    requireValue(
      authorityFor(
        reviewedPacket,
        "policy_safe_telemetry",
        "policy-nonce-0001",
      ),
    ).source,
    "policy_safe_telemetry",
  );
});

test("authority binds one exact target, fingerprint, preview, and operation", async () => {
  const value = packet();
  const transport = fakeTransport();
  const outboxRoot = commonDirectory();
  try {
    const outbox = FeedbackOutbox.open(outboxRoot.common);
    assert.equal(outbox.status, "ok");
    assert.equal(outbox.value.enqueue(value).status, "ok");
    const stale = {
      ...requireValue(
        authorityFor(value, "current_user", "current-nonce-0001"),
      ),
      previewHash: "0".repeat(64),
    };
    const refused = await outbox.value.flush(
      value.telemetry.fingerprint,
      stale,
      transport,
    );
    assert.deepEqual(refused, { status: "unauthorized" });
    const result = await outbox.value.flush(
      value.telemetry.fingerprint,
      authorityFor(value, "current_user", "current-nonce-0002"),
      transport,
    );
    assert.equal(result.status, "submitted");
  } finally {
    rmSync(outboxRoot.root, { recursive: true, force: true });
  }
});

test("strict authority and GitHub readbacks reject forged repository, URL, pagination, and unknown fields", async () => {
  const value = packet();
  const authority = authorityFor(value, "current_user", "current-nonce-0100");
  assert.equal(
    authorizes(value, { ...authority, extra: true } as never),
    false,
  );
  const forged = await flushPacket(value, authority, {
    async discoverExactMarker() {
      return {
        repositoryId: "R_kgDOUCvUmw",
        paginationComplete: true,
        issues: [],
        extra: true,
      };
    },
    async createIssue() {
      throw new Error("must not create from malformed discovery");
    },
  });
  assert.deepEqual(forged, { status: "ambiguous", code: "GITHUB_REJECTED" });
  const incomplete = await discoverExisting(value, {
    async discoverExactMarker() {
      return {
        repositoryId: "R_kgDOUCvUmw",
        paginationComplete: false,
        issues: [],
      };
    },
    async createIssue() {
      return undefined;
    },
  });
  assert.deepEqual(incomplete, { status: "invalid" });
  const forgedCreate = await flushPacket(value, authority, {
    async discoverExactMarker() {
      return {
        repositoryId: "R_kgDOUCvUmw",
        paginationComplete: true,
        issues: [],
      };
    },
    async createIssue() {
      return {
        repositoryId: "R_kgDOUCvUmw",
        number: 10,
        url: "https://github.com/hls-uk/other/issues/10",
        body: value.body,
        open: true,
      };
    },
  });
  assert.deepEqual(forgedCreate, {
    status: "ambiguous",
    code: "GITHUB_REJECTED",
  });
});

test("all public authority and provider paths reconstruct packets before use", async () => {
  const value = packet("FORGED");
  const forged = {
    ...value,
    target: { ...value.target, repository: "hls-uk/other" },
  };
  let calls = 0;
  const transport: FeedbackGitHubTransport = {
    async discoverExactMarker() {
      calls += 1;
      return {
        repositoryId: "R_kgDOUCvUmw",
        paginationComplete: true,
        issues: [],
      };
    },
    async createIssue() {
      calls += 1;
      return undefined;
    },
  };
  assert.equal(validateFeedbackPacket(forged), undefined);
  assert.equal(
    authorityFor(forged, "current_user", "current-nonce-0111"),
    undefined,
  );
  assert.equal(
    authorizes(
      forged,
      authorityFor(value, "current_user", "current-nonce-0112"),
    ),
    false,
  );
  assert.deepEqual(await discoverExisting(forged, transport), {
    status: "invalid",
  });
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common);
    assert.equal(opened.status, "ok");
    assert.equal(opened.value.enqueue(forged).status, "invalid");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
  assert.equal(calls, 0);
});

test("post-create readback must retain the exact authorized body", async () => {
  const value = packet("CREATE");
  const result = await flushPacket(
    value,
    authorityFor(value, "current_user", "current-nonce-0120"),
    {
      async discoverExactMarker() {
        return {
          repositoryId: "R_kgDOUCvUmw",
          paginationComplete: true,
          issues: [],
        };
      },
      async createIssue() {
        return {
          repositoryId: "R_kgDOUCvUmw",
          number: 13,
          url: "https://github.com/hls-uk/single-controller-engineer/issues/13",
          body: `${value.body}\nextra`,
          open: true,
        };
      },
    },
  );
  assert.deepEqual(result, { status: "ambiguous", code: "GITHUB_REJECTED" });
});

test("duplicate reconciliation ignores copied markers and ranks only exact controlled bodies", () => {
  const value = packet();
  const result = reconcileExactDuplicates(value, [
    {
      repositoryId: "R_kgDOUCvUmw",
      number: 20,
      url: "https://github.com/hls-uk/single-controller-engineer/issues/20",
      body: value.body,
      open: true,
    },
    {
      repositoryId: "R_kgDOUCvUmw",
      number: 3,
      url: "https://github.com/hls-uk/single-controller-engineer/issues/3",
      body: value.marker,
      open: true,
    },
    {
      repositoryId: "R_kgDOUCvUmw",
      number: 1,
      url: "https://github.com/hls-uk/single-controller-engineer/issues/1",
      body: value.marker.replace("fingerprint", "fingerprints"),
      open: true,
    },
  ]);
  const reconciliation = requireValue(result);
  assert.equal(reconciliation.canonical.number, 20);
  assert.deepEqual(reconciliation.duplicates, []);
});

test("outbox enforces private modes, no-follow symlink refusal, locking, quota and atomic crash boundaries", () => {
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common);
    assert.equal(opened.status, "ok");
    const value = packet();
    assert.equal(opened.value.enqueue(value).status, "ok");
    assert.equal(lstatSync(opened.value.directory).mode & 0o777, 0o700);
    assert.equal(
      lstatSync(
        join(opened.value.directory, `${value.telemetry.fingerprint}.json`),
      ).mode & 0o777,
      0o600,
    );
    writeFileSync(join(opened.value.directory, ".lock"), "lock", {
      mode: 0o600,
    });
    assert.equal(opened.value.enqueue(packet("SECOND")).status, "busy");
    rmSync(join(opened.value.directory, ".lock"), { force: true });
    assert.equal(
      opened.value.quarantine(value.telemetry.fingerprint, "OUTBOX_CORRUPT")
        .status,
      "ok",
    );
    assert.equal(opened.value.read(value.telemetry.fingerprint).status, "ok");

    const unsafe = commonDirectory();
    symlinkSync(unsafe.common, join(fixture.root, "linked"));
    assert.equal(
      FeedbackOutbox.open(join(fixture.root, "linked")).status,
      "unavailable",
    );
    rmSync(unsafe.root, { recursive: true, force: true });

    const crash = FeedbackOutbox.open(fixture.common, {
      afterTempFsync: () => {
        throw new Error("crash");
      },
    });
    assert.equal(crash.status, "ok");
    assert.equal(crash.value.enqueue(packet("CRASH")).status, "unavailable");
    assert.equal(opened.value.enqueue(packet("CRASH")).status, "ok");

    for (let index = 0; index < 98; index += 1)
      assert.equal(opened.value.enqueue(packet(`COUNT${index}`)).status, "ok");
    assert.equal(opened.value.enqueue(packet("OVER_QUOTA")).status, "quota");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("outbox rejects symlink/malformed existing data without chmod and recovers only a positively observed killed lock", () => {
  const fixture = commonDirectory();
  try {
    const targetDirectory = join(fixture.root, "outside");
    mkdirSync(targetDirectory, { mode: 0o755 });
    const before = lstatSync(targetDirectory).mode & 0o777;
    mkdirSync(join(fixture.common, "sce"), { mode: 0o700 });
    symlinkSync(
      targetDirectory,
      join(fixture.common, "sce", "feedback-outbox"),
    );
    assert.equal(FeedbackOutbox.open(fixture.common).status, "unavailable");
    assert.equal(lstatSync(targetDirectory).mode & 0o777, before);
    rmSync(join(fixture.common, "sce"), { recursive: true, force: true });

    const opened = FeedbackOutbox.open(fixture.common);
    assert.equal(opened.status, "ok");
    const value = packet("EXACT");
    const path = join(
      opened.value.directory,
      `${value.telemetry.fingerprint}.json`,
    );
    writeFileSync(path, "{not-json}", { mode: 0o600 });
    assert.equal(opened.value.enqueue(value).status, "invalid");
    rmSync(path, { force: true });
    writeFileSync(join(opened.value.directory, ".lock"), "dead", {
      mode: 0o600,
    });
    const recovered = FeedbackOutbox.open(fixture.common, {
      recoverKilledLock: () => true,
    });
    assert.equal(recovered.status, "ok");
    assert.equal(recovered.value.enqueue(value).status, "ok");

    const stale = packet("STALE");
    const temp = join(
      recovered.value.directory,
      `.${stale.telemetry.fingerprint}.tmp`,
    );
    writeFileSync(temp, "untrusted temporary", { mode: 0o600 });
    assert.equal(recovered.value.enqueue(stale).status, "ok");
    assert.equal(lstatSync(temp).isFile(), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("lock cleanup never removes a replacement inode", () => {
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common, {
      afterTempFsync: () => {
        const lock = join(fixture.common, "sce", "feedback-outbox", ".lock");
        rmSync(lock, { force: true });
        writeFileSync(lock, "replacement", { mode: 0o600 });
      },
    });
    assert.equal(opened.status, "ok");
    assert.equal(opened.value.enqueue(packet("REPLACED")).status, "ok");
    assert.equal(
      lstatSync(join(opened.value.directory, ".lock")).isFile(),
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("outbox quota accounts for incoming bytes", () => {
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common);
    assert.equal(opened.status, "ok");
    writeFileSync(
      join(opened.value.directory, "padding"),
      Buffer.alloc(OUTBOX_MAX_BYTES),
      { mode: 0o600 },
    );
    assert.equal(opened.value.enqueue(packet("INCOMING")).status, "quota");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("outbox read binds its filename fingerprint and submitted tombstone URL", () => {
  const fixture = commonDirectory();
  try {
    const result = FeedbackOutbox.open(fixture.common);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") throw new Error("outbox unavailable");
    const opened = result.value;
    const first = packet("FIRST");
    const second = packet("SECOND");
    const mismatched = join(
      opened.directory,
      `${second.telemetry.fingerprint}.json`,
    );
    writeFileSync(
      mismatched,
      JSON.stringify({ schemaVersion: 1, status: "pending", packet: first }),
      { mode: 0o600 },
    );
    assert.equal(opened.read(second.telemetry.fingerprint).status, "invalid");
    rmSync(mismatched, { force: true });
    writeFileSync(
      join(opened.directory, `${first.telemetry.fingerprint}.json`),
      JSON.stringify({
        schemaVersion: 1,
        status: "submitted",
        packet: first,
        issue: { number: 14, url: "https://github.com/hls-uk/other/issues/14" },
      }),
      { mode: 0o600 },
    );
    assert.equal(opened.read(first.telemetry.fingerprint).status, "invalid");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("ambiguous submit recovers through exact discovery and flush reauthorizes", async () => {
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common);
    assert.equal(opened.status, "ok");
    const value = packet();
    assert.equal(opened.value.enqueue(value).status, "ok");
    const unavailable: FeedbackGitHubTransport = {
      async discoverExactMarker() {
        return {
          repositoryId: "R_kgDOUCvUmw",
          paginationComplete: true,
          issues: [],
        };
      },
      async createIssue() {
        throw Object.assign(new Error("lost response"), {
          code: "GITHUB_UNAVAILABLE",
        });
      },
    };
    const first = await opened.value.flush(
      value.telemetry.fingerprint,
      authorityFor(value, "current_user", "current-nonce-0003"),
      unavailable,
    );
    assert.deepEqual(first, {
      status: "ambiguous",
      code: "GITHUB_UNAVAILABLE",
    });
    const intent = opened.value.read(value.telemetry.fingerprint);
    assert.equal(intent.status, "ok");
    assert.equal(
      intent.status === "ok" ? intent.value.status : undefined,
      "submit_intent",
    );
    const absentRetry = await opened.value.flush(
      value.telemetry.fingerprint,
      authorityFor(value, "current_user", "current-nonce-0003"),
      unavailable,
    );
    assert.deepEqual(absentRetry, { status: "unauthorized" });
    const observed = {
      repositoryId: "R_kgDOUCvUmw" as const,
      number: 9,
      url: "https://github.com/hls-uk/single-controller-engineer/issues/9",
      body: value.body,
      open: true,
    };
    const recovered = await opened.value.flush(
      value.telemetry.fingerprint,
      undefined,
      fakeTransport([observed]),
    );
    assert.equal(recovered.status, "existing");
    const submitted = opened.value.read(value.telemetry.fingerprint);
    assert.equal(submitted.status, "ok");
    assert.equal(
      submitted.status === "ok" ? submitted.value.status : undefined,
      "submitted",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("concurrent local flushes serialize one submit intent", async () => {
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common);
    assert.equal(opened.status, "ok");
    const value = packet("CONCURRENT");
    assert.equal(opened.value.enqueue(value).status, "ok");
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: FeedbackGitHubTransport = {
      async discoverExactMarker() {
        return {
          repositoryId: "R_kgDOUCvUmw",
          paginationComplete: true,
          issues: [],
        };
      },
      async createIssue(request) {
        await waiting;
        return {
          repositoryId: "R_kgDOUCvUmw" as const,
          number: 88,
          url: "https://github.com/hls-uk/single-controller-engineer/issues/88",
          body: request.body,
          open: true,
        };
      },
    };
    const first = opened.value.flush(
      value.telemetry.fingerprint,
      authorityFor(value, "current_user", "current-nonce-0088"),
      transport,
    );
    const second = await opened.value.flush(
      value.telemetry.fingerprint,
      authorityFor(value, "current_user", "current-nonce-0089"),
      transport,
    );
    assert.deepEqual(second, { status: "busy" });
    release?.();
    assert.equal((await first).status, "submitted");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the same authority cannot create twice through the durable outbox", async () => {
  const fixture = commonDirectory();
  try {
    const opened = FeedbackOutbox.open(fixture.common);
    assert.equal(opened.status, "ok");
    const value = packet("ONCE");
    assert.equal(opened.value.enqueue(value).status, "ok");
    let creates = 0;
    const transport: FeedbackGitHubTransport = {
      async discoverExactMarker() {
        return {
          repositoryId: "R_kgDOUCvUmw",
          paginationComplete: true,
          issues: [],
        };
      },
      async createIssue(request) {
        creates += 1;
        return {
          repositoryId: "R_kgDOUCvUmw" as const,
          number: 99,
          url: "https://github.com/hls-uk/single-controller-engineer/issues/99",
          body: request.body,
          open: true,
        };
      },
    };
    const authority = authorityFor(value, "current_user", "current-nonce-0099");
    assert.equal(
      (
        await opened.value.flush(
          value.telemetry.fingerprint,
          authority,
          transport,
        )
      ).status,
      "submitted",
    );
    assert.equal(
      (
        await opened.value.flush(
          value.telemetry.fingerprint,
          authority,
          transport,
        )
      ).status,
      "invalid",
    );
    assert.equal(creates, 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
