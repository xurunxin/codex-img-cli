import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseArgs, USAGE } from '../src/cli.mjs';
import { decodeJwtExp, decodeJwtClaims } from '../src/auth.mjs';
import { fileToDataUrl } from '../src/client.mjs';

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