import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PinnedBdEmbeddedProcess } from "../../../src/adapters/beads-embedded/index.js";
import {
  EMBEDDED_ADAPTER_VERSION,
  EmbeddedResultSchema,
  REMOTE_FAILURE_TAIL_BYTES,
  redactedStderrTail,
} from "../../../src/adapters/beads-embedded/schemas.js";
import { isSchema } from "../../../src/adapters/git/schemas.js";

const scope = {
  beadsStoreIdentity: "store-1",
  gitRepositoryIdentity: "repo-1",
  integrationBranch: "main",
};

// Secret-shaped fixtures are assembled here, never written as literals, so no
// scanner ever has to decide whether this file leaked a real credential.
const FAKE_GITHUB_TOKEN = `ghp_${"A".repeat(36)}`;
const FAKE_KEY_BODY = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU".repeat(3);
const FAKE_PRIVATE_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  FAKE_KEY_BODY,
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

async function fakeBd(root: string, body: readonly string[]): Promise<string> {
  const path = join(root, "bd");
  await writeFile(
    path,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then printf "bd version 1.1.0\\n"; exit 0; fi',
      ...body,
      "printf '{}\\n'",
    ].join("\n"),
    { mode: 0o700 },
  );
  await chmod(path, 0o700);
  return path;
}

function pinnedProcess(root: string, bdExecutable: string) {
  return new PinnedBdEmbeddedProcess({
    bdExecutable,
    cwd: root,
    databaseDirectory: root,
    doltExecutable: join(root, "dolt"),
    prefix: "sce",
    projections: {
      async discover() {
        return undefined;
      },
      async discoverAt() {
        return undefined;
      },
      matchesBatchDelta() {
        return false;
      },
      async mutate() {
        return { kind: "mutation", value: "quarantined" } as const;
      },
      async readback() {
        return undefined;
      },
    },
    scope,
  });
}

test("a failed push observation names its cause without carrying a secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-stderr-tail-"));
  try {
    const bd = await fakeBd(root, [
      'if [ "$1" = "dolt" ] && [ "$2" = "push" ]; then',
      "cat >&2 <<'STDERR'",
      "pushing to ssh://sce:hunter2@dolt.example.invalid/sce/beads",
      `Authorization: Bearer ${FAKE_GITHUB_TOKEN}`,
      `sync.token=${FAKE_GITHUB_TOKEN}`,
      FAKE_PRIVATE_KEY,
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDexamplehostkeyblob user@host",
      "sce@dolt.example.invalid: Permission denied (publickey).",
      "fatal: Could not read from remote repository.",
      "STDERR",
      "exit 1",
      "fi",
    ]);
    const observed = await pinnedProcess(root, bd).execute({ kind: "push" });
    assert.ok(observed.kind === "push");
    // The classification is exactly what it was before the tail existed.
    assert.equal(observed.value, "conflict");
    const tail = observed.stderrTail;
    assert.ok(tail !== undefined);
    assert.equal(tail.schema, "sce.beads-embedded.remote-failure-tail");
    assert.equal(tail.version, 1);
    assert.equal(tail.truncated, false);
    // The cause survives; every secret shape around it does not.
    assert.ok(tail.text.includes("Permission denied (publickey)."));
    assert.ok(
      tail.text.includes("fatal: Could not read from remote repository."),
    );
    assert.ok(tail.text.includes("dolt.example.invalid"));
    for (const secret of [
      "hunter2",
      FAKE_GITHUB_TOKEN,
      FAKE_KEY_BODY,
      "AAAAB3NzaC1yc2E",
      "PRIVATE KEY",
    ])
      assert.equal(tail.text.includes(secret), false);
    assert.equal(/^[\n\x20-\x7E]+$/u.test(tail.text), true);
    assert.ok(
      Buffer.byteLength(tail.text, "utf8") <= REMOTE_FAILURE_TAIL_BYTES,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a flooded stderr is published as a bounded, truncated tail", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-stderr-flood-"));
  try {
    const bd = await fakeBd(root, [
      'if [ "$1" = "dolt" ] && [ "$2" = "push" ]; then',
      "  i=0",
      "  while [ $i -lt 800 ]; do",
      "    printf 'retrying chunk %s of the remote transfer\\n' \"$i\" >&2",
      "    i=$((i+1))",
      "  done",
      "  exit 1",
      "fi",
    ]);
    const observed = await pinnedProcess(root, bd).execute({ kind: "push" });
    assert.ok(observed.kind === "push");
    assert.equal(observed.value, "conflict");
    const tail = observed.stderrTail;
    assert.ok(tail !== undefined);
    assert.equal(tail.truncated, true);
    assert.ok(
      Buffer.byteLength(tail.text, "utf8") <= REMOTE_FAILURE_TAIL_BYTES,
    );
    // The tail is the end of the stream, which is where the failure is.
    assert.ok(tail.text.endsWith("retrying chunk 799 of the remote transfer"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a push that applies carries no tail at all", async () => {
  const root = await mkdtemp(join(tmpdir(), "sce-stderr-applied-"));
  try {
    const bd = await fakeBd(root, [
      'if [ "$1" = "dolt" ] && [ "$2" = "push" ]; then',
      "  echo 'warning: token=never-returned' >&2",
      "  printf '{}\\n'",
      "  exit 0",
      "fi",
    ]);
    const observed = await pinnedProcess(root, bd).execute({ kind: "push" });
    assert.deepEqual(observed, { kind: "push", value: "applied" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the published tail redacts every secret shape it knows and stays bounded", () => {
  const cases: readonly (readonly [string, string])[] = [
    [
      "cloning https://someone:hunter2@example.invalid/sce.git",
      "cloning https://[redacted]@example.invalid/sce.git",
    ],
    ["Authorization: Bearer abc.def", "Authorization: [redacted]"],
    ["sync.token = abc-def", "sync.token = [redacted]"],
    [`used ${FAKE_GITHUB_TOKEN} here`, "used [redacted] here"],
    [`key ${FAKE_PRIVATE_KEY} end`, "key [redacted key] end"],
    [
      `truncated -----BEGIN RSA PRIVATE KEY-----\n${FAKE_KEY_BODY}`,
      "truncated [redacted key]",
    ],
    [
      "host ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexamplehostkey label",
      "host ssh-ed25519 [redacted] label",
    ],
    // A named secret is rarely bare: an environment variable, a compound AWS
    // name, a snake-cased field, and a query parameter each decorate it, and
    // a word boundary before the name would publish every one of these.
    ["DOLT_REMOTE_PASSWORD=hunter2", "DOLT_REMOTE_PASSWORD=[redacted]"],
    [
      "AWS_SECRET_ACCESS_KEY=not-a-real-value",
      "AWS_SECRET_ACCESS_KEY=[redacted]",
    ],
    ["secret_key=not-a-real-value", "secret_key=[redacted]"],
    [
      "GET https://dolt.example.invalid/sce/beads?access_token=not-a-real-value",
      "GET https://dolt.example.invalid/sce/beads?access_token=[redacted]",
    ],
    ["--password=hunter2", "--password=[redacted]"],
    // The cause itself is never a named secret, so it survives intact.
    [
      "sce@dolt.example.invalid: Permission denied (publickey).",
      "sce@dolt.example.invalid: Permission denied (publickey).",
    ],
    [
      "remote: error: cannot lock ref 'refs/dolt/data'",
      "remote: error: cannot lock ref 'refs/dolt/data'",
    ],
    [`\u001B[31mred\u001B[0m\tcause\r\n`, "red cause"],
    // A line that is nothing but base64 is a key body, never a diagnostic.
    [`\n${"A".repeat(64)}\n`, "[redacted]"],
  ];
  for (const [raw, expected] of cases) {
    const tail = redactedStderrTail(raw, false);
    assert.ok(tail !== undefined);
    assert.equal(tail.text, expected);
    assert.equal(tail.truncated, false);
  }
  assert.equal(redactedStderrTail("   \n\t ", false), undefined);
  const flooded = redactedStderrTail("connection reset ".repeat(600), true);
  assert.ok(flooded !== undefined);
  assert.equal(flooded.truncated, true);
  assert.equal(
    Buffer.byteLength(flooded.text, "utf8"),
    REMOTE_FAILURE_TAIL_BYTES,
  );
});

test("the strict result schema admits exactly one bounded, redacted tail", () => {
  const tail = redactedStderrTail("fatal: remote refused the push", false);
  assert.ok(tail !== undefined);
  const refused = {
    code: "conflict",
    schema: "sce.beads-embedded.result",
    stderrTail: tail,
    version: EMBEDDED_ADAPTER_VERSION,
  };
  assert.equal(isSchema(EmbeddedResultSchema, refused), true);
  // The field is optional: a result with no failed child is still valid.
  assert.equal(
    isSchema(EmbeddedResultSchema, {
      code: "applied",
      schema: "sce.beads-embedded.result",
      version: EMBEDDED_ADAPTER_VERSION,
    }),
    true,
  );
  // An unbounded tail, an unprintable one, and an extra property are refused
  // rather than carried into a journalled refusal.
  for (const invalid of [
    {
      ...refused,
      stderrTail: { ...tail, text: "x".repeat(REMOTE_FAILURE_TAIL_BYTES + 1) },
    },
    { ...refused, stderrTail: { ...tail, text: "cause\u0000" } },
    { ...refused, stderrTail: { ...tail, extra: 1 } },
    { ...refused, stderrTail: tail.text },
    { ...refused, stderr: tail.text },
  ])
    assert.equal(isSchema(EmbeddedResultSchema, invalid), false);
});
