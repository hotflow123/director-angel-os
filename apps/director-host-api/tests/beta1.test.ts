import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import { updateDirectorApiProviderSetting } from "@hotflow/director-runtime";
import type { DirectorEvaluationResult } from "@hotflow/director-service";
import { DirectorService } from "@hotflow/director-service";
import { afterEach, describe, expect, it } from "vitest";

import { buildRuntimeCapabilitySnapshotFromResult, createBlueprintResponse } from "../src/beta1.js";
import {
  bootstrapDirectorHostApi,
  materializeDirectorHostRuntimeCapabilitySnapshot,
} from "../src/bootstrap.js";

describe("beta1 runtime snapshot integration", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("materializes runtime and result snapshots from the runtime registry", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-beta1-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const runtime = bootstrapDirectorHostApi({
      env: {
        HOTFLOW_DATA_DIR: dataDir,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
      now: () => "2026-04-12T00:00:00.000Z",
      providerIds: ["scripted"],
    });
    const service = new DirectorService();
    const snapshot = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.snapshot.v1",
      snapshotId: "snapshot-1",
      createdAt: "2026-04-11T12:00:00.000Z",
      host: {
        hostId: "host-1",
        triggerSource: "cli" as const,
      },
      project: {
        projectId: "project-1",
        title: "Director Host API",
        outline: "为导演做一个预检蓝图。",
      },
      group: {
        groupId: "group-1",
        generationStyle: "standard" as const,
        generationType: "new" as const,
        sceneCount: 1,
        anchorIds: ["anchor-a"],
      },
      runtime: {
        runtimeId: "runtime-1",
        status: "ready" as const,
        availableBindings: ["binding-a"],
        maxPromptChars: 4096,
        supportsVideo: false,
      },
      intent: {
        bindingPolicy: "prefer" as const,
        preferredImageBinding: "binding-a",
      },
    };
    const evaluation = await service.evaluateSnapshot({
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot,
    });

    const runtimeSnapshot = materializeDirectorHostRuntimeCapabilitySnapshot(runtime, {
      runtimeId: "director-host-api",
    });
    const resultSnapshot = buildRuntimeCapabilitySnapshotFromResult(runtime, snapshot, evaluation);

    expect(runtimeSnapshot.adapters.map((adapter) => adapter.adapterId)).toEqual([
      "director-host-api",
      "scripted",
      "beta1-handoff-preview",
    ]);
    expect(resultSnapshot.runtimeId).toBe("runtime-1");
    expect(resultSnapshot.capturedAt).toBe(snapshot.createdAt);
    expect(resultSnapshot.adapters.map((adapter) => adapter.adapterId)).toEqual([
      "director-host-api",
      "scripted",
      "beta1-handoff-preview",
    ]);
    expect(
      resultSnapshot.adapters.find((adapter) => adapter.adapterId === "scripted")?.mediaCapability
        ?.supportedModes,
    ).toEqual(expect.arrayContaining(["text_to_image"]));
    expect(resultSnapshot.notes).toContain("eligible image bindings: binding-a");
  });

  it("allows worker-side effects after approval when a real API provider media bridge is selected", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-beta1-media-bridge-"));
    tempRoots.push(workspaceRoot);
    const providersRoot = join(workspaceRoot, ".director-angel", "providers");
    await updateDirectorApiProviderSetting(providersRoot, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-key",
      now: "2026-04-13T12:00:00.000Z",
    });
    const runtime = bootstrapDirectorHostApi({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        DIRECTOR_API_PROVIDER_BRIDGE_BASE_URL: "http://127.0.0.1:4501",
      },
      now: () => "2026-04-13T12:05:00.000Z",
      providerIds: ["scripted"],
    });
    const snapshot = createSnapshotFixture({
      snapshotId: "snapshot-media-bridge-1",
      availableBindings: ["memefast-api"],
      preferredImageBinding: "memefast-api",
    });
    const request = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot,
      intake: {
        intakeId: "intake-media-bridge-1",
        submittedAt: snapshot.createdAt,
        objective: "生成一个 15 秒短剧分镜蓝图",
        desiredOutcome: "生成一个 15 秒短剧分镜蓝图",
        deliverables: ["shot blueprint"],
      },
      alignmentLock: {
        lockId: "alignment-lock-media-bridge-1",
        sourceIntakeId: "intake-media-bridge-1",
        state: "locked",
        lockedAt: snapshot.createdAt,
        objective: "生成一个 15 秒短剧分镜蓝图",
        deliverables: ["shot blueprint"],
        lockedConstraints: [],
        lockedFields: [],
      },
    } as const;

    const response = createBlueprintResponse(
      runtime,
      request,
      createMediaBridgeEvaluationFixture(),
    );

    expect(response.handoff.chosenAdapters).toContain("memefast-api");
    expect(response.handoff.sideEffectsAllowed).toBe(true);
    expect(response.handoff.notes.join(" ")).toContain("Worker-only external execution is allowed");
  });
});

function createSnapshotFixture(input: {
  readonly snapshotId: string;
  readonly availableBindings: readonly string[];
  readonly preferredImageBinding: string;
}) {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.snapshot.v1",
    snapshotId: input.snapshotId,
    createdAt: "2026-04-13T12:00:00.000Z",
    host: {
      hostId: "host-media-bridge-1",
      triggerSource: "cli" as const,
    },
    project: {
      projectId: "project-media-bridge-1",
      title: "API provider media bridge",
      outline: "生成一个 15 秒短剧分镜蓝图",
    },
    group: {
      groupId: "group-media-bridge-1",
      generationStyle: "standard" as const,
      generationType: "new" as const,
      sceneCount: 1,
      anchorIds: ["anchor-media-bridge-1"],
    },
    runtime: {
      runtimeId: "runtime-media-bridge-1",
      status: "ready" as const,
      availableBindings: [...input.availableBindings],
      maxPromptChars: 4096,
      supportsVideo: false,
    },
    intent: {
      bindingPolicy: "prefer" as const,
      preferredImageBinding: input.preferredImageBinding,
    },
  };
}

function createMediaBridgeEvaluationFixture(): DirectorEvaluationResult {
  return {
    normalizedInput: {
      snapshotId: "snapshot-media-bridge-1",
      operatorId: null,
      goal: "生成一个 15 秒短剧分镜蓝图",
      projectLabel: "API provider media bridge",
      context: {} as DirectorEvaluationResult["normalizedInput"]["context"],
    },
    runtimeCapabilitySnapshot: {
      runtimeId: "runtime-media-bridge-1",
      status: "ready",
      availableBindings: ["memefast-api"],
      availableAdapters: ["memefast-api"],
      eligibleImageBindings: ["memefast-api"],
      eligibleVideoBindings: [],
      eligibleImageAdapters: ["memefast-api"],
      eligibleVideoAdapters: [],
      eligibleExecutionAdapters: [],
      executionAdapterSelections: [
        {
          role: "script-planner",
          actionClass: "generate",
          eligibleAdapters: [],
          selectedAdapter: null,
        },
        {
          role: "shot-planner",
          actionClass: "generate",
          eligibleAdapters: [],
          selectedAdapter: null,
        },
      ],
      selectedImageAdapter: "memefast-api",
      selectedVideoAdapter: null,
      selectedExecutionAdapter: null,
      supportsVideo: false,
      maxPromptChars: 4096,
      deterministicMode: null,
      autoRouteEnabled: true,
      disabledRoles: [],
      disabledAdapters: [],
      blockedReasons: [],
      warnings: [],
      issues: [],
    },
    alignmentAssessment: {
      decision: "aligned",
      summary: "aligned",
      reasons: [],
      clarificationQuestions: [],
    },
    alignmentLock: {
      status: "locked",
      goal: "生成一个 15 秒短剧分镜蓝图",
      lockedConstraints: [],
      openQuestions: [],
      blockingReasons: [],
    },
    review: {
      decision: "warn",
      summary: "operator review is required before execution.",
      recommendations: ["Approve the media route before worker execution."],
      blockingReasons: [],
      plan: {} as DirectorEvaluationResult["review"]["plan"],
      executionPlan: {} as DirectorEvaluationResult["review"]["executionPlan"],
      reviewReport: {} as DirectorEvaluationResult["review"]["reviewReport"],
    },
    crewAssignments: [
      {
        assignmentId: "assignment-asset-router",
        role: "asset-router",
        objective: "Match the requested output with the configured API provider bridge.",
        assignedCapability: "adapter-route-selection",
        inputs: ["script outline", "runtime capability snapshot"],
        outputs: ["adapter route"],
        deliverable: "Adapter route recommendation and readiness decision.",
        acceptanceCriteria: ["Selected adapter must satisfy the locked binding policy."],
        constraints: [],
        dependsOn: [],
        allowedAdapters: ["memefast-api"],
        actionClass: "route",
        approvalMode: "operator-approve",
        budgetLimit: 0,
        timeoutMs: 4_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Block the handoff if no eligible adapter exists.",
        escalationToDirector: "Escalate when adapter capabilities do not satisfy the locked goal.",
        status: "ready",
        selectedAdapter: "memefast-api",
      },
    ],
    actionGraph: {
      graphId: "graph-media-bridge-1",
      goal: "生成一个 15 秒短剧分镜蓝图",
      readiness: "review_required",
      nodes: [
        {
          nodeId: "node-assignment-asset-router",
          assignmentId: "assignment-asset-router",
          role: "asset-router",
          objective: "Match the requested output with the configured API provider bridge.",
          deliverable: "Adapter route recommendation and readiness decision.",
          actionClass: "route",
          approvalMode: "operator-approve",
          status: "awaiting_approval",
          dependsOn: [],
          eligibleAdapters: ["memefast-api"],
          selectedAdapter: "memefast-api",
          acceptanceCriteria: ["Selected adapter must satisfy the locked binding policy."],
        },
      ],
      edges: [],
      blockedReasons: [],
    },
    executionHandoffEnvelope: {
      handoffId: "handoff-media-bridge-1",
      snapshotId: "snapshot-media-bridge-1",
      runtimeId: "runtime-media-bridge-1",
      status: "review_required",
      goal: "生成一个 15 秒短剧分镜蓝图",
      lockedConstraints: [],
      operatorPreview: {
        summary: "API provider media bridge route requires approval before execution.",
        visiblePrompt: "生成一个 15 秒短剧分镜蓝图",
        selectedGenerationType: "new",
        selectedGenerationStyle: "standard",
        selectedImageBinding: "memefast-api",
        selectedVideoBinding: null,
        actionCount: 1,
        blockedReasons: [],
      },
      entries: [
        {
          assignmentId: "assignment-asset-router",
          role: "asset-router",
          deliverable: "Adapter route recommendation and readiness decision.",
          actionClass: "route",
          approvalMode: "operator-approve",
          selectedAdapter: "memefast-api",
          status: "awaiting_approval",
        },
      ],
      auditTrail: ["media-bridge=memefast-api"],
    },
    skillContext: {} as DirectorEvaluationResult["skillContext"],
    context: {} as DirectorEvaluationResult["context"],
    plan: {} as DirectorEvaluationResult["plan"],
    executionPlan: {} as DirectorEvaluationResult["executionPlan"],
    reviewReport: {} as DirectorEvaluationResult["reviewReport"],
    recall: {} as DirectorEvaluationResult["recall"],
    publishedKnowledgeRecall: {} as DirectorEvaluationResult["publishedKnowledgeRecall"],
    observation: {} as DirectorEvaluationResult["observation"],
    response: {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: "snapshot-media-bridge-1",
      runtimeId: "runtime-media-bridge-1",
      decision: "needs_review",
      summary: "API provider media bridge route requires approval before execution.",
      recommendations: ["Approve the asset-router assignment before worker execution."],
      plan: {
        planId: "plan-media-bridge-1",
        status: "review_required",
        summary: "media bridge route",
        confidence: 0.8,
        selectedGenerationStyle: "standard",
        selectedImageBinding: "memefast-api",
        selectedVideoBinding: null,
        riskFlags: [],
      },
      execution: {
        executionId: "execution-media-bridge-1",
        selectedGenerationType: "new",
        selectedGenerationStyle: "standard",
        visiblePrompt: "生成一个 15 秒短剧分镜蓝图",
      },
      review: {
        overallDecision: "needs_review",
        blockingReasons: [],
        requiredFixes: [],
      },
    },
  };
}
