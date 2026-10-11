import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Codex CLI public OAuth client. Confirmed against openai/codex + several independent clients. */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_SCOPES = 'openid profile email offline_access';

/** Base of the subscription-backed images API (not api.openai.com). */
export const CODEX_API_BASE = 'https://chatgpt.com/backend-api/codex';

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function authFilePath() {
  return path.join(codexHome(), 'auth.json');
}

/**
 * Decode a JWT payload without verifying the signature.
 * We only need `exp` to decide whether to refresh; the signature is checked
 * server-side on every request anyway.
 */
export function decodeJwtExp(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function decodeJwtClaims(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function readAuthFile() {
  const file = authFilePath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `Codex auth file not found: ${file}\n` +
        'Run `codex login` first (or set CODEX_HOME to a directory containing auth.json).',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err.message}`);
  }
  if (!parsed?.tokens?.access_token) {
    throw new Error(
      `${file} has no tokens.access_token. The CLI expects a ChatGPT-subscription login ` +
        '(codex login), not an OPENAI_API_KEY login.',
    );
  }
  return parsed;
}

/**
 * Write auth.json back atomically.
 *
 * Codex refreshes its own tokens and rotates the refresh token. If we refresh
 * without persisting, Codex's stored refresh token becomes dead. If we persist
 * non-atomically, a crash mid-write corrupts the file. So: temp file + rename,
 * in the same directory (rename is atomic only within one filesystem).
 */
export function writeAuthFile(auth) {
  const file = authFilePath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(auth, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Exchange the refresh token for a new access token and persist the result.
 */
export async function refreshAccessToken(auth = readAuthFile()) {
  const refreshToken = auth?.tokens?.refresh_token;
  if (!refreshToken) {
    throw new Error('No refresh_token in auth.json. Run `codex login` to re-authenticate.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CODEX_CLIENT_ID,
    refresh_token: refreshToken,
    scope: CODEX_SCOPES,
  });

  const res = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Token refresh failed (HTTP ${res.status}). ` +
        `Codex rotates refresh tokens, so a concurrent Codex refresh may have invalidated this one. ` +
        `Run \`codex login\` and retry.\n${text.slice(0, 400)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!data.access_token) {
    throw new Error(`Token endpoint returned no access_token: ${text.slice(0, 200)}`);
  }

  auth.tokens.access_token = data.access_token;
  // Some issuers omit refresh_token on refresh; keep the previous one if so.
  if (data.refresh_token) auth.tokens.refresh_token = data.refresh_token;
  if (data.id_token) auth.tokens.id_token = data.id_token;
  auth.last_refresh = new Date().toISOString();

  writeAuthFile(auth);
  return auth;
}

/**
 * Resolve a usable access token.
 *
 * @param {object} opts
 * @param {boolean} opts.refresh  Refresh when the token is expired or near expiry.
 * @param {number}  opts.skewSec Treat the token as expired this many seconds early.
 */
export async function resolveCredentials({ refresh = true, skewSec = 90 } = {}) {
  let auth = readAuthFile();
  const exp = decodeJwtExp(auth.tokens.access_token);
  const nowSec = Math.floor(Date.now() / 1000);
  const needsRefresh = exp !== null && exp - nowSec <= skewSec;

  if (needsRefresh) {
    if (!refresh) {
      throw new Error(
        `Access token expired at ${new Date(exp * 1000).toISOString()} ` +
          'and auto-refresh is disabled (--no-refresh).',
      );
    }
    auth = await refreshAccessToken(auth);
  }

  return {
    accessToken: auth.tokens.access_token,
    accountId: auth.tokens.account_id ?? null,
    authMode: auth.auth_mode ?? null,
    expiresAt: exp,
    refreshed: needsRefresh,
  };
}