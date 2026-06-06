import { describe, expect, it } from "vitest";

import {
  type DirectorKnowledgePackDocument,
  materializeDirectorKnowledgePackFromProposal,
} from "@hotflow/director-knowledge";

import { DirectorService } from "../src/service.ts";

const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";

type DirectorEvaluateRequest = Parameters<DirectorService["evaluateSnapshot"]>[0];

const request: DirectorEvaluateRequest = {
  apiVersion: DIRECTOR_HOST_API_VERSION,
  snapshot: {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.snapshot.v1",
    snapshotId: "snapshot-1",
    createdAt: "2026-04-11T12:00:00.000Z",
    host: {
      hostId: "host-1",
      triggerSource: "cli",
    },
    project: {
      projectId: "project-1",
      title: "Director Service",
      continuityPriority: "high",
    },
    group: {
      groupId: "group-1",
      generationType: "new",
      sceneCount: 2,
      anchorIds: ["anchor-a"],
    },
    runtime: {
      runtimeId: "runtime-1",
      status: "ready",
      availableBindings: ["binding-a"],
      maxPromptChars: 4096,
      supportsVideo: true,
      deterministicMode: "balanced",
    },
    intent: {
      bindingPolicy: "prefer",
      preferredImageBinding: "binding-a",
    },
    knowledgeSignals: [
      {
        id: "signal-1",
        description: "Keep the same visual tone",
        confidence: 0.9,
        tags: ["continuity"],
      },
    ],
  },
};

describe("DirectorService", () => {
  it("evaluates a snapshot through the Beta-1 control pipeline", async () => {
    const service = new DirectorService();
    const result = await service.evaluateSnapshot(request);

    expect(result.context.request.requestId).toBe("snapshot-1");
    expect(result.normalizedInput.goal).toContain("new 2 scene(s)");
    expect(result.runtimeCapabilitySnapshot.eligibleImageBindings).toEqual(["binding-a"]);
    expect(result.runtimeCapabilitySnapshot.eligibleImageAdapters).toEqual(["binding-a"]);
    expect(result.runtimeCapabilitySnapshot.autoRouteEnabled).toBe(true);
    expect(result.alignmentAssessment.decision).toBe("aligned");
    expect(result.alignmentLock.status).toBe("locked");
    expect(result.plan.status).toBe("ready");
    expect(result.executionPlan.selectedGenerationStyle).toBe("immersive");
    expect(result.reviewReport.overallDecision).toBe("pass");
    expect(result.review.decision).toBe("pass");
    expect(result.crewAssignments).toHaveLength(5);
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "asset-router")
        ?.allowedAdapters,
    ).toEqual(["binding-a"]);
    expect(result.actionGraph.readiness).toBe("ready");
    expect(result.actionGraph.edges).toHaveLength(5);
    expect(result.executionHandoffEnvelope.status).toBe("ready");
    expect(result.executionHandoffEnvelope.entries).toHaveLength(5);
    expect(result.response.plan.planId).toBe(result.plan.planId);
  });

  it("uses the intake objective as the primary director goal", async () => {
    const service = new DirectorService();
    const result = await service.evaluateSnapshot({
      ...request,
      intake: {
        intakeId: "intake-objective-1",
        submittedAt: "2026-04-11T12:00:00.000Z",
        objective: "Create a launch teaser that opens with a neon rain reveal.",
        desiredOutcome: "A compact teaser storyboard.",
        deliverables: ["storyboard"],
      },
    });

    expect(result.normalizedInput.goal).toBe(
      "Create a launch teaser that opens with a neon rain reveal.",
    );
    expect(result.alignmentLock.goal).toBe(result.normalizedInput.goal);
    expect(result.actionGraph.goal).toBe(result.normalizedInput.goal);
    expect(result.executionHandoffEnvelope.goal).toBe(result.normalizedInput.goal);
    expect(result.review.summary).toContain(result.normalizedInput.goal);
  });

  it("keeps intake-backed extend requests clarification-gated when continuity anchors are missing", async () => {
    const service = new DirectorService();
    const result = await service.evaluateSnapshot({
      ...request,
      snapshot: {
        ...request.snapshot,
        group: {
          ...request.snapshot.group,
          generationType: "extend",
          anchorIds: [],
        },
      },
      intake: {
        intakeId: "intake-clarify-with-objective",
        submittedAt: "2026-04-11T12:05:00.000Z",
        objective: "Continue the existing story.",
        desiredOutcome: "Continue the existing story.",
      },
    });

    expect(result.alignmentAssessment.decision).toBe("clarification_required");
    expect(result.alignmentAssessment.clarificationQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-continuity-anchor",
        }),
      ]),
    );
    expect(result.alignmentLock.status).toBe("awaiting_clarification");
    expect(result.actionGraph.readiness).toBe("review_required");
  });

  it("prefers injected runtime registry and matcher for eligible adapters", async () => {
    const service = new DirectorService({
      runtimeRegistry: {
        async listAdapters() {
          return [
            {
              adapterId: "media-image-a",
              adapterKind: "media",
              bindingId: "binding-external-image",
              enabled: true,
              healthy: true,
              mediaModes: ["image"],
              supportedActionClasses: ["route", "generate"],
            },
            {
              adapterId: "media-video-a",
              adapterKind: "media",
              bindingId: "binding-external-video",
              enabled: true,
              healthy: true,
              mediaModes: ["video"],
              supportedActionClasses: ["route", "generate"],
            },
          ];
        },
      },
      runtimeMatcher: {
        async match() {
          return {
            eligibleImageAdapters: ["media-image-a"],
            eligibleVideoAdapters: ["media-video-a"],
            selectedImageAdapterId: "media-image-a",
            selectedVideoAdapterId: "media-video-a",
          };
        },
      },
    });

    const result = await service.evaluateSnapshot(request);

    expect(result.runtimeCapabilitySnapshot.availableAdapters).toEqual([
      "media-image-a",
      "media-video-a",
    ]);
    expect(result.runtimeCapabilitySnapshot.eligibleImageBindings).toEqual([
      "binding-external-image",
    ]);
    expect(result.runtimeCapabilitySnapshot.eligibleVideoBindings).toEqual([
      "binding-external-video",
    ]);
    expect(result.runtimeCapabilitySnapshot.selectedVideoAdapter).toBe("media-video-a");
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "asset-router")
        ?.allowedAdapters,
    ).toEqual(["media-video-a"]);
    expect(
      result.actionGraph.nodes.find((node) => node.role === "asset-router")?.selectedAdapter,
    ).toBe("media-video-a");
  });

  it("selects a real execution adapter for the first script-planner handoff when one is available", async () => {
    const service = new DirectorService({
      runtimeRegistry: {
        async listAdapters() {
          return [
            {
              adapterId: "media-image-a",
              adapterKind: "media",
              bindingId: "binding-external-image",
              enabled: true,
              healthy: true,
              mediaModes: ["image"],
              supportedActionClasses: ["route", "generate"],
            },
            {
              adapterId: "media-video-a",
              adapterKind: "media",
              bindingId: "binding-external-video",
              enabled: true,
              healthy: true,
              mediaModes: ["video"],
              supportedActionClasses: ["route", "generate"],
            },
            {
              adapterId: "script-execution-a",
              adapterKind: "execution",
              enabled: true,
              healthy: true,
              mockOnly: false,
              bridgeKind: "http-json",
              supportedRoles: ["script-planner"],
              supportedActionClasses: ["generate"],
            },
          ];
        },
      },
      runtimeMatcher: {
        async match() {
          return {
            eligibleImageAdapters: ["media-image-a"],
            eligibleVideoAdapters: ["media-video-a"],
            selectedImageAdapterId: "media-image-a",
            selectedVideoAdapterId: "media-video-a",
          };
        },
      },
    });

    const result = await service.evaluateSnapshot(request);

    expect(result.runtimeCapabilitySnapshot.eligibleExecutionAdapters).toEqual([
      "script-execution-a",
    ]);
    expect(result.runtimeCapabilitySnapshot.selectedExecutionAdapter).toBe("script-execution-a");
    expect(result.runtimeCapabilitySnapshot.executionAdapterSelections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "script-planner",
          actionClass: "generate",
          selectedAdapter: "script-execution-a",
          requiresOperatorApproval: true,
        }),
      ]),
    );
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "script-planner")
        ?.allowedAdapters,
    ).toEqual(["script-execution-a"]);
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "script-planner")
        ?.approvalMode,
    ).toBe("operator-approve");
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "script-planner")?.status,
    ).toBe("awaiting_approval");
    expect(
      result.actionGraph.nodes.find((node) => node.role === "script-planner")?.selectedAdapter,
    ).toBe("script-execution-a");
    expect(result.actionGraph.nodes.find((node) => node.role === "script-planner")?.status).toBe(
      "awaiting_approval",
    );
    expect(
      result.executionHandoffEnvelope.entries.find((entry) => entry.role === "script-planner")
        ?.selectedAdapter,
    ).toBe("script-execution-a");
    expect(
      result.executionHandoffEnvelope.entries.find((entry) => entry.role === "script-planner")
        ?.approvalMode,
    ).toBe("operator-approve");
  });

  it("extends the same real execution adapter to the shot-planner when the adapter supports both roles", async () => {
    const service = new DirectorService({
      runtimeRegistry: {
        async listAdapters() {
          return [
            {
              adapterId: "media-image-a",
              adapterKind: "media",
              bindingId: "binding-external-image",
              enabled: true,
              healthy: true,
              mediaModes: ["image"],
              supportedActionClasses: ["route", "generate"],
            },
            {
              adapterId: "media-video-a",
              adapterKind: "media",
              bindingId: "binding-external-video",
              enabled: true,
              healthy: true,
              mediaModes: ["video"],
              supportedActionClasses: ["route", "generate"],
            },
            {
              adapterId: "script-execution-a",
              adapterKind: "execution",
              enabled: true,
              healthy: true,
              mockOnly: false,
              bridgeKind: "http-json",
              supportedRoles: ["script-planner", "shot-planner"],
              supportedActionClasses: ["generate"],
            },
          ];
        },
      },
      runtimeMatcher: {
        async match() {
          return {
            eligibleImageAdapters: ["media-image-a"],
            eligibleVideoAdapters: ["media-video-a"],
            selectedImageAdapterId: "media-image-a",
            selectedVideoAdapterId: "media-video-a",
          };
        },
      },
    });

    const result = await service.evaluateSnapshot(request);

    expect(result.runtimeCapabilitySnapshot.executionAdapterSelections).toEqual([
      {
        role: "script-planner",
        actionClass: "generate",
        eligibleAdapters: ["script-execution-a"],
        selectedAdapter: "script-execution-a",
        requiresOperatorApproval: true,
      },
      {
        role: "shot-planner",
        actionClass: "generate",
        eligibleAdapters: ["script-execution-a"],
        selectedAdapter: "script-execution-a",
        requiresOperatorApproval: true,
      },
    ]);
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "shot-planner")
        ?.allowedAdapters,
    ).toEqual(["script-execution-a"]);
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "shot-planner")
        ?.selectedAdapter,
    ).toBe("script-execution-a");
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "shot-planner")?.approvalMode,
    ).toBe("operator-approve");
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "shot-planner")?.status,
    ).toBe("awaiting_approval");
    expect(
      result.actionGraph.nodes.find((node) => node.role === "shot-planner")?.selectedAdapter,
    ).toBe("script-execution-a");
    expect(
      result.executionHandoffEnvelope.entries.find((entry) => entry.role === "shot-planner")
        ?.selectedAdapter,
    ).toBe("script-execution-a");
    expect(result.observation.evaluation?.selectedAdapters).toContain("script-execution-a");
  });

  it("surfaces clarification-needed inputs as a review-required handoff", async () => {
    const service = new DirectorService();
    const result = await service.evaluateSnapshot({
      ...request,
      snapshot: {
        ...request.snapshot,
        project: {
          projectId: "project-clarify",
        },
        group: {
          ...request.snapshot.group,
          generationType: "extend",
          anchorIds: [],
        },
      },
    });

    expect(result.alignmentAssessment.decision).toBe("clarification_required");
    expect(result.alignmentLock.status).toBe("awaiting_clarification");
    expect(result.review.decision).toBe("warn");
    expect(result.actionGraph.readiness).toBe("review_required");
    expect(result.response.decision).toBe("warn");
    expect(result.response.review.requiredFixes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("provide a project title"),
        expect.stringContaining("at least one anchor ID"),
      ]),
    );
  });

  it("blocks the handoff when no eligible adapter exists", async () => {
    const service = new DirectorService();
    const result = await service.evaluateSnapshot({
      ...request,
      snapshot: {
        ...request.snapshot,
        runtime: {
          ...request.snapshot.runtime,
          availableBindings: [],
        },
      },
    });

    expect(result.runtimeCapabilitySnapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "binding-missing", severity: "block" }),
      ]),
    );
    expect(result.review.decision).toBe("block");
    expect(result.actionGraph.readiness).toBe("blocked");
    expect(result.actionGraph.blockedReasons).toEqual(
      expect.arrayContaining(["No eligible adapter matched the locked request."]),
    );
    expect(result.executionHandoffEnvelope.status).toBe("blocked");
    expect(result.response.decision).toBe("block");
  });

  it("blocks the handoff when auto-route is disabled by switches", async () => {
    const service = new DirectorService({
      switches: {
        async snapshot() {
          return {
            autoRouteEnabled: false,
          };
        },
      },
    });
    const result = await service.evaluateSnapshot(request);

    expect(result.runtimeCapabilitySnapshot.autoRouteEnabled).toBe(false);
    expect(result.runtimeCapabilitySnapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "auto-route-disabled", severity: "block" }),
      ]),
    );
    expect(result.actionGraph.readiness).toBe("blocked");
    expect(result.actionGraph.blockedReasons).toEqual(
      expect.arrayContaining(["Auto-route is disabled by runtime switches."]),
    );
    expect(
      result.executionHandoffEnvelope.entries.find((entry) => entry.role === "asset-router")
        ?.blockingReason,
    ).toBe("Auto-route is disabled by runtime switches.");
  });

  it("blocks the handoff when a role or adapter kill switch removes the route", async () => {
    const service = new DirectorService({
      switches: {
        async snapshot() {
          return {
            disabledRoles: ["asset-router"],
            disabledAdapters: ["binding-a"],
          };
        },
      },
    });
    const result = await service.evaluateSnapshot(request);

    expect(result.runtimeCapabilitySnapshot.disabledRoles).toEqual(["asset-router"]);
    expect(result.runtimeCapabilitySnapshot.disabledAdapters).toEqual(["binding-a"]);
    expect(result.review.decision).toBe("block");
    expect(result.actionGraph.readiness).toBe("blocked");
    expect(result.actionGraph.blockedReasons).toEqual(
      expect.arrayContaining(["Role asset-router is disabled by runtime switches."]),
    );
  });

  it("builds runtime summary with knowledge pack counts", async () => {
    const service = new DirectorService();
    const summary = await service.getRuntimeSummary({
      runtimeId: "runtime-1",
      workspaceRoot: "/workspace",
      dataDir: "/workspace/.hotflow",
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
      availableProviders: ["scripted"],
    });

    expect(summary.runtimeId).toBe("runtime-1");
    expect(summary.knowledgePackCount).toBe(0);
  });

  it("degrades recall safely and still appends an evaluation observation", async () => {
    const observations: Array<{ source: string; recallStatus: string }> = [];
    const service = new DirectorService({
      memoryRecall: {
        async recall() {
          throw new Error("recall backend timeout");
        },
      },
      learningSink: {
        append(observation) {
          observations.push({
            source: observation.source,
            recallStatus: observation.recallStatus,
          });
        },
      },
      now: () => "2026-04-12T03:00:00.000Z",
    });

    const result = await service.evaluateSnapshot(request);

    expect(result.recall.status).toBe("degraded");
    expect(result.recall.notes[0]).toContain("timeout");
    expect(result.observation.source).toBe("evaluation");
    expect(result.observation.recallStatus).toBe("degraded");
    expect(observations).toEqual([
      {
        source: "evaluation",
        recallStatus: "degraded",
      },
    ]);
  });

  it("materializes bounded recall into review, crew routing, and handoff audit trail", async () => {
    const service = new DirectorService({
      runtimeRegistry: {
        async listAdapters() {
          return [
            {
              adapterId: "adapter-b",
              adapterKind: "media",
              bindingId: "binding-b",
              enabled: true,
              healthy: true,
              mediaModes: ["video"],
              supportedActionClasses: ["route", "generate"],
            },
            {
              adapterId: "adapter-a",
              adapterKind: "media",
              bindingId: "binding-a",
              enabled: true,
              healthy: true,
              mediaModes: ["video"],
              supportedActionClasses: ["route", "generate"],
            },
          ];
        },
      },
      runtimeMatcher: {
        async match() {
          return {
            eligibleImageAdapters: ["adapter-b", "adapter-a"],
            eligibleVideoAdapters: ["adapter-b", "adapter-a"],
            selectedImageAdapterId: "adapter-b",
            selectedVideoAdapterId: "adapter-b",
          };
        },
      },
      memoryRecall: {
        async recall() {
          return {
            status: "hit",
            knowledgePacks: [],
            hits: [
              {
                recordId: "record-memory-1",
                summary: "Previous completed run preserved continuity with adapter-a.",
                status: "completed",
                recordedAt: "2026-04-11T12:00:00.000Z",
                score: 9.4,
                reasons: ["projectId matched", "anchorIds matched"],
                selectedAdapters: ["adapter-a"],
                provenance: {
                  runId: "run-previous",
                  reportId: "report-previous",
                  observationIds: ["observation-previous"],
                },
              },
            ],
            notes: ["1 prior run recalled."],
          };
        },
      },
    });

    const result = await service.evaluateSnapshot(request);

    expect(result.review.summary).toContain("Recall matched 1 prior run");
    expect(result.review.recommendations).toEqual(
      expect.arrayContaining([expect.stringContaining("run-previous")]),
    );
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "researcher")?.inputs,
    ).toEqual(expect.arrayContaining(["bounded recall brief"]));
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "asset-router")
        ?.allowedAdapters,
    ).toEqual(["adapter-a", "adapter-b"]);
    expect(result.executionHandoffEnvelope.auditTrail).toEqual(
      expect.arrayContaining([
        "recall=hit",
        expect.stringContaining("recall-hit=record-memory-1"),
        expect.stringContaining("recall-run=run-previous"),
      ]),
    );
  });

  it("records operator outcomes as append-only observation envelopes", async () => {
    const observations: Array<{ source: string; status?: string; blueprintId?: string }> = [];
    const service = new DirectorService({
      learningSink: {
        append(observation) {
          observations.push({
            source: observation.source,
            status: observation.outcome?.status,
            blueprintId: observation.blueprintId,
          });
        },
      },
    });

    const recorded = await service.recordOutcome(
      {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshotId: "snapshot-1",
        blueprintId: "blueprint-1",
        handoffId: "handoff-1",
        outcome: {
          outcomeId: "outcome-1",
          status: "accepted",
          recordedAt: "2026-04-12T03:10:00.000Z",
        },
      },
      {
        runtimeId: "runtime-1",
      },
    );

    expect(recorded.stored).toBe(true);
    expect(recorded.observation.source).toBe("outcome");
    expect(recorded.observation.outcome?.status).toBe("accepted");
    expect(observations).toEqual([
      {
        source: "outcome",
        status: "accepted",
        blueprintId: "blueprint-1",
      },
    ]);
  });

  it("lists published knowledge packs from an injected store", async () => {
    const service = new DirectorService({
      knowledgeStore: {
        async listPublished() {
          return [
            {
              state: "published",
              metadata: {
                id: "pack-1",
                title: "Knowledge Pack",
                version: 2,
                createdAt: "2026-04-11T12:00:00.000Z",
                tags: ["tone"],
              },
            },
          ];
        },
      },
    });
    const catalog = await service.listKnowledgePacks();

    expect(catalog.apiVersion).toBe(DIRECTOR_HOST_API_VERSION);
    expect(catalog.knowledgePacks[0]?.id).toBe("pack-1");
    expect(catalog.knowledgePacks[0]?.stage).toBe("published");
  });

  it("injects published knowledge recall into planning when enabled", async () => {
    const service = new DirectorService({
      knowledgeRecall: {
        enabled: true,
        maxHits: 2,
        maxChars: 600,
      },
      knowledgeStore: {
        async listPublished() {
          return [];
        },
        async listPublishedDocuments() {
          return [
            materializeDirectorKnowledgePackFromProposal(createAcceptedKnowledgeProposal(), {
              now: "2026-04-13T03:00:00.000Z",
            }),
          ];
        },
      },
    });

    const result = await service.evaluateSnapshot({
      ...request,
      snapshot: {
        ...request.snapshot,
        knowledgeSignals: [],
      },
    });

    expect(result.publishedKnowledgeRecall.status).toBe("hit");
    expect(result.context.knowledgeSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("knowledge-pack:director-method-"),
        }),
      ]),
    );
    expect(result.executionPlan.prompt.hidden).toContain("Knowledge:");
    expect(result.executionPlan.prompt.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "execution.knowledge",
          visibility: "hidden",
        }),
      ]),
    );
    expect(result.observation.recalledKnowledgePacks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          knowledgePackId: expect.stringContaining("director-method-"),
        }),
      ]),
    );
    expect(result.observation.recallNotes.join(" ")).toContain(
      "Matched 1 published Director knowledge pack",
    );
    expect(result.review.reviewReport.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "continuity",
          status: "pass",
        }),
      ]),
    );
  });

  it("injects compact long-term memory as knowledge signals before production planning", async () => {
    const service = new DirectorService({
      longTermMemory: {
        async load() {
          return {
            status: "hit",
            signals: [
              {
                id: "long-term-memory:memory",
                description:
                  "MEMORY.md: Prefer cold open continuity, keep anchor-a visible, and avoid comic timing.",
                confidence: 0.78,
                tags: ["long-term-memory", "memory", "anchor-a"],
              },
              {
                id: "long-term-memory:user",
                description:
                  "USER.md: The operator likes concise production plans and dislikes loose visual drift.",
                confidence: 0.72,
                tags: ["long-term-memory", "user"],
              },
            ],
            notes: ["Loaded compact long-term memory from MEMORY.md and USER.md."],
          };
        },
      },
    });

    const result = await service.evaluateSnapshot({
      ...request,
      snapshot: {
        ...request.snapshot,
        knowledgeSignals: [],
      },
    });

    expect(result.context.knowledgeSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "long-term-memory:memory",
          description: expect.stringContaining("keep anchor-a visible"),
          tags: expect.arrayContaining(["long-term-memory", "memory"]),
        }),
        expect.objectContaining({
          id: "long-term-memory:user",
          description: expect.stringContaining("concise production plans"),
          tags: expect.arrayContaining(["long-term-memory", "user"]),
        }),
      ]),
    );
    expect(result.executionPlan.prompt.hidden).toContain("MEMORY.md");
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "asset-router")?.constraints,
    ).toEqual(expect.arrayContaining([expect.stringContaining("long-term-memory:memory")]));
    expect(result.executionHandoffEnvelope.auditTrail).toEqual(
      expect.arrayContaining(["long-term-memory=hit"]),
    );
  });

  it("leaves published knowledge recall inactive when the feature is disabled", async () => {
    const service = new DirectorService({
      knowledgeRecall: {
        enabled: false,
      },
      knowledgeStore: {
        async listPublished() {
          return [];
        },
        async listPublishedDocuments() {
          return [
            materializeDirectorKnowledgePackFromProposal(createAcceptedKnowledgeProposal(), {
              now: "2026-04-13T03:00:00.000Z",
            }),
          ];
        },
      },
    });

    const result = await service.evaluateSnapshot({
      ...request,
      snapshot: {
        ...request.snapshot,
        knowledgeSignals: [],
      },
    });

    expect(result.publishedKnowledgeRecall.status).toBe("miss");
    expect(result.context.knowledgeSignals).toEqual([]);
    expect(result.review.reviewReport.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "continuity",
          status: "warn",
        }),
      ]),
    );
  });

  it("injects published self-learning experience knowledge without project-specific matches", async () => {
    const service = new DirectorService({
      knowledgeRecall: {
        enabled: true,
        maxHits: 2,
        maxChars: 700,
      },
      knowledgeStore: {
        async listPublished() {
          return [];
        },
        async listPublishedDocuments() {
          return [createPublishedExperienceKnowledgePack()];
        },
      },
    });

    const result = await service.evaluateSnapshot({
      ...request,
      snapshot: {
        ...request.snapshot,
        project: {
          ...request.snapshot.project,
          projectId: "project-without-specific-history",
        },
        group: {
          ...request.snapshot.group,
          groupId: "group-without-specific-history",
          anchorIds: [],
        },
        knowledgeSignals: [],
      },
    });

    expect(result.publishedKnowledgeRecall.status).toBe("hit");
    expect(result.publishedKnowledgeRecall.hits[0]?.reasons).toEqual(
      expect.arrayContaining(["global self-learning experience"]),
    );
    expect(result.context.knowledgeSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "knowledge-pack:director-experience-local-constraints",
          tags: expect.arrayContaining(["experience", "self-learning", "constraint-clarity"]),
        }),
      ]),
    );
    expect(result.executionPlan.prompt.hidden).toContain("Knowledge:");
    expect(result.executionPlan.prompt.hidden).toContain(
      "knowledge-pack:director-experience-local-constraints",
    );
    expect(result.observation.recalledKnowledgePacks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          knowledgePackId: "director-experience-local-constraints",
        }),
      ]),
    );
  });

  it("assembles published knowledge and approved Skill context before execution handoff", async () => {
    const service = new DirectorService({
      knowledgeRecall: {
        enabled: true,
        maxHits: 2,
        maxChars: 700,
      },
      knowledgeStore: {
        async listPublished() {
          return [];
        },
        async listPublishedDocuments() {
          return [
            materializeDirectorKnowledgePackFromProposal(createAcceptedKnowledgeProposal(), {
              now: "2026-04-13T03:00:00.000Z",
            }),
          ];
        },
      },
      skillPromptIndex: {
        buildSections({ userText }) {
          expect(userText).toContain("continuity-safe teaser");
          return [
            {
              id: "skill.continuity-teaser",
              content:
                "Skill: Continuity teaser\nKeep the anchor visible in the first shot and verify route continuity before handoff.",
              metadata: {
                skillId: "continuity-teaser",
              },
            },
          ];
        },
      },
    });

    const result = await service.evaluateSnapshot({
      ...request,
      intake: {
        intakeId: "intake-knowledge-skill-1",
        submittedAt: "2026-04-11T12:00:00.000Z",
        objective: "Create a continuity-safe teaser.",
        desiredOutcome: "A continuity-safe teaser storyboard.",
        deliverables: ["storyboard"],
      },
      snapshot: {
        ...request.snapshot,
        knowledgeSignals: [],
      },
    });

    expect(result.publishedKnowledgeRecall.status).toBe("hit");
    expect(result.skillContext.status).toBe("hit");
    expect(result.review.summary).toContain("Published knowledge matched 1 pack");
    expect(result.review.summary).toContain("Matched 1 approved Skill(s): continuity-teaser");
    expect(result.review.recommendations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("published knowledge pack"),
        expect.stringContaining("continuity-teaser"),
      ]),
    );
    expect(result.executionPlan.prompt.hidden).toContain("Knowledge:");
    expect(result.executionPlan.prompt.hidden).toContain("Skill continuity-teaser");
    expect(result.executionPlan.prompt.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "execution.knowledge", visibility: "hidden" }),
        expect.objectContaining({ id: "execution.skills", visibility: "hidden" }),
      ]),
    );
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "script-planner")
        ?.constraints,
    ).toEqual(expect.arrayContaining([expect.stringContaining("Skill continuity-teaser")]));
    expect(
      result.crewAssignments.find((assignment) => assignment.role === "asset-router")?.constraints,
    ).toEqual(expect.arrayContaining([expect.stringContaining("Published method brief")]));
    expect(result.executionHandoffEnvelope.auditTrail).toEqual(
      expect.arrayContaining([
        "published-knowledge=hit",
        "skills=hit",
        "skill-hit=continuity-teaser",
        expect.stringContaining("published-pack=director-method-"),
      ]),
    );
  });
});

function createPublishedExperienceKnowledgePack(): DirectorKnowledgePackDocument {
  return {
    schemaVersion: "director.knowledge.pack.v1",
    metadata: {
      id: "director-experience-local-constraints",
      title: "Ask for constraints before production",
      description: "Use for user-provided desktop lessons.",
      tags: ["experience", "self-learning", "source:local-directory", "constraint-clarity"],
      createdAt: "2026-04-25T09:00:00.000Z",
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: "experience:experience_local_constraints",
      sourceRecordId: "adapter_desktop_lessons",
      sourceDigestId: "sha256:desktop-lessons",
      projectId: "experience-learning",
      groupId: "local-directory",
      goal: "Use learned operating lessons from local files.",
      trigger: "Use learned operating lessons from local files.",
      summary: "Ask for missing constraints before generating production assets.",
      explanation:
        "Ask for missing constraints before generating production assets.\nRuntime injection: disabled until reviewed and published.",
      evidenceSummary: "evidence_1: desktop lesson",
      roles: ["researcher"],
      preferredAdapters: [],
      anchorIds: ["evidence_1"],
      generationType: "self-learning",
      generationStyle: "local-directory",
    },
    audit: {
      publishedAt: "2026-04-25T09:01:00.000Z",
    },
  };
}

function createAcceptedKnowledgeProposal() {
  return {
    proposalId: "proposal-published-1",
    status: "accepted" as const,
    recordId: "record-published-1",
    digestId: "digest-published-1",
    projectId: "project-1",
    groupId: "group-1",
    title: "Director method: continuity-safe teaser",
    summary: "Use the previously approved continuity-safe route.",
    trigger: "When planning a continuity-safe teaser for the same project group.",
    evidenceSummary: "completed run with stable teaser continuity",
    explanation: "Preserve anchor continuity and keep the immersive teaser tone.",
    dedupeKey: "project-1__group-1__continuity-safe-teaser",
    tags: ["continuity", "teaser"],
    roles: ["researcher", "script-planner"],
    selectedAdapters: ["binding-a"],
    latestDecision: {
      decidedAt: "2026-04-13T02:55:00.000Z",
      note: "approved_for_publish",
    },
    sourceRecord: {
      anchorIds: ["anchor-a"],
      tags: ["continuity", "teaser"],
      digest: {
        goal: "Create a continuity-safe teaser.",
        generationType: "new",
        generationStyle: "immersive",
        knowledgeSignalTags: ["continuity", "teaser"],
      },
    },
  };
}
