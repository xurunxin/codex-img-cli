# Contributing

Thanks for considering a contribution.

## Development setup

The project has **zero runtime dependencies** and needs Node.js ≥ 20.

```bash
git clone https://github.com/xurunxin/codex-img-cli.git
cd codex-img-cli
npm link          # puts `codex-img` on your PATH
npm test          # 20 unit tests, no network access required
```

## Ground rules

- **No runtime dependencies.** The whole tool is built on `node:fs`,
  `node:path` and `fetch`. Please keep it that way; a dependency has to earn
  its place.
- **Credentials never leave the machine.** The tool reads
  `~/.codex/auth.json` and talks to `chatgpt.com` directly. Never log, copy or
  commit tokens, and never add a code path that sends them anywhere else.
- **Tests must not need the network.** Unit tests use a local HTTP server and a
  fake `CODEX_HOME`. A test that needs a real ChatGPT subscription does not
  belong in the default `npm test` run.
- **Keep the help text truthful.** `codex-img help <command>` is the contract
  agents read. If you change behaviour, change the matching help text in
  `src/help.mjs` in the same commit.

## Pull requests

1. Branch off `main`.
2. Run `npm test` locally.
3. Open a pull request describing what changed and why.

CI runs the test suite on Linux, macOS and Windows against Node 20, 22 and 24.
Windows matters here: the tool ships as a `.cmd` shim and a Node ≥ 20 target.

## README images

The images under `docs/` are produced by the tool itself. To regenerate and
shrink them, you need Python with Pillow — an optional, contributor-only
dependency:

```bash
python scripts/optimize-docs-images.py
```

## Checking the OAuth constants

The login flow mirrors `openai/codex`. When the upstream implementation
changes, `scripts/extract-bin-strings.mjs` helps you read the constants out of
a local Codex binary instead of guessing:

```bash
node scripts/extract-bin-strings.mjs <path-to>/codex.exe "oauth/authorize" "auth/callback"
```

## Reporting bugs

Open an issue with the output of `codex-img auth --json` (redact the account
id) and the exact command you ran. Please never paste tokens.
