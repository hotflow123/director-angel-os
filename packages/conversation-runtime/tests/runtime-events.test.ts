import { describe, expect, it } from "vitest";

import {
  appendConversationRuntimeEvent,
  createConversationRuntimeUnifiedEvent,
  createConversationRuntimeUnifiedEventBuilder,
  mapLegacyConversationRuntimeEvent,
} from "../src/runtime-events.js";

describe("conversation runtime events", () => {
  it("creates a stable turn lifecycle event envelope with elapsed time", () => {
    const event = createConversationRuntimeUnifiedEvent({
      kind: "turn.started",
      turnId: "turn-1",
      conversationId: "desktop:workbench",
      sequence: 1,
      startedAtMs: 100,
      occurredAtMs: 125,
      payload: {
        surface: "desktop",
        channel: "desktop",
        messageId: "message-1",
      },
    });

    expect(event).toEqual({
      schemaVersion: "conversation-runtime.event.v1",
      kind: "turn.started",
      turnId: "turn-1",
      conversationId: "desktop:workbench",
      eventId: "turn-1:000001:turn.started",
      sequence: 1,
      startedAtMs: 100,
      occurredAtMs: 125,
      elapsedMs: 25,
      payload: {
        surface: "desktop",
        channel: "desktop",
        messageId: "message-1",
      },
    });
  });

  it("builds ordered events for automation, tools, evidence, memory recall, candidates, model final, and failures", () => {
    const builder = createConversationRuntimeUnifiedEventBuilder({
      turnId: "turn-2",
      conversationId: "desktop:workbench",
      startedAtMs: 1_000,
      nowMs: (() => {
        const values = [1_000, 1_010, 1_020, 1_050, 1_080, 1_120, 1_140, 1_160, 1_180];
        return () => values.shift() ?? 1_200;
      })(),
    });

    const events = [
      builder.event("intent.classified", { intentKind: "learning-admit" }),
      builder.event("automation.policy.matched", {
        policyId: "policy-assisted-learning",
        mode: "assisted",
        decision: "allowed",
      }),
      builder.event("tool.started", { toolName: "web_extract", toolCallId: "call-1" }),
      builder.event("evidence.read", { sourceUrl: "https://example.test/a", readStatus: "read" }),
      builder.event("memory.recall", {
        status: "hit",
        hitCount: 1,
        layers: ["L2"],
        hits: [
          {
            id: "memory:mempalace:drawer_seedance_01",
            memoryLayer: "L2",
            layerLabel: "L2 On-Demand",
          },
        ],
      }),
      builder.event("candidate.created", { candidateId: "candidate-1", status: "reviewed" }),
      builder.event("model.fallback", { fallbackMode: "tool-evidence", errorClass: "network" }),
      builder.event("model.final", { chars: 42, replySource: "model" }),
      builder.event("turn.failed", { message: "provider timeout", retryable: true }),
    ];

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(events.map((event) => event.kind)).toEqual([
      "intent.classified",
      "automation.policy.matched",
      "tool.started",
      "evidence.read",
      "memory.recall",
      "candidate.created",
      "model.fallback",
      "model.final",
      "turn.failed",
    ]);
    expect(events[1]).toMatchObject({
      eventId: "turn-2:000002:automation.policy.matched",
      payload: {
        policyId: "policy-assisted-learning",
        mode: "assisted",
        decision: "allowed",
      },
    });
    expect(events[4]).toMatchObject({
      eventId: "turn-2:000005:memory.recall",
      payload: {
        status: "hit",
        hitCount: 1,
        layers: ["L2"],
      },
    });
    expect(events[6]).toMatchObject({
      eventId: "turn-2:000007:model.fallback",
      payload: {
        fallbackMode: "tool-evidence",
        errorClass: "network",
      },
    });
    expect(events[8]).toMatchObject({
      eventId: "turn-2:000009:turn.failed",
      elapsedMs: 180,
      payload: {
        message: "provider timeout",
        retryable: true,
      },
    });
  });

  it("maps legacy runtime events without letting desktop guess run state", () => {
    expect(
      mapLegacyConversationRuntimeEvent(
        {
          kind: "runtime.tool",
          payload: {
            tool: {
              id: "call-1",
              name: "director.experience.candidates.list",
              phase: "completed",
            },
          },
        },
        {
          turnId: "turn-3",
          conversationId: "desktop:workbench",
          sequence: 7,
          startedAtMs: 2_000,
          occurredAtMs: 2_250,
        },
      ),
    ).toMatchObject({
      schemaVersion: "conversation-runtime.event.v1",
      kind: "tool.completed",
      eventId: "turn-3:000007:tool.completed",
      elapsedMs: 250,
      payload: {
        toolName: "director.experience.candidates.list",
        toolCallId: "call-1",
        phase: "completed",
      },
    });
  });

  it("maps legacy approval and loop diagnostics into explicit unified event kinds", () => {
    expect(
      mapLegacyConversationRuntimeEvent(
        {
          kind: "runtime.approval",
          payload: {
            approval: {
              id: "tool:call-enable-skill",
              status: "pending",
              metadata: {
                toolName: "director.skills.set_enabled",
                permissionStatus: "ask",
              },
            },
          },
        },
        {
          turnId: "turn-approval",
          conversationId: "desktop:workbench",
          sequence: 3,
          startedAtMs: 1_000,
          occurredAtMs: 1_080,
        },
      ),
    ).toMatchObject({
      kind: "approval.requested",
      payload: {
        approvalId: "tool:call-enable-skill",
        toolName: "director.skills.set_enabled",
        status: "pending",
      },
    });

    expect(
      mapLegacyConversationRuntimeEvent(
        {
          kind: "runtime.tool",
          payload: {
            tool: {
              id: "call-loop",
              name: "web_extract",
              phase: "failed",
              metadata: {
                diagnosticKind: "tool.loop_detected",
                reason: "tool-loop-threshold-exceeded",
              },
            },
          },
        },
        {
          turnId: "turn-loop",
          conversationId: "desktop:workbench",
          sequence: 4,
          startedAtMs: 2_000,
          occurredAtMs: 2_250,
        },
      ),
    ).toMatchObject({
      kind: "tool.loop_detected",
      payload: {
        toolName: "web_extract",
        toolCallId: "call-loop",
        reason: "tool-loop-threshold-exceeded",
      },
    });
  });

  it("appends immutable events into a turn transcript", () => {
    const events = appendConversationRuntimeEvent([], {
      kind: "model.final",
      turnId: "turn-4",
      conversationId: "desktop:workbench",
      sequence: 1,
      startedAtMs: 10,
      occurredAtMs: 45,
      payload: { chars: 12 },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "model.final",
      elapsedMs: 35,
    });
  });

  it("builds external provider watch and artifact projection events", () => {
    const builder = createConversationRuntimeUnifiedEventBuilder({
      turnId: "turn-moyin-watch",
      conversationId: "desktop:workbench",
      startedAtMs: 10_000,
      nowMs: (() => {
        const values = [10_020, 10_080, 10_140];
        return () => values.shift() ?? 10_120;
      })(),
    });

    const watch = builder.event("external.provider.watch", {
      providerId: "moyin",
      toolId: "moyin.provider",
      operationId: "task.watch",
      taskId: "task-123",
      status: "succeeded",
      progress: 1,
      outputRef: "external-tool:moyin.provider:task.watch:task-123",
    });
    const artifacts = builder.event("external.provider.artifacts", {
      providerId: "moyin",
      toolId: "moyin.provider",
      operationId: "artifact.list",
      projectId: "project-1",
      runId: "run-1",
      artifactCount: 2,
      artifactIds: ["artifact-1", "artifact-2"],
    });
    const cancelled = builder.event("external.provider.cancelled", {
      providerId: "moyin",
      toolId: "moyin.provider",
      operationId: "workflow-run.cancel",
      projectId: "project-1",
      runId: "run-1",
      status: "cancelled",
    });

    expect(watch).toMatchObject({
      kind: "external.provider.watch",
      eventId: "turn-moyin-watch:000001:external.provider.watch",
      payload: {
        providerId: "moyin",
        taskId: "task-123",
        status: "succeeded",
        progress: 1,
      },
    });
    expect(artifacts).toMatchObject({
      kind: "external.provider.artifacts",
      eventId: "turn-moyin-watch:000002:external.provider.artifacts",
      payload: {
        artifactCount: 2,
        artifactIds: ["artifact-1", "artifact-2"],
      },
    });
    expect(cancelled).toMatchObject({
      kind: "external.provider.cancelled",
      eventId: "turn-moyin-watch:000003:external.provider.cancelled",
      payload: {
        providerId: "moyin",
        operationId: "workflow-run.cancel",
        runId: "run-1",
        status: "cancelled",
      },
    });
  });
});
