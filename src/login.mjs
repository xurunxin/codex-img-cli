import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';

import {
  CODEX_CLIENT_ID,
  CODEX_ISSUER,
  CODEX_LOGIN_SCOPES,
  CODEX_TOKEN_URL,
  decodeJwtClaims,
} from './auth.mjs';
import { writeManagedAuth } from './credentials.mjs';

/**
 * Sign in with a ChatGPT subscription.
 *
 * Two flows, both copied from the `openai/codex` login implementation:
 *
 * 1. Browser (default) — a local loopback server receives the OAuth callback
 *    on 127.0.0.1, the same way `codex login` does.
 * 2. Device code (`--device`) — no local server at all; the user types a code
 *    on a web page. Works over SSH and in containers.
 *
 * The resulting tokens are written to this CLI's own credential directory.
 * The Codex login in ~/.codex is never read into the write path and never
 * overwritten.
 */

const CALLBACK_PATH = '/auth/callback';
const PRIMARY_PORT = 1455;
const FALLBACK_PORT = 1457;
const ORIGINATOR = 'codex_cli_rs';

const SUCCESS_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>codex-img — signed in</title>
<body style="font:16px system-ui;padding:3rem;text-align:center">
<h1>Signed in</h1>
<p>You can close this tab and go back to the terminal.</p>
</body>`;

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** PKCE pair, S256 challenge — same shape Codex CLI generates. */
export function generatePkce() {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** The authorization URL the browser is sent to. */
export function buildAuthorizeUrl({ redirectUri, challenge, state }) {
  const url = new URL(`${CODEX_ISSUER}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CODEX_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', CODEX_LOGIN_SCOPES);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', ORIGINATOR);
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error_description ?? parsed?.error?.message ?? parsed?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * Start the loopback callback server.
 *
 * Tries the primary port, then the registered fallback port, so a stale
 * server from an earlier run does not block signing in.
 */
async function startCallbackServer(expectedState) {
  let lastError = null;

  for (const port of [PRIMARY_PORT, FALLBACK_PORT]) {
    let resolveCode;
    let rejectCode;
    const result = new Promise((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`Sign-in failed: ${error}`);
        rejectCode(new Error(`Sign-in failed: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing authorization code.');
        rejectCode(new Error('Sign-in failed: the callback carried no authorization code.'));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('State mismatch.');
        rejectCode(new Error('Sign-in failed: state mismatch.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_PAGE);
      resolveCode(code);
    });

    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
    } catch (err) {
      lastError = err;
      continue;
    }

    return {
      port,
      redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
      waitForCode(timeoutMs) {
        return Promise.race([
          result,
          sleep(timeoutMs).then(() => {
            throw new Error(`Sign-in timed out after ${Math.round(timeoutMs / 1000)}s.`);
          }),
        ]);
      },
      close() {
        return new Promise((resolve) => server.close(() => resolve()));
      },
    };
  }

  throw new Error(
    `Could not bind the local callback server on ports ${PRIMARY_PORT} or ${FALLBACK_PORT}: ` +
      `${lastError?.message ?? 'unknown error'}`,
  );
}

/** Exchange an authorization code for tokens. */
export async function exchangeCodeForTokens({ code, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CODEX_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Token exchange failed (HTTP ${res.status}). ${extractErrorMessage(text)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Token endpoint returned no access_token/refresh_token.');
  }

  return {
    idToken: data.id_token ?? null,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}

/** Ask the server for a device code the user can type into a web page. */
async function requestDeviceCode() {
  const res = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  });

  if (res.status === 404) {
    throw new Error(
      'Device code login is not enabled for this server. Run `codex-img login` without --device.',
    );
  }
  if (!res.ok) {
    throw new Error(`Device code request failed (HTTP ${res.status}).`);
  }

  const data = await res.json();
  const deviceAuthId = data.device_auth_id;
  const userCode = data.user_code ?? data.usercode;
  const interval = Math.max(1, Number(data.interval) || 5);
  if (!deviceAuthId || !userCode) {
    throw new Error('Device code response was missing device_auth_id or user_code.');
  }
  return { deviceAuthId, userCode, interval };
}

/** Poll until the user approved the device code. */
async function pollForAuthorizationCode({ deviceAuthId, userCode, interval, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const res = await fetch(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    });

    if (res.ok) {
      const data = await res.json();
      if (!data.authorization_code) {
        throw new Error('Device auth response contained no authorization_code.');
      }
      return {
        authorizationCode: data.authorization_code,
        codeVerifier: data.code_verifier ?? '',
      };
    }

    // 403/404 means "not approved yet" — keep polling until the deadline.
    if (res.status === 403 || res.status === 404) {
      if (Date.now() >= deadline) {
        throw new Error(`Device authorization timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      await sleep(Math.min(interval * 1000, Math.max(0, deadline - Date.now())));
      continue;
    }

    throw new Error(`Device auth failed with status ${res.status}.`);
  }
}

/** Turn exchanged tokens into the auth.json shape Codex CLI uses. */
export function buildAuthFile({ idToken, accessToken, refreshToken }) {
  const claims = decodeJwtClaims(idToken);
  const authClaims = claims?.['https://api.openai.com/auth'];
  const accountId = authClaims?.chatgpt_account_id ?? claims?.chatgpt_account_id ?? null;
  const plan = authClaims?.chatgpt_plan_type ?? claims?.chatgpt_plan_type ?? null;

  if (!accountId) {
    throw new Error(
      'The returned id_token carried no chatgpt_account_id claim, so the account cannot be ' +
        'identified. Sign in with `codex login` instead, or retry the login.',
    );
  }

  return {
    auth: {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: accountId,
      },
      last_refresh: new Date().toISOString(),
    },
    accountId,
    plan,
  };
}

/** Open a URL in the default browser without going through a shell. */
export function openInBrowser(url) {
  try {
    let child;
    if (process.platform === 'win32') {
      // rundll32 avoids the shell, so & in the query string is not a problem.
      child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
      });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign in and persist the credentials this CLI manages.
 *
 * @returns {{file: string, accountId: string, plan: string|null, flow: string}}
 */
export async function login({
  device = false,
  browser = true,
  timeoutMs = 300000,
  onPrompt = () => {},
} = {}) {
  let tokens;

  if (device) {
    const { deviceAuthId, userCode, interval } = await requestDeviceCode();
    onPrompt({
      type: 'device',
      url: `${CODEX_ISSUER}/codex/device`,
      userCode,
    });
    const { authorizationCode, codeVerifier } = await pollForAuthorizationCode({
      deviceAuthId,
      userCode,
      interval,
      timeoutMs,
    });
    tokens = await exchangeCodeForTokens({
      code: authorizationCode,
      redirectUri: `${CODEX_ISSUER}/deviceauth/callback`,
      codeVerifier,
    });
  } else {
    const { verifier, challenge } = generatePkce();
    const state = base64url(crypto.randomBytes(16));
    const callback = await startCallbackServer(state);
    const url = buildAuthorizeUrl({
      redirectUri: callback.redirectUri,
      challenge,
      state,
    });
    onPrompt({ type: 'browser', url, redirectUri: callback.redirectUri });
    if (browser) openInBrowser(url);
    try {
      const code = await callback.waitForCode(timeoutMs);
      tokens = await exchangeCodeForTokens({
        code,
        redirectUri: callback.redirectUri,
        codeVerifier: verifier,
      });
    } finally {
      await callback.close();
    }
  }

  const { auth, accountId, plan } = buildAuthFile(tokens);
  const file = writeManagedAuth(auth);
  return { file, accountId, plan, flow: device ? 'device' : 'browser' };
}
