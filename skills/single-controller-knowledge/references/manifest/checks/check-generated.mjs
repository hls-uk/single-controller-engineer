#!/usr/bin/env node
import { checkGenerated, runCheck } from "./lib.mjs";

runCheck("generated-reproducibility", checkGenerated);
