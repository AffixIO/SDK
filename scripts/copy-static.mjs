#!/usr/bin/env node
/* Credit: @paparichens */
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src/dashboard/public");
const to = join(root, "dist/dashboard/public");
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
