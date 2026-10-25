import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached = null;

/**
 * The package version, read from package.json.
 *
 * Reading it rather than hardcoding keeps `codex-img --version` and the MCP
 * serverInfo in sync with the published package automatically.
 */
export function version() {
  if (cached !== null) return cached;
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    cached = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version ?? 'unknown';
  } catch {
    cached = 'unknown';
  }
  return cached;
}
