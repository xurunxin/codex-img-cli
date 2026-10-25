# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-25

First public release.

### Added

- `codex-img` CLI with five commands: `auth`, `gen`, `edit`, `models`, `mcp`.
- Per-command help: `codex-img help <command>` and `codex-img <command> --help`,
  each listing required arguments, every option, runnable examples and the
  behaviour that is easy to get wrong. `codex-img --version` prints the version.
- MCP stdio server exposing `generate_image` and `edit_image`, with tool
  descriptions detailed enough for an agent to call them correctly without
  further documentation.
- `--transparent` flag (shorthand for `--background transparent`), which the
  README had documented before it was implemented.
- `--n <count>` now writes every returned image: the first to `--out`, the rest
  as `<out>-2.png`, `<out>-3.png`, … instead of silently discarding them.
- `--models <a,b,c>` on `codex-img models` to probe a custom model list, and
  `--base-url` is now honoured by that command too.
- Boolean options are parsed from an explicit whitelist, so
  `--transparent out.png` no longer swallows the following argument.

### Fixed

- `codex-img models` ignored `--base-url`.
- `--version` reported a hardcoded string instead of the package version; the
  CLI and the MCP `serverInfo` now both read it from `package.json`.

[1.0.0]: https://github.com/xurunxin/codex-img-cli/releases/tag/v1.0.0
