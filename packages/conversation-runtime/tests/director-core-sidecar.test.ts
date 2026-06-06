import { describe, expect, it } from "vitest";

import {
  buildDirectorConsoleProjection,
  createDirectorContextFromSidecarSnapshot,
  runDirectorCoreSidecar,
} from "../src/director-core/adapter.js";
import type { DirectorCoreSidecarSnapshot } from "../src/director-core/context.js";

function buildSnapshot(
  overrides: Partial<DirectorCoreSidecarSnapshot> = {},
): DirectorCoreSidecarSnapshot {
  return {
    requestId: "req-director-console",
    projectId: "project-a",
    groupId: "group-a",
    timestamp: "2026-05-23T10:00:00.000Z",
    project: {
      title: "AI 短剧样片",
      outline: "主角进入旧工厂，发现第一条关键线索。",
      genre: ["thriller"],
      continuityPriority: "high",
    },
    group: {
      generationStyle: "immersive",
      generationType: "new",
      sceneCount: 3,
      anchorIds: ["factory-anchor"],
    },
    runtime: {
      runtimeId: "desktop-runtime",
      status: "ready",
      availableBindings: ["image-pro", "seedance-pro"],
      maxPromptChars: 5000,
      supportsVideo: true,
      deterministicMode: "balanced",
    },
    intent: {
      bindingPolicy: "prefer",
      preferredImageBinding: "image-pro",
      preferredVideoBinding: "seedance-pro",
    },
    knowledgeSignals: [
      {
        id: "continuity-note",
        description: "旧工厂场景需要保持冷色调和潮湿地面。",
        confidence: 0.88,
        tags: ["continuity"],
      },
    ],
    ...overrides,
  };
}

describe("Director Core sidecar", () => {
  it("builds a console-ready plan without mutating the host snapshot", () => {
    const snapshot = buildSnapshot();
    const before = JSON.stringify(snapshot);

    const result = runDirectorCoreSidecar(snapshot);

    expect(JSON.stringify(snapshot)).toBe(before);
    expect(result.context.request.requestId).toBe("req-director-console");
    expect(result.control.plan.modeDecision.selectedGenerationStyle).toBe("immersive");
    expect(result.console.recommendation.mode.id).toBe("immersive");
    expect(result.console.recommendation.model.videoBindingId).toBe("seedance-pro");
    expect(result.console.recommendation.model.imageBindingId).toBe("image-pro");
    expect(result.console.recommendation.model.reason).toContain("seedance-pro");
    expect(result.console.reviewGates.map((gate) => gate.id)).toEqual([
      "runtime",
      "alignment",
      "continuity",
      "binding",
      "locks",
    ]);
    expect(result.console.decisionActions.map((action) => action.id)).toEqual([
      "accept_and_generate",
      "accept_mode_model",
      "ignore_and_continue",
      "rerun_director",
    ]);
    expect(result.executionPlan.planId).toBe(result.control.plan.planId);
    expect(result.console.executionPreview.hiddenPromptEnhanced).toBe(true);
  });

  it("requires human confirmation when the plan touches user locks", () => {
    const result = runDirectorCoreSidecar(
      buildSnapshot({
        locks: {
          lockedFields: [
            {
              field: "intent.preferredVideoBinding",
              level: "hard_lock",
              reason: "用户已经锁定视频模型",
            },
          ],
        },
      }),
    );

    expect(result.console.lockImpact.touchesUserLocks).toBe(true);
    expect(result.console.lockImpact.lockedFields).toContain("intent.preferredVideoBinding");
    expect(result.console.manualConfirmationRequired).toBe(true);
    expect(result.console.autoApplyAllowed).toBe(false);
    expect(result.console.reviewGates.find((gate) => gate.id === "locks")).toMatchObject({
      status: "warn",
    });
    expect(
      result.console.decisionActions.find((action) => action.id === "accept_and_generate"),
    ).toMatchObject({
      requiresConfirmation: true,
      enabled: true,
    });
  });

  it("blocks auto-apply when required bindings cannot be resolved", () => {
    const result = runDirectorCoreSidecar(
      buildSnapshot({
        runtime: {
          runtimeId: "desktop-runtime",
          status: "ready",
          availableBindings: ["seedance-pro"],
          maxPromptChars: 5000,
          supportsVideo: true,
          deterministicMode: "balanced",
        },
        intent: {
          bindingPolicy: "require",
          requiredImageBinding: "missing-image-model",
          preferredVideoBinding: "seedance-pro",
        },
      }),
    );

    expect(result.control.plan.status).toBe("blocked");
    expect(result.console.risk.level).toBe("high");
    expect(result.console.autoApplyAllowed).toBe(false);
    expect(
      result.console.decisionActions.find((action) => action.id === "accept_and_generate"),
    ).toMatchObject({
      enabled: false,
    });
    expect(result.console.blockingReasons.length).toBeGreaterThan(0);
  });

  it("can project an externally supplied control result for desktop rendering", () => {
    const context = createDirectorContextFromSidecarSnapshot(buildSnapshot());
    const sidecar = runDirectorCoreSidecar(buildSnapshot());
    const consoleProjection = buildDirectorConsoleProjection({
      context,
      control: sidecar.control,
      executionPlan: sidecar.executionPlan,
    });

    expect(consoleProjection.title).toBe("总导演计划");
    expect(consoleProjection.summary).toContain("AI 短剧样片");
    expect(consoleProjection.executionPreview.willTouchUserLocks).toBe(false);
  });
});
