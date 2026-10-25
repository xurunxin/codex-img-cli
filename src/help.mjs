import { DEFAULT_MODEL, MAX_EDIT_IMAGES } from './client.mjs';

/**
 * Help text for every command.
 *
 * The CLI is driven by agents as often as by humans, and an agent has no
 * context beyond what it reads. So each command states its required
 * arguments, every option it accepts, a runnable example, and the behaviour
 * that is not obvious from the flags — for instance that the endpoint ignores
 * the `model` field, or that the edit endpoint takes at most five images.
 */

export const USAGE = `
codex-img — image generation/editing on the local ChatGPT (Codex) subscription

Usage:
  codex-img <command> [options]
  codex-img help <command>        detailed help for one command

Commands:
  auth      Show credential status (no network)
  gen       Generate an image from a text prompt
  edit      Edit existing image(s) with a text instruction
  models    Probe which model ids the endpoint actually honours
  mcp       Run as an MCP stdio server for agent clients

Global options:
  -h, --help      Show this help, or per-command help when a command is given
  -v, --version   Print the version
  --json          Machine-readable JSON output (auth, gen, edit)

Getting started:
  codex-img auth                     # check the subscription login (offline)
  codex-img gen --prompt "..." --out a.png
  codex-img help gen                 # every option, with examples

Notes:
  * Credentials come from ~/.codex/auth.json (run \`codex login\` first).
    OPENAI_API_KEY is never read.
  * The endpoint ignores the \`model\` field and usually ignores \`size\`; the
    size reported in the output is the real one.
  * Exit codes: 0 success, 1 request/auth failure, 2 bad usage.
`.trim();

const AUTH_HELP = `
codex-img auth — show credential status (no network)

Usage:
  codex-img auth [--json]

Reads ~/.codex/auth.json (override the directory with CODEX_HOME) and reports
whether the access token is still valid, which plan it belongs to, and whether
a refresh token is available. Makes no network request.

Options:
  --json        Print the same information as JSON
  -h, --help    This help

Example:
  codex-img auth
  codex-img auth --json

Reported fields:
  auth file, auth mode, account id, plan, audience,
  access tok (valid / EXPIRED + minutes left), refresh tok, last refresh
`.trim();

const GEN_HELP = `
codex-img gen — generate an image from a text prompt

Usage:
  codex-img gen --prompt <text> [options]

Required:
  --prompt <text>        What to draw. Name the subject, the style and the
                         composition; English prompts work best.

Options:
  --out <file>           Where to write the PNG
                         (default: ./codex-img-gen-<timestamp>.png)
  --n <count>            How many images to request (default: 1). The first is
                         written to --out, the others to <out>-2.png, <out>-3.png…
  --transparent          Shorthand for --background transparent
  --background <mode>    transparent | opaque | auto   (default: opaque)
  --quality <q>          low | medium | high | xhigh | max | auto (default: auto)
  --size <WxH|auto>      e.g. 1024x1024, 2048x1152, auto (default: auto)
  --model <id>           Model id placed in the request body
                         (default: ${DEFAULT_MODEL})
  --timeout <ms>         Per-request timeout in milliseconds (default: 300000)
  --base-url <url>       Override the API base URL
  --no-refresh           Fail instead of auto-refreshing an expired access token
  --json                 Print a JSON summary instead of text
  -h, --help             This help

Examples:
  codex-img gen --prompt "a cozy alpine cabin at dawn" --out cabin.png
  codex-img gen --prompt "flat vector icon, no background" --transparent --out icon.png
  codex-img gen --prompt "product shot on white" --quality high --size 1024x1024 --out shot.png --json

Notes:
  * The endpoint ignores the \`model\` field — even a non-existent model id
    returns 200 — and usually ignores \`size\` as well. Trust the reported size.
  * The PNG is written with C2PA metadata and an invisible watermark.
  * Exit codes: 0 success, 1 request/auth failure, 2 bad usage.
`.trim();

const EDIT_HELP = `
codex-img edit — edit existing image(s) with a text instruction

Usage:
  codex-img edit --image <file> [--image <file>…] --prompt <text> [options]

Required:
  --image <file>     Input image; repeat the flag to pass more than one
                     (at most ${MAX_EDIT_IMAGES}). Supported formats: png, jpg,
                     jpeg, webp, gif.
  --prompt <text>    What to change. Say explicitly what must stay unchanged.

Options:
  --out <file>           Where to write the result
                         (default: ./codex-img-edit-<timestamp>.png)
  --transparent          Shorthand for --background transparent
  --background <mode>    transparent | opaque | auto   (default: opaque)
  --quality <q>          low | medium | high | xhigh | max | auto (default: auto)
  --size <WxH|auto>      e.g. 1024x1024, 2048x1152, auto (default: auto)
  --model <id>           Model id placed in the request body
                         (default: ${DEFAULT_MODEL})
  --timeout <ms>         Per-request timeout in milliseconds (default: 300000)
  --base-url <url>       Override the API base URL
  --no-refresh           Fail instead of auto-refreshing an expired access token
  --json                 Print a JSON summary instead of text
  -h, --help             This help

Examples:
  codex-img edit --image a.png --image b.png \\
    --prompt "replace the background with a warm sunset, keep the subjects unchanged" \\
    --out sunset.png

Notes:
  * At most ${MAX_EDIT_IMAGES} reference images, matching openai/codex's
    image-generation tool.
  * The edit endpoint ignores \`model\` and usually ignores \`size\`.
  * Exit codes: 0 success, 1 request/auth failure, 2 bad usage.
`.trim();

const MODELS_HELP = `
codex-img models — probe which model ids the endpoint honours

Usage:
  codex-img models [--models <a,b,c>] [--prompt <text>]

Sends one small image request per model id and reports the HTTP outcome and
what the API claimed to produce. Use it to check first-hand whether the
backend routes on the \`model\` field.

Options:
  --models <a,b,c>    Comma-separated model ids to probe
                      (default: gpt-image-2.5-flare, gpt-image-2.5-sunburst,
                      gpt-image-2, gpt-image-2-nonexistent-probe)
  --prompt <text>     Prompt used for every probe
                      (default: "a small red circle on white background")
  --base-url <url>    Override the API base URL
  --no-refresh        Fail instead of auto-refreshing an expired access token
  -h, --help          This help

Example:
  codex-img models --prompt "a tiny grey dot on white"

Notes:
  * Every probe spends one image generation from the image quota.
  * Output is always JSON — one entry per probed model id.
`.trim();

const MCP_HELP = `
codex-img mcp — run as an MCP stdio server

Usage:
  codex-img mcp

Speaks JSON-RPC 2.0 over stdin/stdout so any MCP client (Claude Code,
MiniMax Code, Codex…) can call the image tools directly. Diagnostics go to
stderr so they never corrupt the protocol stream.

Tools:
  generate_image  prompt, out_path, transparent, size, quality, model
  edit_image      prompt, image_paths[1-${MAX_EDIT_IMAGES}], out_path,
                  transparent, size, quality, model

Options:
  -h, --help    This help. The command takes no other options.

MCP client configuration:
  {
    "mcpServers": {
      "codex-img": {
        "command": "node",
        "args": ["<absolute path>/bin/codex-img.mjs", "mcp"]
      }
    }
  }

Notes:
  * The server holds no state between calls; it reads credentials fresh each
    time and writes one PNG per call.
  * Exit codes: 0 on a clean stdin close, 1 on an unrecoverable failure.
`.trim();

/**
 * The command surface, in one registry: name, aliases, one-line summary and
 * the long help. The dispatcher and the help output both read from here, so
 * a command can never drift away from its own documentation.
 */
export const COMMANDS = [
  { name: 'auth', aliases: [], summary: 'Show credential status (no network)', help: AUTH_HELP },
  { name: 'gen', aliases: ['generate'], summary: 'Generate an image from a text prompt', help: GEN_HELP },
  { name: 'edit', aliases: [], summary: 'Edit existing image(s) with a text instruction', help: EDIT_HELP },
  { name: 'models', aliases: [], summary: 'Probe which model ids the endpoint actually honours', help: MODELS_HELP },
  { name: 'mcp', aliases: [], summary: 'Run as an MCP stdio server for agent clients', help: MCP_HELP },
];

/** Resolve a command name or alias to its registry entry. */
export function findCommand(name) {
  if (typeof name !== 'string') return null;
  const needle = name.trim().toLowerCase();
  return (
    COMMANDS.find((c) => c.name === needle) ??
    COMMANDS.find((c) => c.aliases.includes(needle)) ??
    null
  );
}

/**
 * Help for a command, or null when the name is unknown.
 * An unknown name is a usage error, so the caller reports it and lists the
 * valid commands rather than silently printing the global overview.
 */
export function helpFor(name) {
  const command = findCommand(name);
  return command ? command.help : null;
}
