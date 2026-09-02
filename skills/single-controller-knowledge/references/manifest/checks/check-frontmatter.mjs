#!/usr/bin/env node
import { checkFrontmatter, runCheck } from "./lib.mjs";

runCheck("frontmatter-schema", checkFrontmatter);
