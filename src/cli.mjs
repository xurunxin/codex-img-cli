import path from 'node:path';

import { DEFAULT_MODEL, writeBase64ToFile } from './client.mjs';
import { authFilePath, decodeJwtClaims, decodeJwtExp, readAuthFile } from './auth.mjs';

const USAGE = `
codex-img — image generation/editing on the local ChatGPT (Codex) subscription

Usage:
  codex-img auth                                  Show credential status (no network)
  codex-img gen    --prompt <text> [options]       Generate an image
  codex-img edit   --image <file>... --prompt <t>  Edit existing image(s)
  codex-img models [--prompt <text>]              Probe which model ids are honoured
  codex-img mcp                                   Run as an MCP stdio server

Common options:
  --prompt <text>       Prompt (required for gen/edit)
  --out <file>          Output path (default: ./codex-img-<timestamp>.png)
  --model <id>          Model id sent in the body (default: ${DEFAULT_MODEL})
  --background <mode>   transparent | opaque | auto   (default: opaque)
  --quality <q>         low | medium | high | xhigh | max | auto  (default: auto)
  --size <WxH|auto>     e.g. 1024x1024, 2048x1152, auto (default: auto)
  --timeout <ms>        Per-request timeout (default: 300000)
  --base-url <url>      Override the API base (default: the subscription endpoint)
  --no-refresh          Fail instead of refreshing an expired access token
  --json                Print machine-readable JSON to stdout
  -h, --help            This help

gen options:
  --n <count>           Number of images (only the first is written to --out)

edit options:
  --image <file>        Input image; repeat for multiple (max 5)
`.trim();

function parseArgs(argv) {
  const opts = { _: [] };
  const repeat = { image: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let value;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        // boolean flag
        opts[key] = true;
        continue;
      }
      i += 1;
    }
    if (repeat[key]) repeat[key].push(value);
    else opts[key] = value;
  }

  opts.image = repeat.image;
  return opts;
}

function num(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function commonRequestArgs(opts) {
  return {
    prompt: typeof opts.prompt === 'string' ? opts.prompt : undefined,
    model: typeof opts.model === 'string' ? opts.model : DEFAULT_MODEL,
    background: typeof opts.background === 'string' ? opts.background : 'opaque',
    quality: typeof opts.quality === 'string' ? opts.quality : 'auto',
    size: typeof opts.size === 'string' ? opts.size : 'auto',
    baseUrl: typeof opts['base-url'] === 'string' ? opts['base-url'] : undefined,
    allowRefresh: opts['no-refresh'] !== true,
    timeoutMs: num(opts.timeout, 300000),
  };
}

function defaultOut(prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.resolve(process.cwd(), `codex-img-${prefix}-${stamp}.png`);
}

function reportResult(result, outPath, opts, { write = true } = {}) {
  let saved = null;
  if (write && result.b64 && outPath) {
    saved = writeBase64ToFile(result.b64, outPath);
  }

  const summary = {
    endpoint: result.endpoint,
    saved,
    background: result.background,
    size: result.size,
    quality: result.quality,
    outputFormat: result.outputFormat,
    generationId: result.generationId,
    bytes: result.b64 ? Buffer.from(result.b64, 'base64').length : 0,
    usage: result.usage,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`saved:   ${saved ?? '(not written)'}`);
    console.log(`endpoint:${result.endpoint}`);
    console.log(`size:    ${result.size ?? '?'}   quality: ${result.quality ?? '?'}`);
    console.log(`bg:      ${result.background ?? '?'}   format: ${result.outputFormat ?? '?'}`);
    if (result.usage) {
      console.log(
        `usage:   in=${result.usage.input_tokens ?? '?'} out=${result.usage.output_tokens ?? '?'} ` +
          `total=${result.usage.total_tokens ?? '?'}`,
      );
    }
  }
  return summary;
}

async function cmdAuth(opts) {
  const auth = readAuthFile();
  const access = auth.tokens.access_token;
  const exp = decodeJwtExp(access);
  const claims = decodeJwtClaims(access);
  const nowSec = Math.floor(Date.now() / 1000);

  const info = {
    authMode: auth.auth_mode ?? null,
    accountId: auth.tokens.account_id ?? null,
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    expired: exp !== null ? exp <= nowSec : null,
    secondsRemaining: exp !== null ? exp - nowSec : null,
    plan: claims?.['https://api.openai.com/auth']?.chatgpt_plan_type ?? claims?.chatgpt_plan_type ?? null,
    audience: claims?.aud ?? null,
    lastRefresh: auth.last_refresh ?? null,
    hasRefreshToken: Boolean(auth.tokens.refresh_token),
    authFile: authFilePath(),
  };

  if (opts.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log(`auth file:   ${info.authFile}`);
  console.log(`auth mode:   ${info.authMode}`);
  console.log(`account id:  ${info.accountId ?? '(none)'}`);
  console.log(`plan:        ${info.plan ?? '(not in token claims)'}`);
  console.log(`audience:    ${info.audience ?? '?'}`);
  console.log(
    `access tok:  ${info.expired ? 'EXPIRED' : 'valid'}` +
      (info.secondsRemaining !== null ? ` (${Math.round(info.secondsRemaining / 60)} min left)` : ''),
  );
  console.log(`refresh tok: ${info.hasRefreshToken ? 'present' : 'MISSING'}`);
  console.log(`last refresh:${info.lastRefresh ?? '?'}`);
}

async function cmdGen(opts, client) {
  const args = commonRequestArgs(opts);
  if (!args.prompt) throw new Error('--prompt is required.');
  const result = await client.generateImage({ ...args, n: num(opts.n, 1) });
  reportResult(result, typeof opts.out === 'string' ? opts.out : defaultOut('gen'), opts);
}

async function cmdEdit(opts, client) {
  const args = commonRequestArgs(opts);
  if (!args.prompt) throw new Error('--prompt is required.');
  if (opts.image.length === 0) throw new Error('At least one --image is required.');
  const result = await client.editImage({ ...args, images: opts.image });
  reportResult(result, typeof opts.out === 'string' ? opts.out : defaultOut('edit'), opts);
}

async function cmdModels(opts, client) {
  const models =
    typeof opts.models === 'string'
      ? opts.models.split(',').map((s) => s.trim()).filter(Boolean)
      : ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-2-nonexistent-probe'];
  const prompt =
    typeof opts.prompt === 'string' ? opts.prompt : 'a small red circle on white background';
  const results = await client.probeModels({ prompt, models, allowRefresh: args0(opts) });
  console.log(JSON.stringify(results, null, 2));
}

function args0(opts) {
  return opts['no-refresh'] !== true;
}

export async function run(argv) {
  const opts = parseArgs(argv);
  const command = opts._[0];

  if (!command || opts.help || command === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'auth') {
    await cmdAuth(opts);
    return 0;
  }

  if (command === 'mcp') {
    const { runMcpServer } = await import('./mcp.mjs');
    await runMcpServer();
    return 0;
  }

  const client = await import('./client.mjs');

  switch (command) {
    case 'gen':
    case 'generate':
      await cmdGen(opts, client);
      return 0;
    case 'edit':
      await cmdEdit(opts, client);
      return 0;
    case 'models':
      await cmdModels(opts, client);
      return 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      return 2;
  }
}

export { parseArgs, USAGE };