import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseArgs, USAGE, commonRequestArgs, run } from '../src/cli.mjs';
import { decodeJwtExp, decodeJwtClaims } from '../src/auth.mjs';
import { fileToDataUrl, generateImage } from '../src/client.mjs';
import http from 'node:http';

function makeJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc(payload)}.sig`;
}

test('parseArgs reads --key value and --key=value', () => {
  const o = parseArgs(['gen', '--prompt', 'a cat', '--out=x.png', '--json']);
  assert.equal(o._[0], 'gen');
  assert.equal(o.prompt, 'a cat');
  assert.equal(o.out, 'x.png');
  assert.equal(o.json, true);
});

test('parseArgs collects repeatable --image', () => {
  const o = parseArgs(['edit', '--image', 'a.png', '--image', 'b.png']);
  assert.deepEqual(o.image, ['a.png', 'b.png']);
});

test('parseArgs treats a following --flag as a boolean, not a value', () => {
  const o = parseArgs(['gen', '--prompt', '--json']);
  assert.equal(o.prompt, true);
  assert.equal(o.json, true);
});

test('decodeJwtExp reads exp from an unverified payload', () => {
  const jwt = makeJwt({ exp: 1700000000, aud: 'https://api.openai.com/v1' });
  assert.equal(decodeJwtExp(jwt), 1700000000);
  assert.equal(decodeJwtClaims(jwt).aud, 'https://api.openai.com/v1');
});

test('decodeJwtExp returns null for non-JWT input instead of throwing', () => {
  assert.equal(decodeJwtExp('not-a-jwt'), null);
  assert.equal(decodeJwtExp(undefined), null);
  assert.equal(decodeJwtExp('a.!!!not-base64!!!.c'), null);
});

test('fileToDataUrl builds a data URL for png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-img-'));
  const png = path.join(dir, 'a.png');
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const url = fileToDataUrl(png);
  assert.ok(url.startsWith('data:image/png;base64,'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fileToDataUrl rejects unsupported extensions and missing files', () => {
  assert.throws(() => fileToDataUrl('nope.png'), /not found/i);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-img-'));
  const bad = path.join(dir, 'a.tiff');
  fs.writeFileSync(bad, 'x');
  assert.throws(() => fileToDataUrl(bad), /unsupported image extension/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('USAGE documents every subcommand', () => {
  for (const cmd of ['auth', 'gen', 'edit', 'models', 'mcp']) {
    assert.ok(USAGE.includes(cmd), `USAGE should mention ${cmd}`);
  }
});

/** Capture what the CLI writes to stdout/stderr while a command runs. */
async function capture(fn) {
  const out = [];
  const err = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => out.push(args.join(' '));
  console.error = (...args) => err.push(args.join(' '));
  try {
    const code = await fn();
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test('every command has its own help text', async () => {
  for (const cmd of ['auth', 'gen', 'edit', 'models', 'mcp']) {
    const { code, stdout } = await capture(() => run(['help', cmd]));
    assert.equal(code, 0, `help ${cmd} should succeed`);
    assert.ok(stdout.includes(`codex-img ${cmd}`), `${cmd} help should name the command`);
    assert.ok(stdout.includes('Usage:'), `${cmd} help should show a synopsis`);
    assert.ok(stdout.includes('Options:'), `${cmd} help should list options`);
  }
});

test('a command with --help prints its own help, not the global usage', async () => {
  const { code, stdout } = await capture(() => run(['gen', '--help']));
  assert.equal(code, 0);
  assert.ok(stdout.includes('--prompt'), 'gen help should document --prompt');
  assert.ok(stdout.includes('codex-img gen —'), 'gen help should have its own title');
  assert.ok(!stdout.includes('Run `codex-img help <command>`'), 'should not be the global usage');
});

test('the gen help spells out the caveats an agent would otherwise guess wrong', async () => {
  const { stdout } = await capture(() => run(['help', 'gen']));
  assert.ok(stdout.includes('--transparent'), 'gen help should document --transparent');
  assert.ok(stdout.includes('ignores the `model` field'), 'gen help should warn that model is ignored');
  assert.ok(stdout.includes('--out'), 'gen help should document --out');
});

test('the edit help states the image limit', async () => {
  const { stdout } = await capture(() => run(['help', 'edit']));
  assert.ok(/at most 5/i.test(stdout), 'edit help should state the 5 image limit');
});

test('help for an unknown command is a usage error', async () => {
  const { code, stderr } = await capture(() => run(['help', 'nope']));
  assert.equal(code, 2);
  assert.ok(stderr.includes('Unknown command: nope'));
  assert.ok(stderr.includes('Available commands:'), 'the error should list the valid commands');
});

test('an unknown command is a usage error', async () => {
  const { code, stderr } = await capture(() => run(['nope']));
  assert.equal(code, 2);
  assert.ok(stderr.includes('Unknown command: nope'));
});

test('--version prints the package version', async () => {
  const { code, stdout } = await capture(() => run(['--version']));
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('boolean flags never swallow the next argument', () => {
  const o = parseArgs(['gen', '--transparent', '--out', 'x.png']);
  assert.equal(o.transparent, true);
  assert.equal(o.out, 'x.png');

  const j = parseArgs(['gen', '--json', '--out', 'x.png']);
  assert.equal(j.json, true);
  assert.equal(j.out, 'x.png');
});

test('--transparent maps to a transparent background, an explicit --background wins', () => {
  assert.equal(commonRequestArgs(parseArgs(['gen', '--prompt', 'x'])).background, 'opaque');
  assert.equal(
    commonRequestArgs(parseArgs(['gen', '--prompt', 'x', '--transparent'])).background,
    'transparent',
  );
  assert.equal(
    commonRequestArgs(parseArgs(['gen', '--prompt', 'x', '--transparent', '--background', 'opaque']))
      .background,
    'opaque',
  );
});

/**
 * A fake Codex home whose access_token is an opaque string, not a JWT.
 * decodeJwtExp then returns null, so resolveCredentials does not try to refresh
 * and these tests never touch auth.openai.com.
 */
function withFakeCodexHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  fs.writeFileSync(
    path.join(dir, 'auth.json'),
    JSON.stringify({ tokens: { access_token: 'opaque-not-a-jwt', account_id: 'acct_test' } }),
  );
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('an externally aborted signal cancels the request and surfaces its own reason', async (t) => {
  withFakeCodexHome(t);
  // Abort before the call: nothing should reach the network at all.
  const ac = new AbortController();
  ac.abort(new Error('user canceled'));
  await assert.rejects(
    () => generateImage({ prompt: 'x', signal: ac.signal, allowRefresh: false }),
    /user canceled/,
  );
});

test('a caller-supplied signal aborts a request already in flight', async (t) => {
  withFakeCodexHome(t);
  // A server that accepts the connection and never answers — the only way to
  // exercise abort *during* a request without a real network call.
  let sawRequest = false;
  const server = http.createServer((_req, _res) => { sawRequest = true; });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));

  const ac = new AbortController();
  const pending = generateImage({
    prompt: 'x',
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    signal: ac.signal,
    allowRefresh: false,
    timeoutMs: 10_000,
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(sawRequest, 'request should have reached the server before cancelling');
  ac.abort(new Error('user canceled'));

  // Must be the caller's reason, not a timeout — the server distinguishes the two.
  await assert.rejects(pending, /user canceled/);
});

test('a timeout is reported as a timeout, distinct from a caller cancel', async (t) => {
  withFakeCodexHome(t);
  const server = http.createServer((_req, _res) => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));

  await assert.rejects(
    () => generateImage({
      prompt: 'x',
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      allowRefresh: false,
      timeoutMs: 120,
    }),
    /timed out after 120ms/,
  );
});