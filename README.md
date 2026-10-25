# codex-img-cli

**Give any agent GPT-Image generation, by reusing the Codex / ChatGPT subscription you already pay for.**

Codex CLI ships an `imagegen` skill — but it lives *inside* the agent, so nothing
else can reach it. Claude Code, MiniMax Code, OpenCode, Cursor, your own
scripts… none of them can turn your ChatGPT plan into an image.

`codex-img-cli` extracts the exact same endpoint into a standalone **CLI** and an
**MCP stdio server**. Point any MCP client at it and "draw me a picture" becomes
a tool call.

![codex-img-cli hero](docs/hero.png)

> Zero runtime dependencies · Node.js ≥ 20 · credentials never leave your machine

[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![mcp](https://img.shields.io/badge/protocol-MCP-8A2BE2.svg)](#mcp)
[![stars](https://img.shields.io/github/stars/xurunxin/codex-img-cli?style=social)](https://github.com/xurunxin/codex-img-cli/stargazers)

English | [简体中文](README.zh-CN.md)

---

## Why

| | Codex `imagegen` skill | codex-img-cli |
|---|---|---|
| Who can call it | Codex only | any agent, any script |
| Interface | sealed inside the agent | CLI + MCP stdio server |
| Extra setup | — | `codex login`, once |
| Credentials | managed by Codex | read from `~/.codex/auth.json` |
| Dependencies | — | none |

## How it works

The request shape is taken from the `openai/codex` source
(`codex-rs/ext/image-generation/src/`):

```
POST https://chatgpt.com/backend-api/codex/images/generations
POST https://chatgpt.com/backend-api/codex/images/edits

Authorization: Bearer <tokens.access_token>
ChatGPT-Account-ID: <tokens.account_id>
Content-Type: application/json

{ "model": "gpt-image-2", "prompt": "...", "background": "opaque",
  "quality": "auto", "size": "auto" }
```

Authentication reads `~/.codex/auth.json` — the file `codex login` writes. Your
`OPENAI_API_KEY` is never touched. When the access token is about to expire,
the `refresh_token` from the same file is exchanged for a fresh one and written
back atomically (temp file + rename), so Codex CLI and this tool can share one
login.

## Install

```bash
git clone https://github.com/xurunxin/codex-img-cli.git
cd codex-img-cli
npm link          # puts `codex-img` on your PATH
npm test          # 20 unit tests, no network access required
```

Prerequisite: run `codex login` on this machine, with an account that has a
ChatGPT subscription.

Prefer not to install it? `node bin/codex-img.mjs ...` works exactly the same.

<details>
<summary><b>Windows + nvm: getting <code>codex-img</code> onto PATH</b></summary>

`npm link` writes the shim into the npm global directory. Under nvm-windows that
is the **version** directory (`…\nvm\installs\<version>\`), which is not on PATH
and disappears when you switch Node versions. Drop a small wrapper into a
directory that *is* on PATH:

```bat
@echo off
setlocal
set "CODEX_IMG_ENTRY=<repo>\bin\codex-img.mjs"
set "CODEX_IMG_NODE=%LOCALAPPDATA%\Author Software\nvm\.nodejs\node.exe"
if not exist "%CODEX_IMG_NODE%" set "CODEX_IMG_NODE=node"
"%CODEX_IMG_NODE%" "%CODEX_IMG_ENTRY%" %*
exit /b %errorlevel%
```

Save it as `%USERPROFILE%\.local\bin\codex-img.cmd`, then check with
`where codex-img`.

</details>

## Quick start

```bash
codex-img auth                        # check the login — offline, no quota
codex-img gen --prompt "a cozy alpine cabin at dawn" --out cabin.png
codex-img edit --image cabin.png \
  --prompt "replace the background with a warm sunset, keep the cabin unchanged" \
  --out sunset.png
```

## CLI reference

| Command | What it does |
|---|---|
| `codex-img auth` | Show credential status — no network request |
| `codex-img gen` | Generate an image from a text prompt |
| `codex-img edit` | Edit existing image(s) with a text instruction |
| `codex-img models` | Probe which model ids the endpoint actually honours |
| `codex-img mcp` | Run as an MCP stdio server |

Common options:

| Option | Description |
|---|---|
| `--out <file>` | Output path (default `./codex-img-<timestamp>.png`) |
| `--transparent` | Shorthand for `--background transparent` |
| `--background <mode>` | `transparent` / `opaque` / `auto` (default `opaque`) |
| `--quality <q>` | `low` / `medium` / `high` / `xhigh` / `max` / `auto` |
| `--size <WxH>` | e.g. `1024x1024`, `2048x1152`, `auto` |
| `--model <id>` | Model id placed in the request body (see [below](#what-the-endpoint-really-honours)) |
| `--timeout <ms>` | Per-request timeout (default `300000`) |
| `--base-url <url>` | Override the API base URL |
| `--no-refresh` | Fail instead of auto-refreshing an expired access token |
| `--json` | Machine-readable output |

Command-specific: `gen --n <count>`, `edit --image <file>` (repeatable, max 5),
`models --models <a,b,c>`.

### Help

Every command carries its own help text, so an agent can learn the tool from the
tool itself:

```bash
codex-img                    # overview: command table + notes
codex-img help gen           # full reference for one command
codex-img gen --help         # same thing
codex-img --version
```

Each command's help lists its required arguments, every option, runnable
examples, and the behaviour that is easy to get wrong — for example that the
endpoint ignores `model`, or that `edit` takes at most five reference images.
An unknown command exits with code 2 and lists the valid commands.

### Multiple images

`--n` requests more than one image: the first is written to `--out`, the rest
to `<out>-2.png`, `<out>-3.png`, …

```bash
codex-img gen --prompt "four variations of a brass compass" --n 4 --out compass.png
```

## MCP

The `mcp` command speaks JSON-RPC 2.0 over stdin/stdout. Any MCP client that
speaks stdio can use it.

```jsonc
{
  "mcpServers": {
    "codex-img": {
      "command": "node",
      "args": ["/absolute/path/to/codex-img-cli/bin/codex-img.mjs", "mcp"]
    }
  }
}
```

With Claude Code:

```bash
claude mcp add codex-img -- node /absolute/path/to/codex-img-cli/bin/codex-img.mjs mcp
```

Two tools are exposed:

| Tool | Parameters |
|---|---|
| `generate_image` | `prompt`, `out_path`, `transparent`, `size`, `quality`, `model` |
| `edit_image` | `prompt`, `image_paths[]` (1–5), `out_path`, `transparent`, `size`, `quality`, `model` |

The tool descriptions spell out how to write the prompt, why `out_path` should
always be explicit, and that `model` and `size` are ignored by this endpoint —
so an agent calls it correctly without any extra documentation.

The same request, both ways:

| | |
|---|---|
| ![generated](docs/hero.png) | ![edited](docs/hero-sunset.png) |
| `codex-img gen --prompt "…robot handing a picture card…" --out hero.png` | `codex-img edit --image hero.png --prompt "…warm sunset background…" --out hero-sunset.png` |

## What the endpoint really honours

OpenAI shipped **GPT-Image-2.5** on 2026-09-08, split on the API side into
`gpt-image-2.5-flare` (fast) and `gpt-image-2.5-sunburst` (precise). On this
subscription channel you cannot pick between them.

`codex-img models` probes it first-hand — measured on a Pro subscription:

| Requested model | Result | Returned size | Returned quality |
|---|---|---|---|
| `gpt-image-2.5-flare` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2.5-sunburst` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2-nonexistent-probe` (made up) | **HTTP 200** | 1448x1086 | low |

**A model id that does not exist still returns 200**, so the endpoint ignores
the `model` field outright. `size` is ignored too: asking for `1024x1024` comes
back as `1254x1254` or `1448x1086`, not even satisfying the public Images API
rule that side lengths be multiples of 16.

That also explains why `openai/codex` still hardcodes
`const IMAGE_MODEL: &str = "gpt-image-2"` and yet delivers 2.5 quality: the
backend changed, the frontend identifier did not.

**Conclusion:** choosing between Flare and Sunburst requires an official API key
against `api.openai.com`. On the subscription channel, you get whatever the
backend serves.

## Requirements and limits

- Needs a ChatGPT subscription and `codex login` on the same machine.
- This calls an **undocumented internal endpoint** that is not part of the
  OpenAI developer documentation. It can change or disappear at any time.
- Using subscription credentials from a non-official client **violates the
  OpenAI terms of service**. Self-use is your own call; do not redistribute it
  or resell access.
- Image generation draws from a **quota pool separate from chat** (`limit_id ==
  "image_gen"` in the Codex source).
- Codex rotates refresh tokens. If Codex CLI refreshes at the same moment, you
  can hit "refresh token already used" — run `codex login` once and retry.
- Output PNGs carry C2PA metadata and an invisible watermark, same as anything
  produced by ChatGPT or Codex.

## Development

```bash
npm test          # node:test, no network, no dependencies
npm link          # run the CLI from your working tree
```

Layout:

```
bin/codex-img.mjs   executable entry point
src/cli.mjs         argument parsing and command dispatch
src/help.mjs        the command registry and all help text
src/client.mjs      endpoint calls, base64 payloads, file writing
src/auth.mjs        credential file, token refresh, atomic write
src/mcp.mjs         MCP stdio server and tool schemas
src/version.mjs     version, read from package.json
```

CI runs the suite on Linux, macOS and Windows against Node 20, 22 and 24.

## License

MIT — see [LICENSE](LICENSE).

## Related work

Independent implementations of the same call, useful as cross-checks:

- [`headroomlabs-ai/headroom`](https://github.com/headroomlabs-ai/headroom) — Python
- [`caozhiyuan/copilot-api`](https://github.com/caozhiyuan/copilot-api) — TypeScript
- [`kittors/CliRelay`](https://github.com/kittors/CliRelay) — Go, also records the "model field is ignored" finding
- [`NomaDamas/CozyClay`](https://github.com/NomaDamas/CozyClay) — Node
- [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) — Hermes, with a built-in `openai-codex` image provider

If you would rather not maintain your own code, **Hermes** already wraps this
and can expose OAuth providers as an OpenAI-compatible endpoint via
`hermes proxy`.
