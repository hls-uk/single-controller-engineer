#!/usr/bin/env node
import { checkProvenance, runCheck } from "./lib.mjs";

runCheck("provenance-validity", checkProvenance);
