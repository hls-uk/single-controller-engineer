#!/usr/bin/env node
import { parseArgs, validateManifest } from "./lib.mjs";

try {
  validateManifest(parseArgs(process.argv.slice(2)));
  process.stdout.write("manifest-schema: ok\n");
} catch (error) {
  process.stderr.write(
    `manifest-schema: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
