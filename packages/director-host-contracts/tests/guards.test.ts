import {
  DIRECTOR_HOST_API_VERSION,
  type DirectorBlueprintResponse,
  type DirectorEvaluateResponse,
  type DirectorHostSnapshotEnvelope,
  isDirectorBlueprintRequest,
  isDirectorBlueprintResponse,
  isDirectorClarifyRequest,
  isDirectorClarifyResponse,
  isDirectorEvaluateRequest,
  isDirectorEvaluateResponse,
  isDirectorHostSnapshotEnvelope,
  isDirectorIntakeRequest,
  isDirectorIntakeResponse,
  isDirectorKnowledgePackCatalogResponse,
  isDirectorOutcomeRequest,
  isDirectorOutcomeResponse,
  isDirectorRuntimeCapabilitySnapshotRequest,
  isDirectorRuntimeCapabilitySnapshotResponse,
  isDirectorRuntimePreflightResponse,
  isDirectorRuntimeResponse,
} from "../src/index.js";

const makeSnapshot = (): DirectorHostSnapshotEnvelope => ({
  apiVersion: DIRECTOR_HOST_API_VERSION,
  schemaId: "director.host.snapshot.v1",
  snapshotId: "snapshot-123",
  createdAt: "2026-04-11T12:00:00.000Z",
  host: {
    hostId: "host-123",
    triggerSource: "cli",
  },
  project: {
    projectId: "project-123",
    title: "Director Alpha",
    outline: "Build a preview-safe director handoff.",
  },
  group: {
    groupId: "group-123",
    generationType: "new",
    generationStyle: "immersive",
    sceneCount: 3,
    anchorIds: ["anchor-a"],
  },
  runtime: {
    runtimeId: "runtime-abc",
    status: "ready",
    availableBindings: ["binding-a"],
    maxPromptChars: 4000,
    supportsVideo: true,
    deterministicMode: "balanced",
  },
  intent: {
    bindingPolicy: "prefer",
    preferredImageBinding: "binding-a",
  },
});

const makeCapabilitySnapshot = () => ({
  snapshotId: "capability-snapshot-1",
  runtimeId: "runtime-abc",
  capturedAt: "2026-04-11T12:00:00.000Z",
  status: "ready" as const,
  adapters: [
    {
      adapterId: "host-123",
      adapterKind: "host" as const,
      provider: "director-host-api",
      enabled: true,
      healthStatus: "ready" as const,
      dryRunSupported: true,
      mockOnly: true,
      supportedActionClasses: ["read", "write"] as const,
    },
    {
      adapterId: "binding-a",
      adapterKind: "media" as const,
      provider: "binding-a",
      enabled: true,
      healthStatus: "ready" as const,
      dryRunSupported: true,
      mockOnly: true,
      riskLevel: "low" as const,
      approvalMode: "auto_allow" as const,
      permissionScopes: ["media.generate"],
      dataRetentionPolicy: "no-external-retention",
      rateLimitPolicy: "local-preview",
      budgetPolicy: "no-cost",
      supportedActionClasses: ["generate", "write"] as const,
      mediaCapability: {
        adapterId: "binding-a",
        adapterKind: "media" as const,
        provider: "binding-a",
        supportedModes: ["text_to_video"] as const,
        inputModalities: ["text"] as const,
        outputArtifactTypes: ["video"] as const,
        supportsAsync: false,
        healthStatus: "ready" as const,
      },
    },
  ],
  notes: ["preview-safe"],
});

const makeEvaluateResponse = (): DirectorEvaluateResponse => ({
  apiVersion: DIRECTOR_HOST_API_VERSION,
  snapshotId: "snapshot-123",
  runtimeId: "runtime-abc",
  decision: "pass",
  summary: "Director preflight is ready.",
  recommendations: [],
  plan: {
    planId: "plan-1",
    status: "ready",
    summary: "Ready to generate.",
    confidence: 0.92,
    selectedGenerationStyle: "immersive",
    selectedImageBinding: "binding-a",
    selectedVideoBinding: null,
    riskFlags: [],
  },
  execution: {
    executionId: "execution-1",
    selectedGenerationType: "new",
    selectedGenerationStyle: "immersive",
    visiblePrompt: "Project: Director Alpha",
  },
  review: {
    overallDecision: "pass",
    blockingReasons: [],
    requiredFixes: [],
  },
});

const makeIntakePayload = () => ({
  intakeId: "intake-1",
  submittedAt: "2026-04-11T12:00:00.000Z",
  objective: "Build a preview-safe director handoff.",
  desiredOutcome: "A safe blueprint with no side effects.",
  deliverables: ["preview-safe director handoff"],
});

const makeClarification = () => ({
  decision: "ready" as const,
  summary: "Enough information is available.",
  missingFields: [],
  conflictingFields: [],
  questions: [],
});

const makeAlignmentLock = () => ({
  lockId: "alignment-lock-1",
  sourceIntakeId: "intake-1",
  state: "locked" as const,
  lockedAt: "2026-04-11T12:00:00.000Z",
  objective: "Build a preview-safe director handoff.",
  desiredOutcome: "A safe blueprint with no side effects.",
  deliverables: ["preview-safe director handoff"],
  lockedConstraints: [
    {
      field: "group.generationType",
      requirement: "new",
      priority: "required" as const,
    },
  ],
  lockedFields: [],
});

const makeBlueprintResponse = (): DirectorBlueprintResponse => ({
  apiVersion: DIRECTOR_HOST_API_VERSION,
  snapshotId: "snapshot-123",
  runtimeId: "runtime-abc",
  blueprintId: "blueprint-1",
  review: {
    overallDecision: "pass",
    blockingReasons: [],
    requiredFixes: [],
  },
  capabilitySnapshot: makeCapabilitySnapshot(),
  actionGraph: {
    graphId: "graph-1",
    blueprintId: "blueprint-1",
    goal: "Build a preview-safe director handoff.",
    nodes: [
      {
        nodeId: "node-1",
        assignmentId: "assignment-1",
        role: "researcher",
        objective: "Inspect the brief.",
        assignedCapability: "workspace-research",
        inputs: ["snapshot"],
        outputs: ["brief"],
        deliverable: "Research brief",
        acceptanceCriteria: ["Goal is explicit."],
        constraints: [],
        dependsOn: [],
        allowedAdapters: [],
        actionClass: "read",
        approvalMode: "auto_allow",
        escalationToDirector: false,
      },
    ],
    edges: [],
    stopConditions: ["runtime-offline"],
  },
  preview: {
    previewId: "preview-1",
    summary: "Ready to preview.",
    warnings: [],
    blockedReasons: [],
    requiredApprovals: [],
  },
  handoff: {
    handoffId: "handoff-1",
    blueprintId: "blueprint-1",
    createdAt: "2026-04-11T12:00:00.000Z",
    alignmentLockId: "alignment-lock-1",
    actionGraphId: "graph-1",
    previewSummary: "Ready to preview.",
    capabilityMatches: [],
    mediaRequests: [],
    expectedArtifacts: [],
    chosenAdapters: ["binding-a"],
    sideEffectsAllowed: false,
    notes: ["preview-only"],
  },
});

describe("Director host contracts guards", () => {
  it("recognizes a valid host snapshot", () => {
    expect(isDirectorHostSnapshotEnvelope(makeSnapshot())).toBe(true);
    expect(isDirectorHostSnapshotEnvelope({})).toBe(false);
  });

  it("validates evaluate request and evaluate response", () => {
    const request = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: makeSnapshot(),
    };
    expect(isDirectorEvaluateRequest(request)).toBe(true);
    expect(isDirectorEvaluateRequest({ snapshot: makeSnapshot() })).toBe(false);

    expect(isDirectorEvaluateResponse(makeEvaluateResponse())).toBe(true);
    expect(
      isDirectorEvaluateResponse({
        ...makeEvaluateResponse(),
        decision: "unknown",
      }),
    ).toBe(false);
  });

  it("validates runtime, capability snapshot, and catalog payloads", () => {
    const runtime = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      runtimeId: "runtime-abc",
      status: "ready",
      workspaceRoot: "/workspace",
      dataDir: "/workspace/.hotflow",
      defaultProvider: "scripted",
      defaultModel: "hotflow-phase1",
      availableProviders: ["scripted"],
      knowledgePackCount: 1,
      notes: ["Director runtime ready."],
    };
    expect(isDirectorRuntimeResponse(runtime)).toBe(true);
    expect(
      isDirectorRuntimePreflightResponse({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "runtime-abc",
        status: "pass",
        readiness: "ready",
        summaryText: "Director host runtime looks ready.",
        recommendedAction: "POST /v1/entry/intake to start the first bounded host session.",
        recommendedRoute: {
          method: "POST",
          path: "/v1/entry/intake",
        },
        commands: ["hotflow preflight"],
        notes: ["Director runtime ready."],
        surfaces: {
          runtime: {
            status: "pass",
            summaryText: "Runtime is serving requests.",
          },
          adapters: {
            status: "pass",
            summaryText: "Media and execution adapters are visible.",
            counts: {
              total: 3,
              host: 1,
              media: 1,
              execution: 1,
              enabled: 3,
              ready: 3,
              degraded: 0,
              offline: 0,
              mockOnly: 0,
              dryRunSupported: 2,
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      isDirectorRuntimeCapabilitySnapshotRequest({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "runtime-abc",
      }),
    ).toBe(true);
    expect(
      isDirectorRuntimeCapabilitySnapshotResponse({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        runtimeId: "runtime-abc",
        capabilitySnapshot: makeCapabilitySnapshot(),
        agentOsExtensionMatrix: {
          summary: {
            total: 1,
            ready: 1,
            needsAuth: 0,
            needsSetup: 0,
            disabled: 0,
            problem: 0,
          },
          entries: [
            {
              id: "media-understanding.local",
              kind: "provider",
              displayName: "Media Understanding",
              toolId: "media-understanding.local",
              providerId: "media-understanding",
              capabilityIds: ["media.understand_image"],
              health: { status: "ready", checkFn: "media-understanding.local" },
              sandbox: {
                defaultMode: "readonly",
                networkPolicy: "none",
                requiresCommandPattern: false,
              },
              sourceTrust: { status: "built-in", label: "Built-in" },
              uiSurfaces: ["tools", "review"],
            },
          ],
          byCapability: {
            "media.understand_image": [
              {
                id: "media-understanding.local",
                kind: "provider",
                displayName: "Media Understanding",
                toolId: "media-understanding.local",
                providerId: "media-understanding",
                capabilityIds: ["media.understand_image"],
                health: { status: "ready" },
                sandbox: { defaultMode: "readonly", networkPolicy: "none" },
                sourceTrust: { status: "built-in" },
                uiSurfaces: ["tools", "review"],
              },
            ],
          },
        },
        agentOsSubagentRuns: {
          summary: {
            total: 1,
            queued: 0,
            running: 0,
            completed: 1,
            failed: 0,
            cancelled: 0,
            verifiedPass: 1,
            verifiedFail: 0,
            verifiedPartial: 0,
          },
          schedulerHeartbeat: {
            schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
            parentTurnId: "turn-1",
            totalSubagentRuns: 1,
            queuedCount: 0,
            runningCount: 0,
            completedCount: 1,
            failedCount: 0,
            cancelledCount: 0,
            schedulerTrackedCount: 1,
            readyCount: 0,
            blockedCount: 0,
            unscheduledQueuedCount: 0,
            nextReadySubagentIds: [],
            blockedSubagentIds: [],
            runningSubagentIds: [],
            canContinue: false,
            stoppedReason: "mailbox-empty",
            heartbeatOrdinal: 1_700_000_001_000,
            latestUpdatedAtMs: 1_700_000_001_000,
          },
          schedulerDispatchPlan: {
            schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
            parentTurnId: "turn-1",
            planOrdinal: 1_700_000_001_000,
            heartbeatOrdinal: 1_700_000_001_000,
            canDispatch: false,
            dispatchReason: "mailbox-empty",
            maxDispatchableCount: 0,
            dispatchableSubagentIds: [],
            dispatchBatches: [],
            blockedSubagentIds: [],
            runningSubagentIds: [],
          },
          schedulerTick: {
            schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
            sessionId: "run-1",
            latestTurnId: "turn-1",
            dispatchIntents: [
              {
                intentId: "dispatch_delegation-run-1-shot-planner",
                delegationId: "delegation-run-1-shot-planner",
                workerId: "director-shot-planner",
                command: "run-delegation",
                argv: [
                  "run-delegation",
                  "--session-id",
                  "run-1",
                  "--worker-id",
                  "director-shot-planner",
                  "--delegation-id",
                  "delegation-run-1-shot-planner",
                ],
                parallelBatch: 0,
                writeSet: ["shots/plan.md"],
                writeSetSource: "explicit",
              },
            ],
            claimDryRun: true,
          },
          schedulerRecoveryPlan: {
            schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
            parentTurnId: "turn-1",
            canRecover: true,
            blockedSubagentIds: ["delegation-run-1-shot-planner"],
            conflictedSubagentIds: ["delegation-run-1-researcher", "delegation-run-1-shot-planner"],
            recoveryActions: [
              {
                actionId: "recover_delegation-run-1-shot-planner_write_set_overlap",
                subagentId: "delegation-run-1-shot-planner",
                actionType: "wait-for-running-subagent",
                severity: "info",
                reason: "write-set-overlap: shots/plan.md",
                relatedSubagentIds: ["delegation-run-1-researcher"],
                writeSet: ["shots/plan.md"],
                evidence: {
                  blockedBy: ["delegation-run-1-researcher"],
                  conflictsWith: ["delegation-run-1-researcher"],
                },
                operatorSummary:
                  "Wait for running subagent delegation-run-1-researcher before unblocking delegation-run-1-shot-planner.",
              },
              {
                actionId: "recover_delegation-run-1-researcher_observed_write_set_overlap",
                subagentId: "delegation-run-1-researcher",
                actionType: "review-observed-write-set",
                severity: "warning",
                reason: "observed-write-set-overlap: shots/plan.md",
                relatedSubagentIds: ["delegation-run-1-shot-planner"],
                writeSet: ["briefs/notes.md"],
                observedWriteSet: ["briefs/notes.md", "shots/plan.md"],
                undeclaredObservedWriteSet: ["shots/plan.md"],
                evidence: {
                  blockedBy: [],
                  conflictsWith: [],
                  observedConflictWith: ["delegation-run-1-shot-planner"],
                },
                operatorSummary:
                  "Review observed write-set drift for delegation-run-1-researcher before dispatching related subagents.",
              },
            ],
            recoveryGroups: [
              {
                groupId: "recovery_group_write_set_overlap_shots_plan_md",
                groupType: "write-set-overlap",
                severity: "info",
                reason: "write-set-overlap: shots/plan.md",
                actionIds: ["recover_delegation-run-1-shot-planner_write_set_overlap"],
                subagentIds: ["delegation-run-1-shot-planner", "delegation-run-1-researcher"],
                runningSubagentIds: ["delegation-run-1-researcher"],
                blockedSubagentIds: ["delegation-run-1-shot-planner"],
                completedSubagentIds: [],
                writeSet: ["shots/plan.md"],
                operatorSummary:
                  "Review write-set-overlap recovery group for shots/plan.md: 1 running, 1 blocked, 0 completed.",
              },
              {
                groupId: "recovery_group_observed_write_set_overlap_shots_plan_md",
                groupType: "observed-write-set-overlap",
                severity: "warning",
                reason: "observed-write-set-overlap: shots/plan.md",
                actionIds: ["recover_delegation-run-1-researcher_observed_write_set_overlap"],
                subagentIds: ["delegation-run-1-researcher", "delegation-run-1-shot-planner"],
                runningSubagentIds: ["delegation-run-1-researcher"],
                blockedSubagentIds: ["delegation-run-1-shot-planner"],
                completedSubagentIds: [],
                writeSet: ["shots/plan.md"],
                observedWriteSet: ["briefs/notes.md", "shots/plan.md"],
                undeclaredObservedWriteSet: ["shots/plan.md"],
                operatorSummary:
                  "Review observed-write-set-overlap recovery group for shots/plan.md: 1 running, 1 blocked, 0 completed.",
              },
            ],
            recoveryOrdinal: 1_700_000_001_000,
          },
          entries: [
            {
              subagentId: "delegation-run-1-researcher",
              parentTurnId: "turn-1",
              profileId: "director-researcher",
              workerId: "director-researcher",
              taskId: "assignment-1",
              status: "completed",
              role: "explore",
              targetAgent: "director-researcher",
              isolatedContext: true,
              instruction: "Inspect the brief.",
              resultSummary: "Brief inspected.",
              observedWriteSet: ["briefs/notes.md"],
              observedWriteSetSource: "artifact",
              createdAtMs: 1_700_000_000_000,
              updatedAtMs: 1_700_000_001_000,
              completedAtMs: 1_700_000_001_000,
              verification: {
                verificationId: "verification-run-1-researcher",
                verifierId: "director-qc-reviewer",
                status: "passed",
                verdict: "pass",
                verdictSummary: "Looks good.",
                requirement: "Check the brief.",
                checks: [
                  {
                    id: "check-1",
                    status: "pass",
                    summary: "Evidence attached.",
                  },
                ],
              },
              parentVisibleResult: {
                status: "completed",
                summary: "Brief inspected.",
                verificationVerdict: "pass",
                observedWriteSet: ["briefs/notes.md"],
                observedWriteSetSource: "artifact",
              },
              scheduling: {
                parallelGroup: "research",
                writeSet: [],
                writeSetSource: "explicit",
                canRunInParallel: true,
                conflictsWith: [],
                parallelBatch: 0,
                scheduleOrder: 0,
                readyToStart: true,
                blockedBy: [],
              },
            },
          ],
        },
      }),
    ).toBe(true);

    const catalog = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      knowledgePacks: [
        {
          id: "kp-1",
          title: "Sample Pack",
          version: 1,
          stage: "published",
          createdAt: "2026-04-11T12:00:00.000Z",
        },
      ],
    };
    expect(isDirectorKnowledgePackCatalogResponse(catalog)).toBe(true);
  });

  it("validates intake, clarify, blueprint, and outcome payloads", () => {
    const intakeRequest = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: makeSnapshot(),
      intake: makeIntakePayload(),
    };
    expect(isDirectorIntakeRequest(intakeRequest)).toBe(true);

    const intakeResponse = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: "snapshot-123",
      runtimeId: "runtime-abc",
      intakeId: "intake-1",
      capabilitySnapshot: makeCapabilitySnapshot(),
      clarification: makeClarification(),
      alignmentState: "locked",
      alignmentLock: makeAlignmentLock(),
    };
    expect(isDirectorIntakeResponse(intakeResponse)).toBe(true);

    const clarifyRequest = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: makeSnapshot(),
      intake: makeIntakePayload(),
      answers: [],
    };
    expect(isDirectorClarifyRequest(clarifyRequest)).toBe(true);
    expect(
      isDirectorClarifyResponse({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshotId: "snapshot-123",
        runtimeId: "runtime-abc",
        intakeId: "intake-1",
        clarification: makeClarification(),
        alignmentState: "locked",
        alignmentLock: makeAlignmentLock(),
      }),
    ).toBe(true);

    const blueprintRequest = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: makeSnapshot(),
      intake: makeIntakePayload(),
      alignmentLock: makeAlignmentLock(),
      capabilitySnapshot: makeCapabilitySnapshot(),
    };
    expect(isDirectorBlueprintRequest(blueprintRequest)).toBe(true);
    expect(isDirectorBlueprintResponse(makeBlueprintResponse())).toBe(true);

    const outcomeRequest = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: "snapshot-123",
      blueprintId: "blueprint-1",
      handoffId: "handoff-1",
      outcome: {
        outcomeId: "outcome-1",
        status: "accepted",
        recordedAt: "2026-04-11T12:00:00.000Z",
        notes: "ready for next phase",
      },
    };
    expect(isDirectorOutcomeRequest(outcomeRequest)).toBe(true);
    expect(
      isDirectorOutcomeResponse({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshotId: "snapshot-123",
        blueprintId: "blueprint-1",
        handoffId: "handoff-1",
        stored: true,
        outcome: outcomeRequest.outcome,
      }),
    ).toBe(true);
  });
});
