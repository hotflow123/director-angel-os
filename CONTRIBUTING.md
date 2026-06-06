# Contributing / 参与贡献

Thanks for helping shape `Director Angel OS`.
感谢你为 `Director Angel OS` 做出贡献。

## Before You Start / 开始前

- Follow the `.editorconfig` rules on whitespace and quotes. 遵循 `.editorconfig` 中的空格、换行和引号规则。
- Keep new packages private unless maintainers explicitly approve a public package surface. 除非维护者明确批准，不要把新包做成公开发布包。
- Reference existing workspace packages through `workspace:*` only. 工作区内部依赖统一使用 `workspace:*`。
- Read [docs/architecture.md](./docs/architecture.md) and [docs/open-source-boundaries.md](./docs/open-source-boundaries.md) before changing core behavior. 修改核心行为前先阅读架构和开源边界文档。

## Start Here / 从哪里开始看

- Read [README.md](./README.md) first for the public project story. 先看 [README.md](./README.md)，了解项目对外定位。
- Read [docs/open-source-boundaries.md](./docs/open-source-boundaries.md) before proposing large new surfaces. 想提大改动前，先看 [docs/open-source-boundaries.md](./docs/open-source-boundaries.md)。
- Use [examples/minimal-director-angel-workspace/README.md](./examples/minimal-director-angel-workspace/README.md) if you want a small runnable workspace instead of the whole repo. 如果你想先在一个小工作区上跑，不想直接面对整个仓库，就从 [examples/minimal-director-angel-workspace/README.md](./examples/minimal-director-angel-workspace/README.md) 开始。
- Check [docs/release/v0.1.0-publish-checklist.md](./docs/release/v0.1.0-publish-checklist.md) when a change affects first-release promises. 如果改动会影响首发承诺，请同步检查 [docs/release/v0.1.0-publish-checklist.md](./docs/release/v0.1.0-publish-checklist.md)。

## Development Workflow / 开发流程

1. Make the smallest coherent change that solves one problem. 一次提交尽量只解决一个完整问题。
2. Run `pnpm verify` before opening a pull request. 提交 PR 前运行 `pnpm verify`。
3. If you need a tighter local loop, use `pnpm lint`, `pnpm test`, `pnpm typecheck`, and `pnpm bench:all` as needed. 本地迭代时可按需使用更小粒度命令。
4. Update release-facing docs when behavior, operator flow, or user-visible wording changes. 涉及行为、运维流程或对外文案变更时，同步更新发布文档。

## Pull Requests / Pull Request 要求

- Use a descriptive title and summarize the user-facing impact. PR 标题要清晰，并说明对用户或维护者的影响。
- Reference the relevant Wave, plan, or design note when the change is architectural. 涉及架构调整时，请引用对应的 Wave、计划或设计说明。
- Call out security, policy, runtime, or control-plane implications explicitly. 涉及安全、策略、运行时或控制面的影响时，请显式写明。
- Add or update tests when behavior changes. 行为变化必须补齐或更新测试。
- Use the repository issue / PR templates when they fit. 能用仓库自带的 issue / PR 模板时，优先使用模板。

## Review Expectations / 评审预期

- Preserve existing conventions unless the change intentionally updates them. 非必要不要偏离仓库现有约定。
- Keep diffs readable and scoped. 保持改动范围清晰、可审阅。
- Do not mix unrelated refactors into a feature or fix PR. 不要把无关重构混入功能或修复 PR。

## Community and Safety / 社区与安全

- Read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before participating in issues, PRs, or discussions.
- Read [SECURITY.md](./SECURITY.md) before reporting vulnerabilities or handling sensitive information.
