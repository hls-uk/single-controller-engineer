#!/usr/bin/env node
import { checkMarkdownFormat, runCheck } from "./lib.mjs";

runCheck("markdown-format", checkMarkdownFormat);
