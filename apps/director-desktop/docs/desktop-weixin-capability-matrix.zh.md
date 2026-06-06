# 桌面端与微信端能力同步矩阵

核对时间：2026-05-22

## 1. 结论

桌面端和微信端不是同一个 UI，但已经共享一批底层能力。

- 已同步的是 runtime、URL 学习、候选隔离、经验/知识/Skill/制作等后端能力。
- 微信端已补 `/帮助` / `/能力` 和 `/状态`，可在不调用模型的情况下查看可用命令和通道状态。
- 未同步的是 Electron 前端能力，例如键盘快捷键、Run Center 可视化、设置页、证据卡片和后台学习 UI 卡片。
- 微信端适合做文字命令、确认回复和状态查询，不应该照搬桌面端三栏 UI。
- 微信端依赖桌面浏览器能力时，必须先有桌面端运行并写入 `learningFetchUrl` / `browserToolUrl`。

## 2. 可用性等级

| 等级 | 含义 |
| --- | --- |
| 已可用 | 微信端已有对应入口或复用统一 runtime，用户可直接通过微信使用。 |
| 部分可用 | 后端能力存在，但微信入口、状态展示、权限或依赖条件不完整。 |
| 桌面专属 | 属于 Electron 前端交互，不适合直接同步到微信。 |
| 待补 | 需要新增微信命令、网关路由或 Host API 收口。 |

## 3. 能力矩阵

| 能力 | 桌面端入口 | 微信端状态 | 微信端入口或依赖 | 证据 |
| --- | --- | --- | --- | --- |
| 普通对话 runtime | 工作台 composer | 已可用 | 微信消息进入 `runConversationRuntimeTurn` | `apps/weixin-gateway/src/adapter.ts` 导入并调用 conversation runtime。 |
| URL 学习 | `/学习 <URL>`、URL 自动识别 | 已可用 | 自然 URL、`director.learning.url`、`/学习 URL` | 微信端 `runWeixinDirectUrlLearning()` 与 `orchestrateConversationRuntimeUrlLearningRead()`。 |
| URL 学习候选隔离 | 桌面候选确认 | 已可用 | 微信端生成 pending artifact，用户确认后才保存 | `createPendingLearningArtifactFromResult()`、`createConversationRuntimeLearningArtifactProjection()`。 |
| 低质量网页 fail-closed | 桌面 URL 学习质量门 | 已可用 | 微信端低质量来源返回中文卡点，不说学到了 | 微信端 blocked reply 与 URL 学习质量门执行板。 |
| 经验候选列表 | 经验库页面、`/经验` | 已可用 | `/经验 列表` / `experience.list` | 微信 command switch 覆盖 `experience.list`。 |
| 经验接受/拒绝/晋升 | 经验库按钮、slash | 已可用 | `/经验 接受/拒绝/晋升 <candidateId>` | 微信 command switch 覆盖 `experience.accept/reject/promote`。 |
| 知识候选列表 | 知识/经验页面 | 已可用 | `/知识 候选` / `knowledge.candidates` | 微信 command switch 覆盖 `knowledge.candidates`。 |
| 知识接受/拒绝/发布 | 桌面按钮、slash | 已可用 | `/知识 接受/拒绝/发布 <packId>` | 微信 command switch 覆盖 `knowledge.accept/reject/publish`。 |
| 知识召回预览 | 桌面召回面板 | 已可用 | `/知识 召回` | 微信 command switch 覆盖 `knowledge.recallPreview`。 |
| Skill 从经验生成候选 | Skills 页面 | 已可用 | `/技能 从经验 <candidateId>` | 微信 command switch 覆盖 `skills.proposeFromExperience`。 |
| Skill 列表/审核/应用 | Skills 页面 | 已可用 | `/技能 列表/接受/拒绝/应用 <proposalId>` | 微信 command switch 覆盖 `skills.list/accept/reject/apply`。 |
| ComfyUI 工作流草稿 | 桌面 ComfyUI 设置/执行 | 部分可用 | `/ComfyUI 脚本+图片+视频 <目标>` 等 | 微信端能生成草稿并上传模板，但不是完整桌面 UI。 |
| ComfyUI 直接运行 | 桌面外部工具执行 | 部分可用 | `/ComfyUI <prompt>` | 微信端可调用 `runDirectorComfyUiWorkflow`，但执行前仍需外部工具状态可用。 |
| 运行/制作 | `/制作 ...`、运行与审查 | 已可用 | `/制作 ...`、`/运行 状态/中止/继续` | 微信端经 Host API / channel turn 创建制作运行并可停止。 |
| 长期记忆状态/治理 | 设置页/命令 | 部分可用 | `/记忆`、`memory.status`、`memory.recallPreview` | 微信 command switch 覆盖 memory status/recall，治理能力按权限收口。 |
| 工具审批 | 桌面审批面板 | 已可用 | 微信回复确认/拒绝 | 微信端支持 `parseChannelRuntimeToolApprovalIntent()` 与 approval decision。 |
| 微信能力帮助 | 桌面命令目录/帮助 | 已可用 | `/帮助`、`/能力`、`帮助`、`能力` | 微信端本地短路输出可用命令，不依赖模型或 Host API。 |
| 微信系统状态摘要 | 桌面状态栏/运行中心/设置状态 | 已可用 | `/状态`、`系统状态`、`通道状态` | 微信端本地摘要微信网关、Host API、桌面浏览器桥、模型通道；`/运行 状态` 仍保留制作运行状态语义。 |
| 微信学习/证据状态摘要 | 桌面后台学习卡片/证据 disclosure | 已可用 | `/学习 状态`、`学习状态`、`后台学习` | 微信端显示最近学习来源、候选数、证据数、读取状态、入库边界，并只读桌面后台学习 runtime SQLite 摘要。 |
| 浏览器读取 | 桌面 BrowserWindow/browser tool service | 部分可用 | 依赖桌面端写入 `DIRECTOR_BROWSER_TOOL_URL` 或配置文件 | Electron main 写入 `learningFetchUrl` / `browserToolUrl`，微信端读取该配置。 |
| 后台定时学习执行 | 桌面后台 runtime | 部分可用 | 底层 schedule policy 共享，但微信没有 UI 卡片 | 当前 UI smoke 是桌面端；微信端没有后台学习卡片。 |
| Run Center 可视化 | 桌面右侧/运行中心 | 桌面专属 | 不适合直接同步 | 微信端应提供 `/运行 状态` 文字摘要。 |
| 证据卡片/折叠 disclosure | 桌面 timeline/inspector | 桌面专属 | 微信端只能发简洁文本摘要 | 微信没有 DOM 卡片；可同步文案规则，不同步 UI。 |
| 设置页 | 桌面 Settings | 桌面专属 | 微信端只保留少量安全命令 | Key、路径、MCP、外部工具配置不应完整暴露到微信。 |
| 键盘快捷键 | Electron renderer | 桌面专属 | 无 | `Cmd/Ctrl+K`、`Esc` 等只对桌面端有意义。 |
| 多栏导航/资产详情页 | Electron renderer | 桌面专属 | 无 | 微信端用命令和短回复替代。 |

## 4. 微信端当前短板

1. `/学习 状态` 目前是文字摘要，不是桌面证据卡片；媒体数量、字符数等更细字段还取决于学习 artifact 是否保存。
2. 微信端对 ComfyUI、外部工具、浏览器桥接依赖桌面端运行，失败原因需要继续人话化。
3. 桌面端新增功能时，没有强制更新这份矩阵，容易出现“桌面有了，微信没人知道”的漂移。

## 5. 同步原则

- 先同步业务能力，再考虑展示形式。
- 微信端只接安全的文字命令和确认流，不复制桌面 UI。
- 高风险动作必须保留确认和权限边界。
- 依赖桌面本机资源的能力必须明确提示“需要桌面端在线”。
- 桌面端新增 P0/P1 能力时，同时更新本矩阵的微信状态。

## 6. 建议下一步

P0：

- 已完成 `/帮助` / `/能力` 微信命令，输出当前可用能力清单。
- 已完成 `/状态` 微信命令，区分模型、微信网关、桌面浏览器桥、Host API。

P1：

- 已完成 `/学习 状态` 微信摘要：最近学习、证据数、读取状态、候选边界、后台学习 job/schedule。
- 后续可继续细化：字符数、媒体数量、媒体理解边界等更细证据字段。

P2：

- 做自动回归：桌面新增 command/action 时，检查是否需要微信入口或矩阵说明。
