# Internal Plugins / 内置插件

This directory contains the built-in, in-repo plugins that ship with `Director Angel OS`.
这个目录放的是随 `Director Angel OS` 一起交付的内置插件，全部都在仓库内，不依赖外部插件市场。

- `providers/scripted`
- `tools/filesystem-read`

Each plugin exposes:
每个插件都会暴露：

- a `manifest.json`
- a typed registration entrypoint (`index.ts`)
- catalog-level loading helpers in `catalog.ts`

Design intent:
设计原则：

- static, in-repo plugins only
- no marketplace/download/runtime script execution
- plugin runtime can load manifests first, then import registration entrypoints

In plain language, these are not "app store plugins".
大白话说，这里不是“插件市场”，而是 Agent OS 自带的、受控的、随仓库一起版本化的扩展件。

Minimal plugin-runtime contract:
最小 plugin-runtime 契约：

1. Read plugin manifests under `internal-plugins/**/manifest.json`
2. Validate `kind`, `id`, `version`, and `entrypoint`
3. Import the `entrypoint`
4. Call `registerXxxPlugin(...)` and wire returned definition/provider into runtime registries

Recommended integration entrypoints:
推荐接入入口：

- `internal-plugins/catalog.ts`
  - `INTERNAL_PROVIDER_PLUGINS`
  - `INTERNAL_TOOL_PLUGINS`
  - `getInternalProviderPluginById(...)`
  - `getInternalToolPluginById(...)`
- `internal-plugins/manifests.ts`
  - `INTERNAL_PLUGIN_MANIFESTS`
