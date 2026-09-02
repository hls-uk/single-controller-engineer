#!/usr/bin/env node
import { checkBoundary, runCheck } from "./lib.mjs";

runCheck("boundary-policy", checkBoundary);
