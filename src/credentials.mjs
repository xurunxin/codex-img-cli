import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The credential directory this CLI manages.
 *
 * The credentials live inside the package's own directory, so uninstalling
 * the package removes the credentials with it — there is no way to leave a
 * token behind on the machine. npm 11 has no uninstall lifecycle hook (the
 * arborist does not implement preuninstall/postuninstall at all), so the
 * directory layout is what makes the guarantee real rather than a promise.
 *
 * Consequences worth knowing: reinstalling the package, or switching Node
 * versions when the package is installed globally, means signing in again.
 *
 * CODEX_IMG_HOME overrides the location for anyone who wants the credentials
 * somewhere else.
 */
export function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function managedHome() {
  if (process.env.CODEX_IMG_HOME) return process.env.CODEX_IMG_HOME;
  return path.join(packageRoot(), '.codex-img');
}

/** The file the managed credentials live in. */
export function managedAuthPath() {
  return path.join(managedHome(), 'auth.json');
}

/** Whether this CLI has its own credentials. */
export function hasManagedAuth() {
  return fs.existsSync(managedAuthPath());
}

/** Read the managed credentials, or null when there are none. */
export function readManagedAuth() {
  const file = managedAuthPath();
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Write the managed credentials.
 *
 * Temp file + rename, same directory: rename is atomic only within one
 * filesystem, and a half-written auth file would be worse than none.
 */
export function writeManagedAuth(auth) {
  const file = managedAuthPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(auth, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // chmod is a no-op on Windows and may fail on exotic filesystems.
  }
  return file;
}

/**
 * Delete the managed credentials.
 *
 * Only ever touches what this CLI created — the Codex login in ~/.codex
 * is left alone. The directory is removed too when nothing else is in it.
 */
export function removeManagedAuth() {
  const file = managedAuthPath();
  const existed = fs.existsSync(file);
  if (existed) fs.rmSync(file, { force: true });

  const dir = managedHome();
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // A non-empty or locked directory is not a failure of the logout.
  }
  return { existed, file };
}
