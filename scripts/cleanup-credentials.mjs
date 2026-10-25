/**
 * Remove the credentials this package created.
 *
 * The credentials live inside the package directory, so removing the package
 * removes them too — this script is the belt to that braces, for package
 * managers that do run uninstall lifecycle scripts.
 *
 * Deliberately self-contained: it must keep working even when the rest of the
 * package is already gone, and it must never touch the Codex login in
 * ~/.codex, which belongs to Codex CLI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.CODEX_IMG_HOME || path.join(packageRoot, '.codex-img');
const file = path.join(home, 'auth.json');

try {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
    console.log(`codex-img: removed ${file}`);
  }
  if (fs.existsSync(home) && fs.readdirSync(home).length === 0) {
    fs.rmdirSync(home);
    console.log(`codex-img: removed ${home}`);
  }
} catch (err) {
  // Never fail an uninstall over cleanup.
  console.error(`codex-img: credential cleanup failed: ${err.message}`);
}
