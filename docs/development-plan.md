# Materin 开发计划与技术设计 v0.1

> 日期：2026-10-12
> 状态：架构决策定稿，待开工
> 本文档汇总自对 Claude Code / OpenCode / Pi / Hermes Agent 四个产品的深度调研（约 180 次一手资料抓取：官方文档、源码、工程博客），以及后续的技术选型讨论。

---

## 0. 项目目标

打造一个完整的自有 AI Coding Agent，核心差异化切入点：

| 痛点（来自 Claude Code / OpenCode 实际使用） | 我们的解法 |
|---|---|
| 终端里截图粘贴体验差 | Desktop/Web 客户端原生剪贴板 → ImageContent 进上下文（GUI 相对终端的**结构性优势**） |
| 桌面端没有 `@` 引用等输入能力 | `@`/`!`/`/` 解析放在 **server 层** input pipeline，所有端自动一致 |
| 安装繁琐（pi 需要 Node≥22 + --ignore-scripts） | `bun build --compile` 单二进制 + install.sh |

**产品哲学（从四家共识提炼）**：没有一家是靠「功能多」赢的——Claude Code 赢在 harness 打磨，Pi 赢在克制，OpenCode 赢在架构分层远见，Hermes 赢在学习闭环。核心保持极简（4~6 个内置工具，系统提示 <1000 token），一切扩展走 extension 总线。

---

## 1. 竞品深度调研结论

### 1.1 一句话定位

| 工具 | 本质 | 技术栈 | 核心差异化 |
|---|---|---|---|
| Claude Code | 闭源 harness 标杆，loop 极简、外围武装到牙齿 | Node/TS + 原生二进制 | 权限系统 + 上下文工程 + Hooks（30+ 事件） |
| OpenCode v2 | 开源平替，server-first | Bun + Effect + SQLite | 本地 HTTP server + SSE 总线，所有 UI 是薄客户端 |
| Pi | 极简可魔改，刻意做减法 | Node/TS monorepo | 4 工具 + <1000 token 提示 + 一切靠 extension |
| Hermes Agent | 自学习闭环 + 消息平台优先 | Python + SQLite | 记忆自维护 + 后台 review + FTS5 检索 + 7 种执行后端 |

### 1.2 关键参考资产（读源码学设计）

| 资产 | 学什么 | 位置 |
|---|---|---|
| **pi-mono/packages/coding-agent/docs/session-format.md** | 树形 JSONL session 设计（全网最好的 agent session 教材） | github.com/badlogic/pi-mono（已迁 earendil-works/pi） |
| **pi-mono/packages/agent** | agent loop + steering/follow-up 双队列（~2000 行） | 同上 |
| **pi-ai** | 6 种 wire API 抽象、跨 provider 切换、国产模型 compat 表 | packages/ai |
| **OpenCode packages/core** | server-first、SSE 总线、SQLite schema、合成消息去重台账 | github.com/anomalyco/opencode |
| **Hermes docs/developer-guide/** | session storage、micro-compaction、记忆闭环 | hermes-agent.nousresearch.com/docs/ |
| **Anthropic 工程博客** | building-agents-with-the-claude-agent-sdk、claude-code-auto-mode | anthropic.com/engineering |
| **Mario Zechner 博客** | MCP 批判（CLI+README 按需读，225 token）| mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp |

### 1.3 四家共识（写进设计原则）

1. Agent loop 本身不值钱，harness 才是产品
2. Append-only + 结构化（树/链表）的 session = resume/fork/rewind/压缩全部免费
3. Progressive disclosure 无处不在（skill、工具 schema、规则全按需加载）
4. 系统提示稳定性 > 灵活性（prompt cache 是钱的闭环）
5. 大输出 spill 到文件，只给模型路径 + 预览
6. 权限/压缩/plan mode/subagent 都应该是可插拔机制，不是硬编码

---

## 2. 技术选型定稿

**最终决策：TypeScript + Bun。**

> 决策依据：用户两种语言都不精通、愿意学 → TS 路线学习成本更低（三份最好的开源作业全是 TS，读源码学语言）；分发能力（单二进制）TS/Bun 显著优于 Python；一套 TS 代码跑遍 TUI/Web/Desktop；agent harness 纯 IO bound，JS event loop 是甜区。Python 仅在「已精通」时才成立。

| 层 | 选型 | 一句话理由 |
|---|---|---|
| 运行时 | **Bun** | 单二进制分发 + 内置 SQLite + TS 原生 |
| 语言 | TypeScript strict + **TypeBox** | 类型即 schema，AJV 运行时校验工具参数（pi 同款） |
| Server | **Hono** | 轻、SSE 一等公民、OpenAPI 集成；避免 OpenCode 的 Effect 抽象税 |
| Session 存储 | **SQLite（WAL）单库事实源**，Hermes 范式 | 详见 §4 |
| LLM 层 | **自研（抄 pi-ai 结构）**，起步 anthropic-messages + openai-completions 两种 wire API | 不用 Vercel AI SDK：跨 provider 切换 / abort-first / compat 表它做不了 |
| TUI | **自研 scrollback 差分渲染**（pi-tui 范式：`render(width)→string[]` + `CSI ?2026h` 同步输出） | 拒绝 alt-buffer 全屏；pi-tui 是最好的开源教材 |
| Desktop | **Tauri 2**（Rust 壳 + 复用 TS 前端组件） | 图片粘贴/@引用主场；体积 1/10 于 Electron |
| 扩展 | **jiti 加载 TS 文件 + 事件总线**（Pi 范式） | 无构建步骤，热重载；权限门 = tool_call 阻断事件 |
| Skill | **agentskills.io 标准** | 兼容读 `.claude/skills/`，白捡生态 |
| 分发 | `bun build --compile` + install.sh | 根治安装痛点 |

---

## 3. 顶层架构

```
┌──────────────────────────────────────────────────────────┐
│                   Surface 层（全部薄客户端）                │
│  ┌──────┐  ┌──────────┐  ┌──────┐  ┌──────────────────┐  │
│  │  TUI │  │ Tauri    │  │ Web  │  │ IDE 插件(后续)    │  │
│  │(scroll│  │ Desktop  │  │(复用  │  │  ACP 协议        │  │
│  │back) │  │(图片粘贴/ │  │前端   │  │                 │  │
│  │      │  │ @引用主场)│  │组件)  │  │                 │  │
│  └──┬───┘  └────┬─────┘  └──┬───┘  └────────┬─────────┘  │
└─────┼───────────┼───────────┼───────────────┼────────────┘
      │  HTTP + SSE（唯一状态通道，OpenAPI 3.1 spec → SDK 自动生成）
┌─────▼───────────▼───────────▼───────────────▼────────────┐
│                    Core Server（产品本体）                  │
│  Input Pipeline：@引用 / !shell / /命令 解析在这层（全端一致）│
│  Agent Loop（Pi 式极简）+ steering/follow-up 双队列 + abort 保 partial │
│  Context 管道：组装 → spill → 压缩 → 系统提示冻结（保 cache） │
│  Provider 层：6 种 wire API 抽象 + compat 标志表             │
│  Extension 总线（唯一扩展机制，一套事件内外两个消费者）        │
└──────────────────────────┬───────────────────────────────┘
                           │
              ┌────────────▼─────────────┐
              │  SQLite (WAL) 详见 §4     │
              └──────────────────────────┘
```

### 3.1 三条铁律

1. **Server-first**：TUI 不是主体，是第一个客户端。所有状态走 SSE 总线，客户端零业务逻辑。
2. **Append-only 树形历史**：消息、模型切换、压缩、扩展状态全是历史树上的节点，永不改写。
3. **Progressive disclosure**：默认上下文预算 < 10K token，一切按需加载。

### 3.2 Monorepo 模块划分

```
materin/
├── packages/
│   ├── core/          # agent loop、context 管道、session 引擎、权限
│   ├── ai/            # LLM 抽象层（wire API + compat 表）
│   ├── server/        # Hono HTTP + SSE 总线 + OpenAPI 生成
│   ├── tui/           # scrollback 差分渲染 TUI
│   ├── sdk/           # 从 OpenAPI spec 自动生成的客户端
│   ├── ui/            # SolidJS 共享组件（web/desktop）
│   ├── desktop/       # Tauri 2 壳
│   └── extension/     # jiti 加载器 + ExtensionAPI 类型
├── extensions/        # 官方扩展示例（plan-mode、subagent、sandbox）
└── skills/            # agentskills.io 标准 skill
```

### 3.3 事件总线（Extension 与 SSE 共用）

```
agent_start / agent_end / agent_settled
turn_start / turn_end
message_start / message_update(流式delta) / message_end
tool_call          ← 可返回 {block:true, reason}，即权限门
tool_execution_start / tool_execution_end
context            ← 每次 LLM 调用前触发，可重写消息（记忆注入点）
session_start / session_compact / session_fork
permission_ask     ← SSE 推给客户端弹窗，回复走 HTTP
```

### 3.4 Agent Loop 设计（Pi 范式）

- `loop { stream → tool_use? → execute → append }`，无 max-steps 硬限制
- **双输入队列**：steering（当前轮工具执行完后、下次 LLM 调用前注入）vs follow-up（agent 将停时注入）
- **abort-first**：中止的消息保留 partial content/usage，可重新入上下文续跑
- 工具结果双通道：`content`（给模型）+ `details`（给 UI）
- 读工具并行、写工具串行 + 每文件变更队列（防 read-modify-write 竞态）

---

## 4. Session 存储设计（Hermes 范式，已定稿）

> 决策记录：曾考虑「JSONL 事实源 + SQLite 索引」混合方案，最终采纳 Hermes 的纯 SQLite 单库方案。理由：Hermes 早期也是 per-session JSONL，主动迁移到 SQLite 是为了跨会话检索（FTS5 ~20ms）、血缘追踪、成本统计；且其 FTS5 的 trigram 方案天然支持**中文**全文检索，这对我们是加分项。

```
~/.materin/
├── state.db          ← 唯一事实源（WAL，伴随 -wal/-shm）
├── profiles/work/    ← profile 隔离（各自独立 state.db）
└── exports/          ← 导出 JSONL（分享/备份，非运行时依赖）
```

### 4.1 表结构（基于 Hermes v31 schema 裁剪到 M1-M2 所需）

```sql
-- 迁移链：从 v1 起步，每次变更追加一行
CREATE TABLE schema_version (version INTEGER, applied_at INTEGER);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT,        -- 血缘：压缩分裂/subagent 产生子会话
  project_id TEXT,
  title TEXT,                    -- 血缘内版本化："修 Docker 构建 #2"
  model TEXT, agent TEXT,
  cwd TEXT, git_branch TEXT,     -- resume 时校验工作区
  cost REAL, tokens_in INTEGER, tokens_out INTEGER,
  tokens_cache_read INTEGER, tokens_cache_write INTEGER,  -- 成本做成列，统计零聚合
  source TEXT,                   -- cli / desktop / api / subagent
  archived INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
  created_at INTEGER, idle_at INTEGER
);

CREATE TABLE message (
  message_uid TEXT PRIMARY KEY,  -- durable uid：跨压缩/合并存活
  session_id TEXT,
  parent_id TEXT,                -- 树形分支核心（Pi 语义）
  seq INTEGER,
  role TEXT,                     -- user/assistant/tool_result/system/custom
  content JSON,                  -- content blocks（含 base64 图片、thinking）
  api_content BLOB,              -- 字节级保真回放侧车：保 prompt cache 前缀逐字节一致
  reasoning JSON,                -- thinking 块单独存（模型切换时转 <thinking> 文本）
  model TEXT, provider TEXT, usage JSON, stop_reason TEXT,
  created_at INTEGER
);
CREATE INDEX idx_msg_tree ON message(session_id, parent_id);

-- 压缩 checkpoint（自包含：重建上下文不回溯压缩前历史）
CREATE TABLE compaction (
  id TEXT PRIMARY KEY, session_id TEXT,
  summary TEXT, tokens_before INTEGER,
  retained_tail JSON,
  created_at INTEGER
);

-- FTS5 双表（Hermes 的中文关键设计）
CREATE VIRTUAL TABLE fts_default USING fts5(
  content, content='', contentless_delete=1, tokenize='unicode61');
CREATE VIRTUAL TABLE fts_trigram USING fts5(
  content, content='', contentless_delete=1, tokenize='trigram');  -- CJK/子串

-- 并发治理
CREATE TABLE compression_locks (session_id TEXT PRIMARY KEY, locked_at INTEGER);

CREATE TABLE model_usage (
  session_id TEXT, model TEXT,
  input INTEGER, output INTEGER, cache_read INTEGER, cost REAL
);
```

一次回复 = 从当前 leaf 沿 `parent_id` 走到根（或最近 compaction checkpoint）。分支 = 新消息 `parent_id` 指向历史节点。resume/fork/rewind 全是指针操作，零数据复制。

### 4.2 并发与写入协议（继承 Hermes 经验）

1. WAL + `busy_timeout=5000` + `synchronous=NORMAL`
2. 写事务 `BEGIN IMMEDIATE`
3. 短超时 + 带抖动的应用层重试（1s 预算）
4. 每 50 次写做一次 PASSIVE checkpoint，防 WAL 膨胀
5. `compression_locks` 防止 TUI/Desktop 双端同时触发同一会话压缩
6. `api_content` BLOB 存 provider 原始字节，resume 逐字节还原请求前缀（prompt cache 命中率的根基）

### 4.3 保留与治理（防膨胀）

- `archived` 标记：移出默认列表与 FTS 查询范围（`WHERE archived=0`），数据保留
- FTS 同步修剪：归档时从两张 FTS 表删行，索引大小永远与活跃数据成正比
- `materin export` 从 DB 生成 JSONL/Markdown 冷备
- DB 超 2GB 阈值提示归档（单用户约十年量级）

---

## 5. 记忆系统（四层参考架构，分阶段落地）

> 四家光谱：Pi「不做」（文件即状态）→ OpenCode「仅静态层」→ Claude Code「静态+自维护双轨」→ Hermes「全自动闭环」。

| 层 | 管什么 | 抄谁 | 里程碑 |
|---|---|---|---|
| **静态规则层** | 项目常识 | CLAUDE.md/AGENTS.md 向上遍历拼接 + `rules/` 目录 + **合成消息注入 + 去重台账**（compaction 丢失自动补注，OpenCode 独家） | M2 |
| **策展记忆层** | 跨会话重点 | `MEMORY.md` 有界索引 + 主题文件按需读，frontmatter 四类型（user/feedback/project/reference）；**超限报错逼整理**（强制编辑，不自动压缩）；冻结快照注入保 cache | M3 |
| **检索层** | 全部历史长尾 | `session_search` 工具走 FTS5 双表——**§4 的存储选型已免费送了这一层**，~20 行接入 | M3 |
| **反思层** | 自动沉淀 | 每轮 fork 后台 review → 更新记忆，路由便宜模型，可人工审批门 | M4（验证前三层后再做） |

补充吸收 Pi 哲学：TODO/PLAN 落成项目文件（`TODO.md`/`PLAN.md`），不挤占记忆 token。

**路径门控懒加载（M3 可选）**：带 `paths:` glob 的 rules 文件，agent 触碰匹配文件时才注入（Claude Code 机制，含 `cat`/`head` 读取检测）。

---

## 6. Compaction 设计（已定稿，可直接照抄的算法）

> 本质：一次 LLM 摘要调用替换上下文视图——**存储层一字不删**，只是「构建上下文的视角」变了。压缩 = 树上追加一个自包含 entry。

```
每轮开始前:
  tokens = 上次响应的真实 usage.input（不要自己 tokenizer 估）
  if tokens > 0.85 × context_window:        # 预检提前（Hermes 阈值）
      flush_memory()                         # ① 先落盘记忆，摘要丢的检索层找得回
      compact()

compact(focus?):
  acquire compression_lock(session_id)       # 双客户端防重入
  spill_old_tool_outputs()                   # ② 大工具输出落盘换路径引用
  summary = llm_call(                        # ③ 一次摘要调用（可路由便宜模型）
      input  = history_since_last_boundary,
      prompt = STRUCTURED_TEMPLATE          # 任务状态/决策/文件改动/下一步
               + user focus + AGENTS.md summary instructions
  )
  tail = last_20_messages(工具调用对永不拆散)  # ④ 尾部原文保护
  append_compaction_entry(summary, tokens_before, retained_tail=tail)
  # ⑤ 上下文重建 = 系统提示(冻结不变) + 确定性重注入物 + summary + tail
  emit session_compact event

if 压缩后 tokens 仍 > 阈值:                    # ⑥ 防抖：重试 ≤3 次后报错终止
```

**确定性重注入表**（Claude Code 精华——「易失细节交给 LLM 摘要，结构性事实从磁盘确定性重取」）：

| 重注入物 | 说明 |
|---|---|
| AGENTS.md + 未作用域 rules | 从磁盘重读 |
| 策展记忆（MEMORY.md） | 重新注入 |
| 最近修改的 5 个文件 | 重读全文；>5K token 只给路径引用 |
| 新鲜 git status | 现场生成 |
| 已调用 skill 正文 | 5K token/skill，总 25K，最旧先丢 |
| plan 文件 | 保留 |

**三条必须做对**：
1. token 数用 provider 返回的真实 usage
2. 压缩期间系统提示一字不动（动了前缀缓存全失效）
3. 存储 append-only，压缩只加 entry（/rewind、分支、审计免费）

**可干预点**：`PreCompact/PostCompact` extension 事件；`/compact <focus>`；部分压缩（只压前半段）。

---

## 7. 里程碑

### M1 —— 核心闭环（首个可跑版本）
- [ ] Bun monorepo 骨架 + packages 结构
- [ ] `packages/core`：agent loop（单 provider anthropic-messages）+ streaming + 工具执行
- [ ] 4 个内置工具：read / bash / edit / write（TypeBox 参数校验）
- [ ] §4 schema 建表迁移（schema_version v1）
- [ ] 树形 session：创建/追加/分支/resume
- [ ] `packages/server`：Hono + SSE 总线
- [ ] `packages/tui`：最小 scrollback 渲染
- [ ] 验收标准：对话 → 执行工具 → 写文件 → 退出 → resume 续跑；分支后回放正确

### M2 —— 多模型 + 上下文工程
- [ ] `packages/ai`：wire API 抽象 + openai-completions + 国产模型 compat 表（deepseek/qwen/kimi/zai）
- [ ] 跨 provider 中途切换（thinking → `<thinking>` 文本降级）
- [ ] Compaction 全算法（§6）
- [ ] 静态规则层：AGENTS.md 层级 + 合成消息去重台账
- [ ] 权限：tool_call 阻断事件 + allow/ask/deny 规则（last-match-wins + doom_loop 检测）
- [ ] OpenAPI spec → SDK 自动生成
- [ ] 验收标准：同一会话中途切换国产模型正常续跑；长会话压缩后任务不丢线索

### M3 —— 吃痛点红利（差异化起点）
- [ ] `packages/desktop`：Tauri 2 + 图片粘贴（Cmd+V → base64 → ImageContent）+ `@` 引用 + 可视化 diff
- [ ] Input Pipeline 移入 server 层（全端一致）
- [ ] 策展记忆层（MEMORY.md 有界 + 超限报错）+ session_search（FTS5 接入）
- [ ] TUI 完整化：markdown 渲染、图片显示、主题
- [ ] Web 端（复用 ui/ 组件）
- [x] **M3 已完成（2026-10-12）**，交付与决策记录：
  - Input Pipeline 在 server 层：`@文件`（文本/图片自动识别）、`!命令`、`/compact` `/model` `/new` 命令（全端一致）
  - 策展记忆层：MemoryStore（2200 字符硬上限，超限报错逼整理，写入校验 find 唯一性）+ memory 工具 + 冻结快照注入（buildContext: rules → memory → summary → tail）
  - FTS5 检索层：消息入 fts_default + fts_trigram 双表；`session_search` 工具；`GET /search` 跨会话搜索；**短查询（<3 字符）走 JS 全扫描兜底**（trigram 分词器 3 字符下限，双字中文词靠兜底）
  - **Web 端（vanilla TS，零依赖，偏离计划的 SolidJS 决策）**：`bun build` 单包构建，session 列表/消息渲染（代码块/图片/edit diff 红绿块）/剪贴板粘贴图片（paste → base64 → chip → ImageContent）/SSE 流式/权限 confirm 对话框/搜索框；server 静态服务 `/ui/`
  - Tauri Desktop 脚手架（packages/desktop，配置就绪未构建，需 Rust 工具链）
  - **重要修复**：Bun.serve 默认 idleTimeout 10s 会杀 SSE 长连接 → 两处 Bun.serve 加 `idleTimeout: 255` + ping 间隔 9s
  - 浏览器端到端验证（chrome devtools 实测）：粘贴 1x1 png → chip → 提交 → 消息落库 `[image, text]` → SSE 实时渲染 ✅；中文搜索 ✅
- [ ] 遗留：Tauri 实际构建；Web 端 markdown 完整渲染；TUI 图片显示

### M4 —— Channel Gateway（已完成 2026-10-12）
> 决策记录：三平台按会话路由（群按群/单聊按人，userId 审计）；飞书最完整；安全默认档渠道会话 bash/write/edit 全 deny。
- [x] `packages/gateway`：ChannelAdapter 统一接口 + gateway_routing 路由（v3 迁移建的表）+ 会话级串行队列（忙碌排队）+ 非流式回复（ack → 累积最终文本 → 4000 字截断）
- [x] 飞书：官方 SDK WebSocket 长连接（免公网 IP），@提及剥离、图片下载（5MB 上限、失败文本回退）
- [x] 钉钉：Stream 模式 + 回复走 OpenAPI（access token 缓存；sessionWebhook 弃用因其回合作用域）
- [x] 企微：自建应用回调（AES-256-CBC + sha1 签名，纯函数全测）+ 主动发消息（wr 前缀判群聊）
- [x] console 适配器（本地测试）；`bun run gateway` 二进制按环境变量注册适配器
- [x] 安全默认档：渠道会话默认 bash/write/edit deny，`MATERIN_CHANNEL_PERMISSIONS` 覆盖
- [x] 测试 15 个（路由/队列/加密/三平台解析器/全链路），总计 63/63
- [ ] **诚实边界：真实平台连通性未验证**（需企业应用凭据），README 有逐步配置指引
- [ ] 遗留至 M5：Extension 总线完整化 + Skill 标准 + Subagent + 反思层 + 分发

### M5 —— 生态与分发（已完成 2026-10-12）
- [x] Extension 总线：Bun 原生 TS import（零依赖，不用 jiti）；registerTool / registerCommand / 事件订阅 / **interceptToolCall 权限门**；`POST /extensions/reload` 热重载；项目级扩展需 `trust.json` 门控；坏扩展隔离（不拖垮加载）
- [x] Skill：agentskills.io 格式（frontmatter 解析零依赖）；**独立目录原则（用户决策）**：运行时只认 `~/.materin/skills/` + `<cwd>/.materin/skills/`，`.claude/.agents/opencode` 不做运行时兼容；`materin init` 一次性迁移导入（整目录拷贝、重名跳过 --force 覆盖、源目录零改动、幂等可重跑）
- [x] Subagent：`task` 工具 → child session（parent_session_id 血缘 + source='subagent'），`subagent_depth` 默认 1 防递归
- [x] 反思层：回合后 review → 记忆操作 JSON → MemoryStore.apply；默认关闭（`MATERIN_REFLECTION=1`），异常永不打断主流程
- [x] 分发：`bun build --compile` 三二进制（materin/materin-server/materin-gateway，Mach-O arm64 实测 `--version` 输出）+ install.sh（本地构建路径，无 release 下载）
- [x] 验收标准达成：官方扩展示例 15/12/6 行（<50 行标准）实现自定义工具 + 权限门；83/83 测试全绿
- [ ] 遗留：TUI 内嵌 server 未接 task 工具/扩展（server/gateway 已接）；真实渠道连通性待凭据

### M5.1 增强（2026-10-12）
- [x] 模型 TIER 别名（Claude Code 风格短名）: `ALIASES` 表 opus/sonnet/haiku/deepseek/deepseek-r1/qwen/kimi/glm；`resolveModel()` 返回 canonical id；新增 `claude-haiku-4-5` 注册；`getModel` 解析顺序 = 精确命中 → 别名链（限深）→ 前缀兜底
- [x] `listAvailableModels()` + `GET /models`（含 env 配置状态）；`/model` 无参返回模型列表而非报错；`/model <alias>` 与 `POST /session/:id/model` 均存 canonical id
- [x] 思考深度: `thinking_level` 会话列（v4 迁移, 默认 off）+ `normalizeThinking` 边界归一化 → `StreamContext.thinkingLevel`；Claude 走 `thinking.budget_tokens`（low 4096 / medium 8192 / high 16384 / xhigh 32768, max_tokens 抬到 budget+4096）；OpenAI 兼容按 compat.thinkingFormat 分派（reasoning_effort / enable_thinking / thinking.type）
- [x] `/thinking <level>` 命令 + `POST /session/:id/thinking`；`packages/ai/test` 进根 test script（106/106 全绿）
- [ ] 遗留：TUI 内嵌 server 同步接 /thinking；真实模型连通性待凭据

---

## 8. 待决问题（Open Questions）

1. **项目名**：暂用 materin（repo 目录名），是否定名待定
2. **TUI 起步是否自研**：M1 可先用最简实现验证 loop，差分渲染 M2 再投入
3. **Provider 起步顺序**：anthropic 先（自己主力用），还是先做 openai-compatible（覆盖国产面广）——建议 anthropic 先，compat 表 M2 一次到位
4. **权限默认值**：OpenCode 式默认放行 vs Claude Code 式默认询问——M1 建议 YOLO（开发期效率），M2 上权限层时再定默认档
5. **Desktop 时机**：M3 才做 Desktop，但图片粘贴的**协议**（消息 content blocks 携带 base64）必须 M1 就定对，否则返工

---

## 9. 参考资料

- pi: github.com/badlogic/pi-mono · mariozechner.at（2025-11-30 最小 agent 设计复盘 / 2025-11-02 MCP 批判 / 2025-08-15 MCP vs CLI benchmark）
- OpenCode: opencode.ai/docs · github.com/anomalyco/opencode（core/src/session/sql.ts、models-dev.ts、snapshot.ts）
- Claude Code: code.claude.com/docs（memory / skills / hooks / sessions / how-claude-code-works）· anthropic.com/engineering（building-effective-agents / claude-agent-sdk / claude-code-auto-mode）
- Hermes: hermes-agent.nousresearch.com/docs/developer-guide/（architecture / agent-loop / session-storage / memory / micro-compaction）
- Agent Skills 标准: agentskills.io/specification
- 模型目录: models.dev
