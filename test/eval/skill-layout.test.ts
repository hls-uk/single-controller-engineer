import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const skills = [
  "skills/single-controller-engineer/SKILL.md",
  "skills/single-controller-feedback/SKILL.md",
] as const;
const hostAgents = ["claude.yaml", "openai.yaml"] as const;

test("packaged skills have strict identity, valid local links, and no unfinished placeholders", async () => {
  for (const path of skills) {
    const source = await readFile(path, "utf8");
    const frontmatter =
      /^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n/u.exec(source);
    assert.ok(frontmatter, `${path} has invalid frontmatter`);
    assert.equal(
      frontmatter[1],
      path.split("/").at(-2),
      `${path} name differs from its directory`,
    );
    assert.ok(frontmatter[2]!.length <= 1_024);
    assert.doesNotMatch(source, /\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b/u);
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1]!;
      assert.doesNotMatch(target, /^(?:https?:|\/)/u);
      await readFile(resolve(dirname(path), target), "utf8");
    }
  }
});

test("each skill ships exactly one identical descriptor per supported host", async () => {
  for (const path of skills) {
    const agents = resolve(dirname(path), "agents");
    assert.deepEqual(
      (await readdir(agents)).sort(),
      [...hostAgents],
      `${path} ships an unexpected host descriptor set`,
    );
    const [claude, openai] = await Promise.all(
      hostAgents.map((host) => readFile(resolve(agents, host), "utf8")),
    );
    assert.match(
      claude!,
      /^interface:\n  display_name: [^\n]+\n  short_description: [^\n]+\n/u,
    );
    assert.equal(claude, openai, `${path} host descriptors differ`);
  }
});

test("feedback skill cannot be selected implicitly on any host", async () => {
  for (const host of hostAgents) {
    const source = await readFile(
      `skills/single-controller-feedback/agents/${host}`,
      "utf8",
    );
    assert.match(source, /^policy:\n  allow_implicit_invocation: false$/mu);
  }
});
