import { describe, expect, it, vi } from "vitest";

import {
  createRunCenterRenderScheduler,
  createRunCenterTaskRow,
  createRunCenterTaskTranscript,
  createRunCenterToastState,
  formatTaskRuntimeEventPreview,
  resolveRunCenterTaskTranscriptSteps,
  updateRunCenterToastStateFromTasks,
} from "./run-center.js";

describe("run center external reference parity", () => {
  it("merges OpenClaw-style tool stream events by toolCallId with input, output, and elapsed time", () => {
    const startedAt = Date.parse("2026-05-23T12:00:00.000Z");
    const completedAt = startedAt + 2400;
    const task = {
      id: "task-1",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.started",
          eventId: "turn-1:000003:tool.started",
          occurredAtMs: startedAt,
          payload: {
            toolName: "web_extract",
            toolCallId: "call-web-1",
            inputPreview: "url=https://x.com/example/status/1",
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.completed",
          eventId: "turn-1:000004:tool.completed",
          occurredAtMs: completedAt,
          payload: {
            toolName: "web_extract",
            toolCallId: "call-web-1",
            outputPreview: "全文 6076 字符，媒体 3 个",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      key: "tool-stream:call-web-1",
      kind: "read",
      state: "done",
    });
    expect(steps[0].label).toContain("网页正文提取");
    expect(steps[0].label).toContain("url=https://x.com/example/status/1");
    expect(steps[0].label).toContain("全文 6076 字符，媒体 3 个");
    expect(steps[0].label).toContain("2.4s");
  });

  it("keeps failed tool calls visible with the real failure reason instead of a generic fallback", () => {
    const task = {
      id: "task-2",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.started",
          eventId: "turn-2:000003:tool.started",
          occurredAtMs: 1000,
          payload: {
            toolName: "director.opencli.invoke",
            toolCallId: "call-opencli-1",
            inputPreview: "command=director.experience.candidates.list",
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.failed",
          eventId: "turn-2:000004:tool.failed",
          occurredAtMs: 1600,
          payload: {
            toolName: "director.opencli.invoke",
            toolCallId: "call-opencli-1",
            error: "candidate store unavailable",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      key: "tool-stream:call-opencli-1",
      kind: "error",
      state: "failed",
    });
    expect(steps[0].label).toContain("OpenCLI");
    expect(steps[0].label).toContain("candidate store unavailable");
  });

  it("shows model provider fallback status as a run-center step", () => {
    const task = {
      id: "task-3",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "model.fallback",
          eventId: "turn-3:000006:model.fallback",
          occurredAtMs: 2000,
          payload: {
            providerId: "memefast-api",
            modelId: "gemini-3-pro",
            errorClass: "network",
            message: "fetch failed",
            fallbackMode: "tool-evidence",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "error",
    });
    expect(steps[0].key).toContain("model.fallback");
    expect(steps[0].label).toContain("已用工具证据降级回答");
    expect(steps[0].label).toContain("供应方 memefast-api");
    expect(steps[0].label).toContain("错误类别 network");
  });

  it("shows unified approval and loop diagnostics without exposing raw event names", () => {
    const task = {
      id: "task-approval-loop",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "approval.requested",
          eventId: "turn-approval:000003:approval.requested",
          occurredAtMs: 2500,
          payload: {
            approvalId: "tool:call-enable-skill",
            toolName: "director.skills.set_enabled",
            status: "pending",
            summary: "启用浏览 Skill 需要确认。",
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.loop_detected",
          eventId: "turn-loop:000004:tool.loop_detected",
          occurredAtMs: 3200,
          payload: {
            toolName: "web_extract",
            toolCallId: "call-loop",
            reason: "tool-loop-threshold-exceeded",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);
    const labels = steps.map((step) => step.label).join("\n");

    expect(steps).toHaveLength(2);
    expect(labels).toContain("等待确认");
    expect(labels).toContain("director.skills.set_enabled");
    expect(labels).toContain("启用浏览 Skill 需要确认");
    expect(labels).toContain("工具重复调用已拦截");
    expect(labels).toContain("网页正文提取");
    expect(labels).not.toContain("approval.requested");
    expect(labels).not.toContain("tool.loop_detected");
  });

  it("projects subagent failures as explicit lifecycle diagnostics", () => {
    const task = {
      id: "task-subagent-failed",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "subagent.failed",
          eventId: "turn-subagent:000004:subagent.failed",
          occurredAtMs: 3600,
          payload: {
            subagentId: "subagent_research_1",
            role: "researcher",
            workerId: "worker-7",
            error: "browser snapshot timed out",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);
    const preview = formatTaskRuntimeEventPreview(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "error",
      state: "failed",
    });
    expect(steps[0].label).toContain("子任务失败");
    expect(steps[0].label).toContain("subagent_research_1");
    expect(steps[0].label).toContain("researcher");
    expect(steps[0].label).toContain("browser snapshot timed out");
    expect(steps[0].label).not.toContain("subagent.failed");
    expect(preview).toContain("子任务失败");
    expect(preview).not.toContain("subagent.failed");
  });

  it("projects context compaction partial checkpoints as memory-degraded diagnostics", () => {
    const task = {
      id: "task-context-compaction",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "context.compaction.partial_saved",
          eventId: "turn-context:000008:context.compaction.partial_saved",
          occurredAtMs: 4200,
          payload: {
            checkpointId: "context-checkpoint-1",
            summaryPreview: "已保留参考仓库对照和统一调度要求。",
            reason: "provider-timeout",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);
    const preview = formatTaskRuntimeEventPreview(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "memory",
      state: "warning",
    });
    expect(steps[0].label).toContain("上下文已保留部分摘要");
    expect(steps[0].label).toContain("context-checkpoint-1");
    expect(steps[0].label).toContain("provider-timeout");
    expect(steps[0].label).not.toContain("context.compaction.partial_saved");
    expect(preview).toContain("上下文已保留部分摘要");
    expect(preview).not.toContain("context.compaction.partial_saved");
  });

  it("shows MemPalace memory layer recall with source pointers", () => {
    const task = {
      id: "task-4",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "memory.recall",
          eventId: "turn-4:000003:memory.recall",
          occurredAtMs: 3000,
          payload: {
            status: "hit",
            hitCount: 1,
            layers: ["L2"],
            hits: [
              {
                id: "memory:working-memory:mempalace:drawer_seedance_01",
                memoryLayer: "L2",
                layerLabel: "L2 On-Demand",
                drawerId: "drawer_seedance_01",
                sourceFile: "seedance.md",
                drawerIndex: 2,
                totalDrawers: 7,
                verbatimExcerpt: "Scene prompts stay per shot.",
                drawerContent:
                  "Scene prompts stay per shot.\nDo not merge every scene into one abstract summary.",
              },
            ],
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      key: expect.stringContaining("memory.recall"),
      kind: "memory",
    });
    expect(steps[0].label).toContain("召回记忆 1 条");
    expect(steps[0].label).toContain("L2 On-Demand");
    expect(steps[0].label).toContain("seedance.md");
    expect(steps[0].label).toContain("drawer 2/7");
    expect(steps[0].pointer).toBe("seedance.md · L2 On-Demand · drawer 2/7");
    expect(steps[0].source).toStrictEqual({
      sourceFile: "seedance.md",
      layerLabel: "L2 On-Demand",
      drawerId: "drawer_seedance_01",
      drawerIndex: 2,
      totalDrawers: 7,
      verbatimExcerpt: "Scene prompts stay per shot.",
      drawerContent: "Scene prompts stay per shot.\nDo not merge every scene into one abstract summary.",
    });
  });

  it("shows MemPalace degraded layer reasons fail-closed", () => {
    const task = {
      id: "task-memory-degraded",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "memory.recall",
          eventId: "turn-memory:000003:memory.recall",
          occurredAtMs: 3000,
          payload: {
            status: "degraded",
            hitCount: 0,
            layers: ["L3"],
            degradedReasons: ["L3 Deep Search index is not ready"],
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "memory",
      state: "failed",
    });
    expect(steps[0].label).toContain("记忆召回降级");
    expect(steps[0].label).toContain("L3");
    expect(steps[0].label).toContain("原因 L3 Deep Search index is not ready");
  });

  it("renders a copy action for MemPalace memory source pointers", () => {
    const restoreDocument = installRunCenterTestDocument();
    const task = {
      id: "task-memory-pointer",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "memory.recall",
          eventId: "turn-memory:000003:memory.recall",
          occurredAtMs: 3000,
          payload: {
            status: "hit",
            hitCount: 1,
            hits: [
              {
                memoryLayer: "L2",
                layerLabel: "L2 On-Demand",
                drawerId: "drawer_seedance_01",
                sourceFile: "seedance.md",
                drawerIndex: 2,
                totalDrawers: 7,
                verbatimExcerpt: "Scene prompts stay per shot.",
                drawerContent:
                  "Scene prompts stay per shot.\nDo not merge every scene into one abstract summary.",
              },
            ],
          },
        },
      ],
    };

    try {
      const transcript = createRunCenterTaskTranscript(task);
      const copyButton = transcript.querySelector("[data-run-center-pointer-copy]");

      expect(copyButton).not.toBeNull();
      expect(copyButton.textContent).toBe("复制来源");
      expect(copyButton.dataset.runCenterPointerCopy).toBe("seedance.md · L2 On-Demand · drawer 2/7");
      const openButton = transcript.querySelector("[data-run-center-pointer-open]");
      expect(openButton).not.toBeNull();
      expect(openButton.textContent).toBe("打开来源");
      expect(JSON.parse(openButton.dataset.runCenterPointerOpen)).toStrictEqual({
        sourceFile: "seedance.md",
        layerLabel: "L2 On-Demand",
        drawerId: "drawer_seedance_01",
        drawerIndex: 2,
        totalDrawers: 7,
        verbatimExcerpt: "Scene prompts stay per shot.",
        drawerContent:
          "Scene prompts stay per shot.\nDo not merge every scene into one abstract summary.",
      });
    } finally {
      restoreDocument();
    }
  });

  it("filters OpenClaw-style runtime events to the current task turn, session, and run", () => {
    const task = {
      id: "task-filter-current",
      turnId: "turn-current",
      activeRunId: "run-current",
      payload: {
        sessionKey: "desktop:workbench:current",
      },
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.completed",
          eventId: "turn-current:000004:tool.completed",
          turnId: "turn-current",
          sessionKey: "desktop:workbench:current",
          occurredAtMs: 4000,
          payload: {
            runId: "run-current",
            toolName: "web_extract",
            toolCallId: "call-current",
            outputPreview: "当前会话读取完成",
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.completed",
          eventId: "turn-other:000004:tool.completed",
          turnId: "turn-other",
          sessionKey: "desktop:workbench:current",
          occurredAtMs: 4001,
          payload: {
            runId: "run-current",
            toolName: "web_extract",
            toolCallId: "call-other-turn",
            outputPreview: "其他 turn 不应出现",
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.completed",
          eventId: "turn-current:000005:tool.completed",
          turnId: "turn-current",
          sessionKey: "desktop:workbench:other",
          occurredAtMs: 4002,
          payload: {
            runId: "run-current",
            toolName: "web_extract",
            toolCallId: "call-other-session",
            outputPreview: "其他 session 不应出现",
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.completed",
          eventId: "turn-current:000006:tool.completed",
          turnId: "turn-current",
          sessionKey: "desktop:workbench:current",
          occurredAtMs: 4003,
          payload: {
            runId: "run-other",
            toolName: "web_extract",
            toolCallId: "call-other-run",
            outputPreview: "其他 run 不应出现",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);
    const labels = steps.map((step) => step.label).join("\n");

    expect(steps).toHaveLength(1);
    expect(labels).toContain("当前会话读取完成");
    expect(labels).not.toContain("其他 turn 不应出现");
    expect(labels).not.toContain("其他 session 不应出现");
    expect(labels).not.toContain("其他 run 不应出现");
  });

  it("keeps transport internals out of user-facing runtime event labels", () => {
    const steps = resolveRunCenterTaskTranscriptSteps({
      id: "task-human-labels",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "turn.started",
          eventId: "turn-human:000001:turn.started",
          occurredAtMs: 1000,
          payload: {},
        },
      ],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].label).toBe("正在发送请求");
    expect(steps[0].label).not.toContain("Native Bridge");
  });

  it("projects Moyin workflow events as concrete project, command, approval, watch, artifact, and export facts", () => {
    const task = {
      id: "task-moyin-run",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "moyin.workflow_run.create.started",
          eventId: "turn-moyin:000001:moyin.workflow_run.create.started",
          occurredAtMs: 1000,
          projectId: "project-1",
          stepId: "workflow-run.create",
          metadata: {
            command: "moyin workflow-run create --project project-1 --file draft.json --json",
            stepCount: 4,
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "moyin.workflow_run.approval_packet.created",
          eventId: "turn-moyin:000002:moyin.workflow_run.approval_packet.created",
          occurredAtMs: 2000,
          projectId: "project-1",
          runId: "run-1",
          stepId: "scene-image-1",
          sealedRequestId: "sealed-image-1",
          metadata: {
            approvalId: "approval-1",
            advanceAction: "execute",
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "moyin.workflow_run.task_watch.heartbeat",
          eventId: "turn-moyin:000003:moyin.workflow_run.task_watch.heartbeat",
          occurredAtMs: 3000,
          projectId: "project-1",
          runId: "run-1",
          stepId: "scene-image-1",
          taskId: "task-image-1",
          resumeToken: "watch-token-1",
          metadata: {
            heartbeatIntervalMs: 5000,
            watchTimeoutMs: 300000,
          },
        },
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "moyin.workflow_run.package.completed",
          eventId: "turn-moyin:000004:moyin.workflow_run.package.completed",
          occurredAtMs: 4000,
          projectId: "project-1",
          runId: "run-1",
          stepId: "workflow-run.package",
          metadata: {
            artifactCount: 2,
            backfillAttemptedCount: 1,
            jsonExportRequested: true,
            comfyuiDraftRequested: true,
            readyForComfyUi: false,
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);
    const labels = steps.map((step) => step.label).join("\n");

    expect(steps).toHaveLength(4);
    expect(steps[0].source).toStrictEqual({
      type: "moyin",
      projectId: "project-1",
      stepId: "workflow-run.create",
      command: "moyin workflow-run create --project project-1 --file draft.json --json",
    });
    expect(steps[3].source).toStrictEqual({
      type: "moyin",
      projectId: "project-1",
      runId: "run-1",
      stepId: "workflow-run.package",
      artifactCount: 2,
      backfillAttemptedCount: 1,
      exports: ["json", "comfyui-draft"],
      readyForComfyUi: false,
    });
    expect(labels).toContain("Moyin 创建工作流");
    expect(labels).toContain("项目 project-1");
    expect(labels).toContain("命令 moyin workflow-run create --project project-1 --file draft.json --json");
    expect(labels).toContain("步骤 scene-image-1");
    expect(labels).toContain("等待审批");
    expect(labels).toContain("审批 approval-1");
    expect(labels).toContain("sealed sealed-image-1");
    expect(labels).toContain("Moyin watch 心跳");
    expect(labels).toContain("任务 task-image-1");
    expect(labels).toContain("恢复 watch-token-1");
    expect(labels).toContain("产物 2 个");
    expect(labels).toContain("回填 1 次");
    expect(labels).toContain("导出 json、comfyui-draft");
    expect(labels).toContain("ComfyUI 未就绪");
    expect(labels).not.toContain("moyin.workflow_run");
  });

  it("projects stuck runtime warnings as factual Chinese diagnostics", () => {
    const task = {
      id: "conversation:turn-stuck",
      events: [
        {
          type: "conversation.registry.runtime.stuck_warning",
          kind: "runtime.stuck_warning",
          occurredAt: new Date(180_000).toISOString(),
          message: "Conversation run has had no activity past the stuck threshold.",
          metadata: {
            status: "tool_calling",
            lastActivityAtMs: 60_000,
            idleForMs: 120_000,
            thresholdMs: 90_000,
            activeModelCall: "gemini-3-pro",
            activeToolCalls: ["web_extract"],
            activeSubagentRunIds: ["subagent-1"],
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);
    const preview = formatTaskRuntimeEventPreview(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "error",
      state: "warning",
    });
    expect(steps[0].label).toContain("运行可能卡住");
    expect(steps[0].label).toContain("已 2分钟 无新事件");
    expect(steps[0].label).toContain("阈值 1分30秒");
    expect(steps[0].label).toContain("模型 gemini-3-pro");
    expect(steps[0].label).toContain("工具 web_extract");
    expect(steps[0].label).toContain("子任务 subagent-1");
    expect(preview).toContain("运行可能卡住");
    expect(preview).not.toContain("Conversation run has had no activity");
  });

  it("projects stale recovered runtime events as restart recovery facts", () => {
    const task = {
      id: "conversation:turn-stale",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "runtime.stale_recovered",
          eventId: "turn-stale:000009:runtime.stale_recovered",
          occurredAtMs: 240_000,
          payload: {
            fromStatus: "running",
            reason: "stale conversation run recovered after runtime restart",
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "error",
      state: "cancelled",
    });
    expect(steps[0].label).toContain("重启后发现旧运行已中止");
    expect(steps[0].label).toContain("原状态 running");
    expect(steps[0].label).not.toContain("Stale active conversation run");
  });

  it("marks long tool previews as truncated with the original character count", () => {
    const longOutput = `输出开始 ${"长文本".repeat(80)} 输出结尾`;
    const task = {
      id: "task-long-tool-preview",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "tool.completed",
          eventId: "turn-long:000004:tool.completed",
          occurredAtMs: 5000,
          payload: {
            toolName: "web_extract",
            toolCallId: "call-long-output",
            outputPreview: longOutput,
          },
        },
      ],
    };

    const steps = resolveRunCenterTaskTranscriptSteps(task);

    expect(steps).toHaveLength(1);
    expect(steps[0].label).toContain("输出开始");
    expect(steps[0].label).not.toContain("输出结尾");
    expect(steps[0].label).toContain(`已截断，原始 ${longOutput.length} 字符`);
  });

  it("renders an OpenClaw-style retry action only for failed composer tasks with a prompt snapshot", () => {
    const restoreDocument = installRunCenterTestDocument();
    try {
      const retryable = createRunCenterTaskRow({
        id: "conversation:turn-failed",
        status: "failed",
        category: "conversation-runtime",
        payload: {
          source: "desktop.conversation-runtime",
          promptPreview: "哪些地方最有用？",
          sessionKey: "desktop:workbench:a",
        },
      });
      const retryButton = retryable.querySelector("[data-task-retry]");

      expect(retryButton).not.toBeNull();
      expect(retryButton.textContent).toBe("重试");
      expect(retryButton.dataset.taskRetry).toBe("conversation:turn-failed");

      const notRetryable = createRunCenterTaskRow({
        id: "task-old",
        status: "failed",
        category: "conversation-runtime",
        payload: {
          source: "desktop.conversation-runtime",
        },
      });

      expect(notRetryable.querySelector("[data-task-retry]")).toBeNull();
    } finally {
      restoreDocument();
    }
  });

  it("projects model fallback events into a temporary run-center toast", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const toast = createRunCenterToastState();
    const task = {
      id: "task-fallback-toast",
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "model.fallback",
          eventId: "turn-fallback:000006:model.fallback",
          occurredAtMs: 6000,
          payload: {
            providerId: "memefast-api",
            modelId: "gemini-3-pro",
            fallbackMode: "tool-evidence",
            errorClass: "network",
            message: "fetch failed",
          },
        },
      ],
    };

    updateRunCenterToastStateFromTasks(toast, [task]);

    expect(toast.fallbackStatus).toMatchObject({
      phase: "active",
      selected: "memefast-api/gemini-3-pro",
      active: "工具证据降级回答",
      reason: "network · fetch failed",
      taskId: "task-fallback-toast",
    });
    vi.advanceTimersByTime(7_999);
    expect(toast.fallbackStatus).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(toast.fallbackStatus).toBeNull();
    vi.useRealTimers();
  });

  it("throttles run-center renders and supports an explicit flush", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = [];
    const scheduler = createRunCenterRenderScheduler(() => {
      calls.push("render");
    });

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(79);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["render"]);

    scheduler.schedule();
    scheduler.flush();
    expect(calls).toEqual(["render", "render"]);
    scheduler.cancel();
    vi.useRealTimers();
  });
});

function installRunCenterTestDocument() {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return new RunCenterTestElement(tagName);
    },
  };
  return () => {
    if (previous === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previous;
    }
  };
}

class RunCenterTestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.type = "";
    this.title = "";
    this.style = {};
  }

  append(...children) {
    this.children.push(...children);
  }

  querySelector(selector) {
    if (selector === "[data-run-center-pointer-copy]" && this.dataset.runCenterPointerCopy !== undefined) {
      return this;
    }
    if (selector === "[data-run-center-pointer-open]" && this.dataset.runCenterPointerOpen !== undefined) {
      return this;
    }
    if (selector === "[data-task-retry]" && this.dataset.taskRetry !== undefined) {
      return this;
    }
    for (const child of this.children) {
      const found = typeof child?.querySelector === "function" ? child.querySelector(selector) : null;
      if (found) {
        return found;
      }
    }
    return null;
  }
}
