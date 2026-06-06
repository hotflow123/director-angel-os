# Channel Adapter Contract

更新时间：2026-05-03

这份契约给后续接入飞书、Telegram、Slack、网页聊天、语音入口时使用。原则只有一句：渠道只负责收发和格式转换，Director Angel 的意图判断、经验召回、Skill 召回、长期记忆、学习准入、ComfyUI/外部工具编排和制作任务只能走共享编排层。

## 1. 入站边界

每个渠道 adapter 必须把平台消息归一成标准输入，再交给 `orchestrateConversationTurn` 或 Host API `/v1/entry/message`：

- `channel`：平台标识，例如 `weixin`、`feishu`、`telegram`。
- `agentId`：当前接收消息的 Angel，例如 `director-angel`。
- `peerId`：平台用户、群、会话的稳定 ID。
- `routeKind`：私聊用 `direct`，群/线程用 `thread`。
- `threadId` / `baseSessionId`：只有线程消息需要。
- `messageId`：平台原始消息 ID。
- `receivedAtMs`：收到消息的本机时间。
- `text`：清洗后的用户文本。
- `metadata`：平台原始信息、附件摘要、账号 ID、来源设备等。

adapter 可以处理附件上传、二维码登录、验证码、消息限流和失败重试，但不允许直接读取经验库、Skill、长期记忆、ComfyUI 或模型供应方。

## 2. 出站边界

普通用户只接收 `ConversationTurnResult.userText` 或下游执行产物的人话版结果。

下面这些内容默认不能发给普通用户，只能进桌面端开发者详情、运行审查或日志：

- `operatorTrace`
- `capabilityPlan`
- 完整 `recallTrace`
- 内部 blueprint/run/report/assignment ID
- 完整 hidden prompt block
- 原始长期记忆全文
- API key、token、cookie、二维码登录密钥

如果平台有长度限制，adapter 只负责分段发送，不改写业务判断。

## 3. 能力调用颗粒度

用户不需要手动选择经验或 Skill。执行链路按以下顺序处理：

1. 渠道 adapter 生成标准消息信封。
2. `ConversationTurnOrchestrator` 判断是闲聊、制作、学习、确认/补充、运行控制、管理命令还是外部工具任务。
3. 需要上下文的任务调用 `resolveDirectorWorkspaceCapabilityContext`。
4. 召回只注入 bounded hidden context：
   - 经验/知识：按 surface policy 限制条数和字符数。
   - Skill：只加载已批准且已启用的匹配 Skill section。
   - 长期记忆：只注入压缩信号，不注入原始长历史。
5. 低信号闲聊不进入经验候选或长期记忆。
6. 学习和自我反思只生成待审候选，不能绕过审核直接发布。

## 4. Platform Checklist

新增渠道必须完成这些项：

- 实现登录/鉴权状态展示。
- 实现入站消息解析到 `ChannelTransportEnvelope` 或等价 `ConversationTurnInput`。
- 使用 `buildChannelSessionKey` 或 `resolveChannelSessionTarget` 生成稳定会话。
- 支持 active session 补充和确认，不把“确认执行，内容是...”当新任务。
- 普通回复只发送用户结果，不泄露 trace。
- 长内容分段发送。
- 附件只传摘要和引用，原文件处理交给学习/工具链。
- 错误回复说人话：未登录、未连接、后端不可达、任务需桌面审查。
- 写测试覆盖：闲聊、制作、补充、确认、学习、ComfyUI、低价值垃圾输入、后端失败。

## 5. 禁止事项

- 禁止每个渠道自建一套 slash 命令树。
- 禁止每个渠道自建经验召回、Skill 匹配、记忆写入或模型 prompt 拼接。
- 禁止普通闲聊因为包含“学习”“制作”等词就进入经验库。
- 禁止 AI 生成结果直接成为经验，必须经过质量评估、提炼、审核和发布。
- 禁止多个外部记忆后端同时向同一轮对话注入上下文。

## 6. 最小 Feishu/Telegram 接入形态

飞书和 Telegram 的第一版只需要做到：

1. 收到文本消息。
2. 转成标准信封。
3. 调 `/v1/entry/message`。
4. 根据 Host API 返回结果发送 `userText`。
5. 后台记录 delivery status 和错误原因。

二维码、群聊权限、附件、富文本、按钮和流式消息可以作为第二阶段，不应阻塞统一大脑接入。
