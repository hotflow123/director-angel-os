# Director Angel 桌面端系统功能适配自检

目标：围绕当前 Codex 风格桌面设计，检查现有系统能力是否能支撑 UI，并明确防止代码变成屎山的边界。

多端同步情况见：[桌面端与微信端能力同步矩阵](./desktop-weixin-capability-matrix.zh.md)。

## 1. 结论

当前设计图里的核心能力可以接上系统，但必须通过一层干净的 Desktop Bridge。

不能做：

- renderer 直接拼 `hotflow director ...` 命令。
- renderer 直接读写 `.director-angel` 文件。
- UI 通过解析 CLI stdout 来判断业务状态。
- 把学习、审查、晋升、发布、召回逻辑复制到桌面端。

应该做：

- UI 只发 typed action。
- Desktop Bridge 调用现有 TypeScript helper / store / host API。
- 所有副作用集中在 bridge/main process。
- renderer 只渲染状态，不拥有业务规则。

## 2. 设计图功能到系统能力映射

| UI 区域 | UI 动作 | 现有系统能力 | 当前可用性 | 推荐接法 |
| --- | --- | --- | --- | --- |
| 左侧学习来源 | 添加桌面目录 | `learnDirectorExperience(... directories)` | 可用 | Bridge 调 helper |
| 左侧学习来源 | 添加网页主题 | `learnDirectorExperience(... queries)` | 可用 | Bridge 调 helper |
| 左侧学习来源 | 添加 URL | `learnDirectorExperience(... urls)` | 可用 | Bridge 调 helper |
| 中央流式区 | 显示学习结果 | `FileExperienceStore.listCandidates` / CLI helper | 可用 | Bridge 返回结构化数据 |
| 中央按钮 | 接受候选 | `acceptDirectorExperienceCandidate` | 可用 | Bridge typed action |
| 中央按钮 | 晋升知识 | `promoteDirectorExperienceCandidate` | 可用 | Bridge typed action |
| 右侧经验 | 候选详情 | `explainDirectorExperienceCandidate` | 可用，但目前文本化 | 优先补结构化 query |
| 右侧计划 | 知识候选列表 | `listDirectorKnowledgeCandidates` | 可用 | Bridge typed action |
| 右侧计划 | 接受知识候选 | `acceptDirectorKnowledgeCandidate` | 可用 | Bridge typed action |
| 右侧计划 | 发布知识 | `publishDirectorKnowledgeCandidate` | 可用 | Bridge typed action |
| 右侧召回 | 查看召回命中 | `previewDirectorKnowledgeRecall` / `recallPublishedKnowledge` | 可用 | Bridge 返回 packet |
| 中央运行评估 | Director evaluate | Host API `/v1/evaluate` / `DirectorService.evaluateSnapshot` | 可用 | 优先 Host API |
| 右侧运行时知识 | `execution.knowledge` | `DirectorService` 已注入 published self-learning experience | 可用 | 读 evaluate response |
| 左侧运行会话 | 会话列表 | 当前没有桌面专用 session catalog | 需补 | 后续做轻量 session index |

## 3. 最小不屎山架构

```text
renderer
  只负责 UI、状态展示、用户点击
  ↓ typed action
preload
  暴露 window.directorAngel.invoke(action)
  ↓
desktop main / bridge
  调用现有 helper、store、host API
  ↓
director system
  director-knowledge / director-service / director-host-api
```

## 4. Bridge Action 草案

```ts
type DesktopAction =
  | { type: "experience.learnDirectory"; directory: string; privacy: "confidential" | "internal" | "public" }
  | { type: "experience.learnQuery"; query: string; maxResults?: number }
  | { type: "experience.list" }
  | { type: "experience.accept"; candidateId: string; note?: string }
  | { type: "experience.reject"; candidateId: string; note?: string }
  | { type: "experience.promote"; candidateId: string; note?: string }
  | { type: "knowledge.candidateList" }
  | { type: "knowledge.accept"; packId: string; note?: string }
  | { type: "knowledge.publish"; packId: string; note?: string }
  | { type: "knowledge.recallPreview"; projectId: string; groupId?: string; tags?: string[] }
  | { type: "director.evaluate"; snapshotPath?: string; goal?: string };
```

## 5. 需要补的系统接口

### 5.1 结构化经验查询

现在 `apps/cli/src/director-knowledge.ts` 很多函数返回 operator-readable 文本，适合 CLI，但桌面端需要结构化数据。

建议新增：

- `inspectDirectorExperienceCandidates(workspaceRoot)`
- `inspectDirectorExperienceCandidate(workspaceRoot, candidateId)`
- `promoteDirectorExperienceCandidateStructured(...)`

CLI 可以继续用这些结构化函数渲染文本，避免重复逻辑。

### 5.2 桌面会话索引

左侧“运行会话”现在 UI 有，但系统没有桌面专用索引。

建议先做文件型 index：

```text
.director-angel/runtime/desktop-sessions/index.json
```

只记录：

- session id
- title
- last action
- updated at
- status
- related candidate ids
- related pack ids

### 5.3 Host API 经验端点

Host API 当前有：

- `/v1/evaluate`
- `/v1/catalog/knowledge-packs`

但没有 experience review/promote 端点。桌面第一版可以先走 Desktop Bridge 直接调 helper；后续如果要远程化，再补：

- `GET /v1/experience/candidates`
- `POST /v1/experience/candidates/:id/accept`
- `POST /v1/experience/candidates/:id/promote`

## 6. 代码防腐规则

1. `src/app.js` 只保留 UI 行为，不出现业务命令字符串。
2. 新建 `src/bridge-client.js`，renderer 只调用 bridge client。
3. Electron/Tauri main process 才能访问文件系统和 Node API。
4. 所有业务动作必须复用现有 `director-knowledge` / `director-service`。
5. 不在桌面端复制 candidate/review/promotion/publish 数据结构。
6. 不在 UI 里解析 CLI 文本；CLI 文本只能用于日志展示。
7. 每个真实副作用都要有操作结果、错误状态、审计 note。
8. 每次新增 UI action 都要有一个 bridge 测试或 CLI/helper 测试。

## 7. 当前设计图可落地程度

| 模块 | 可落地程度 | 判断 |
| --- | --- | --- |
| 三栏布局 | 高 | 静态原型已完成 |
| 底部输入 composer | 高 | 已改为唯一输入区 |
| 学习来源 | 高 | 目录、URL、query 已有 adapter |
| 经验候选 | 高 | store 和 CLI helper 已有 |
| 审查/晋升 | 高 | Wave40 已完成 |
| 发布后召回 | 高 | Wave41 已完成 |
| Director evaluate 注入经验 | 高 | service 测试已通过 |
| 桌面文件选择 | 中 | 需要 Electron/Tauri 壳 |
| 结构化桌面 API | 中 | 需要补 bridge facade |
| 运行会话历史 | 中 | 需要桌面 session index |

## 8. 下一步建议

先不要做大 Electron 工程。

下一步最小收口：

1. 新增 `src/bridge-client.js` 和 mock bridge。
2. 把当前静态 UI 从硬编码状态改为读 bridge snapshot。
3. 新增结构化 `inspectDirectorExperienceCandidates` helper。
4. 做一个桌面 gate：mock bridge 下按钮流转不靠解析 stdout。

这样可以先把 UI 和系统能力接起来，同时不把桌面端做成命令拼接泥潭。
