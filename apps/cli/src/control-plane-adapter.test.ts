import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { join } from "node:path";

import { MemoryCoreManager } from "@hotflow/memory-core";
import { SessionStore } from "@hotflow/sessions";
import {
  SKILL_SNAPSHOT_UPSERT_KIND,
  SkillSnapshotFileStore,
  encodeSkillProposalPayload,
} from "@hotflow/skills";
import { describe, expect, test, vi } from "vitest";

import { createCliControlPlane, createCliOperatorControlPlane } from "./control-plane-adapter.js";
import { bootstrapDirectorWorkspace } from "./director-bootstrap.js";

function createTestSessionStore() {
  const tempDir = mkdtempSync(join(tmpdir(), "hotflow-cli-control-plane-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = new SessionStore({ dbPath });

  return {
    tempDir,
    dbPath,
    store,
    cleanup() {
      try {
        store.close();
      } catch {
        // Ignore double-close in tests that reopen the same database path.
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function createHealthyDirectorAssignment(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    assignmentId: "assignment-script-1",
    role: "script-planner",
    objective: "Draft the lighthouse reveal script",
    deliverable: "script outline",
    inputs: ["goal"],
    outputs: ["script outline"],
    acceptanceCriteria: ["Bridge request is accepted."],
    constraints: [],
    actionClass: "generate",
    approvalMode: "auto_allow",
    dependsOn: [],
    status: "completed",
    selectedAdapter: "seedance-preview",
    allowedAdapters: ["seedance-preview"],
    createdAt: "2026-04-13T12:06:00.000Z",
    completedAt: "2026-04-13T12:10:00.000Z",
    notes: ["external-bridge", "bridge:http-json"],
    result: {
      runId: "run-1",
      assignmentId: "assignment-script-1",
      status: "completed",
      recordedAt: "2026-04-13T12:10:00.000Z",
      workerId: "worker-script-1",
      summary: "Bridge request accepted.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 1500,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 202,
          accepted: true,
          requestId: "req-beta9-pass",
          bodyBytes: 48,
        },
      },
    },
    ...overrides,
  };
}

function createDirectorExecutionRunArtifact(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    runId: "run-1",
    snapshotId: "snapshot-1",
    runtimeId: "director-host-api",
    blueprintId: "blueprint-1",
    handoffId: "handoff-1",
    actionGraphId: "graph-1",
    goal: "Generate a single-shot lighthouse reveal video.",
    previewSummary: "Single-shot video brief is ready for remote submission.",
    sideEffectsAllowed: true,
    createdAt: "2026-04-13T12:05:00.000Z",
    updatedAt: "2026-04-13T12:10:00.000Z",
    status: "completed",
    assignments: [createHealthyDirectorAssignment()],
    events: [],
    notes: ["external-bridge-succeeded"],
    ...overrides,
  };
}

function createDirectorExecutionReportArtifact(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    reportId: "report-run-1",
    runId: "run-1",
    run: createDirectorExecutionRunArtifact(),
    recordedAt: "2026-04-13T12:11:00.000Z",
    summary: ["run status=completed"],
    flags: ["external-bridge-succeeded"],
    operatorSurface: {
      directorGoal: "Generate a single-shot lighthouse reveal video.",
      operatorSummary: "Single-shot video brief is ready for remote submission.",
      adapterRoute: "seedance-preview",
      bridgeVerdict: "accepted",
      requestAccepted: true,
      requestId: "req-beta9-pass",
      nextAction: "track the remote request by request id and wait for the downstream result.",
    },
    events: [],
    ...overrides,
  };
}

function seedDirectorRouteRecoveryArtifacts(workspaceRoot: string) {
  bootstrapDirectorWorkspace(workspaceRoot);

  const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
  const executionRunDir = join(runtimeDir, "execution", "runs", "run-warn-1");
  mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
  mkdirSync(executionRunDir, { recursive: true });

  const warnRun = createDirectorExecutionRunArtifact({
    runId: "run-warn-1",
    updatedAt: "2026-04-13T12:40:00.000Z",
    status: "failed",
    assignments: [
      createHealthyDirectorAssignment({
        runId: "run-warn-1",
        assignmentId: "assignment-rerouted-1",
        status: "ready",
        selectedAdapter: "runway-preview",
        allowedAdapters: ["seedance-preview", "runway-preview"],
        createdAt: "2026-04-13T12:20:00.000Z",
        completedAt: undefined,
        notes: [
          "external-bridge",
          "bridge:http-json",
          "Retry requested at 2026-04-13T12:30:00.000Z.",
          "Adapter rerouted from seedance-preview to runway-preview at 2026-04-13T12:31:00.000Z.",
        ],
        result: undefined,
      }),
      createHealthyDirectorAssignment({
        runId: "run-warn-1",
        assignmentId: "assignment-failed-1",
        status: "failed",
        selectedAdapter: "seedance-preview",
        allowedAdapters: ["seedance-preview", "runway-preview"],
        createdAt: "2026-04-13T12:21:00.000Z",
        completedAt: undefined,
        notes: [
          "external-bridge",
          "bridge:http-json",
          "Retry requested at 2026-04-13T12:32:00.000Z.",
        ],
        result: {
          runId: "run-warn-1",
          assignmentId: "assignment-failed-1",
          status: "failed",
          recordedAt: "2026-04-13T12:33:00.000Z",
          workerId: "worker-failed-1",
          summary: "Bridge request failed with retry budget exhausted on the current route.",
          adapterId: "seedance-preview",
          bridgeExecution: {
            kind: "http-json",
            request: {
              endpointOrigin: "https://bridge.example.test",
              endpointPath: "/v1/jobs",
              method: "POST",
              timeoutMs: 1500,
              authMode: "env",
              headerKeys: ["authorization"],
              payloadBytes: 256,
            },
            failure: {
              reason: "http_error",
              retryable: true,
              statusCode: 502,
              message: "Bad gateway",
            },
          },
        },
      }),
    ],
  });

  writeFileSync(join(executionRunDir, "run.json"), JSON.stringify(warnRun), "utf8");
  writeFileSync(
    join(executionRunDir, "report.json"),
    JSON.stringify(
      createDirectorExecutionReportArtifact({
        reportId: "report-warn-1",
        runId: "run-warn-1",
        run: warnRun,
        recordedAt: "2026-04-13T12:41:00.000Z",
        summary: ["run status=failed", "route recovery in progress"],
        flags: ["external-bridge-failed", "route-recovery-in-progress"],
        operatorSurface: {
          directorGoal: "Generate a single-shot lighthouse reveal video.",
          operatorSummary: "One assignment has been rerouted and one still needs manual reroute.",
          adapterRoute: "runway-preview",
          bridgeVerdict: "failed",
          bridgeFailureReason: "http_error",
          retryable: true,
          retryAllowed: false,
          rerouteCandidates: ["runway-preview"],
          nextAction: "reroute the failed assignment to the approved alternate adapter and retry.",
        },
      }),
    ),
    "utf8",
  );
}

function seedDirectorReadyRunArtifacts(workspaceRoot: string) {
  bootstrapDirectorWorkspace(workspaceRoot);

  const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
  const executionRunDir = join(runtimeDir, "execution", "runs", "run-ready-1");
  mkdirSync(join(workspaceRoot, ".hotflow", "sessions"), { recursive: true });
  mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
  mkdirSync(executionRunDir, { recursive: true });

  const readyRun = createDirectorExecutionRunArtifact({
    runId: "run-ready-1",
    updatedAt: "2026-04-14T12:10:00.000Z",
    status: "created",
    previewSummary:
      "A reviewed director run is materialized and waiting for the local worker lane.",
    assignments: [
      createHealthyDirectorAssignment({
        runId: "run-ready-1",
        assignmentId: "assignment-ready-1",
        status: "ready",
        selectedAdapter: "runway-preview",
        allowedAdapters: ["runway-preview"],
        createdAt: "2026-04-14T12:06:00.000Z",
        completedAt: undefined,
        notes: ["external-bridge", "bridge:http-json"],
        result: undefined,
      }),
      createHealthyDirectorAssignment({
        runId: "run-ready-1",
        assignmentId: "assignment-completed-1",
        status: "completed",
        selectedAdapter: "seedance-preview",
        allowedAdapters: ["seedance-preview"],
        createdAt: "2026-04-14T12:05:00.000Z",
        completedAt: "2026-04-14T12:08:00.000Z",
      }),
    ],
  });

  writeFileSync(join(executionRunDir, "run.json"), JSON.stringify(readyRun), "utf8");
  writeFileSync(
    join(executionRunDir, "report.json"),
    JSON.stringify(
      createDirectorExecutionReportArtifact({
        reportId: "report-ready-1",
        runId: "run-ready-1",
        run: readyRun,
        recordedAt: "2026-04-14T12:11:00.000Z",
        summary: ["run status=created", "ready assignments are waiting for worker dispatch"],
        flags: ["ready-assignments-present"],
        operatorSurface: undefined,
      }),
    ),
    "utf8",
  );
}

describe("cli control-plane adapter", () => {
  test("passes director memory and knowledge lane probes through operator doctor dispatch", async () => {
    const runDoctor = vi.fn(async (options?: Record<string, unknown>) => ({
      ok: true,
      status: "pass",
      startedAtMs: 1,
      completedAtMs: 2,
      durationMs: 1,
      checks: [
        {
          id: "director.memory.switch",
          status: "pass",
          summary: "Director memory is enabled by switch.",
          startedAtMs: 1,
          completedAtMs: 2,
          durationMs: 1,
        },
      ],
      probeType: typeof options?.probeDirectorMemoryLane,
    }));

    const operatorPlane = createCliOperatorControlPlane({
      cwd: mkdtempSync(join(tmpdir(), "hotflow-cli-operator-doctor-")),
      runDoctor,
    });

    const result = await operatorPlane.dispatch({
      type: "doctor",
      sessionId: "operator_memory_lane",
    });

    expect(runDoctor).toHaveBeenCalledOnce();
    expect(runDoctor.mock.calls[0]?.[0]).toMatchObject({
      probeDirectorMemoryLane: expect.any(Function),
      probeDirectorKnowledgeLane: expect.any(Function),
    });
    expect(result.ok).toBe(true);
  });

  test("returns a session observation snapshot for status", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_status_snapshot";
    const turnId = "turn_status";
    const memory = new MemoryCoreManager();
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
              reasoning: {
                strategy: "plan-execute",
                confidence: 0.9,
                rationale: "tool-heavy work benefits from an explicit plan/execute turn strategy",
                suggestedAction: "tool",
              },
            },
          },
        },
      });
      setup.store.appendJournal(sessionId, {
        eventType: "tasks.todo_write",
        payload: {
          items: [{ id: "todo_status", content: "status snapshot todo", status: "todo" }],
        },
        createdAtMs: 100,
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 0,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
            {
              id: "session.guidance",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["outputStyle", "permissionMode"],
              metadataPreview: {
                outputStyle: "concise",
                permissionMode: "deny",
              },
            },
          ],
          dynamicSectionIds: ["user-input", "session.guidance"],
          omittedSections: [
            { id: "working-memory.recall-1", cacheBucket: "dynamic", owner: "memory" },
          ],
          omittedSectionIds: ["working-memory.recall-1"],
          usedTokens: 480,
          remainingTokens: 1520,
          runtimeDegradations: [],
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 1,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
            {
              id: "session.guidance",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["outputStyle", "permissionMode"],
              metadataPreview: {
                outputStyle: "concise",
                permissionMode: "deny",
              },
            },
            {
              id: "runtime.tool-status",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["impactedTools", "status"],
              metadataPreview: {
                impactedTools: 2,
                status: "degraded",
              },
            },
          ],
          dynamicSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
          omittedSections: [
            { id: "runtime.degradations", cacheBucket: "dynamic", owner: "runtime" },
          ],
          omittedSectionIds: ["runtime.degradations"],
          usedTokens: 620,
          remainingTokens: 1380,
          runtimeDegradations: [
            {
              stage: "context",
              category: "budget",
              action: "degrade",
              severity: "warn",
              reason: "token_budget_low",
              message: "Prompt recall sections were trimmed by budget.",
              recoverable: true,
            },
          ],
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 1,
        eventType: "step.tool_result",
        payload: {
          results: [{ toolName: "tasks.todo_write", resolution: "executed", ok: true }],
        },
      });
      memory.writeLayer0({
        content: "working-status-note",
        scope: { sessionId },
      });
      memory.writeLayer1({
        content: "episodic-status-note",
        scope: { sessionId },
      });
      setup.store.appendJournal(sessionId, {
        eventType: "control.memory_clear",
        payload: {
          scope: "working",
          beforeLayer0Count: 2,
          beforeLayer1Count: 1,
          layer0Cleared: 1,
          layer1Cleared: 0,
          afterLayer0Count: 1,
          afterLayer1Count: 1,
          layer0Ids: ["working-a"],
          layer1Ids: [],
        },
        createdAtMs: 130,
      });
      setup.store.appendJournal(sessionId, {
        eventType: "control.response_language",
        payload: {
          previousLanguage: "follow-user",
          language: "zh-CN",
        },
        createdAtMs: 135,
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        memory,
      });
      const result = await controlPlane.dispatch({
        type: "status",
        sessionId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        firstTodo: "status snapshot todo",
        workingMemoryEntries: 1,
        episodicMemoryEntries: 1,
        latestMemoryControl: {
          action: "clear",
          scope: "working",
          journalSeq: 5,
          occurredAtMs: 130,
          beforeWorkingMemoryEntries: 2,
          beforeEpisodicMemoryEntries: 1,
          afterWorkingMemoryEntries: 1,
          afterEpisodicMemoryEntries: 1,
        },
        latestGuidanceControl: {
          action: "response-language",
          value: "zh-CN",
          previousValue: "follow-user",
          journalSeq: 6,
          occurredAtMs: 135,
        },
        latestTurnId: turnId,
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        auditEvents: 0,
        streamEvents: 0,
        step: {
          promptSummary: {
            stepIndex: 1,
            previousStepIndex: 0,
            focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
            focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
            omittedSectionIds: ["runtime.degradations"],
            omittedSectionSummaries: ["runtime degradations"],
            addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
            addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
            removedDynamicSectionIds: ["user-input"],
            removedDynamicSectionSummaries: ["user input"],
            sessionGuidance: {
              outputStyle: "concise",
              permissionMode: "deny",
            },
            effectiveGuidance: {
              outputStyle: "concise",
              permissionMode: "deny",
              responseLanguage: "follow-user",
            },
            effectiveGuidanceSources: {
              outputStyle: "session-override",
              permissionMode: "session-override",
              responseLanguage: "runtime-default",
            },
            toolRuntimeGuidance: {
              impactedTools: 2,
              status: "degraded",
            },
            runtimeDegradationSummaries: ["budget trim [warn]"],
          },
        },
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "follow-user",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "runtime-default",
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  test("preserves historical prompt guidance evidence inside status prompt summaries", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_status_prompt_evidence";
    const turnId = "turn_status_prompt_evidence";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 0,
        eventType: "step.context_built",
        payload: {
          staticSections: [
            { id: "system.identity", cacheBucket: "static", owner: "runtime" },
            { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
            {
              id: "system.output-style",
              cacheBucket: "static",
              owner: "runtime",
              metadataKeys: ["outputStyle", "source"],
              metadataPreview: {
                outputStyle: "verbose",
                source: "runtime-default",
              },
            },
            {
              id: "system.permission-mode",
              cacheBucket: "static",
              owner: "runtime",
              metadataKeys: ["permissionMode", "source"],
              metadataPreview: {
                permissionMode: "allow",
                source: "runtime-default",
              },
            },
            {
              id: "system.response-language",
              cacheBucket: "static",
              owner: "runtime",
              metadataKeys: ["responseLanguage", "source"],
              metadataPreview: {
                responseLanguage: "fr",
                source: "runtime-default",
              },
            },
          ],
          staticSectionIds: [
            "system.identity",
            "system.runtime",
            "system.output-style",
            "system.permission-mode",
            "system.response-language",
          ],
          dynamicSections: [
            { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
            {
              id: "session.output-style",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["outputStyle", "source"],
              metadataPreview: {
                outputStyle: "concise",
                source: "session-override",
              },
            },
          ],
          dynamicSectionIds: ["user-input", "session.output-style"],
          omittedSections: [],
          omittedSectionIds: [],
          usedTokens: 540,
          remainingTokens: 1460,
          runtimeDegradations: [],
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        env: {
          HOTFLOW_OUTPUT_STYLE: "normal",
          HOTFLOW_PERMISSION_MODE: "ask",
          HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
        },
      });
      const result = await controlPlane.dispatch({
        type: "status",
        sessionId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "ask",
          responseLanguage: "zh-CN",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "runtime-default",
          responseLanguage: "runtime-default",
        },
        step: {
          promptSummary: {
            sessionGuidance: {
              outputStyle: "concise",
            },
            effectiveGuidance: {
              outputStyle: "concise",
              permissionMode: "allow",
              responseLanguage: "fr",
            },
            effectiveGuidanceSources: {
              outputStyle: "session-override",
              permissionMode: "runtime-default",
              responseLanguage: "runtime-default",
            },
          },
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  test("returns a prompt inspect snapshot from persisted context-built evidence", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_prompt_inspect";
    const turnId = "turn_prompt";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 0,
        eventType: "step.context_built",
        payload: {
          staticSections: [
            {
              id: "system.identity",
              cacheBucket: "static",
              owner: "runtime",
            },
            {
              id: "system.runtime",
              cacheBucket: "static",
              owner: "runtime",
            },
            {
              id: "system.output-style",
              cacheBucket: "static",
              owner: "runtime",
            },
            {
              id: "system.permission-mode",
              cacheBucket: "static",
              owner: "runtime",
            },
            {
              id: "system.response-language",
              cacheBucket: "static",
              owner: "runtime",
            },
          ],
          staticSectionIds: [
            "system.identity",
            "system.runtime",
            "system.output-style",
            "system.permission-mode",
            "system.response-language",
          ],
          dynamicSections: [
            {
              id: "user-input",
              cacheBucket: "dynamic",
              owner: "turn",
              priority: 100,
            },
            {
              id: "session.guidance",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["outputStyle", "permissionMode"],
              metadataPreview: {
                outputStyle: "concise",
                permissionMode: "deny",
              },
            },
            {
              id: "runtime.tool-status",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["status", "impactedTools", "previewedTools", "toolPreview"],
              metadataPreview: {
                status: "degraded",
                impactedTools: 2,
                previewedTools: 2,
                toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
              },
            },
            {
              id: "runtime.turn-resume",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["resumeAction", "nextStepIndex", "recoveredToolResults"],
              metadataPreview: {
                resumeAction: "continue-current-step",
                nextStepIndex: 1,
                recoveredToolResults: 1,
              },
            },
            {
              id: "session.latest-turn",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["turnId", "runtimeStatus", "turnBranch"],
              metadataPreview: {
                turnId: "turn_previous",
                runtimeStatus: "blocked",
                turnBranch: "approval-required",
              },
            },
          ],
          dynamicSectionIds: [
            "user-input",
            "session.guidance",
            "runtime.tool-status",
            "runtime.turn-resume",
            "session.latest-turn",
          ],
          omittedSections: [
            {
              id: "working-memory.recall-1",
              cacheBucket: "dynamic",
              owner: "memory",
            },
          ],
          omittedSectionIds: ["working-memory.recall-1"],
          usedTokens: 512,
          remainingTokens: 1536,
          runtimeDegradations: [
            {
              stage: "context",
              category: "budget",
              action: "degrade",
              severity: "warn",
              reason: "token_budget_low",
              message: "Prompt recall sections were trimmed by budget.",
              recoverable: true,
            },
          ],
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const result = await controlPlane.dispatch({
        type: "prompt-inspect",
        sessionId,
        turnId,
        stepIndex: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        turnId,
        stepIndex: 0,
        availableStepIndices: [0],
        usedTokens: 512,
        remainingTokens: 1536,
        runtimeShellSectionIds: ["system.runtime"],
        runtimeShellSectionSummaries: ["runtime shell"],
        staticGuidanceSectionIds: [
          "system.output-style",
          "system.permission-mode",
          "system.response-language",
        ],
        staticGuidanceSectionSummaries: [
          "default output style guidance",
          "default permission mode guidance",
          "default response language guidance",
        ],
        focusSectionIds: [
          "user-input",
          "session.guidance",
          "runtime.tool-status",
          "runtime.turn-resume",
          "session.latest-turn",
        ],
        focusSectionSummaries: [
          "user input",
          "session guidance",
          "tool runtime guidance",
          "turn resume guidance",
          "latest turn guidance",
        ],
        omittedSectionIds: ["working-memory.recall-1"],
        omittedSectionSummaries: ["working memory recall 1"],
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
        },
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "follow-user",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "runtime-default",
        },
        toolRuntimeGuidance: {
          status: "degraded",
          impactedTools: 2,
          previewedTools: 2,
          toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
        },
        turnResumeGuidance: {
          resumeAction: "continue-current-step",
          nextStepIndex: 1,
          recoveredToolResults: 1,
        },
        latestTurnGuidance: {
          turnId: "turn_previous",
          runtimeStatus: "blocked",
          turnBranch: "approval-required",
        },
        runtimeDegradationSummaries: ["budget trim [warn]"],
        staticSections: [
          {
            id: "system.identity",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.runtime",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.output-style",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.permission-mode",
            cacheBucket: "static",
            owner: "runtime",
          },
          {
            id: "system.response-language",
            cacheBucket: "static",
            owner: "runtime",
          },
        ],
        dynamicSections: [
          {
            id: "user-input",
            cacheBucket: "dynamic",
            owner: "turn",
            priority: 100,
          },
          {
            id: "session.guidance",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["outputStyle", "permissionMode"],
            metadataPreview: {
              outputStyle: "concise",
              permissionMode: "deny",
            },
          },
          {
            id: "runtime.tool-status",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["status", "impactedTools", "previewedTools", "toolPreview"],
            metadataPreview: {
              status: "degraded",
              impactedTools: 2,
              previewedTools: 2,
              toolPreview: "filesystem.read_text:degraded|tools.exec:missing",
            },
          },
          {
            id: "runtime.turn-resume",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["resumeAction", "nextStepIndex", "recoveredToolResults"],
            metadataPreview: {
              resumeAction: "continue-current-step",
              nextStepIndex: 1,
              recoveredToolResults: 1,
            },
          },
          {
            id: "session.latest-turn",
            cacheBucket: "dynamic",
            owner: "runtime",
            metadataKeys: ["turnId", "runtimeStatus", "turnBranch"],
            metadataPreview: {
              turnId: "turn_previous",
              runtimeStatus: "blocked",
              turnBranch: "approval-required",
            },
          },
        ],
        omittedSections: [
          {
            id: "working-memory.recall-1",
            cacheBucket: "dynamic",
            owner: "memory",
          },
        ],
        runtimeDegradations: [
          {
            stage: "context",
            category: "budget",
            severity: "warn",
            reason: "token_budget_low",
            message: "Prompt recall sections were trimmed by budget.",
          },
        ],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("returns a prompt explain snapshot derived from consecutive context-built evidence", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_prompt_explain";
    const turnId = "turn_prompt_explain";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 0,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
            {
              id: "session.guidance",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["outputStyle", "permissionMode"],
              metadataPreview: {
                outputStyle: "verbose",
                permissionMode: "ask",
              },
            },
          ],
          dynamicSectionIds: ["user-input", "session.guidance"],
          omittedSections: [
            { id: "working-memory.recall-1", cacheBucket: "dynamic", owner: "memory" },
          ],
          omittedSectionIds: ["working-memory.recall-1"],
          usedTokens: 480,
          remainingTokens: 1550,
          runtimeDegradations: [],
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 1,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
            {
              id: "session.guidance",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["outputStyle", "permissionMode"],
              metadataPreview: {
                outputStyle: "verbose",
                permissionMode: "ask",
              },
            },
            {
              id: "runtime.tool-status",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["impactedTools", "status"],
              metadataPreview: {
                impactedTools: 2,
                status: "degraded",
              },
            },
          ],
          dynamicSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
          omittedSections: [
            { id: "runtime.degradations", cacheBucket: "dynamic", owner: "runtime" },
          ],
          omittedSectionIds: ["runtime.degradations"],
          usedTokens: 620,
          remainingTokens: 1380,
          runtimeDegradations: [
            {
              stage: "context",
              category: "budget",
              action: "degrade",
              severity: "warn",
              reason: "token_budget_low",
              message: "Prompt recall sections were trimmed by budget.",
              recoverable: true,
            },
          ],
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const result = await controlPlane.dispatch({
        type: "prompt-explain",
        sessionId,
        turnId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        turnId,
        stepIndex: 1,
        previousStepIndex: 0,
        availableStepIndices: [0, 1],
        usedTokens: 620,
        remainingTokens: 1380,
        focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
        focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
        omittedSectionIds: ["runtime.degradations"],
        omittedSectionSummaries: ["runtime degradations"],
        addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
        addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
        removedDynamicSectionIds: ["user-input"],
        removedDynamicSectionSummaries: ["user input"],
        newlyOmittedSectionIds: ["runtime.degradations"],
        newlyOmittedSectionSummaries: ["runtime degradations"],
        restoredOmittedSectionIds: ["working-memory.recall-1"],
        restoredOmittedSectionSummaries: ["working memory recall 1"],
        sessionGuidance: {
          outputStyle: "verbose",
          permissionMode: "ask",
        },
        effectiveGuidance: {
          outputStyle: "verbose",
          permissionMode: "ask",
          responseLanguage: "follow-user",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "runtime-default",
        },
        toolRuntimeGuidance: {
          impactedTools: 2,
          status: "degraded",
        },
        runtimeDegradationSummaries: ["budget trim [warn]"],
        runtimeDegradations: [
          {
            stage: "context",
            category: "budget",
            severity: "warn",
            reason: "token_budget_low",
            message: "Prompt recall sections were trimmed by budget.",
          },
        ],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("returns a prompt inspect snapshot with change summaries from consecutive context-built evidence", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_prompt_inspect_changes";
    const turnId = "turn_prompt_inspect_changes";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 0,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
            { id: "session.guidance", cacheBucket: "dynamic", owner: "runtime" },
          ],
          dynamicSectionIds: ["user-input", "session.guidance"],
          omittedSections: [
            { id: "working-memory.recall-1", cacheBucket: "dynamic", owner: "memory" },
          ],
          omittedSectionIds: ["working-memory.recall-1"],
          usedTokens: 480,
          remainingTokens: 1520,
          runtimeDegradations: [],
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 1,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            { id: "tool-results", cacheBucket: "dynamic", owner: "turn", priority: 80 },
            { id: "session.guidance", cacheBucket: "dynamic", owner: "runtime" },
            { id: "runtime.tool-status", cacheBucket: "dynamic", owner: "runtime" },
          ],
          dynamicSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
          omittedSections: [
            { id: "runtime.degradations", cacheBucket: "dynamic", owner: "runtime" },
          ],
          omittedSectionIds: ["runtime.degradations"],
          usedTokens: 620,
          remainingTokens: 1380,
          runtimeDegradations: [],
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const result = await controlPlane.dispatch({
        type: "prompt-inspect",
        sessionId,
        turnId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        turnId,
        stepIndex: 1,
        previousStepIndex: 0,
        focusSectionIds: ["tool-results", "session.guidance", "runtime.tool-status"],
        focusSectionSummaries: ["tool results", "session guidance", "tool runtime guidance"],
        omittedSectionIds: ["runtime.degradations"],
        omittedSectionSummaries: ["runtime degradations"],
        addedDynamicSectionIds: ["tool-results", "runtime.tool-status"],
        addedDynamicSectionSummaries: ["tool results", "tool runtime guidance"],
        removedDynamicSectionIds: ["user-input"],
        removedDynamicSectionSummaries: ["user input"],
        newlyOmittedSectionIds: ["runtime.degradations"],
        newlyOmittedSectionSummaries: ["runtime degradations"],
        restoredOmittedSectionIds: ["working-memory.recall-1"],
        restoredOmittedSectionSummaries: ["working memory recall 1"],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("keeps prompt explain guidance anchored to stored prompt evidence when config has changed", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_prompt_explain_evidence";
    const turnId = "turn_prompt_explain_evidence";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 0,
        eventType: "step.context_built",
        payload: {
          staticSections: [
            { id: "system.identity", cacheBucket: "static", owner: "runtime" },
            { id: "system.runtime", cacheBucket: "static", owner: "runtime" },
            {
              id: "system.output-style",
              cacheBucket: "static",
              owner: "runtime",
              metadataKeys: ["outputStyle", "source"],
              metadataPreview: {
                outputStyle: "verbose",
                source: "runtime-default",
              },
            },
            {
              id: "system.permission-mode",
              cacheBucket: "static",
              owner: "runtime",
              metadataKeys: ["permissionMode", "source"],
              metadataPreview: {
                permissionMode: "allow",
                source: "runtime-default",
              },
            },
            {
              id: "system.response-language",
              cacheBucket: "static",
              owner: "runtime",
              metadataKeys: ["responseLanguage", "source"],
              metadataPreview: {
                responseLanguage: "fr",
                source: "runtime-default",
              },
            },
          ],
          staticSectionIds: [
            "system.identity",
            "system.runtime",
            "system.output-style",
            "system.permission-mode",
            "system.response-language",
          ],
          dynamicSections: [
            { id: "user-input", cacheBucket: "dynamic", owner: "turn" },
            {
              id: "session.output-style",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["outputStyle", "source"],
              metadataPreview: {
                outputStyle: "concise",
                source: "session-override",
              },
            },
          ],
          dynamicSectionIds: ["user-input", "session.output-style"],
          omittedSections: [],
          omittedSectionIds: [],
          usedTokens: 545,
          remainingTokens: 1455,
          runtimeDegradations: [],
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        env: {
          HOTFLOW_OUTPUT_STYLE: "normal",
          HOTFLOW_PERMISSION_MODE: "ask",
          HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
        },
      });
      const result = await controlPlane.dispatch({
        type: "prompt-explain",
        sessionId,
        turnId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        turnId,
        stepIndex: 0,
        runtimeShellSectionIds: ["system.runtime"],
        runtimeShellSectionSummaries: ["runtime shell"],
        staticGuidanceSectionIds: [
          "system.output-style",
          "system.permission-mode",
          "system.response-language",
        ],
        sessionGuidance: {
          outputStyle: "concise",
        },
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "allow",
          responseLanguage: "fr",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "runtime-default",
          responseLanguage: "runtime-default",
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  test("returns turn resume guidance through the CLI control-plane prompt explain action", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_prompt_turn_resume";
    const turnId = "turn_prompt_turn_resume";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 1,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            {
              id: "runtime.turn-resume",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["resumeAction", "nextStepIndex", "recoveredToolResults"],
              metadataPreview: {
                resumeAction: "continue-current-step",
                nextStepIndex: 1,
                recoveredToolResults: 1,
              },
            },
          ],
          dynamicSectionIds: ["runtime.turn-resume"],
          omittedSections: [],
          omittedSectionIds: [],
          usedTokens: 320,
          remainingTokens: 1680,
          runtimeDegradations: [],
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const result = await controlPlane.dispatch({
        type: "prompt-explain",
        sessionId,
        turnId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        turnId,
        stepIndex: 1,
        availableStepIndices: [1],
        focusSectionIds: ["runtime.turn-resume"],
        focusSectionSummaries: ["turn resume guidance"],
        turnResumeGuidance: {
          resumeAction: "continue-current-step",
          nextStepIndex: 1,
          recoveredToolResults: 1,
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  test("returns latest turn guidance through the CLI control-plane prompt explain action", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_prompt_latest_turn";
    const turnId = "turn_prompt_latest_turn";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 1,
        eventType: "step.context_built",
        payload: {
          staticSections: [{ id: "system.identity", cacheBucket: "static", owner: "runtime" }],
          staticSectionIds: ["system.identity"],
          dynamicSections: [
            {
              id: "session.latest-turn",
              cacheBucket: "dynamic",
              owner: "runtime",
              metadataKeys: ["turnId", "runtimeStatus", "turnBranch"],
              metadataPreview: {
                turnId: "turn_previous",
                runtimeStatus: "blocked",
                turnBranch: "approval-required",
              },
            },
          ],
          dynamicSectionIds: ["session.latest-turn"],
          omittedSections: [],
          omittedSectionIds: [],
          usedTokens: 360,
          remainingTokens: 1640,
          runtimeDegradations: [],
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const result = await controlPlane.dispatch({
        type: "prompt-explain",
        sessionId,
        turnId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        turnId,
        stepIndex: 1,
        availableStepIndices: [1],
        focusSectionIds: ["session.latest-turn"],
        focusSectionSummaries: ["latest turn guidance"],
        latestTurnGuidance: {
          turnId: "turn_previous",
          runtimeStatus: "blocked",
          turnBranch: "approval-required",
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  test("inspects session memory through the CLI control-plane and writes journal evidence", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_memory_inspect";
    const memory = new MemoryCoreManager();
    try {
      setup.store.createSession({ sessionId });
      const layer0 = memory.writeLayer0({
        content: "working-note",
        scope: { sessionId },
      });
      const layer1 = memory.writeLayer1({
        content: "episodic-note",
        scope: { sessionId },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        memory,
      });
      const result = await controlPlane.dispatch({
        type: "memory-inspect",
        sessionId,
        scope: "all",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        scope: "all",
        layer0Count: 1,
        layer1Count: 1,
        layer0Ids: [layer0.id],
        layer1Ids: [layer1.id],
      });

      const inspectJournal = setup.store.journal
        .list(sessionId)
        .find((entry) => entry.eventType === "control.memory_inspect");
      expect(inspectJournal?.payload).toMatchObject({
        scope: "all",
        layer0Count: 1,
        layer1Count: 1,
        layer0Ids: [layer0.id],
        layer1Ids: [layer1.id],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("clears session memory through the CLI control-plane and writes before/after closure", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_memory_clear";
    const memory = new MemoryCoreManager();
    try {
      setup.store.createSession({ sessionId });
      const layer0 = memory.writeLayer0({
        content: "working-note",
        scope: { sessionId },
      });
      const layer1 = memory.writeLayer1({
        content: "episodic-note",
        scope: { sessionId },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        memory,
      });
      const result = await controlPlane.dispatch({
        type: "memory-clear",
        sessionId,
        scope: "all",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        scope: "all",
        beforeLayer0Count: 1,
        beforeLayer1Count: 1,
        layer0Cleared: 1,
        layer1Cleared: 1,
        afterLayer0Count: 0,
        afterLayer1Count: 0,
        layer0Ids: [layer0.id],
        layer1Ids: [layer1.id],
      });
      expect(memory.layer0.listByScope({ sessionId })).toEqual([]);
      expect(memory.layer1.listByScope({ sessionId })).toEqual([]);

      const clearJournal = setup.store.journal
        .list(sessionId)
        .find((entry) => entry.eventType === "control.memory_clear");
      expect(clearJournal?.payload).toMatchObject({
        scope: "all",
        beforeLayer0Count: 1,
        beforeLayer1Count: 1,
        layer0Cleared: 1,
        layer1Cleared: 1,
        afterLayer0Count: 0,
        afterLayer1Count: 0,
        layer0Ids: [layer0.id],
        layer1Ids: [layer1.id],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("returns a structured resume snapshot through the CLI control-plane", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_resume";
    const turnId = "turn_resume";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId,
              providerId: "openai-live",
              model: "gpt-5-mini",
            },
          },
        },
      });
      setup.store.appendJournal(sessionId, {
        eventType: "tasks.todo_write",
        payload: {
          items: [{ id: "todo_1", content: "draft intro", status: "doing" }],
        },
      });
      setup.store.appendStepJournal(sessionId, {
        turnId,
        stepIndex: 1,
        eventType: "step.tool_result",
        payload: {
          results: [{ toolName: "tasks.todo_write", resolution: "executed", ok: true }],
        },
      });
      setup.store.appendStreamEvent(sessionId, {
        turnId,
        event: {
          id: "stream_reasoning_resume",
          kind: "stream.reasoning",
          schemaVersion: "0.1.0",
          occurredAtMs: 1710000000000,
          payload: {
            turnId,
            decision: {
              strategy: "react",
            },
          },
        },
      });
      const checkpoint = setup.store.createCheckpoint(sessionId, {
        state: {
          tasks: {
            items: [{ id: "todo_1", content: "draft intro", status: "doing" }],
          },
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const result = await controlPlane.dispatch({
        type: "resume",
        sessionId,
        checkpointId: checkpoint.checkpointId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        requestedCheckpointId: checkpoint.checkpointId,
        checkpointId: checkpoint.checkpointId,
        checkpointUptoSeq: checkpoint.uptoSeq,
        latestTurnId: turnId,
        latestTurnProviderId: "openai-live",
        latestTurnModel: "gpt-5-mini",
        recoveryReasoningStrategy: "react",
        recoveryReasoningSource: "stream-evidence",
        resumable: true,
        resumeAction: "start-next-step",
        nextStepIndex: 2,
        runtimeStatus: "healthy",
      });
    } finally {
      setup.cleanup();
    }
  });

  test("rewinds session state through the CLI control-plane", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_rewind";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          runtime: {
            latestTurn: {
              turnId: "turn_future",
              runtimeStatus: "healthy",
              turnBranch: "normal",
            },
          },
        },
      });
      const previousCheckpoint = setup.store.createCheckpoint(sessionId, {
        state: {
          tasks: {
            items: [{ id: "todo_1", content: "draft", status: "todo" }],
          },
        },
      });
      setup.store.appendJournal(sessionId, {
        eventType: "tasks.todo_write",
        payload: {
          items: [{ id: "todo_2", content: "review", status: "doing" }],
        },
        turnId: "turn_future",
      });
      const currentCheckpoint = setup.store.createCheckpoint(sessionId, {
        state: {
          tasks: {
            items: [{ id: "todo_2", content: "review", status: "doing" }],
          },
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const result = await controlPlane.dispatch({
        type: "rewind",
        sessionId,
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        selection: "previous",
        requestedCheckpointId: null,
        targetCheckpointId: previousCheckpoint.checkpointId,
        targetUptoSeq: previousCheckpoint.uptoSeq,
        latestTurnId: null,
        clearedLatestTurn: true,
      });
      expect((result.data as { currentCheckpointId: number }).currentCheckpointId).toBeGreaterThan(
        currentCheckpoint.checkpointId,
      );

      const recovered = setup.store.recover<{ tasks: { items: Array<{ id: string }> } }>(sessionId);
      expect(recovered.state.tasks.items.map((item) => item.id)).toEqual(["todo_1"]);
      expect(setup.store.getLatestTurnId(sessionId)).toBeNull();
      expect(
        setup.store.getSession(sessionId)?.metadata.runtime &&
          typeof setup.store.getSession(sessionId)?.metadata.runtime === "object" &&
          !Array.isArray(setup.store.getSession(sessionId)?.metadata.runtime)
          ? "latestTurn" in (setup.store.getSession(sessionId)?.metadata.runtime as object)
          : false,
      ).toBe(false);
    } finally {
      setup.cleanup();
    }
  });

  test("soft compaction rewrites older working memory into a shorter summary", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_compact_soft";
    const memory = new MemoryCoreManager();
    try {
      setup.store.createSession({ sessionId });
      const newest = memory.writeLayer0({
        content: "Latest working note that should stay intact.",
        scope: { sessionId, namespace: "conversation" },
        timestamp: 300,
      });
      const olderA = memory.writeLayer0({
        content:
          "Older planning note with repeated workspace details and rationale that should be compressed into a shorter summary block.",
        scope: { sessionId, namespace: "conversation" },
        timestamp: 200,
      });
      const olderB = memory.writeLayer0({
        content:
          "Another older assistant output carrying duplicate context, intermediate decisions, and verbose text that no longer needs to remain verbatim.",
        scope: { sessionId, namespace: "assistant-output" },
        timestamp: 100,
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        memory,
      });
      const result = await controlPlane.dispatch({
        type: "compact",
        sessionId,
        strategy: "soft",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        compacted: true,
        strategy: "soft",
      });

      const payload = result.data as {
        beforeTokens: number;
        afterTokens: number;
        removedEntryIds: string[];
        summaryEntryIds: string[];
      };
      expect(payload.beforeTokens).toBeGreaterThan(payload.afterTokens);
      expect(payload.removedEntryIds).toEqual([olderA.id, olderB.id]);
      expect(payload.summaryEntryIds).toHaveLength(1);

      const layer0Entries = memory.layer0.listByScope({ sessionId });
      expect(layer0Entries).toHaveLength(2);
      expect(layer0Entries.some((entry) => entry.id === newest.id)).toBe(true);
      const summaryEntry = layer0Entries.find((entry) => entry.id !== newest.id);
      expect(summaryEntry?.scope.namespace).toBe("compaction");
      expect(summaryEntry?.metadata.strategy).toBe("soft");
      expect(memory.layer0.get(olderA.id)).toBeUndefined();
      expect(memory.layer0.get(olderB.id)).toBeUndefined();

      const compactJournal = setup.store.journal
        .list(sessionId)
        .find((entry) => entry.eventType === "control.compact");
      expect(compactJournal?.payload).toMatchObject({
        strategy: "soft",
        compacted: true,
        removedEntryIds: [olderA.id, olderB.id],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("hard compaction merges both memory layers into one layer1 summary", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_compact_hard";
    const memory = new MemoryCoreManager();
    try {
      setup.store.createSession({ sessionId });
      const layer0Entry = memory.writeLayer0({
        content:
          "Working-memory note with long operational detail that can be collapsed during a hard compaction pass.",
        scope: { sessionId, namespace: "conversation" },
        metadata: {
          memoryAdmission: {
            category: "preference",
            retention: "user",
            confidence: 0.9,
            score: 0.9,
            reason: "test:user-memory",
            safety: { safe: true, findings: [] },
          },
        },
        timestamp: 200,
      });
      const layer1Entry = memory.writeLayer1({
        content:
          "Episodic-memory note with repeated context and historical detail that should fold into the compacted session summary.",
        scope: { sessionId, namespace: "history" },
        metadata: {
          memoryAdmission: {
            category: "preference",
            retention: "user",
            confidence: 0.9,
            score: 0.9,
            reason: "test:user-memory",
            safety: { safe: true, findings: [] },
          },
        },
        timestamp: 100,
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        memory,
      });
      const result = await controlPlane.dispatch({
        type: "compact",
        sessionId,
        strategy: "hard",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        compacted: true,
        strategy: "hard",
      });

      const payload = result.data as {
        beforeTokens: number;
        afterTokens: number;
        removedEntryIds: string[];
        summaryEntryIds: string[];
      };
      expect(payload.beforeTokens).toBeGreaterThan(payload.afterTokens);
      expect(payload.removedEntryIds).toEqual([layer0Entry.id, layer1Entry.id]);
      expect(payload.summaryEntryIds).toHaveLength(1);

      expect(memory.layer0.listByScope({ sessionId })).toEqual([]);
      const layer1Entries = memory.layer1.listByScope({ sessionId });
      expect(layer1Entries).toHaveLength(1);
      expect(layer1Entries[0]?.scope.namespace).toBe("compaction");
      expect(layer1Entries[0]?.metadata.strategy).toBe("hard");
      expect(layer1Entries[0]?.metadata.memoryAdmission).toMatchObject({
        category: "conversation",
        retention: "user",
        reason: "system:hard-compaction-summary",
      });
      expect(layer1Entries[0]?.tags).toEqual(
        expect.arrayContaining(["memory:compaction", "memory:system-summary"]),
      );
      expect(memory.layer1.get(layer1Entry.id)).toBeUndefined();
    } finally {
      setup.cleanup();
    }
  });

  test("hard compaction only summarizes admissible user memory sources", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_compact_hard_filters_sources";
    const memory = new MemoryCoreManager();
    try {
      setup.store.createSession({ sessionId });
      const acceptedPreference = memory.writeLayer0({
        content:
          "User preference: always explain implementation tradeoffs briefly before editing files, keep final responses concise, and preserve this preference across sessions. This accepted preference is intentionally verbose so a hard compaction summary can be shorter than the source memory while still retaining the user preference signal.",
        scope: { sessionId, namespace: "conversation" },
        tags: ["memory:preference"],
        metadata: {
          memoryAdmission: {
            category: "preference",
            retention: "user",
            confidence: 0.95,
            score: 0.95,
            reason: "test:accepted-user-preference",
            safety: { safe: true, findings: [] },
          },
        },
        timestamp: 400,
      });
      const assistantOutput = memory.writeLayer0({
        content:
          "Assistant draft output with verbose transient reasoning that must not become long-term memory through hard compaction.",
        scope: { sessionId, namespace: "assistant-output" },
        tags: ["memory:assistant-output"],
        metadata: {
          memoryAdmission: {
            category: "working",
            retention: "working",
            confidence: 0.8,
            score: 0.6,
            reason: "test:assistant-output",
            safety: { safe: true, findings: [] },
          },
        },
        timestamp: 300,
      });
      const quarantinedSecret = memory.writeLayer1({
        content: "User secret: [redacted:api-key] must stay quarantined.",
        scope: { sessionId, namespace: "memory:quarantine" },
        tags: ["memory:quarantine", "memory:safety"],
        metadata: {
          memoryAdmission: {
            category: "secret",
            retention: "quarantine",
            confidence: 0.99,
            score: 0,
            reason: "test:secret-quarantine",
            safety: {
              safe: false,
              findings: [{ type: "api-key" }],
            },
          },
        },
        timestamp: 200,
      });
      const noise = memory.writeLayer1({
        content: "thanks lol",
        scope: { sessionId, namespace: "memory:discarded" },
        tags: ["memory:noise"],
        metadata: {
          memoryAdmission: {
            category: "chitchat",
            retention: "none",
            confidence: 0.99,
            score: 0.05,
            reason: "test:noise",
            safety: { safe: true, findings: [] },
          },
        },
        timestamp: 100,
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        memory,
      });
      const result = await controlPlane.dispatch({
        type: "compact",
        sessionId,
        strategy: "hard",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId,
        compacted: true,
        strategy: "hard",
      });

      const payload = result.data as {
        removedEntryIds: string[];
        summaryEntryIds: string[];
      };
      expect(payload.removedEntryIds).toEqual([
        acceptedPreference.id,
        assistantOutput.id,
        quarantinedSecret.id,
        noise.id,
      ]);
      expect(payload.summaryEntryIds).toHaveLength(1);

      expect(memory.layer0.listByScope({ sessionId })).toEqual([]);
      const layer1Entries = memory.layer1.listByScope({ sessionId });
      expect(layer1Entries).toHaveLength(1);
      const summary = layer1Entries[0];
      expect(summary?.scope.namespace).toBe("compaction");
      expect(summary?.content).toContain("User preference");
      expect(summary?.content).not.toContain("Assistant draft output");
      expect(summary?.content).not.toContain("[redacted:api-key]");
      expect(summary?.content).not.toContain("thanks lol");
      expect(summary?.tags).toEqual(expect.arrayContaining(["memory:preference"]));
      expect(summary?.tags).not.toEqual(expect.arrayContaining(["memory:assistant-output"]));
      expect(summary?.tags).not.toEqual(expect.arrayContaining(["memory:quarantine"]));
      expect(summary?.tags).not.toEqual(expect.arrayContaining(["memory:noise"]));
      expect(summary?.metadata.sourceEntryIds).toEqual([acceptedPreference.id]);
      expect(summary?.metadata.sourceNamespaces).toEqual(["conversation"]);
      expect(summary?.metadata.memoryAdmission).toMatchObject({
        retention: "user",
        safety: { safe: true, findings: [] },
      });
      expect(summary?.metadata.sourceAdmissions).toEqual([
        {
          entryId: acceptedPreference.id,
          retention: "user",
          category: "preference",
          safe: true,
        },
      ]);
      expect(memory.layer0.get(assistantOutput.id)).toBeUndefined();
      expect(memory.layer1.get(quarantinedSecret.id)).toBeUndefined();
      expect(memory.layer1.get(noise.id)).toBeUndefined();
    } finally {
      setup.cleanup();
    }
  });

  test("records session guidance preference switches through metadata and journal", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_session_guidance";
    try {
      setup.store.createSession({
        sessionId,
        metadata: {
          preferences: {
            outputStyle: "normal",
            permissionMode: "ask",
            responseLanguage: "en",
          },
        },
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      const outputStyleResult = await controlPlane.dispatch({
        type: "output-style",
        sessionId,
        style: "concise",
      });
      expect(outputStyleResult.ok).toBe(true);
      expect(outputStyleResult.data).toMatchObject({
        sessionId,
        previousStyle: "normal",
        style: "concise",
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "ask",
          responseLanguage: "en",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "session-override",
        },
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "ask",
          responseLanguage: "en",
        },
      });

      const permissionsResult = await controlPlane.dispatch({
        type: "permissions",
        sessionId,
        mode: "deny",
      });
      expect(permissionsResult.ok).toBe(true);
      expect(permissionsResult.data).toMatchObject({
        sessionId,
        previousMode: "ask",
        mode: "deny",
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "en",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "session-override",
        },
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "en",
        },
      });

      const languageResult = await controlPlane.dispatch({
        type: "language",
        sessionId,
        language: "zh-CN",
      });
      expect(languageResult.ok).toBe(true);
      expect(languageResult.data).toMatchObject({
        sessionId,
        previousLanguage: "en",
        language: "zh-CN",
        effectiveGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "zh-CN",
        },
        effectiveGuidanceSources: {
          outputStyle: "session-override",
          permissionMode: "session-override",
          responseLanguage: "session-override",
        },
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "zh-CN",
        },
      });

      expect(setup.store.getSession(sessionId)?.metadata).toMatchObject({
        preferences: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "zh-CN",
        },
      });

      const outputStyleJournal = setup.store.journal
        .list(sessionId)
        .find((entry) => entry.eventType === "control.output_style");
      expect(outputStyleJournal?.payload).toMatchObject({
        previousStyle: "normal",
        style: "concise",
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "ask",
          responseLanguage: "en",
        },
      });

      const permissionsJournal = setup.store.journal
        .list(sessionId)
        .find((entry) => entry.eventType === "control.permission_mode");
      expect(permissionsJournal?.payload).toMatchObject({
        previousMode: "ask",
        mode: "deny",
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "en",
        },
      });

      const languageJournal = setup.store.journal
        .list(sessionId)
        .find((entry) => entry.eventType === "control.response_language");
      expect(languageJournal?.payload).toMatchObject({
        previousLanguage: "en",
        language: "zh-CN",
        sessionGuidance: {
          outputStyle: "concise",
          permissionMode: "deny",
          responseLanguage: "zh-CN",
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  test("rebuilds todo state from both flat and wrapped task journal payloads", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_todo_compat";
    try {
      setup.store.createSession({ sessionId });
      setup.store.appendJournal(sessionId, {
        eventType: "tasks.todo_write",
        payload: {
          items: [{ id: "todo_flat", content: "flat todo payload", status: "todo" }],
        },
        createdAtMs: 100,
      });
      setup.store.appendJournal(sessionId, {
        eventType: "tasks.todo_write",
        payload: {
          todos: {
            items: [{ id: "todo_wrapped", content: "wrapped todo payload", status: "doing" }],
            updatedAtMs: 120,
          },
          updatedAtMs: 120,
        },
        createdAtMs: 120,
      });

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });
      const statusResult = await controlPlane.dispatch({
        type: "task-status",
        sessionId,
      });

      expect(statusResult.ok).toBe(true);
      const state = statusResult.data as {
        todos: { items: Array<{ id: string; content: string; status: string }> };
      };
      expect(state.todos.items).toHaveLength(1);
      expect(state.todos.items[0]?.id).toBe("todo_wrapped");
      expect(state.todos.items[0]?.content).toBe("wrapped todo payload");
      expect(state.todos.items[0]?.status).toBe("doing");
    } finally {
      setup.cleanup();
    }
  });

  test("reads worker mailbox snapshot through the cli control-plane adapter", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_worker_mailbox";
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      await controlPlane.dispatch({
        type: "delegation-enqueue",
        sessionId,
        delegation: {
          id: "d1",
          taskId: "todo_1",
          workerId: "worker-a",
          instruction: "Implement worker mailbox surface",
          specialization: "plan",
          targetAgent: "plan-agent",
          verificationRequest: {
            verifierId: "qa-a",
            verificationId: "v1",
            requirement: "Implement worker mailbox surface",
          },
        },
      });

      const mailboxResult = await controlPlane.dispatch({
        type: "task-worker-mailbox",
        sessionId,
        workerId: "worker-a",
      });

      expect(mailboxResult.ok).toBe(true);
      expect(mailboxResult.data).toMatchObject({
        workerId: "worker-a",
        mailboxSize: 1,
        notificationCount: 1,
        coverage: "aligned",
        delegationIds: ["d1"],
        notificationIds: ["notification_delegation_d1"],
        unnotifiedDelegationIds: [],
        orphanNotificationIds: [],
        items: [
          {
            id: "d1",
            workerId: "worker-a",
            instruction: "Implement worker mailbox surface",
            status: "queued",
            taskId: "todo_1",
            specialization: "plan",
            targetAgent: "plan-agent",
            verificationRequest: {
              verifierId: "qa-a",
              verificationId: "v1",
              requirement: "Implement worker mailbox surface",
            },
            notificationId: "notification_delegation_d1",
            notificationStatus: "pending",
            notificationSummary: "Delegation d1 is queued for worker worker-a.",
          },
        ],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("reads verifier mailbox snapshot through the cli control-plane adapter", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_verifier_mailbox";
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      await controlPlane.dispatch({
        type: "verification-upsert",
        sessionId,
        verification: {
          id: "v1",
          taskId: "todo_1",
          verifierId: "qa-a",
          requirement: "Implement verifier mailbox surface",
          status: "pending",
        },
      });

      const mailboxResult = await controlPlane.dispatch({
        type: "task-verifier-mailbox",
        sessionId,
        verifierId: "qa-a",
      });

      expect(mailboxResult.ok).toBe(true);
      expect(mailboxResult.data).toMatchObject({
        verifierId: "qa-a",
        mailboxSize: 1,
        notificationCount: 1,
        coverage: "aligned",
        verificationIds: ["v1"],
        notificationIds: ["notification_verification_v1"],
        unnotifiedVerificationIds: [],
        orphanNotificationIds: [],
        items: [
          {
            id: "v1",
            verifierId: "qa-a",
            requirement: "Implement verifier mailbox surface",
            status: "pending",
            taskId: "todo_1",
            notificationId: "notification_verification_v1",
            notificationStatus: "pending",
            notificationSummary: "Verification v1 is pending for verifier qa-a.",
          },
        ],
      });
    } finally {
      setup.cleanup();
    }
  });

  test("uses stable outbox ids and id-based drain replay", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_outbox";
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      await controlPlane.dispatch({
        type: "proposal-enqueue",
        sessionId,
        proposal: {
          id: "p1",
          kind: "skill-proposal",
          payload: { name: "quality-gate" },
          sourceSessionId: sessionId,
          sourceTurnId: "turn_1",
          provenance: "worker-tests",
        },
      });
      await controlPlane.dispatch({
        type: "proposal-transition",
        sessionId,
        proposalId: "p1",
        status: "accepted",
      });

      const beforeDrain = await controlPlane.dispatch({
        type: "task-status",
        sessionId,
      });
      expect(beforeDrain.ok).toBe(true);
      const outboxBefore = (beforeDrain.data as { proposalOutbox: Array<{ id: string }> })
        .proposalOutbox;
      expect(outboxBefore).toHaveLength(2);
      expect(outboxBefore[0]?.id).toMatch(/^outbox_/u);
      expect(outboxBefore[1]?.id).toMatch(/^outbox_/u);

      const drained = await controlPlane.dispatch({
        type: "proposal-outbox-drain",
        sessionId,
        limit: 1,
      });
      expect(drained.ok).toBe(true);
      const drainedEntries = drained.data as Array<{ id: string }>;
      expect(drainedEntries).toHaveLength(1);
      expect(drainedEntries[0]?.id).toBe(outboxBefore[0]?.id);

      const afterDrain = await controlPlane.dispatch({
        type: "task-status",
        sessionId,
      });
      expect(afterDrain.ok).toBe(true);
      const outboxAfter = (afterDrain.data as { proposalOutbox: Array<{ id: string }> })
        .proposalOutbox;
      expect(outboxAfter).toHaveLength(1);
      expect(outboxAfter[0]?.id).toBe(outboxBefore[1]?.id);

      setup.store.close();
      const reopenedStore = new SessionStore({ dbPath: setup.dbPath });
      const reopenedControlPlane = createCliControlPlane({
        sessionStore: reopenedStore,
      });
      const replayed = await reopenedControlPlane.dispatch({
        type: "task-status",
        sessionId,
      });
      expect(replayed.ok).toBe(true);
      const replayedOutbox = (replayed.data as { proposalOutbox: Array<{ id: string }> })
        .proposalOutbox;
      expect(replayedOutbox).toHaveLength(1);
      expect(replayedOutbox[0]?.id).toBe(outboxBefore[1]?.id);
      reopenedStore.close();
    } finally {
      setup.cleanup();
    }
  });

  test("reads and applies accepted todo proposals through the cli control-plane adapter", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_reconcile";
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      await controlPlane.dispatch({
        type: "proposal-enqueue",
        sessionId,
        proposal: {
          id: "p_apply",
          kind: "tasks.todo_write",
          payload: {
            items: [{ id: "todo_apply", content: "Apply from adapter", status: "todo" }],
          },
          sourceSessionId: sessionId,
          sourceTurnId: "turn_apply",
          provenance: "worker-jobs/reconcile",
        },
      });
      await controlPlane.dispatch({
        type: "proposal-transition",
        sessionId,
        proposalId: "p_apply",
        status: "accepted",
      });

      const proposalResult = await controlPlane.dispatch({
        type: "proposal-get",
        sessionId,
        proposalId: "p_apply",
      });
      expect(proposalResult.ok).toBe(true);
      expect((proposalResult.data as { id: string; status: string; kind: string }).status).toBe(
        "accepted",
      );

      const applyResult = await controlPlane.dispatch({
        type: "proposal-apply",
        sessionId,
        proposalId: "p_apply",
      });
      expect(applyResult.ok).toBe(true);
      const state = applyResult.data as {
        todos: { items: Array<{ content: string }> };
        proposalQueue: Array<{ id: string; status: string }>;
      };
      expect(state.todos.items[0]?.content).toBe("Apply from adapter");
      expect(state.proposalQueue.find((entry) => entry.id === "p_apply")?.status).toBe("applied");
    } finally {
      setup.cleanup();
    }
  });

  test("reverts approved snapshot when skill proposal apply cannot persist the applied status", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_skill_apply_compensate";
    const env = {
      HOTFLOW_WORKSPACE_ROOT: setup.tempDir,
      HOTFLOW_DATA_DIR: joinPath(setup.tempDir, ".hotflow"),
    };
    const approvedSkillSnapshotPath = joinPath(
      env.HOTFLOW_DATA_DIR,
      "skills",
      "approved-skills.json",
    );
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        env,
      });

      await controlPlane.dispatch({
        type: "proposal-enqueue",
        sessionId,
        proposal: {
          id: "p_skill_apply_compensate",
          kind: SKILL_SNAPSHOT_UPSERT_KIND,
          payload: encodeSkillProposalPayload({
            trajectoryRef: "journal://session_1/turn_1",
            snapshot: {
              id: "skill.readme.summary",
              version: "1.0.0",
              title: "README Summary",
              content: "Read the README first, then summarize the repository clearly.",
              updatedAtMs: 100,
            },
          }),
          sourceSessionId: sessionId,
          sourceTurnId: "turn_skill_apply_compensate",
          provenance: "worker-jobs/trajectory-summary",
        },
      });
      await controlPlane.dispatch({
        type: "proposal-transition",
        sessionId,
        proposalId: "p_skill_apply_compensate",
        status: "accepted",
      });

      const appendJournal = setup.store.appendJournal.bind(setup.store);
      vi.spyOn(setup.store, "appendJournal").mockImplementation((targetSessionId, input) => {
        if (input.eventType === "tasks.proposal_transitioned") {
          throw new Error("session journal offline");
        }
        return appendJournal(targetSessionId, input);
      });

      const applyResult = await controlPlane.dispatch({
        type: "proposal-apply",
        sessionId,
        proposalId: "p_skill_apply_compensate",
      });

      expect(applyResult.ok).toBe(false);
      expect(applyResult.error).toContain("session journal offline");
      expect(new SkillSnapshotFileStore(approvedSkillSnapshotPath).readHead()).toBeNull();

      const proposalResult = await controlPlane.dispatch({
        type: "proposal-get",
        sessionId,
        proposalId: "p_skill_apply_compensate",
      });
      expect(proposalResult.ok).toBe(true);
      expect((proposalResult.data as { status: string }).status).toBe("accepted");
    } finally {
      setup.cleanup();
    }
  });

  test("lists, reviews, explains, and decides skill proposals through the cli control-plane adapter", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_skill_operator";
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      const proposalPayload = encodeSkillProposalPayload({
        trajectoryRef: "journal://session_1/turn_1",
        trigger: "Summarize the repository.",
        evidenceSummary: "Opened README and summarized the repository structure.",
        riskLevel: "medium",
        confidence: 0.74,
        explanation: "This workflow repeats across README-oriented tasks.",
        snapshot: {
          id: "skill.readme.summary",
          version: "1.0.0",
          title: "README Summary",
          content: "Read the README first, then summarize the repository clearly.",
          updatedAtMs: 100,
          toolNames: ["filesystem-read"],
        },
      });

      await controlPlane.dispatch({
        type: "proposal-enqueue",
        sessionId,
        proposal: {
          id: "p_skill_accept",
          kind: SKILL_SNAPSHOT_UPSERT_KIND,
          payload: proposalPayload,
          sourceSessionId: sessionId,
          sourceTurnId: "turn_skill_accept",
          provenance: "worker-jobs/trajectory-summary",
        },
      });
      await controlPlane.dispatch({
        type: "proposal-enqueue",
        sessionId,
        proposal: {
          id: "p_skill_reject",
          kind: SKILL_SNAPSHOT_UPSERT_KIND,
          payload: proposalPayload,
          sourceSessionId: sessionId,
          sourceTurnId: "turn_skill_reject",
          provenance: "worker-jobs/trajectory-summary",
        },
      });

      const listResult = await controlPlane.dispatch({
        type: "proposal-list",
        sessionId,
        status: "pending",
      });
      const reviewResult = await controlPlane.dispatch({
        type: "proposal-review",
        sessionId,
        proposalId: "p_skill_accept",
      });
      const explainResult = await controlPlane.dispatch({
        type: "proposal-explain",
        sessionId,
        proposalId: "p_skill_accept",
      });
      const acceptResult = await controlPlane.dispatch({
        type: "proposal-accept",
        sessionId,
        proposalId: "p_skill_accept",
        decisionNote: "Accepted by operator.",
      });
      const rejectResult = await controlPlane.dispatch({
        type: "proposal-reject",
        sessionId,
        proposalId: "p_skill_reject",
        decisionNote: "Rejected by operator.",
      });

      expect(listResult.ok).toBe(true);
      expect(listResult.data).toMatchObject([
        { id: "p_skill_accept", status: "pending" },
        { id: "p_skill_reject", status: "pending" },
      ]);
      expect(reviewResult.ok).toBe(true);
      expect(reviewResult.data).toMatchObject({
        proposalId: "p_skill_accept",
        verdict: "accepted",
      });
      expect(explainResult.ok).toBe(true);
      expect(explainResult.data).toMatchObject({
        proposalId: "p_skill_accept",
        kind: SKILL_SNAPSHOT_UPSERT_KIND,
        evidenceSummary: "Opened README and summarized the repository structure.",
        riskLevel: "medium",
      });
      expect(acceptResult.ok).toBe(true);
      expect(rejectResult.ok).toBe(true);

      const finalStatus = await controlPlane.dispatch({
        type: "task-status",
        sessionId,
      });
      expect(finalStatus.ok).toBe(true);
      expect(
        (finalStatus.data as { proposalQueue: Array<{ id: string; status: string }> })
          .proposalQueue,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "p_skill_accept", status: "accepted" }),
          expect.objectContaining({ id: "p_skill_reject", status: "rejected" }),
        ]),
      );
    } finally {
      setup.cleanup();
    }
  });

  test("persists delegation and verification across control-plane runs", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_state";
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      await controlPlane.dispatch({
        type: "delegation-enqueue",
        sessionId,
        delegation: {
          id: "d1",
          taskId: "todo_1",
          workerId: "worker-a",
          instruction: "review proposal",
          contextSnapshot: "parentTurnId=turn-parent; isolatedContext=true",
          specialization: "plan",
          targetAgent: "plan-agent",
          verificationRequest: {
            verificationId: "v1",
            verifierId: "verifier-a",
            requirement: "must include rollback plan",
          },
        },
      });
      await controlPlane.dispatch({
        type: "delegation-status",
        sessionId,
        update: {
          id: "d1",
          status: "running",
        },
      });
      await controlPlane.dispatch({
        type: "delegation-status",
        sessionId,
        update: {
          id: "d1",
          status: "completed",
          resultSummary: "Review completed with rollback plan.",
        },
      });
      await controlPlane.dispatch({
        type: "verification-upsert",
        sessionId,
        verification: {
          id: "v1",
          taskId: "todo_1",
          verifierId: "verifier-a",
          requirement: "must include rollback plan",
          status: "passed",
          verdict: "pass",
        },
      });

      const stateResult = await controlPlane.dispatch({
        type: "task-status",
        sessionId,
      });
      expect(stateResult.ok).toBe(true);
      const state = stateResult.data as {
        delegation: Array<{ id: string; status: string; targetAgent?: string }>;
        verification: Array<{ id: string; status: string }>;
        subagentRuns: Array<{
          subagentId: string;
          parentTurnId: string;
          profileId: string;
          status: string;
          parentVisibleResult: { status: string; summary?: string; verificationVerdict?: string };
        }>;
      };
      expect(state.delegation[0]?.id).toBe("d1");
      expect(state.delegation[0]?.status).toBe("completed");
      expect(state.delegation[0]?.targetAgent).toBe("plan-agent");
      expect(state.verification[0]?.id).toBe("v1");
      expect(state.verification[0]?.status).toBe("passed");
      expect(state.subagentRuns[0]).toMatchObject({
        subagentId: "d1",
        parentTurnId: "turn-parent",
        profileId: "plan-agent",
        status: "completed",
        parentVisibleResult: {
          status: "completed",
          summary: "Review completed with rollback plan.",
          verificationVerdict: "pass",
        },
      });
    } finally {
      setup.cleanup();
    }
  });

  test("records structured control.action audit payloads via callback", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_audit";
    const auditEvents: Array<{ kind: string; payload?: unknown }> = [];
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        recordAuditEvent: (input) => {
          auditEvents.push({
            kind: input.kind,
            payload: input.payload,
          });
        },
      });

      const okResult = await controlPlane.dispatch({
        type: "task-status",
        sessionId,
      });
      expect(okResult.ok).toBe(true);

      const failedResult = await controlPlane.dispatch({
        type: "proposal-transition",
        sessionId,
        proposalId: "missing",
        status: "accepted",
      });
      expect(failedResult.ok).toBe(false);

      const controlActionEvents = auditEvents.filter((entry) => entry.kind === "control.action");
      expect(controlActionEvents.length).toBeGreaterThanOrEqual(2);
      const successPayload = controlActionEvents[0]?.payload as { action?: string; ok?: boolean };
      expect(successPayload.action).toBe("task-status");
      expect(successPayload.ok).toBe(true);
      const failurePayload = controlActionEvents.at(-1)?.payload as {
        action?: string;
        ok?: boolean;
        error?: string;
      };
      expect(failurePayload.action).toBe("proposal-transition");
      expect(failurePayload.ok).toBe(false);
      expect(typeof failurePayload.error).toBe("string");
    } finally {
      setup.cleanup();
    }
  });

  test("dispatches doctor through the cli control-plane operator surface", async () => {
    const setup = createTestSessionStore();
    const runDoctor = vi.fn(async () => ({
      status: "warn",
      checks: [
        {
          id: "memory.mempalace",
          status: "warn",
          summary: "Optional mempalace integration is unavailable.",
          startedAtMs: 1,
          completedAtMs: 2,
          durationMs: 1,
        },
      ],
    }));
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        runDoctor,
      });

      const result = await controlPlane.dispatch({
        type: "doctor",
        sessionId: "operator_surface",
      });

      expect(result.ok).toBe(true);
      expect(runDoctor).toHaveBeenCalledOnce();
      expect((result.data as { status?: string }).status).toBe("warn");
    } finally {
      setup.cleanup();
    }
  });

  test("exposes onboarding status through the operator-only control-plane", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-cli-onboard-status-"));
    const runDoctor = vi.fn(async () => ({
      ok: true,
      status: "pass",
      startedAtMs: 10,
      completedAtMs: 20,
      durationMs: 10,
      checks: [
        {
          id: "provider.default",
          status: "pass",
          summary: "Default provider is configured.",
          startedAtMs: 11,
          completedAtMs: 12,
          durationMs: 1,
        },
      ],
    }));

    try {
      const controlPlane = createCliOperatorControlPlane({
        cwd: workspaceRoot,
        runDoctor,
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DEFAULT_PROVIDER: "scripted",
          HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
          HOTFLOW_PROFILE: "test",
        },
      });

      const result = await controlPlane.dispatch({
        type: "onboarding-status",
        sessionId: "operator_surface",
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        sessionId: "operator_surface",
        status: "warn",
        readiness: "needs-attention",
        recommendedCommand: "hotflow doctor",
        surfaces: {
          environment: {
            status: "warn",
          },
          doctor: {
            status: "pass",
            counts: {
              pass: 1,
              warn: 0,
              fail: 0,
              total: 1,
            },
          },
          directorExecution: {
            status: "pass",
            routeCounts: {
              total: 0,
            },
          },
        },
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("dispatches onboarding through the runtime cli control-plane and returns structured report", async () => {
    const setup = createTestSessionStore();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-cli-onboard-workspace-"));
    const runDoctor = vi.fn(async () => ({
      ok: false,
      status: "warn",
      startedAtMs: 10,
      completedAtMs: 20,
      durationMs: 10,
      checks: [
        {
          id: "provider.default",
          status: "fail",
          summary: "Default provider is not configured.",
          startedAtMs: 11,
          completedAtMs: 12,
          durationMs: 1,
        },
        {
          id: "session.store",
          status: "pass",
          summary: "Session store can be opened.",
          startedAtMs: 13,
          completedAtMs: 14,
          durationMs: 1,
        },
        {
          id: "memory.mempalace",
          status: "warn",
          summary: "Optional mempalace integration is unavailable.",
          startedAtMs: 15,
          completedAtMs: 16,
          durationMs: 1,
        },
      ],
    }));
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        cwd: workspaceRoot,
        runDoctor,
        env: {
          HOTFLOW_DEFAULT_PROVIDER: "openai-compatible",
          HOTFLOW_DEFAULT_MODEL: "gpt-4o-mini",
          HOTFLOW_PROFILE: "test",
          HOTFLOW_RESPONSE_LANGUAGE: "zh-CN",
        },
      });

      const result = await controlPlane.dispatch({
        type: "onboarding",
        sessionId: "operator_surface",
      });

      expect(result.ok).toBe(true);
      expect(runDoctor).toHaveBeenCalledOnce();
      expect(result.data).toMatchObject({
        sessionId: "operator_surface",
        status: "warn",
        doctorReport: {
          status: "warn",
        },
      });

      const report = result.data as {
        doctorReport: { checks: Array<{ id: string }> };
        environment: {
          defaultProvider: string;
          sessionDbPath: string;
          effectiveSessionDbPath: string;
          responseLanguage: string;
        };
        runtime: {
          providerIds: string[];
          defaultProviderAvailable: boolean;
          internalPlugins: Array<{ id: string; capabilities: string[] }>;
          approvedSkillSnapshotPath: string;
          approvedSkillCount: number;
        };
      };

      expect(report.doctorReport.checks.map((check) => check.id)).toEqual(
        expect.arrayContaining(["provider.default", "session.store", "memory.mempalace"]),
      );
      expect(report.environment.defaultProvider).toBe("openai-compatible");
      expect(report.environment.responseLanguage).toBe("zh-CN");
      expect(typeof report.environment.sessionDbPath).toBe("string");
      expect(typeof report.environment.effectiveSessionDbPath).toBe("string");
      expect(report.runtime.providerIds.length).toBeGreaterThan(0);
      expect(report.runtime.defaultProviderAvailable).toBe(false);
      expect(Array.isArray(report.runtime.internalPlugins)).toBe(true);
      expect(report.runtime.internalPlugins.length).toBeGreaterThan(0);
      expect(report.runtime.internalPlugins[0]).toMatchObject({
        id: expect.any(String),
        capabilities: expect.any(Array),
      });
      expect(typeof report.runtime.approvedSkillSnapshotPath).toBe("string");
      expect(typeof report.runtime.approvedSkillCount).toBe("number");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      setup.cleanup();
    }
  });

  test("surfaces director route recovery guidance through onboarding when the latest chain is recoverable", async () => {
    const setup = createTestSessionStore();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-cli-onboard-director-route-"));
    const runDoctor = vi.fn(async () => ({
      ok: true,
      status: "pass",
      startedAtMs: 10,
      completedAtMs: 20,
      durationMs: 10,
      checks: [
        {
          id: "provider.default",
          status: "pass",
          summary: "Default provider is configured.",
          startedAtMs: 11,
          completedAtMs: 12,
          durationMs: 1,
        },
      ],
    }));

    try {
      seedDirectorRouteRecoveryArtifacts(workspaceRoot);

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        cwd: workspaceRoot,
        runDoctor,
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DEFAULT_PROVIDER: "scripted",
          HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
          HOTFLOW_PROFILE: "test",
        },
      });

      const result = await controlPlane.dispatch({
        type: "onboarding",
        sessionId: "operator_route_recovery",
      });

      expect(result.ok).toBe(true);
      const report = result.data as {
        status: string;
        summaryText: string;
        guidance: string[];
        nextSteps: Array<{ title: string; command: string; detail: string }>;
        directorExecution: {
          status: string;
          runId?: string;
          reportId?: string;
          routeSummary?: string;
          nextAction?: string;
          suggestedCommands: string[];
          routeCounts: {
            degraded: number;
            reroutable: number;
            total: number;
          };
        };
      };

      expect(report.status).toBe("warn");
      expect(report.summaryText).toContain("recoverable");
      expect(report.directorExecution).toMatchObject({
        status: "warn",
        runId: "run-warn-1",
        reportId: "report-warn-1",
        routeCounts: {
          degraded: 1,
          reroutable: 1,
          total: 2,
        },
      });
      expect(report.directorExecution.routeSummary).toContain("can still recover by reroute");
      expect(report.directorExecution.nextAction).toContain("reroute the failed assignment");
      expect(report.directorExecution.suggestedCommands).toContain(
        "hotflow director run reroute --run-id run-warn-1 --assignment-id assignment-failed-1 --adapter-id runway-preview",
      );
      expect(report.guidance).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Latest director route summary"),
          expect.stringContaining(
            "hotflow director run reroute --run-id run-warn-1 --assignment-id assignment-failed-1 --adapter-id runway-preview",
          ),
        ]),
      );
      expect(report.nextSteps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Reroute director assignment / 改道导演任务",
            command:
              "hotflow director run reroute --run-id run-warn-1 --assignment-id assignment-failed-1 --adapter-id runway-preview",
          }),
        ]),
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      setup.cleanup();
    }
  });

  test("surfaces local worker run-once guidance when the latest director chain is healthy and ready", async () => {
    const setup = createTestSessionStore();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-cli-onboarding-ready-run-"));
    const runDoctor = vi.fn(async () => ({
      ok: true,
      status: "pass",
      startedAtMs: 10,
      completedAtMs: 12,
      durationMs: 2,
      checks: [
        {
          id: "config.default-provider",
          status: "pass",
          summary: "Default provider is configured.",
          startedAtMs: 10,
          completedAtMs: 12,
          durationMs: 2,
        },
      ],
    }));

    try {
      seedDirectorReadyRunArtifacts(workspaceRoot);

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        cwd: workspaceRoot,
        runDoctor,
        env: {
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DEFAULT_PROVIDER: "scripted",
          HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
          HOTFLOW_PROFILE: "test",
        },
      });

      const result = await controlPlane.dispatch({
        type: "onboarding",
        sessionId: "operator_ready_run_once",
      });

      expect(result.ok).toBe(true);
      const report = result.data as {
        status: string;
        guidance: string[];
        nextSteps: Array<{ title: string; command: string; detail: string }>;
        directorExecution: {
          status: string;
          runId?: string;
          reportId?: string;
          nextAction?: string;
          suggestedCommands: string[];
          routeCounts: {
            healthy: number;
            degraded: number;
            reroutable: number;
            exhausted: number;
            blocked: number;
            total: number;
          };
        };
      };

      expect(report.status).toBe("pass");
      expect(report.directorExecution).toMatchObject({
        status: "pass",
        runId: "run-ready-1",
        reportId: "report-ready-1",
        routeCounts: {
          healthy: 2,
          degraded: 0,
          reroutable: 0,
          exhausted: 0,
          blocked: 0,
          total: 2,
        },
      });
      expect(report.directorExecution.nextAction).toContain("local worker lane");
      expect(report.directorExecution.suggestedCommands).toContain(
        "hotflow director run once --run-id run-ready-1",
      );
      expect(report.guidance).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Latest director next action"),
          expect.stringContaining("hotflow director run once --run-id run-ready-1"),
        ]),
      );
      expect(report.nextSteps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Run ready director assignments / 运行就绪导演任务",
            command: "hotflow director run once --run-id run-ready-1",
          }),
        ]),
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
      setup.cleanup();
    }
  });

  test("rejects direct proposal-transition to applied in the cli control-plane adapter", async () => {
    const setup = createTestSessionStore();
    const sessionId = "sess_control_plane_apply_guard";
    try {
      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
      });

      const result = await controlPlane.dispatch({
        type: "proposal-transition",
        sessionId,
        proposalId: "missing",
        status: "applied",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Use proposal-apply");
    } finally {
      setup.cleanup();
    }
  });

  test("rejects proposal rollback for a missing session without mutating the approved snapshot", async () => {
    const setup = createTestSessionStore();
    const env = {
      HOTFLOW_WORKSPACE_ROOT: setup.tempDir,
      HOTFLOW_DATA_DIR: joinPath(setup.tempDir, ".hotflow"),
    };
    const approvedSkillSnapshotPath = joinPath(
      env.HOTFLOW_DATA_DIR,
      "skills",
      "approved-skills.json",
    );
    try {
      let currentNow = 100;
      const snapshotStore = new SkillSnapshotFileStore(approvedSkillSnapshotPath, {
        now: () => currentNow,
      });
      snapshotStore.writeApproved([
        {
          id: "skill.readme.summary",
          version: "1.0.0",
          title: "README Summary",
          content: "Read the README, then summarize the repository.",
          updatedAtMs: 50,
        },
      ]);
      currentNow = 200;
      snapshotStore.writeApproved([
        {
          id: "skill.readme.summary",
          version: "1.1.0",
          title: "README Summary",
          content: "Read the README carefully, then summarize the repository clearly.",
          updatedAtMs: 80,
        },
      ]);

      const controlPlane = createCliControlPlane({
        sessionStore: setup.store,
        env,
      });
      const result = await controlPlane.dispatch({
        type: "proposal-rollback",
        sessionId: "missing_session",
        version: 1,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown session: missing_session");
      expect(snapshotStore.readHead()).toMatchObject({
        version: 2,
        restoredFromVersion: null,
      });
    } finally {
      setup.cleanup();
    }
  });
});
