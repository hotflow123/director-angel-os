# Changelog / 更新日志

All notable changes to `Director Angel OS` should be documented in this file.
`Director Angel OS` 的重要变更应记录在本文件中。

This changelog follows a Keep a Changelog-inspired structure and uses `Added`, `Changed`, `Fixed`, and `Removed`.
本更新日志采用类似 Keep a Changelog 的结构，使用 `Added`、`Changed`、`Fixed`、`Removed` 分类。

## [Unreleased] / [未发布]

### Added / 新增

- Bilingual community and release entry documents: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `CHANGELOG.md`.
- 新增中英双语的社区与发布入口文档：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`SECURITY.md`、`CHANGELOG.md`。

### Changed / 变更

- Standardized the external project name in these entry documents to `Director Angel OS`.
- 将这些入口文档中的对外项目名称统一为 `Director Angel OS`。

## [0.0.1] - 2026-06-06 / [0.0.1] - 2026-06-06

### Added / 新增

- Initial macOS arm64 desktop preview release package for Director Angel OS.
- 新增 Director Angel OS 的 macOS arm64 桌面端预览版发布包。
- Added the user-provided Director Angel operator logo as the desktop icon source.
- 使用用户提供的 Director Angel 操作者 logo 作为桌面端图标来源。
- Added a fixed `memefast.top` recommended opening/purchase entry in desktop API settings.
- 在桌面端 API 设置中加入固定的 `memefast.top` 推荐开通/购买入口。

### Changed / 变更

- Set root and desktop package versions to `0.0.1` for the initial public preview.
- 将根包和桌面端版本设为 `0.0.1`，用于首次公开预览版。
- Packaged desktop runtime now defaults writable workspace/data paths to user Application Support.
- 打包后的桌面端 runtime 默认把可写 workspace/data 路径放到用户 Application Support。

### Fixed / 修复

- Removed macOS AppleDouble `._*` metadata files from desktop release packaging.
- 从桌面端发布包中移除 macOS AppleDouble `._*` 元数据文件。
