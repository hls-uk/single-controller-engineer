#!/usr/bin/env node
import { checkSecrets, runCheck } from "./lib.mjs";

runCheck("secret-scan", checkSecrets);
