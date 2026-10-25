# codex-img-cli

**把 Codex / ChatGPT 订阅复用到任意 agent 上，做 GPT-Image 生图。**

Codex CLI 自带一个 `imagegen` 技能，但它长在 agent 里面，外部拿不到。Claude Code、
MiniMax Code、OpenCode、Cursor、你自己的脚本……谁都用不了你的 ChatGPT 额度来画图。

`codex-img-cli` 把同一条链路抽成一个独立的 **CLI** 和一个 **MCP stdio 服务端**。
把任意 MCP 客户端指过来，"帮我画张图" 就变成了一个工具调用。

![codex-img-cli 主图](docs/hero.png)

> 零运行时依赖 · Node.js ≥ 20 · 凭据不出本机

[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![mcp](https://img.shields.io/badge/protocol-MCP-8A2BE2.svg)](#作为-mcp-服务端)

[English](README.md) | 简体中文

---

## 为什么需要它

| | Codex `imagegen` 技能 | codex-img-cli |
|---|---|---|
| 谁能用 | 只有 Codex | 任意 agent、任意脚本 |
| 调用方式 | 封在 agent 内部 | CLI + MCP stdio |
| 额外步骤 | — | 一次 `codex login` |
| 凭据 | 由 Codex 管 | 读 `~/.codex/auth.json` |
| 依赖 | — | 无 |

## 它是怎么工作的

调用方式取自 `openai/codex` 源码（`codex-rs/ext/image-generation/src/`）：

```
POST https://chatgpt.com/backend-api/codex/images/generations
POST https://chatgpt.com/backend-api/codex/images/edits

Authorization: Bearer <tokens.access_token>
ChatGPT-Account-ID: <tokens.account_id>
Content-Type: application/json

{ "model": "gpt-image-2", "prompt": "...", "background": "opaque",
  "quality": "auto", "size": "auto" }
```

认证直接读 `~/.codex/auth.json`（即 `codex login` 写下的凭据），**不碰你的
`OPENAI_API_KEY`**。access token 临近过期时，用同一份文件里的 `refresh_token`
自动续期并原子写回（临时文件 + rename），所以 Codex CLI 和本工具共用一次登录即可。

## 安装

```bash
git clone https://github.com/xurunxin/codex-img-cli.git
cd codex-img-cli
npm link          # 让 codex-img 进入 PATH
npm test          # 20 个单元测试，不需要网络
```

前置条件：本机跑过 `codex login`，且账号有 ChatGPT 订阅。

不想全局安装就直接 `node bin/codex-img.mjs ...`。

<details>
<summary><b>Windows + nvm：让 <code>codex-img</code> 真正进入 PATH</b></summary>

`npm link` 会把可执行文件写进 npm 全局目录。在 nvm-windows 上这是**版本目录**
（`…\nvm\installs\<版本>\`），既不在 PATH 里，换个 node 版本还会消失。所以再往一个
在 PATH 里的目录丢一个小包装器：

```bat
@echo off
setlocal
set "CODEX_IMG_ENTRY=<仓库路径>\bin\codex-img.mjs"
set "CODEX_IMG_NODE=%LOCALAPPDATA%\Author Software\nvm\.nodejs\node.exe"
if not exist "%CODEX_IMG_NODE%" set "CODEX_IMG_NODE=node"
"%CODEX_IMG_NODE%" "%CODEX_IMG_ENTRY%" %*
exit /b %errorlevel%
```

存成 `%USERPROFILE%\.local\bin\codex-img.cmd`，用 `where codex-img` 验证。

</details>

## 快速上手

```bash
codex-img auth                        # 看认证状态——不联网、不耗额度
codex-img gen --prompt "a cozy alpine cabin at dawn" --out cabin.png
codex-img edit --image cabin.png \
  --prompt "把背景换成暖色夕阳，屋子本身保持不变" \
  --out sunset.png
```

## CLI 一览

| 命令 | 作用 |
|---|---|
| `codex-img auth` | 看认证状态——不发起网络请求 |
| `codex-img gen` | 按文字提示生成图片 |
| `codex-img edit` | 按文字指令编辑已有图片 |
| `codex-img models` | 探针：端点到底认不认 model 字段 |
| `codex-img mcp` | 以 MCP stdio 服务端运行 |

通用选项：

| 选项 | 说明 |
|---|---|
| `--out <file>` | 输出路径，默认 `./codex-img-<时间戳>.png` |
| `--transparent` | `--background transparent` 的简写 |
| `--background <mode>` | `transparent` / `opaque` / `auto`（默认 `opaque`） |
| `--quality <q>` | `low` / `medium` / `high` / `xhigh` / `max` / `auto` |
| `--size <WxH>` | 例如 `1024x1024`、`2048x1152`、`auto` |
| `--model <id>` | 放进请求体的 model id（见[下文](#端点到底认不认-model-字段)） |
| `--timeout <ms>` | 单次请求超时，默认 `300000` |
| `--base-url <url>` | 覆盖 API base URL |
| `--no-refresh` | token 过期时直接报错，不自动续期 |
| `--json` | 机器可读输出 |

命令专属选项：`gen --n <count>`、`edit --image <file>`（可重复，最多 5 张）、
`models --models <a,b,c>`。

### 帮助

每个命令都有独立帮助，agent 只看帮助就能学会怎么用：

```bash
codex-img                    # 总览：命令表 + 注意事项
codex-img help gen           # 单命令完整参考
codex-img gen --help         # 同上
codex-img --version
```

每条帮助都包含：必填参数、全部选项、可直接复制的示例，以及**容易被猜错的坑**
（例如端点会忽略 `model` 字段、`edit` 最多 5 张参考图）。未知命令退出码 2，并列出可用命令。

### 一次出多张

`--n` 请求多张图：第一张写到 `--out`，其余写 `<out>-2.png`、`<out>-3.png`……

```bash
codex-img gen --prompt "four variations of a brass compass" --n 4 --out compass.png
```

## 作为 MCP 服务端

`codex-img mcp` 用 stdin/stdout 讲 JSON-RPC 2.0，任何支持 stdio 的 MCP 客户端都能接。

```jsonc
{
  "mcpServers": {
    "codex-img": {
      "command": "node",
      "args": ["/绝对路径/codex-img-cli/bin/codex-img.mjs", "mcp"]
    }
  }
}
```

Claude Code 一行接入：

```bash
claude mcp add codex-img -- node /绝对路径/codex-img-cli/bin/codex-img.mjs mcp
```

暴露两个工具：

| 工具 | 参数 |
|---|---|
| `generate_image` | `prompt`, `out_path`, `transparent`, `size`, `quality`, `model` |
| `edit_image` | `prompt`, `image_paths[]`（1–5 张）, `out_path`, `transparent`, `size`, `quality`, `model` |

工具描述里写清了「prompt 怎么写」「为什么必须显式给 `out_path`」「端点会忽略 `model` / `size`」，
所以接入的 agent 不需要额外文档就能用对。

同一个请求，两种走法：

| | |
|---|---|
| ![生成](docs/hero.png) | ![编辑](docs/hero-sunset.png) |
| `codex-img gen --prompt "…机器人把图片卡片递给另一个机器人…" --out hero.png` | `codex-img edit --image hero.png --prompt "…背景换成暖色夕阳…" --out hero-sunset.png` |

## 端点到底认不认 model 字段

OpenAI 在 2026-09-08 发布了 **GPT-Image-2.5**，API 侧拆成 `gpt-image-2.5-flare`（快）和
`gpt-image-2.5-sunburst`（精）。但在这个订阅通道上，**你无法选择它们**。

`codex-img models` 的实测输出（Pro 订阅）：

| 请求的 model | 结果 | 返回 size | 返回 quality |
|---|---|---|---|
| `gpt-image-2.5-flare` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2.5-sunburst` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2-nonexistent-probe`（编的） | **HTTP 200** | 1448x1086 | low |

**连一个根本不存在的模型 id 都返回 200**，说明端点直接忽略了 `model` 字段。同理 `size` 也被忽略——
请求 `1024x1024` 实际拿回的是 `1254x1254` 或 `1448x1086`，甚至不满足公开 Images API
「边长须为 16 的倍数」的约束。

这也解释了为什么 `openai/codex` 主分支至今硬编码 `const IMAGE_MODEL: &str = "gpt-image-2"`
却仍然拿到 2.5 的画质：**后端已经换了，前端的标识符是过时的**。

**结论**：想要真正在 Flare / Sunburst 之间做选择，只能用官方 API key 走 `api.openai.com`。
订阅通道上，给什么都是后端给什么。

## 前置条件与限制

- 需要 ChatGPT 订阅，并在同一台机器上跑过 `codex login`。
- 这里调用的是**未公开的内部端点**，不在 OpenAI 开发者文档内，随时可能变更或停用。
- 用订阅凭据跑非官方客户端**违反 OpenAI 服务条款**。自用请自行评估风险；不要用于多账号分发或转售。
- 生图走的是**独立于对话的配额池**（`openai/codex` 源码中对应 `limit_id == "image_gen"`）。
- Codex 会轮换 refresh token。如果你和 Codex CLI 同时续期，可能出现「refresh token 已被使用」——
  此时跑一次 `codex login` 即可。
- 输出图带有 C2PA 元数据与隐形水印，与 ChatGPT / Codex 产出一致。

## 开发

```bash
npm test          # node:test，不需要网络，没有依赖
npm link          # 把工作树里的 CLI 挂到 PATH
```

目录结构：

```
bin/codex-img.mjs   可执行入口
src/cli.mjs         参数解析与命令分发
src/help.mjs        命令注册表与全部帮助文本
src/client.mjs      端点调用、base64 载荷、文件落盘
src/auth.mjs        凭据文件、token 续期、原子写回
src/mcp.mjs         MCP stdio 服务端与工具 schema
src/version.mjs     版本号，从 package.json 读取
```

CI 在 Linux / macOS / Windows 上跑 Node 20、22、24。

## License

MIT —— 见 [LICENSE](LICENSE)。

## 同类实现

同一套调用方式的其他独立实现，可交叉印证：

- [`headroomlabs-ai/headroom`](https://github.com/headroomlabs-ai/headroom) —— Python
- [`caozhiyuan/copilot-api`](https://github.com/caozhiyuan/copilot-api) —— TypeScript
- [`kittors/CliRelay`](https://github.com/kittors/CliRelay) —— Go，同样记录了「model 字段被忽略」
- [`NomaDamas/CozyClay`](https://github.com/NomaDamas/CozyClay) —— Node
- [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) —— Hermes，内置 `openai-codex` 生图 provider

如果你不需要自己维护代码，**直接用 Hermes** 更省事，它已经把这套封装好了，
还有 `hermes proxy` 可以把 OAuth provider 暴露成 OpenAI 兼容端点。
