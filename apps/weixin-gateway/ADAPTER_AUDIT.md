# Weixin Adapter Audit

更新时间：2026-05-26

## 结论

微信端应收敛为 channel adapter。它可以保留平台必要状态，但不能持有学习、确认、媒体、工具、能力判断的业务事实源。

## 应保留在 Adapter 的逻辑

- 微信账号、登录、allowlist、去重、限流和发送重试。
- 微信文本、图片、视频、文件消息解析。
- 微信附件下载、临时引用和发送失败处理。
- 微信群聊、私聊、thread/session key 路由元数据。
- 微信消息分段和平台格式化。

## 已清理的业务污染点

- 已移除微信 adapter 对 `PeerLearningArtifactState` 的依赖；遗留 peer learning 文件只作为兼容风险测试夹具，不再是运行时事实源。
- 经验候选展示不再混入微信影子缓存 fallback，只展示共享 Host API / conversation-runtime 候选。
- 学习确认由 conversation-runtime pending confirmation 处理，微信端不再用本地学习缓存接管保存确认。

## 仍需继续收口的过渡点

- 工具执行端口可以暂留在 adapter，但必须由 conversation-runtime 发起、授权和记录。
- 能力类 slash command 和 capability intro 仍有微信本地分支，下一步应继续迁移到共享 capability projection。
- `persistLearningConfirmation` 只能作为 conversation-runtime 的 persistence port 使用，不能由微信本地 regex 直接触发。

## 迁移目标

- 学习候选、确认保存、媒体授权、能力回答和工具路由逐步迁移到 conversation-runtime / Host API。
- 微信 adapter 只把 runtime result 和 runtime events 投影到微信。
- 桌面端和微信端共享 `.hotflow/conversation-runtime/learning-artifacts.json` 等核心事实源。
