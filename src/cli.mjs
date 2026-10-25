import path from 'node:path';

import { DEFAULT_MODEL, writeBase64ToFile } from './client.mjs';
import { authFilePath, decodeJwtClaims, decodeJwtExp, readAuthFile } from './auth.mjs';
import { COMMANDS, USAGE, findCommand, helpFor } from './help.mjs';
import { version } from './version.mjs';

/**
 * Flags that never take a value.
 *
 * Without this list a boolean flag would swallow the next argument whenever
 * that argument did not start with `--` — `--transparent out.png` would set
 * the background to "out.png" instead of writing the file.
 */
const BOOLEAN_FLAGS = new Set(['help', 'version', 'json', 'no-refresh', 'transparent']);

function parseArgs(argv) {
  const opts = { _: [] };
  const repeat = { image: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      opts.version = true;
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
    } else if (BOOLEAN_FLAGS.has(key)) {
      opts[key] = true;
      continue;
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
  const explicitBackground = typeof opts.background === 'string' ? opts.background : undefined;
  return {
    prompt: typeof opts.prompt === 'string' ? opts.prompt : undefined,
    model: typeof opts.model === 'string' ? opts.model : DEFAULT_MODEL,
    // --transparent is a shorthand; an explicit --background still wins.
    background: explicitBackground ?? (opts.transparent === true ? 'transparent' : 'opaque'),
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

/** `cabin.png` -> `cabin-2.png`; a path without extension just gets a suffix. */
function withIndexSuffix(outPath, index) {
  const ext = path.extname(outPath);
  const base = ext ? outPath.slice(0, -ext.length) : outPath;
  return `${base}-${index}${ext}`;
}

function reportResult(result, outPath, opts, { write = true } = {}) {
  const savedFiles = [];
  if (write && outPath) {
    const images = Array.isArray(result.images) && result.images.length > 0 ? result.images : null;
    if (images) {
      // n > 1 returns several images: the first takes --out, the rest are
      // numbered next to it. Dropping them would silently lose paid-for work.
      images.forEach((image, index) => {
        const target = index === 0 ? outPath : withIndexSuffix(outPath, index + 1);
        savedFiles.push(writeBase64ToFile(image.b64, target));
      });
    } else if (result.b64) {
      savedFiles.push(writeBase64ToFile(result.b64, outPath));
    }
  }

  const saved = savedFiles[0] ?? null;
  const summary = {
    endpoint: result.endpoint,
    saved,
    savedFiles,
    count: savedFiles.length,
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
    for (const extra of savedFiles.slice(1)) {
      console.log(`         ${extra}`);
    }
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
  const results = await client.probeModels({
    prompt,
    models,
    baseUrl: typeof opts['base-url'] === 'string' ? opts['base-url'] : undefined,
    allowRefresh: opts['no-refresh'] !== true,
  });
  console.log(JSON.stringify(results, null, 2));
}

function commandList() {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return `Available commands:\n${lines.join('\n')}\n\nRun \`codex-img help <command>\` for details.`;
}

export async function run(argv) {
  const opts = parseArgs(argv);
  const command = opts._[0];

  if (opts.version) {
    console.log(version());
    return 0;
  }

  // `codex-img help [command]` — the explicit form, which also works when a
  // command name happens to collide with an option.
  if (command === 'help') {
    const target = opts._[1];
    if (!target) {
      console.log(USAGE);
      return 0;
    }
    const help = helpFor(target);
    if (!help) {
      console.error(`Unknown command: ${target}\n`);
      console.error(commandList());
      return 2;
    }
    console.log(help);
    return 0;
  }

  if (!command) {
    console.log(USAGE);
    return 0;
  }

  const resolved = findCommand(command);
  if (!resolved) {
    console.error(`Unknown command: ${command}\n`);
    console.error(commandList());
    return 2;
  }

  if (opts.help) {
    console.log(resolved.help);
    return 0;
  }

  switch (resolved.name) {
    case 'auth':
      await cmdAuth(opts);
      return 0;
    case 'mcp': {
      const { runMcpServer } = await import('./mcp.mjs');
      await runMcpServer();
      return 0;
    }
    default: {
      const client = await import('./client.mjs');
      if (resolved.name === 'gen') {
        await cmdGen(opts, client);
        return 0;
      }
      if (resolved.name === 'edit') {
        await cmdEdit(opts, client);
        return 0;
      }
      await cmdModels(opts, client);
      return 0;
    }
  }
}

export { parseArgs, USAGE, commonRequestArgs };
