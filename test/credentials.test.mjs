import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hasManagedAuth,
  managedAuthPath,
  managedHome,
  packageRoot,
  readManagedAuth,
  removeManagedAuth,
  writeManagedAuth,
} from '../src/credentials.mjs';
import { authFilePath, authSource, effectiveAuthPath } from '../src/auth.mjs';
import { buildAuthFile, buildAuthorizeUrl, generatePkce } from '../src/login.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run a test body with the managed credential store pointed at a temp dir. */
function withTempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-img-store-'));
  const previous = process.env.CODEX_IMG_HOME;
  process.env.CODEX_IMG_HOME = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_IMG_HOME;
    else process.env.CODEX_IMG_HOME = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const SAMPLE_AUTH = {
  auth_mode: 'chatgpt',
  OPENAI_API_KEY: null,
  tokens: {
    id_token: 'id',
    access_token: 'access',
    refresh_token: 'refresh',
    account_id: 'acct-1',
  },
  last_refresh: '2026-01-01T00:00:00.000Z',
};

test('the managed store lives inside the package directory', () => {
  const previous = process.env.CODEX_IMG_HOME;
  delete process.env.CODEX_IMG_HOME;
  try {
    assert.equal(managedHome(), path.join(packageRoot(), '.codex-img'));
    assert.equal(packageRoot(), repoRoot);
  } finally {
    if (previous !== undefined) process.env.CODEX_IMG_HOME = previous;
  }
});

test('CODEX_IMG_HOME overrides the managed store location', (t) => {
  const dir = withTempStore(t);
  assert.equal(managedHome(), dir);
  assert.equal(managedAuthPath(), path.join(dir, 'auth.json'));
});

test('credentials round-trip through the managed store', (t) => {
  withTempStore(t);
  assert.equal(hasManagedAuth(), false);
  const file = writeManagedAuth(SAMPLE_AUTH);
  assert.equal(file, managedAuthPath());
  assert.equal(hasManagedAuth(), true);
  assert.deepEqual(readManagedAuth(), SAMPLE_AUTH);
});

test('logout removes the managed credentials and nothing else', (t) => {
  withTempStore(t);
  writeManagedAuth(SAMPLE_AUTH);
  const result = removeManagedAuth();
  assert.equal(result.existed, true);
  assert.equal(hasManagedAuth(), false);
  assert.equal(fs.existsSync(managedHome()), false, 'the empty directory should be gone too');
  // Removing again is a no-op, not an error.
  assert.equal(removeManagedAuth().existed, false);
});

test('the managed store takes precedence over the Codex login', (t) => {
  withTempStore(t);
  assert.equal(authSource(), 'codex');
  assert.equal(effectiveAuthPath(), authFilePath());

  writeManagedAuth(SAMPLE_AUTH);
  assert.equal(authSource(), 'managed');
  assert.equal(effectiveAuthPath(), managedAuthPath());
});

test('the uninstall cleanup script removes the managed credentials', (t) => {
  const dir = withTempStore(t);
  writeManagedAuth(SAMPLE_AUTH);
  assert.equal(hasManagedAuth(), true);

  const script = path.join(repoRoot, 'scripts', 'cleanup-credentials.mjs');
  execFileSync(process.execPath, [script], {
    env: { ...process.env, CODEX_IMG_HOME: dir },
    stdio: 'ignore',
  });

  assert.equal(hasManagedAuth(), false, 'the credentials should be gone after the cleanup');
  assert.equal(fs.existsSync(dir), false, 'the empty directory should be gone too');
});

test('buildAuthFile reads the account id from the namespaced claim', () => {
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-42',
        chatgpt_plan_type: 'pro',
      },
    }),
  ).toString('base64url');
  const idToken = `header.${payload}.sig`;

  const { auth, accountId, plan } = buildAuthFile({
    idToken,
    accessToken: 'access',
    refreshToken: 'refresh',
  });

  assert.equal(accountId, 'acct-42');
  assert.equal(plan, 'pro');
  assert.equal(auth.auth_mode, 'chatgpt');
  assert.equal(auth.tokens.account_id, 'acct-42');
  assert.equal(auth.tokens.access_token, 'access');
  assert.equal(auth.tokens.refresh_token, 'refresh');
});

test('buildAuthFile refuses a token without an account id', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'window' })).toString('base64url');
  assert.throws(
    () =>
      buildAuthFile({
        idToken: `header.${payload}.sig`,
        accessToken: 'a',
        refreshToken: 'r',
      }),
    /chatgpt_account_id/,
  );
});

test('PKCE uses a S256 challenge and a url-safe verifier', () => {
  const { verifier, challenge } = generatePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.ok(verifier.length >= 43, `verifier too short: ${verifier.length}`);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, challenge);
});

test('the authorize URL carries the parameters the issuer expects', () => {
  const url = new URL(
    buildAuthorizeUrl({
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
      challenge: 'challenge-value',
      state: 'state-value',
    }),
  );

  assert.equal(url.origin + url.pathname, 'https://auth.openai.com/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('scope').split(' ').includes('offline_access'), true);
});
