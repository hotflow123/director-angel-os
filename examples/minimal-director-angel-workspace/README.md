# Minimal Director Angel Workspace

This is the smallest example workspace shipped with `Director Angel OS`.

Use it when you want to see the chassis in action without aiming the runtime at the whole monorepo.

## What This Workspace Is

Think of this as a tiny fake product workspace.
It has just enough files for the CLI to read, summarize, and build a recoverable session around.

## Files In This Workspace

- `README.md`: the top-level workspace brief
- `notes/product-brief.md`: a short product summary
- `notes/open-questions.md`: unresolved operator questions

## Suggested Commands

Before you use this example, run `pnpm install` once from the repository root.
在使用这个示例之前，先回到仓库根目录执行一次 `pnpm install`。

Run from this directory, one command at a time.
请在这个目录里顺序执行，等上一条命令结束后再跑下一条。

This example uses the built-in `scripted` provider by default, so you can run it without configuring an external model key first.
这个示例默认使用内置的 `scripted` provider，所以一开始不用先配外部模型密钥。

```sh
export HOTFLOW_WORKSPACE_ROOT="$PWD"
export HOTFLOW_DATA_DIR="$PWD/.hotflow"
pnpm --dir ../../apps/cli dev -- doctor --json
pnpm --dir ../../apps/cli dev -- run "Read README.md and summarize this workspace."
pnpm --dir ../../apps/cli dev -- golden-path README.md
pnpm --dir ../../apps/cli dev -- resume <sessionId>
```

Use the `sessionId` printed by `golden-path` in the final `resume` command.
最后一条 `resume` 里的 `sessionId`，直接用 `golden-path` 打印出来的那个值。

Expected result:

- `doctor` confirms the local runtime can start
- `run` reads this workspace and returns a summary
- `golden-path` creates a local recoverable session and prints a session id
- `resume` reopens that session and proves recovery works

## Why This Example Exists

The repo root is useful when you want to inspect the real codebase.
This example is useful when you want a smaller first run that feels more like an app workspace than an infrastructure monorepo.
