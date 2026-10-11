#!/usr/bin/env node
import { run } from '../src/cli.mjs';

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  if (process.env.CODEX_IMG_DEBUG) process.stderr.write(`${err.stack}\n`);
  process.exitCode = 1;
}