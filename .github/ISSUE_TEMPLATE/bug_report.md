---
name: Bug report
about: Something does not work as documented
title: ""
labels: bug
body:
  - type: markdown
    attributes:
      value: |
        Please do not paste access tokens or refresh tokens. `codex-img auth --json`
        is safe to share after redacting the account id.

  - type: textarea
    id: command
    attributes:
      label: Command
      description: The exact command you ran
      placeholder: codex-img gen --prompt "..." --out out.png
    validations:
      required: true

  - type: textarea
    id: error
    attributes:
      label: Error output
      description: The full error message, including any request id
      render: shell
    validations:
      required: true

  - type: textarea
    id: env
    attributes:
      label: Environment
      description: Output of `codex-img auth --json` (redacted) and `node -v`
      render: shell

  - type: checkboxes
    id: checks
    attributes:
      label: Checks
      options:
        - label: I searched existing issues for this problem
