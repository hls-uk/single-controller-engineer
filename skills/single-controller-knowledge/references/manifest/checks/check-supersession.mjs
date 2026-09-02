#!/usr/bin/env node
import { checkSupersession, runCheck } from "./lib.mjs";

runCheck("supersession-consistency", checkSupersession);
