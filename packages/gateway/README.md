# @materin/gateway

渠道网关: 把飞书 / 钉钉 / 企业微信 / 本地 console 的消息接入 materin agent。

Gateway 是「入站适配层 + 会话路由表 (`gateway_routing`) + 非流式回复」——
它是 SSE 总线的另一个消费者 + 入站推送者，**不是新的大脑**。

```
渠道消息 → ChannelAdapter → Gateway
  ├─ gateway_routing 表路由到 (channel, chatId, userId) 对应的 session（不存在则创建, cwd='/'）
  ├─ per-session 串行队列: 同一会话忙碌时新消息入队并提示
  └─ AgentSession.prompt → 汇总 text delta → 回复渠道（>4000 字符截断）
```

## 运行

```bash
bun run gateway
```

按环境变量注册渠道；一个都没配时打印帮助并退出 1。

## 渠道接入

### 飞书 (Feishu)

1. 在 [open.feishu.cn](https://open.feishu.cn) 创建企业自建应用，添加「机器人」能力
2. 权限: `im:message`（读取与发送单聊/群聊消息）、获取与上传图片或文件
3. 事件: 订阅 `im.message.receive_v1`，连接方式选 **长连接**（无需公网 IP）
4. 环境变量:

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

### 钉钉 (DingTalk)

1. 在 [open-dev.dingtalk.com](https://open-dev.dingtalk.com) 创建企业内部应用 + 机器人
2. 消息接收模式选 **Stream 模式**（无需公网 IP），订阅机器人消息
3. 机器人必须被 @（文本前缀 @mentions 会被剥离）
4. 程序化回复走 reply API，需要机器人有「企业内部机器人」权限（企业内部应用默认具备）
5. 环境变量:

```bash
DINGTALK_APP_KEY=xxx
DINGTALK_APP_SECRET=xxx
```

### 企业微信 (WeCom)

1. 在 [work.weixin.qq.com](https://work.weixin.qq.com) 创建自建应用
2. 回调 URL 配置为 `https://<公网地址>/wecom/callback`（需要公网 https，推荐 frp / ngrok 反代到 `MATERIN_WECOM_PORT`，默认 4190）
3. 令牌与密钥在回调配置页生成: Token + EncodingAESKey（43 字符）
4. 环境变量:

```bash
WECOM_CORP_ID=xxx
WECOM_CORP_SECRET=xxx      # 应用 Secret（发消息 / 拉取媒体用）
WECOM_AGENT_ID=1000002
WECOM_TOKEN=xxx
WECOM_ENCODING_AES_KEY=xxx # 恰好 43 字符
MATERIN_WECOM_PORT=4190    # 可选
```

### Console (本地冒烟测试)

```bash
MATERIN_GATEWAY_CONSOLE=1 bun run gateway
printf 'hello\n' | MATERIN_GATEWAY_CONSOLE=1 bun run gateway
```

## 安全模型（重要）

渠道消息是**远程文本输入**，与本地 CLI 不同: 任何能加机器人好友 / 进群的人都能驱动 agent。
因此 channel 会话默认使用受限权限档（restricted profile）:

```bash
# 默认: 拒绝 bash / write / edit —— 渠道会话只读问答
MATERIN_CHANNEL_PERMISSIONS='bash:deny;write:deny;edit:deny'
# 放开示例（自担风险）:
MATERIN_CHANNEL_PERMISSIONS='bash:deny:rm *;bash:allow:*;write:deny;edit:deny'
```

规则语法: `tool:action[:pattern];...`（last-match-wins, 见 `@materin/core` permissions）。
Gateway 本身**不创建** PermissionManager —— 由 binary 注入；`packages/gateway/src/gateway.ts`
只接受可选的 `permissions` 依赖，以便测试或嵌入式使用时保持中立。
