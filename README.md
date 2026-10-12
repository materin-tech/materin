# Materin

自研 AI coding agent（TS + Bun monorepo）。架构与决策记录见 [docs/development-plan.md](docs/development-plan.md)。

## 运行

```bash
bun install

# 方式一: TUI(内嵌启动 server)
bun run dev

# 方式二: 独立 server + 任意客户端
bun run server          # 监听 http://127.0.0.1:4128

# Web 端
bun run web:build       # 构建 packages/web/dist
open http://127.0.0.1:4128/ui/   # server 自带静态服务
```

Web 端支持: 会话管理、剪贴板粘贴图片提问、`@文件` 引用、`!命令`、
`/compact` `/model` `/new` 斜杠命令、跨会话全文搜索（中文可用）、edit diff 可视化。

## 环境变量

| 变量 | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | 必需 |
| `ANTHROPIC_BASE_URL` | 可选, 中转/代理地址 |
| `MATERIN_MODEL` | 默认 `claude-sonnet-5-5` |

## 命令

- TUI 内: `/exit` 退出, Ctrl+C 中止当前跑动
- TUI 启动默认恢复最近会话, `--new` 新建, `--resume` 选择历史会话

## 模型与思考深度

**`/model` — 模型选择（支持别名）**

- 不带参数: 列出全部注册模型及配置状态（`GET /models` 等价）
- 带别名或完整 id: 解析为 canonical id 后存入会话
  - `opus` → `claude-opus-5-5` · `sonnet` → `claude-sonnet-5-5` · `haiku` → `claude-haiku-4-5`
  - `deepseek` → `deepseek-chat` · `deepseek-r1` → `deepseek-reasoner`
  - `qwen` → `qwen-plus` · `kimi` → `kimi-k2` · `glm` → `glm-4.7`
- 完整 id 依旧接受; 未知 id 按前缀兜底（`claude*` → anthropic, 其余 → OpenAI-compatible）
- `MATERIN_MODEL` 环境变量仍然生效（新建会话的默认模型）

**`/thinking <level>` — 思考深度（会话级, 跨 provider）**

| level | Claude (budget_tokens / max_tokens 下限) | OpenAI 兼容 (reasoning_effort) | Qwen | 智谱 GLM |
|---|---|---|---|---|
| `off`（默认） | 不发送 thinking | 不发送 | 不发送 | 不发送 |
| `low` | 4096 | `low` | `enable_thinking: true` | `thinking: {type: enabled}` |
| `medium` | 8192 | `medium` | 同上 | 同上 |
| `high` | 16384 | `high` | 同上 | 同上 |
| `xhigh` | 32768 | `high`（钳制） | 同上 | 同上 |

- DeepSeek 不需要参数（reasoner 恒思考）, Kimi 暂无参数（M5.1 占位）
- Anthropic 分支: `max_tokens` 自动抬到 `budget + 4096` 以上（API 要求 max_tokens > budget_tokens）
- 也可走 HTTP: `POST /session/:id/thinking {"level":"high"}`、`GET /models`

## 结构

```
packages/
├── ai/       # LLM 抽象层 (wire API, M1 仅 anthropic-messages)
├── core/     # agent loop / 树形 session / SQLite / 内置工具
├── server/   # Hono HTTP + SSE 总线 (OpenAPI M2)
└── tui/      # scrollback TUI, server 的薄客户端
```

## 安装

```bash
# npm (推荐, 无需 Bun — 内含编译好的平台二进制)
npm install -g materin

# 或从 release 包
tar xzf materin-v0.1.0-darwin-arm64.tar.gz && ./materin

# 或源码
bun install && bun run dev
```

首次启动交互式配置 provider (api key / base_url / 默认模型, 私有化部署可自定义 base_url),
配置存于 `~/.materin/config.json` (0600), 也可全部用环境变量覆盖 (`materin config` 重配,
`-d <dir>` 指定数据根目录)。

## 渠道机器人（钉钉/飞书/企业微信）

```bash
bun run gateway   # 按 env 注册适配器
```

| 平台 | 环境变量 | 连接方式 |
|---|---|---|
| 飞书 | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | WebSocket 长连接，免公网 IP |
| 钉钉 | `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` | Stream 模式 |
| 企微 | `WECOM_CORP_ID` / `WECOM_CORP_SECRET` / `WECOM_AGENT_ID` / `WECOM_TOKEN` / `WECOM_ENCODING_AES_KEY` | 回调 `:4190`（需公网，配 frp/ngrok） |
| 本地测试 | `MATERIN_GATEWAY_CONSOLE=1` | stdin/stdout |

安全：渠道会话默认禁用 `bash/write/edit`（远程消息不可信），`MATERIN_CHANNEL_PERMISSIONS` 可覆盖。详见 `packages/gateway/README.md`。

## 测试

```bash
bun test packages/core/test   # 9 个测试: 树形 session 语义 + agent loop
```
