# Director Angel 桌面端

这是 Director Angel 的 Electron 桌面端，按 Codex App 的工作台布局做中文版本。

当前目标不是做一个复杂后台，而是做一个“导演工作台”：

- 左侧：工作区和真实能力分组
- 中间：命令列表与执行流
- 右侧：按命令 schema 生成的参数表单、状态、结果、召回证据

桌面端不再使用 mock 数据。renderer 只提交 typed action；真实执行发生在 native bridge 和 Electron main process：

`command.catalog -> command.run -> desktop action 或 CLI runner -> snapshot/result`

## 文件

- `src/index.html`: 静态原型页面
- `src/styles.css`: Codex 风格三栏工作台样式
- `src/app.js`: renderer 交互，只调用 native bridge action
- `src/desktop-contract.js`: 桌面 action/result contract
- `src/desktop-command-catalog.js`: Director Angel 可执行命令目录
- `src/desktop-command-runner.js`: command.run 分发器
- `src/desktop-bridge-facade.js`: action dispatcher
- `src/desktop-system-handlers.js`: 真实系统 handler，调用 self-learning / knowledge helper
- `src/desktop-native-bridge.js`: 给桌面壳/preload 使用的 native bridge 装配入口
- `src/desktop-preload-bridge.js`: 将 native bridge 暴露为 `window.directorAngel.invoke`
- `docs/ui-map.zh.md`: 中文 UI 界面图谱

## 查看

启动桌面端：

```bash
pnpm --filter @hotflow/director-desktop start
```

直接在浏览器打开 HTML 会因为没有 native bridge 而显示连接错误，这是预期行为。
