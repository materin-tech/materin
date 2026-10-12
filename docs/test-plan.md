# Materin 测试计划

> 日期：2026-10-12
> 配套：docs/development-plan.md（M1–M5.1 + post-release）
> 三层测试体系：单元（129 项）→ E2E API（15 项）→ 冒烟（14 项检查）

---

## 1. 测试策略

### 1.1 三层结构

| 层 | 位置 | 数量 | 特点 |
|---|---|---|---|
| 单元 | packages/core/test · packages/gateway/test · packages/ai/test | 129 | faux provider（脚本化 StreamEvent，无网络）；权限/加密/解析器纯函数全测 |
| E2E API | packages/e2e/test（3 个文件） | 15 | 进程内 Hono app + Bun.serve({port:0})，真实 HTTP/SSE；faux provider 走完整 server 装配（store 总线 权限 工具） |
| 冒烟 | scripts/smoke.ts（`bun run smoke`） | 14 项检查 | 真实产物：dist 二进制 + 真实 server 子进程 + TUI/gateway CLI；无 unit mock |

### 1.2 环境要求

- **无真实 key（默认）**：provider 层一律用 faux provider（pi 范式，脚本化 `StreamEvent[]`）；E2E 与单元测试完全离线、确定性。
- **冒烟**：`ANTHROPIC_API_KEY=sk-smoke-dummy`（只用于启动校验，不发起真实请求）；隔离 `MATERIN_HOME`（mkdtemp）+ 随机端口，不污染 `~/.materin`。
- **有 key 时手动 UAT 清单**（发版前跑一遍）：
  1. 真实 anthropic 对话 → 工具 → 写文件 → resume 续跑
  2. 国产模型（deepseek/qwen/kimi/glm）各一轮对话 + 中途切换续跑
  3. thinking 档位 low/medium/high/xhigh 真实生效（观察 budget_tokens / reasoning_effort）
  4. compaction：超长会话触发压缩，任务线索不丢
  5. Web 端剪贴板粘贴 1x1 png → chip → 提交 → 消息 `[image, text]` → SSE 流式渲染
  6. FTS 中文搜索真实数据检索（双字词兜底）

---

## 2. 按里程碑的测试用例矩阵

> 自动化状态：**自动** = `bun test` 覆盖；**冒烟覆盖** = `bun run smoke` 覆盖；**手动** = 人工验证。
> 结果列：✅ = 当前全绿。单元测试文件与用例的对应关系见"验证方式"列。

### M1 —— 核心闭环

| 用例ID | 功能 | 验证方式 | 自动化状态 | 结果 |
|---|---|---|---|---|
| M1-01 | loop：对话→执行工具→写文件→resume 续跑 | core/test/loop.test.ts | 自动 | ✅ |
| M1-02 | agent 生命周期事件顺序 agent_start→…→agent_end | core/test/loop.test.ts | 自动 | ✅ |
| M1-03 | 非法工具参数 → isError toolResult（模型可重试） | core/test/loop.test.ts | 自动 | ✅ |
| M1-04 | 树形 session：创建/追加/分支/resume/usage 累计 | core/test/session.test.ts | 自动 | ✅ |
| M1-05 | 4 内置工具 read/bash/edit/write + TypeBox 参数校验 | core/test/tools.test.ts | 自动 | ✅ |
| M1-06 | 消息重放/replayFilter 上下文组装 | packages/ai + core replay 相关用例 | 自动 | ✅ |
| M1-07 | E2E：HTTP session 生命周期（201/列表/roundtrip/404） | e2e T1 (server-e2e.test.ts) | 自动 | ✅ |
| M1-08 | E2E：prompt→202→轮询消息 [user, assistant]；SSE 收到 agent_start/agent_end | e2e T2 (server-agent-e2e.test.ts) | 自动 | ✅ |
| M1-09 | E2E：abort → assistant stopReason='aborted'，运行不悬挂套件 | e2e T10 (server-agent-e2e.test.ts) | 自动 | ✅ |

### M2 —— 多模型 + 上下文工程

| 用例ID | 功能 | 验证方式 | 自动化状态 | 结果 |
|---|---|---|---|---|
| M2-01 | openai-completions wire API 请求/响应映射 | ai/test/openai-mapping.test.ts | 自动 | ✅ |
| M2-02 | compat 表、getModel 解析顺序（精确→别名→前缀） | ai/test/compat.test.ts | 自动 | ✅ |
| M2-03 | compaction：摘要 entry、尾部保护、防抖重试 | core/test/compaction.test.ts | 自动 | ✅ |
| M2-04 | 权限规则 allow/ask/deny、last-match-wins、doom-loop | core/test/permissions.test.ts | 自动 | ✅ |
| M2-05 | 权限模式四档决策矩阵（plan/manual/auto/passon × 规则） | core/test/modes.test.ts · mode-loop · mode-session | 自动 | ✅ |
| M2-06 | 静态规则层 AGENTS.md 层级收集 | core/test/rules.test.ts | 自动 | ✅ |
| M2-07 | 跨 provider replay（thinking 降级、内容过滤） | packages/ai replay 用例 | 自动 | ✅ |
| M2-08 | E2E：mode 对工具的真实效果——plan 拦截 write（"plan mode is read-only"），passon 真写文件 | e2e T4 | 自动 | ✅ |
| M2-09 | E2E：permission_mode 持久化 + /mode、/plan 命令 HTTP | e2e T3 + mode-session.test.ts | 自动 | ✅ |

### M3 —— 吃痛点红利（Input Pipeline / 记忆 / Web）

| 用例ID | 功能 | 验证方式 | 自动化状态 | 结果 |
|---|---|---|---|---|
| M3-01 | 输入管线 @引用 / !shell / /命令 解析（server 层，全端一致） | core/test/input-pipeline.test.ts | 自动 | ✅ |
| M3-02 | FTS5 双表检索 + 中文 2 字词 JS 兜底 | core/test/search.test.ts | 自动 | ✅ |
| M3-03 | 记忆层 MemoryStore 限额/校验/快照 | core/test/memory.test.ts | 自动 | ✅ |
| M3-04 | E2E：@ 不存在文件保留原始 token；images → content[0].type=image；非法 mime → 400 | e2e T6 (server-input-e2e.test.ts) | 自动 | ✅ |
| M3-05 | E2E：跨会话 /search 与会话内 /session/:id/search（含中文检索） | e2e T7 | 自动 | ✅ |
| M3-06 | E2E：/session/:id/files @补全文件列表 | e2e T8 | 自动 | ✅ |
| M3-07 | E2E：/openapi.json paths + /ui/ 静态 SPA（dist 缺失优雅跳过） | e2e T9 | 自动 | ✅ |
| M3-08 | Web 端剪贴板粘贴图片端到端（paste→base64→chip→[image,text]） | 浏览器手工流程（开发期 chrome devtools 已实测 ✅） | 手动 | — |
| M3-09 | TUI 渲染/markdown/图片显示 | 人工目测 | 手动 | — |

### M4 —— Channel Gateway

| 用例ID | 功能 | 验证方式 | 自动化状态 | 结果 |
|---|---|---|---|---|
| M4-01 | gateway_routing 路由（群按群/单聊按人） | gateway/test/routing.test.ts | 自动 | ✅ |
| M4-02 | 会话级串行队列 + 忙碌排队 | gateway/test/gateway.test.ts | 自动 | ✅ |
| M4-03 | 企微 AES-256-CBC + sha1 签名（纯函数） | gateway/test/wecom-crypto.test.ts · wecom-xml | 自动 | ✅ |
| M4-04 | 飞书/钉钉/企微三平台消息解析器 | gateway/test/feishu · dingtalk · wecom-xml | 自动 | ✅ |
| M4-05 | daemon 生命周期 start/stop/status/logs | gateway/test/gateway.test.ts | 自动 | ✅ |
| M4-06 | 安全默认档：渠道会话 bash/write/edit deny，env 覆盖 | gateway/test/gateway.test.ts | 自动 | ✅ |
| M4-07 | 启动校验：无渠道配置退出 1 并给指引 | smoke gateway 检查 | 冒烟覆盖 | ✅ |
| M4-08 | 真实渠道连通性（飞书 WS/钉钉 Stream/企微回调） | 需企业应用凭据 | 手动 | — |

### M5 —— 生态与分发

| 用例ID | 功能 | 验证方式 | 自动化状态 | 结果 |
|---|---|---|---|---|
| M5-01 | extension 加载 + 坏扩展隔离（不拖垮加载） | core/test/extensions.test.ts | 自动 | ✅ |
| M5-02 | interceptToolCall 权限门 + registerTool/Command | core/test/extensions.test.ts | 自动 | ✅ |
| M5-03 | skill 发现 + frontmatter 解析 + listing | core/test/skills.test.ts | 自动 | ✅ |
| M5-04 | materin init 迁移导入（幂等、--force、源目录零改动） | core/test/migrate.test.ts | 自动 | ✅ |
| M5-05 | subagent：task 工具、parent_session_id 血缘、深度限制 | core/test/subagent.test.ts | 自动 | ✅ |
| M5-06 | 反思层：回合后 review→记忆 apply，异常不打断主流程 | core/test/reflection.test.ts | 自动 | ✅ |
| M5-07 | 单二进制 --version（dist/materin） | smoke TUI 检查 | 冒烟覆盖 | ✅ |

### M5.1 —— 增强

| 用例ID | 功能 | 验证方式 | 自动化状态 | 结果 |
|---|---|---|---|---|
| M5.1-01 | 模型 TIER 别名（opus/sonnet/…）→ canonical id | ai/test/compat.test.ts + e2e T3 (/model sonnet) | 自动 | ✅ |
| M5.1-02 | thinking 档位 normalizeThinking 边界归一化 | ai/test/thinking.test.ts · loop-thinking · thinking-session | 自动 | ✅ |
| M5.1-03 | E2E：/thinking high → StreamContext.thinkingLevel 透传 provider | e2e T5 (server-input-e2e.test.ts) | 自动 | ✅ |

### Post-release

| 用例ID | 功能 | 验证方式 | 自动化状态 | 结果 |
|---|---|---|---|---|
| P-01 | onboarding 交互引导（无 key 启动） | core/test/config.test.ts 覆盖配置读写；完整交互流程 | 手动 | — |
| P-02 | -d/MATERIN_HOME 数据目录隔离 | smoke：server 与 TUI/gateway 全用 mkdtemp 隔离 | 冒烟覆盖 | ✅ |
| P-03 | reset 子命令 --yes 创建+删除 config | smoke TUI reset 检查 | 冒烟覆盖 | ✅ |
| P-04 | mode 四档 Shift+Tab 循环（TUI） | Bun stdin keypress bug → 不可靠；可靠路径为 /mode 命令 | 手动（见 §4 风险） | — |
| P-05 | /mode、/model、/new 等命令 HTTP 面 | e2e T3 | 自动 | ✅ |
| P-06 | GUI @补全 / 文件粘贴 / 可视化 diff | 待 Desktop 构建（Tauri 需 Rust 工具链） | 手动 | — |

**用例统计**：M1=9 · M2=9 · M3=9 · M4=8 · M5=7 · M5.1=3 · Post-release=6，共 **51** 项（自动 40 / 冒烟覆盖 4 / 手动 7）。

---

## 3. 冒烟脚本说明（bun run smoke）

- 耗时 ~10s；全部使用真实产物，无 unit mock，每项检查独立 try/catch（单项失败不中断）。
- Step 1 Web 构建：packages/web/dist 缺失时自动 `bun run web:build`，已存在则跳过。
- Step 2 真实 server：优先 `dist/materin-server` 二进制，缺则回退 `bun run packages/server/src/index.ts`；
  隔离 `MATERIN_HOME`（mkdtemp）、`MATERIN_PORT`（探测可用端口）、`ANTHROPIC_API_KEY=sk-smoke-dummy`、
  `MATERIN_WEB_ROOT`（编译二进制的 import.meta.dir 指向可执行文件旁，需显式指向仓库 web/dist）。
- Step 3 API 检查：`/` 200、`/openapi.json` paths、POST /session 201、`/model sonnet`→canonical、
  `/thinking high`、`/mode passon`、`/models`、prompt `hello @nope.png`→202+token 保留（轮询 ≤5s）、
  `/search?q=hello` ≥1 命中、`/ui/` 200 HTML。
- Step 4 CLI 检查：`materin --version` 输出 `materin <ver>`（dist 二进制优先）；隔离 HOME 下
  `reset --yes` 创建+删除 config.json；无渠道配置的 gateway 退出码 1 并输出渠道指引。
- 输出：逐项 ✅/❌ + 末行 `SMOKE: PASS (n/m)` 或 `SMOKE: FAIL`，退出码 0/1。

## 4. 已知问题与风险

1. **Bun stdin keypress bug**：Bun 的 readline 不派发 keypress 事件，TUI 的 Shift+Tab 逐键检测
   （_ttyWrite 拦截）在部分终端不可靠 → 审批模式切换的可靠路径是 `/mode <mode>` 命令（HTTP 面，e2e 已覆盖）。
2. **真实渠道连通性需凭据**：飞书/钉钉/企微的解析器、加密、路由、队列均已自动化（15 gateway 单测），
   但真实平台连通从未验证——发版前需凭据做一次手动 UAT（M4-08）。
3. **Linux 平台包待 CI**：`bun build --compile` 三二进制仅在 macOS arm64 实测；Linux 产物与安装脚本
   需 CI 矩阵覆盖后才算分发验收。
4. **编译二进制路径语义**：--compile 后 import.meta.dir 指向可执行文件目录，`/ui/` 静态服务依赖
   MATERIN_WEB_ROOT 或相对布局（冒烟脚本已显式设置；打包安装时需保证 web/dist 相对位置）。
5. **环境变量敏感**：`configuredProviders` 会识别 `ANTHROPIC_AUTH_TOKEN` 等环境变量——若运行测试的 shell
   携带任何 provider key/token（例如 AI 开发工具注入的代理 token），core/test/config.test.ts 的 4 个
   onboarding 用例会因"检测到已配置"而失败。干净终端/CI 无此问题；受污染环境可
   `env -u ANTHROPIC_AUTH_TOKEN bun test …` 复现绿。冒烟脚本对子进程显式传 dummy key，不受影响。

## 5. 回归清单（发版前必跑）

```bash
bunx tsc --noEmit                                   # 类型零错误
bun test packages/core/test packages/gateway/test packages/ai/test packages/e2e/test   # 144 全绿
bun run smoke                                       # SMOKE: PASS (14/14)
```

外加 §1.2 的「有 key 时手动 UAT 清单」与 M4-08 渠道连通性验证。
