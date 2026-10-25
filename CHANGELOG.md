# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-25

### Added

- `codex-img login` — sign in with a ChatGPT subscription, for machines that
  have no `codex login`. Two flows, both matching the `openai/codex` reference
  implementation: a browser flow with a local loopback callback on
  `127.0.0.1:1455` (fallback `1457`), and `--device` for the device code flow
  that works over SSH, in containers and on headless machines.
- `codex-img logout` — remove the credentials this tool manages. The Codex
  login in `~/.codex` is never touched.
- `codex-img auth` now reports which credential store is in use
  (`managed by codex-img` or `codex login (~/.codex)`).

### Changed

- The credentials this tool manages now live in `<package>/.codex-img/auth.json`
  — inside the package's own install directory — instead of a directory in the
  home folder. **Uninstalling the package therefore removes the credentials
  with it, and no token is left behind on the machine.**
  npm 11 has no uninstall lifecycle hook (its arborist does not implement
  `preuninstall`/`postuninstall`), so the directory layout is what makes that
  guarantee real. `CODEX_IMG_HOME` overrides the location.
- Reinstalling the package, or switching Node versions when it is installed
  globally, means signing in again.

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
