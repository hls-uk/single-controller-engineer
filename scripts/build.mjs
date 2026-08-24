import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(
  repositoryRoot,
  "skills/single-controller-engineer/scripts/sce.mjs",
);

await mkdir(dirname(output), { recursive: true });
await build({
  bundle: true,
  entryPoints: [resolve(repositoryRoot, "src/cli.ts")],
  format: "esm",
  logLevel: "info",
  outfile: output,
  platform: "node",
  sourcemap: false,
  target: "node22",
});
await chmod(output, 0o755);
