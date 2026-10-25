# Security

## What this tool touches

`codex-img-cli` reads the ChatGPT credentials written by `codex login`:

```
~/.codex/auth.json   (override the directory with CODEX_HOME)
```

and, when you sign in with `codex-img login` instead, credentials it manages
itself:

```
<package>/.codex-img/auth.json   (override with CODEX_IMG_HOME)
```

It sends them to exactly one place — `chatgpt.com` — to call the image
endpoints. The file is never copied anywhere else, and `OPENAI_API_KEY` is
never read.

If the access token has expired, the tool exchanges the refresh token at
`auth.openai.com/oauth/token` and writes the new token back atomically
(temp file + rename, same directory). The refresh always goes back to the
store the credentials came from.

The credentials `codex-img login` writes live inside the package's install
directory, so uninstalling the package removes them as well. `codex-img logout`
removes them on demand, and never touches the Codex login in `~/.codex`.

## Please do not

- Commit `auth.json`, or any file containing `access_token` / `refresh_token`.
- Paste tokens into issues, pull requests or chat logs.
- Point `--base-url` at a host you do not control while credentials are loaded.
  The `--base-url` flag exists for testing against a local stub; using it with
  a remote host sends your access token there.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/xurunxin/codex-img-cli/security/advisories/new)
rather than a public issue.

Because this project calls an undocumented internal endpoint, "it broke" is
usually an upstream change, not a vulnerability in this code. Those belong in
normal issues.
