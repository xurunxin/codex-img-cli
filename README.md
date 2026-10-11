# codex-img-cli

复用本机 **Codex / ChatGPT 订阅登录态**做图像生成与编辑的本地 CLI，并附带一个 MCP stdio 服务端，让其他 agent 直接调用。

零依赖，只需 Node.js ≥ 20。

---

## 它是怎么工作的

Codex CLI 自带的 `imagegen` 技能把生图能力藏在 agent 里面，外部拿不到。这个工具把同一条链路抽出来，直接从命令行调用。

调用方式来自 `openai/codex` 的源码（`codex-rs/ext/image-generation/src/`）：

```
POST https://chatgpt.com/backend-api/codex/images/generations
POST https://chatgpt.com/backend-api/codex/images/edits

Authorization: Bearer <tokens.access_token>
ChatGPT-Account-ID: <tokens.account_id>
Content-Type: application/json

{ "model": "gpt-image-2", "prompt": "...", "background": "opaque",
  "quality": "auto", "size": "auto" }
```

认证直接读 `~/.codex/auth.json`（即 `codex login` 写下的凭据），**不碰你的 `OPENAI_API_KEY`**。当 access token 临近过期时，用同一份文件里的 `refresh_token` 自动续期并原子写回。

---

## 安装

```bash
git clone <this-repo>
cd codex-img-cli
npm link          # 让 codex-img 进入 PATH
npm test          # 8 个单元测试，不需要网络
```

不想全局安装就直接 `node bin/codex-img.mjs ...`。

前置条件：本机跑过 `codex login`，且账号有 ChatGPT 订阅。

---

## 用法

### 看认证状态（不联网）

```bash
codex-img auth
```

```
auth file:   C:\Users\you\.codex\auth.json
auth mode:   chatgpt
account id:  c47df3ea-...
plan:        pro
audience:    https://api.openai.com/v1
access tok:  valid (6152 min left)
refresh tok: present
```

### 生成

```bash
codex-img gen --prompt "a cozy alpine cabin at dawn" --out cabin.png
codex-img gen --prompt "product icon" --transparent --size 1024x1024 --quality high --out icon.png
```

### 编辑（最多 5 张参考图）

```bash
codex-img edit --image a.png --image b.png \
  --prompt "把背景换成暖色夕阳，其余保持不变" \
  --out sunset.png
```

### 探针：端点到底认不认 model 字段

```bash
codex-img models --prompt "a tiny grey dot on white"
```

### 通用选项

| 选项 | 说明 |
|---|---|
| `--out <file>` | 输出路径，默认 `codex-img-<时间戳>.png` |
| `--background <mode>` | `transparent` / `opaque` / `auto`（默认 `opaque`） |
| `--quality <q>` | `low` / `medium` / `high` / `xhigh` / `max` / `auto` |
| `--size <WxH>` | 例如 `1024x1024`、`2048x1152`、`auto` |
| `--model <id>` | 放进请求体的 model id（见下方「重要发现」） |
| `--timeout <ms>` | 单次请求超时，默认 300000 |
| `--no-refresh` | token 过期时直接报错，不自动续期 |
| `--json` | 机器可读输出 |

---

## 作为 MCP 服务端

让 Claude Code、MiniMax Code、Codex 等任意 MCP 客户端直接生图。

```jsonc
{
  "mcpServers": {
    "codex-img": {
      "command": "node",
      "args": ["C:/path/to/codex-img-cli/bin/codex-img.mjs", "mcp"]
    }
  }
}
```

暴露两个工具：

- `generate_image` — `prompt`, `out_path`, `transparent`, `size`, `quality`, `model`
- `edit_image` — `prompt`, `image_paths[]`（1–5 张）, `out_path`, `transparent`, `size`, `quality`

---

## 重要发现：model 字段其实不起作用

OpenAI 在 2026-09-08 发布了 **GPT-Image-2.5**，API 侧拆成 `gpt-image-2.5-flare`（快）和 `gpt-image-2.5-sunburst`（精）两个模型。但在这个订阅通道上，**你无法选择它们**。

`codex-img models` 的实测输出（本仓库作者在 Pro 订阅上跑出来的）：

| 请求的 model | 结果 | 返回 size | 返回 quality |
|---|---|---|---|
| `gpt-image-2.5-flare` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2.5-sunburst` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2` | HTTP 200 | 1448x1086 | low |
| `gpt-image-2-nonexistent-probe`（编的） | **HTTP 200** | 1448x1086 | low |

**连一个根本不存在的模型 id 都返回 200**，说明端点直接忽略了 `model` 字段。同理 `size` 也被忽略——请求 `1024x1024` 实际拿回的是 `1254x1254` 或 `1448x1086`，甚至不满足公开 Images API「边长须为 16 的倍数」的约束。

这也解释了为什么 `openai/codex` 主分支至今硬编码 `const IMAGE_MODEL: &str = "gpt-image-2"` 却仍然拿到 2.5 的画质：**后端已经换了，前端的标识符是过时的**。

结论：想要真正在 Flare / Sunburst 之间做选择，只能用官方 API key 走 `api.openai.com`。

---

## 合规与风险

- 这里调用的是**未公开的内部端点**，不在 OpenAI 开发者文档内，随时可能变更或停用。
- 订阅凭据用于非授权客户端**违反 OpenAI 服务条款**。自用请自行评估风险；不要用于多账号分发或转售。
- 生图走的是**独立于对话的配额池**（`openai/codex` 源码中对应 `limit_id == "image_gen"`），与聊天额度不共用。
- Codex 会轮换 refresh token。如果你和 Codex CLI 同时续期，可能出现「refresh token 已被使用」——此时跑一次 `codex login` 即可。
- 输出图带有 C2PA 元数据与隐形水印，与 ChatGPT / Codex 产出一致。

## 参考实现

同一套调用方式已有多个独立实现，可交叉印证：

- [`headroomlabs-ai/headroom`](https://github.com/headroomlabs-ai/headroom) — Python
- [`caozhiyuan/copilot-api`](https://github.com/caozhiyuan/copilot-api) — TypeScript
- [`kittors/CliRelay`](https://github.com/kittors/CliRelay) — Go，含「model 字段被忽略」的记录
- [`NomaDamas/CozyClay`](https://github.com/NomaDamas/CozyClay) — Node
- [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) — Hermes，内置 `openai-codex` 生图 provider

如果你不需要自己维护代码，**直接用 Hermes** 更省事，它已经把这套封装好了，还有 `hermes proxy` 可以把 OAuth provider 暴露成 OpenAI 兼容端点。

## License

MIT