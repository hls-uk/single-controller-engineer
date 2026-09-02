#!/usr/bin/env node
import { checkRelativeLinks, runCheck } from "./lib.mjs";

runCheck("relative-links", checkRelativeLinks);
