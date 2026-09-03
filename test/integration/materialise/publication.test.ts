import assert from "node:assert/strict";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  nodeMaterialisationProcess,
  type MaterialisationProcessPort,
} from "../../../src/adapters/materialise/index.js";
import { LIMITS } from "../../../src/protocol/schemas.js";
import {
  adapterFor,
  materialisationFixture,
  replaceHelperSource,
  transformHelper,
  type MaterialisationFixture,
} from "./fixture.js";

function paths(fixture: MaterialisationFixture) {
  const artifact = join(
    fixture.destinationDirectory,
    fixture.effect.params.artifactName,
  );
  const sidecar = join(
    fixture.destinationDirectory,
    fixture.effect.params.sidecarName,
  );
  return {
    artifact,
    artifactTemp: join(
      fixture.destinationDirectory,
      `.${fixture.effect.params.artifactName}.sce-tmp`,
    ),
    sidecar,
    sidecarTemp: join(
      fixture.destinationDirectory,
      `.${fixture.effect.params.sidecarName}.sce-tmp`,
    ),
  };
}

async function assertExactPair(fixture: MaterialisationFixture): Promise<void> {
  const output = paths(fixture);
  assert.deepEqual(await readFile(output.artifact), fixture.artifact);
  assert.deepEqual(await readFile(output.sidecar), fixture.sidecar);
  assert.equal((await lstat(output.artifact)).isFile(), true);
  assert.equal((await lstat(output.sidecar)).isFile(), true);
  assert.deepEqual((await readdir(fixture.destinationDirectory)).sort(), [
    fixture.effect.params.artifactName,
    fixture.effect.params.sidecarName,
  ]);
}

test("publication links sidecar before artifact, then exact retries and discovery are idempotent", async () => {
  const fixture = await materialisationFixture();
  try {
    const orderingPort = transformHelper((source) =>
      replaceHelperSource(
        source,
        "try { fs.linkSync(tempName, finalName); }",
        "try { if (finalName === metadata.artifactName && !fs.existsSync(metadata.sidecarName)) throw Object.assign(new Error('artifact-before-sidecar'), { code: 'EIO' }); fs.linkSync(tempName, finalName); }",
      ),
    );
    const adapter = adapterFor(fixture, orderingPort);
    const first = await adapter.materialise(fixture.effect);
    assert.equal(first.status, "observed");
    if (first.status === "observed") {
      assert.equal(first.observation.sidecarStatus, "published");
      assert.equal(first.observation.artifactStatus, "published");
    }
    await assertExactPair(fixture);

    const discovered = await adapter.discoverMaterialise(fixture.effect);
    assert.equal(discovered.status, "observed");
    if (discovered.status === "observed") {
      assert.equal(discovered.observation.sidecarStatus, "already_present");
      assert.equal(discovered.observation.artifactStatus, "already_present");
    }

    const retry = await adapter.materialise(fixture.effect);
    assert.equal(retry.status, "observed");
    if (retry.status === "observed") {
      assert.equal(retry.observation.sidecarStatus, "already_present");
      assert.equal(retry.observation.artifactStatus, "already_present");
    }
    await assertExactPair(fixture);
  } finally {
    await fixture.cleanup();
  }
});

test("read-only recovery discovery distinguishes complete, recoverable, absent, and contradictory states", async (t) => {
  await t.test("no act and either one-file act remain absent", async () => {
    const fixture = await materialisationFixture();
    try {
      const adapter = adapterFor(fixture);
      assert.deepEqual(await adapter.discoverMaterialise(fixture.effect), {
        status: "absent",
      });
      const output = paths(fixture);
      await writeFile(output.artifact, fixture.artifact);
      const before = await stat(output.artifact);
      assert.deepEqual(await adapter.discoverMaterialise(fixture.effect), {
        status: "absent",
      });
      assert.equal((await stat(output.artifact)).ino, before.ino);
      await writeFile(output.sidecar, fixture.sidecar);
      assert.equal(
        (await adapter.discoverMaterialise(fixture.effect)).status,
        "observed",
      );
      await assertExactPair(fixture);
    } finally {
      await fixture.cleanup();
    }
  });

  await t.test(
    "an exact unlinked temporary is recoverable, not observed",
    async () => {
      const fixture = await materialisationFixture();
      try {
        const output = paths(fixture);
        await writeFile(output.sidecarTemp, fixture.sidecar);
        const before = await stat(output.sidecarTemp);
        assert.deepEqual(
          await adapterFor(fixture).discoverMaterialise(fixture.effect),
          { status: "absent" },
        );
        assert.equal((await stat(output.sidecarTemp)).ino, before.ino);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  await t.test(
    "a post-link temporary is recoverable, not observed",
    async () => {
      const fixture = await materialisationFixture();
      try {
        const output = paths(fixture);
        await writeFile(output.sidecarTemp, fixture.sidecar);
        await link(output.sidecarTemp, output.sidecar);
        assert.deepEqual(
          await adapterFor(fixture).discoverMaterialise(fixture.effect),
          { status: "absent" },
        );
        assert.equal((await stat(output.sidecar)).nlink, 2);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  await t.test(
    "a different-byte unlinked temporary is recoverable and untouched by discovery",
    async () => {
      const fixture = await materialisationFixture();
      try {
        const output = paths(fixture);
        await writeFile(output.sidecarTemp, "contradiction\n");
        const before = await stat(output.sidecarTemp);
        const adapter = adapterFor(fixture);
        assert.deepEqual(await adapter.discoverMaterialise(fixture.effect), {
          status: "absent",
        });
        assert.equal((await stat(output.sidecarTemp)).ino, before.ino);
        assert.equal(
          await readFile(output.sidecarTemp, "utf8"),
          "contradiction\n",
        );
        assert.equal(
          (await adapter.materialise(fixture.effect)).status,
          "observed",
        );
        await assertExactPair(fixture);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  for (const kind of ["final", "temporary"] as const) {
    await t.test(
      `an oversized ${kind} is rejected before recovery readback`,
      async () => {
        const fixture = await materialisationFixture();
        try {
          const output = paths(fixture);
          const path = kind === "final" ? output.artifact : output.artifactTemp;
          await writeFile(path, fixture.artifact);
          await truncate(path, fixture.artifact.byteLength + 1);
          const before = await stat(path);
          assert.equal(
            (await adapterFor(fixture).discoverMaterialise(fixture.effect))
              .status,
            "ambiguous",
          );
          const after = await stat(path);
          assert.equal(after.ino, before.ino);
          assert.equal(after.size, before.size);
        } finally {
          await fixture.cleanup();
        }
      },
    );
  }
});

test("either exact one-file crash state resumes without replacing the existing final", async (t) => {
  await t.test("artifact-only", async () => {
    const fixture = await materialisationFixture();
    try {
      const output = paths(fixture);
      await writeFile(output.artifact, fixture.artifact);
      const before = await stat(output.artifact);
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "observed");
      if (result.status === "observed") {
        assert.equal(result.observation.artifactStatus, "already_present");
        assert.equal(result.observation.sidecarStatus, "published");
      }
      assert.equal((await stat(output.artifact)).ino, before.ino);
      await assertExactPair(fixture);
    } finally {
      await fixture.cleanup();
    }
  });

  await t.test("sidecar-only", async () => {
    const fixture = await materialisationFixture();
    try {
      const output = paths(fixture);
      await writeFile(output.sidecar, fixture.sidecar);
      const before = await stat(output.sidecar);
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "observed");
      if (result.status === "observed") {
        assert.equal(result.observation.artifactStatus, "published");
        assert.equal(result.observation.sidecarStatus, "already_present");
      }
      assert.equal((await stat(output.sidecar)).ino, before.ino);
      await assertExactPair(fixture);
    } finally {
      await fixture.cleanup();
    }
  });
});

test("reserved temporaries are reused or replaced exactly and linked-crash temporaries are cleaned", async (t) => {
  await t.test("different-byte temporaries", async () => {
    const fixture = await materialisationFixture();
    try {
      const output = paths(fixture);
      await writeFile(output.sidecarTemp, "stale sidecar\n");
      await writeFile(output.artifactTemp, "stale artifact\n");
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "observed");
      await assertExactPair(fixture);
    } finally {
      await fixture.cleanup();
    }
  });

  await t.test("identical temporary", async () => {
    const fixture = await materialisationFixture();
    try {
      const output = paths(fixture);
      await writeFile(output.sidecarTemp, fixture.sidecar);
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "observed");
      await assertExactPair(fixture);
    } finally {
      await fixture.cleanup();
    }
  });

  await t.test("sidecar link completed before crash", async () => {
    const fixture = await materialisationFixture();
    try {
      const output = paths(fixture);
      await writeFile(output.sidecarTemp, fixture.sidecar);
      await link(output.sidecarTemp, output.sidecar);
      assert.equal((await stat(output.sidecarTemp)).nlink, 2);
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "observed");
      if (result.status === "observed") {
        assert.equal(result.observation.sidecarStatus, "already_present");
        assert.equal(result.observation.artifactStatus, "published");
      }
      await assertExactPair(fixture);
      assert.equal((await stat(output.sidecar)).nlink, 1);
    } finally {
      await fixture.cleanup();
    }
  });
});

test("an identical EEXIST race observes the competing no-clobber file and removes only its own temp", async () => {
  const fixture = await materialisationFixture();
  try {
    const eexistPort = transformHelper((source) =>
      replaceHelperSource(
        source,
        "try { fs.linkSync(tempName, finalName); }",
        "try { fs.writeFileSync(finalName, bytes, { flag: 'wx', mode: 0o600 }); fs.linkSync(tempName, finalName); }",
      ),
    );
    const result = await adapterFor(fixture, eexistPort).materialise(
      fixture.effect,
    );
    assert.equal(result.status, "observed");
    if (result.status === "observed") {
      assert.equal(result.observation.sidecarStatus, "already_present");
      assert.equal(result.observation.artifactStatus, "already_present");
    }
    await assertExactPair(fixture);
  } finally {
    await fixture.cleanup();
  }
});

test("the helper preserves filesystem identities above the safe integer boundary", async () => {
  const fixture = await materialisationFixture();
  try {
    const identityOffset = 9_007_199_254_740_992n;
    const highIdentityPort: MaterialisationProcessPort = {
      run: async (executable, argv, options) => {
        if (executable !== process.execPath || argv[0] !== "-e")
          return await nodeMaterialisationProcess.run(
            executable,
            argv,
            options,
          );
        assert.equal(typeof argv[1], "string");
        const input = options.input;
        assert.ok(input);
        const headerLength = input.readUInt32BE(0);
        const metadata = JSON.parse(
          input.subarray(4, 4 + headerLength).toString("utf8"),
        ) as { dev: string; ino: string };
        metadata.dev = (BigInt(metadata.dev) + identityOffset).toString();
        metadata.ino = (BigInt(metadata.ino) + identityOffset).toString();
        const header = Buffer.from(JSON.stringify(metadata), "utf8");
        const length = Buffer.alloc(4);
        length.writeUInt32BE(header.byteLength);
        const rewrittenInput = Buffer.concat([
          length,
          header,
          input.subarray(4 + headerLength),
        ]);
        const rewrittenSource = replaceHelperSource(
          argv[1]!,
          'const fs = require("node:fs");',
          'const realFs = require("node:fs"); const identityOffset = 9007199254740992n; const withHighIdentity = value => { value.dev += identityOffset; value.ino += identityOffset; return value; }; const fs = new Proxy(realFs, { get: (target, property) => ["statSync", "lstatSync", "fstatSync"].includes(property) ? (...args) => withHighIdentity(target[property](...args)) : target[property] });',
        );
        return await nodeMaterialisationProcess.run(
          executable,
          ["-e", rewrittenSource],
          { ...options, input: rewrittenInput },
        );
      },
    };
    const result = await adapterFor(fixture, highIdentityPort).materialise(
      fixture.effect,
    );
    assert.equal(result.status, "observed");
    await assertExactPair(fixture);
  } finally {
    await fixture.cleanup();
  }
});

test("the helper preserves a newly linked pair when an unexpected third hard link appears", async () => {
  const fixture = await materialisationFixture();
  try {
    const foreignLinkPort = transformHelper((source) =>
      replaceHelperSource(
        source,
        "try { fs.linkSync(tempName, finalName); }",
        "try { fs.linkSync(tempName, finalName); fs.linkSync(tempName, finalName + '.foreign-link'); }",
      ),
    );
    const result = await adapterFor(fixture, foreignLinkPort).materialise(
      fixture.effect,
    );
    assert.equal(result.status, "ambiguous");
    const output = paths(fixture);
    assert.deepEqual(await readFile(output.sidecar), fixture.sidecar);
    assert.deepEqual(await readFile(output.sidecarTemp), fixture.sidecar);
    assert.deepEqual(
      await readFile(`${output.sidecar}.foreign-link`),
      fixture.sidecar,
    );
    assert.equal((await stat(output.sidecar)).nlink, 3);
  } finally {
    await fixture.cleanup();
  }
});

test("a different-byte EEXIST race is ambiguous and never overwrites the competing final", async () => {
  const fixture = await materialisationFixture();
  try {
    const eexistPort = transformHelper((source) =>
      replaceHelperSource(
        source,
        "try { fs.linkSync(tempName, finalName); }",
        "try { fs.writeFileSync(finalName, Buffer.from('competitor\\n'), { flag: 'wx', mode: 0o600 }); fs.linkSync(tempName, finalName); }",
      ),
    );
    const result = await adapterFor(fixture, eexistPort).materialise(
      fixture.effect,
    );
    assert.equal(result.status, "ambiguous");
    const output = paths(fixture);
    assert.equal(await readFile(output.sidecar, "utf8"), "competitor\n");
    await assert.rejects(readFile(output.artifact), { code: "ENOENT" });
  } finally {
    await fixture.cleanup();
  }
});

test("positive unsupported hard-link evidence refuses before a final is created", async () => {
  const fixture = await materialisationFixture();
  try {
    const unsupportedPort = transformHelper((source) =>
      replaceHelperSource(
        source,
        "try { fs.linkSync(tempName, finalName); }",
        "try { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); }",
      ),
    );
    const result = await adapterFor(fixture, unsupportedPort).materialise(
      fixture.effect,
    );
    assert.equal(result.status, "refused");
    if (result.status === "refused")
      assert.equal(result.refusal.code, "hard_links_unsupported");
    assert.deepEqual(await readdir(fixture.destinationDirectory), []);
  } finally {
    await fixture.cleanup();
  }
});

test("different, oversized, symlinked, and special destination entries are ambiguous and preserved", async (t) => {
  const cases: ReadonlyArray<{
    name: string;
    arrange(fixture: MaterialisationFixture): Promise<string>;
  }> = [
    {
      name: "different final",
      arrange: async (fixture) => {
        const path = paths(fixture).artifact;
        await writeFile(path, "existing owner\n");
        return path;
      },
    },
    {
      name: "oversized sparse final",
      arrange: async (fixture) => {
        const path = paths(fixture).artifact;
        await writeFile(path, "x");
        await truncate(path, LIMITS.materialisationBlobBytes + 1);
        return path;
      },
    },
    {
      name: "symlink final",
      arrange: async (fixture) => {
        const target = join(fixture.root, "foreign");
        await writeFile(target, "foreign\n");
        const path = paths(fixture).artifact;
        await symlink(target, path);
        return path;
      },
    },
    {
      name: "directory at reserved temp",
      arrange: async (fixture) => {
        const path = paths(fixture).sidecarTemp;
        await mkdir(path);
        return path;
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const fixture = await materialisationFixture();
      try {
        const preserved = await entry.arrange(fixture);
        const before = await lstat(preserved);
        const result = await adapterFor(fixture).materialise(fixture.effect);
        assert.equal(result.status, "ambiguous");
        const after = await lstat(preserved);
        assert.equal(after.ino, before.ino);
        assert.equal(after.mode, before.mode);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

test("materialisation refuses to act after marker, containment, or inode identity drift", async (t) => {
  await t.test("marker removed", async () => {
    const fixture = await materialisationFixture();
    try {
      await rm(join(fixture.destinationRoot, ".sce-drive-marker"));
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "ambiguous");
      assert.deepEqual(await readdir(fixture.destinationDirectory), []);
    } finally {
      await fixture.cleanup();
    }
  });

  await t.test("subpath replaced by symlink", async () => {
    const fixture = await materialisationFixture();
    try {
      const original = `${fixture.destinationDirectory}-original`;
      const foreign = join(fixture.root, "foreign-destination");
      await rename(fixture.destinationDirectory, original);
      await mkdir(foreign);
      await symlink(foreign, fixture.destinationDirectory, "dir");
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "ambiguous");
      assert.deepEqual(await readdir(foreign), []);
      assert.deepEqual(await readdir(original), []);
    } finally {
      await fixture.cleanup();
    }
  });

  await t.test("same path now names a different inode", async () => {
    const fixture = await materialisationFixture();
    try {
      const original = `${fixture.destinationDirectory}-original`;
      await rename(fixture.destinationDirectory, original);
      await mkdir(fixture.destinationDirectory);
      const result = await adapterFor(fixture).materialise(fixture.effect);
      assert.equal(result.status, "ambiguous");
      assert.deepEqual(await readdir(fixture.destinationDirectory), []);
      assert.deepEqual(await readdir(original), []);
    } finally {
      await fixture.cleanup();
    }
  });
});
