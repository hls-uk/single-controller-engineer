#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = outputPath(process.argv.slice(2));
const eventsDirectory = join(root, "events");
const records = existsSync(eventsDirectory)
  ? readdirSync(eventsDirectory)
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) =>
        JSON.parse(readFileSync(join(eventsDirectory, entry), "utf8")),
      )
  : [];

const lines = ["# Knowledge timeline", ""];
if (records.length === 0) {
  lines.push("No provenance events recorded.");
} else {
  for (const record of records) {
    lines.push(
      `- \`${record.id}\`: unit \`${record.unitId}\` landed at \`${record.landedOid}\`.`,
    );
  }
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${lines.join("\n")}\n`, "utf8");

function outputPath(argv) {
  const index = argv.indexOf("--output");
  if (index < 0 || !argv[index + 1] || argv.length !== 2) {
    process.stderr.write("usage: generate-rollup.mjs --output <directory>\n");
    process.exit(2);
  }
  return join(resolve(argv[index + 1]), "timeline.md");
}
