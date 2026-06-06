import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapDirectorWorkspace } from "./director-bootstrap.js";
import {
  evaluateSnapshotWithDirector,
  fetchDirectorRunReport,
  fetchDirectorRunStatus,
  fetchDirectorRuntimeSnapshot,
  submitDirectorBlueprint,
  submitDirectorClarify,
  submitDirectorIntake,
  submitDirectorOutcome,
  submitDirectorRunAbort,
  submitDirectorRunApprove,
  submitDirectorRunCreate,
  submitDirectorRunPause,
  submitDirectorRunReroute,
  submitDirectorRunResume,
  submitDirectorRunRetry,
  submitDirectorRunStart,
} from "./director-evaluate.js";
import { describeDirectorStatus } from "./director-status.js";

function createSnapshotFixture() {
  return {
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
      title: "Director CLI",
      outline: "做一支预告片风格的视频。",
    },
    group: {
      groupId: "group-1",
      generationType: "new",
      generationStyle: "immersive",
      sceneCount: 1,
      anchorIds: ["anchor-a"],
    },
    runtime: {
      runtimeId: "runtime-1",
      status: "ready",
      availableBindings: ["binding-a"],
      maxPromptChars: 4096,
      supportsVideo: true,
    },
    intent: {
      bindingPolicy: "prefer",
      preferredImageBinding: "binding-a",
    },
  };
}

function createRuntimeCapabilitySnapshotFixture(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    runtimeId: "runtime-1",
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-1",
      runtimeId: "runtime-1",
      capturedAt: "2026-04-11T12:00:00.000Z",
      status: "ready",
      adapters: [
        {
          adapterId: "binding-a",
          adapterKind: "media",
          provider: "mock-media",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: true,
          notes: ["preview-safe"],
        },
      ],
      notes: ["preview-safe"],
    },
    ...overrides,
  };
}

function createClarificationFixture(overrides: Record<string, unknown> = {}) {
  return {
    decision: "ready",
    summary: "Enough information is present for the next step.",
    missingFields: [],
    conflictingFields: [],
    questions: [],
    ...overrides,
  };
}

function createActionGraphFixture(overrides: Record<string, unknown> = {}) {
  return {
    graphId: "graph-1",
    blueprintId: "blueprint-plan-1",
    goal: "做一支预告片风格的视频。",
    nodes: [],
    edges: [],
    stopConditions: ["runtime offline"],
    ...overrides,
  };
}

function createOperatorPreviewFixture(overrides: Record<string, unknown> = {}) {
  return {
    previewId: "preview-1",
    summary: "ready",
    warnings: [],
    blockedReasons: [],
    requiredApprovals: [],
    ...overrides,
  };
}

function createAlignmentLockFixture(overrides: Record<string, unknown> = {}) {
  return {
    lockId: "lock-snapshot-1",
    sourceIntakeId: "intake-snapshot-1",
    state: "locked",
    lockedAt: "2026-04-11T12:00:00.000Z",
    objective: "做一支预告片风格的视频。",
    deliverables: ["new blueprint for group-1"],
    lockedConstraints: [],
    lockedFields: [],
    notes: ["preview-only"],
    ...overrides,
  };
}

function createHandoffEnvelopeFixture(overrides: Record<string, unknown> = {}) {
  const actionGraph = createActionGraphFixture();
  return {
    handoffId: "handoff-execution-1",
    blueprintId: actionGraph.blueprintId,
    createdAt: "2026-04-11T12:10:00.000Z",
    alignmentLockId: "lock-snapshot-1",
    actionGraphId: actionGraph.graphId,
    previewSummary: "preview-only handoff",
    capabilityMatches: [],
    mediaRequests: [],
    expectedArtifacts: [],
    chosenAdapters: ["binding-a"],
    sideEffectsAllowed: false,
    notes: ["preview-only"],
    ...overrides,
  };
}

function createOperatorOutcomeFixture(overrides: Record<string, unknown> = {}) {
  return {
    outcomeId: "outcome-1",
    status: "accepted",
    recordedAt: "2026-04-11T12:30:00.000Z",
    notes: "operator approved preview",
    ...overrides,
  };
}

function createExecutionAssignmentFixture(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    assignmentId: "a1",
    role: "researcher",
    objective: "inspect",
    deliverable: "brief",
    inputs: ["goal"],
    outputs: ["brief"],
    acceptanceCriteria: ["done"],
    constraints: [],
    actionClass: "read",
    approvalMode: "auto_allow",
    dependsOn: [],
    status: "ready",
    selectedAdapter: null,
    allowedAdapters: ["binding-a"],
    createdAt: "2026-04-11T12:20:00.000Z",
    notes: [],
    ...overrides,
  };
}

function createExecutionRunFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    runId: "run-1",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-plan-1",
    handoffId: "handoff-execution-1",
    actionGraphId: "graph-1",
    goal: "goal",
    previewSummary: "ready",
    sideEffectsAllowed: false,
    createdAt: "2026-04-11T12:20:00.000Z",
    updatedAt: "2026-04-11T12:20:00.000Z",
    status: "created",
    assignments: [createExecutionAssignmentFixture()],
    events: [
      {
        eventId: "event-1",
        runId: "run-1",
        type: "run-created",
        occurredAt: "2026-04-11T12:20:00.000Z",
        message: "Execution run was materialized from a reviewed director blueprint.",
        payload: {
          blueprintId: "blueprint-plan-1",
          handoffId: "handoff-execution-1",
          assignmentCount: 1,
        },
      },
    ],
    notes: ["preview-only"],
    ...overrides,
  };
}

function createExecutionRunReportFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    reportId: "report-run-1",
    runId: "run-1",
    run: createExecutionRunFixture(),
    recordedAt: "2026-04-11T12:25:00.000Z",
    summary: ["run status=running"],
    flags: ["preview-only", "run-in-progress"],
    events: createExecutionRunFixture().events,
    ...overrides,
  };
}

describe("director helper modules", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("bootstraps the director workspace and reports the paths", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-cli-bootstrap-"));
    tempRoots.push(workspaceRoot);

    const output = bootstrapDirectorWorkspace(workspaceRoot);

    expect(output).toContain("Director workspace bootstrap complete.");
    expect(output).toContain(".director-angel/knowledge");
  });

  it("describes knowledge status from the workspace", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-cli-status-"));
    tempRoots.push(workspaceRoot);
    const publishedDir = join(workspaceRoot, ".director-angel", "knowledge", "published");
    const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
    const executionRunDir = join(runtimeDir, "execution", "runs", "run-1");
    mkdirSync(publishedDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
    mkdirSync(executionRunDir, { recursive: true });
    writeFileSync(
      join(publishedDir, "pack.json"),
      JSON.stringify({
        id: "pack-1",
        title: "Pack 1",
        createdAt: "2026-04-11T12:00:00.000Z",
        version: 1,
      }),
      { encoding: "utf8", flag: "w" },
    );
    writeFileSync(
      join(runtimeDir, "observations.ndjson"),
      [
        JSON.stringify({
          observationId: "observation-1",
          source: "evaluation",
        }),
        JSON.stringify({
          observationId: "observation-2",
          source: "outcome",
        }),
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(runtimeDir, "proposals", "index.json"),
      JSON.stringify({
        schemaVersion: "director.proposal.index.v1",
        updatedAt: "2026-04-12T12:00:00.000Z",
        entries: [{ proposalId: "proposal-1" }, { proposalId: "proposal-2" }],
      }),
      "utf8",
    );
    writeFileSync(
      join(runtimeDir, "switches.json"),
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "knowledgeRecall.enabled": true,
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(executionRunDir, "run.json"),
      JSON.stringify(createExecutionRunFixture()),
      "utf8",
    );
    writeFileSync(
      join(executionRunDir, "report.json"),
      JSON.stringify(
        createExecutionRunReportFixture({
          summary: ["run status=completed"],
          flags: ["external-bridge-succeeded"],
          operatorSurface: {
            directorGoal: "Generate a single-shot lighthouse reveal video.",
            operatorSummary: "Single-shot video brief is ready for remote submission.",
            objective: "Submit a media generation request",
            deliverable: "send a bounded adapter request",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "accepted",
            requestAccepted: true,
            requestId: "req-beta9-status",
            nextAction:
              "track the remote request by request id and wait for the downstream result.",
          },
        }),
      ),
      "utf8",
    );

    const status = await describeDirectorStatus(workspaceRoot);

    expect(status).toContain("published packs: 1");
    expect(status).toContain("knowledge recall enabled: yes");
    expect(status).toContain("observation records: 2");
    expect(status).toContain("memory enabled:");
    expect(status).toContain("memory records:");
    expect(status).toContain("proposal lane: ok");
    expect(status).toContain("trace proposals: 2");
    expect(status).toContain("execution runs: 1");
    expect(status).toContain("execution reports: 1");
    expect(status).toContain("latest run: run-1");
    expect(status).toContain("latest report: report-run-1");
    expect(status).toContain("latest bridge verdict: accepted");
    expect(status).toContain("latest next action: track the remote request by request id");
    expect(status).toContain("latest published at:");
    expect(status).toContain("latest rollback at:");
    expect(status).toContain("knowledge evolution switches:");
  });

  it("ignores macOS AppleDouble files when reading latest memory ingest audit", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-cli-memory-appledouble-"));
    tempRoots.push(workspaceRoot);
    const ingestDir = join(workspaceRoot, ".director-angel", "runtime", "memory", "ingest");
    mkdirSync(ingestDir, { recursive: true });
    writeFileSync(join(ingestDir, "._run-ok.json"), "\0\u0005\u0016\u0007metadata", "utf8");
    writeFileSync(
      join(ingestDir, "run-ok.json"),
      JSON.stringify({
        schemaVersion: "director.memory.ingest.audit.v1",
        runId: "run-ok",
        reportId: "report-run-ok",
        status: "ok",
        recordedAt: "2026-04-30T05:00:00.000Z",
        observationIds: ["observation-1"],
        notes: ["Stored Director memory record."],
        recordId: "record-run-ok",
        digestId: "digest-run-ok",
      }),
      "utf8",
    );

    const status = await describeDirectorStatus(workspaceRoot);

    expect(status).toContain("latest memory ingest: ok");
  });

  it("shows chain route health in director status for the latest execution report", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-cli-route-health-status-"));
    tempRoots.push(workspaceRoot);
    const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
    const executionRunDir = join(runtimeDir, "execution", "runs", "run-route-health-1");
    mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
    mkdirSync(executionRunDir, { recursive: true });
    writeFileSync(
      join(executionRunDir, "run.json"),
      JSON.stringify(
        createExecutionRunFixture({
          runId: "run-route-health-1",
          updatedAt: "2026-04-14T08:50:00.000Z",
          status: "running",
          assignments: [
            createExecutionAssignmentFixture({
              runId: "run-route-health-1",
              assignmentId: "assignment-script-1",
              role: "script-planner",
              objective: "Draft the script outline",
              deliverable: "draft script outline",
              inputs: ["goal"],
              outputs: ["script outline"],
              acceptanceCriteria: ["Script bridge request is accepted."],
              actionClass: "generate",
              approvalMode: "auto_allow",
              dependsOn: [],
              status: "completed",
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a"],
              createdAt: "2026-04-14T08:45:00.000Z",
              completedAt: "2026-04-14T08:47:00.000Z",
              notes: ["external-bridge", "bridge:http-json"],
              result: {
                runId: "run-route-health-1",
                assignmentId: "assignment-script-1",
                status: "completed",
                recordedAt: "2026-04-14T08:47:00.000Z",
                workerId: "worker-script-1",
                summary: "Script bridge request accepted.",
                adapterId: "script-execution-a",
                bridgeExecution: {
                  kind: "http-json",
                  request: {
                    endpointOrigin: "https://bridge.example.test",
                    endpointPath: "/v1/jobs",
                    method: "POST",
                    timeoutMs: 1_000,
                    authMode: "env",
                    headerKeys: ["authorization"],
                    payloadBytes: 256,
                  },
                  response: {
                    statusCode: 202,
                    accepted: true,
                    requestId: "req-script-1",
                    bodyBytes: 32,
                  },
                },
              },
            }),
            createExecutionAssignmentFixture({
              runId: "run-route-health-1",
              assignmentId: "assignment-shot-1",
              role: "shot-planner",
              objective: "Draft the shot list",
              deliverable: "draft shot list",
              inputs: ["assignment-script-1"],
              outputs: ["shot list"],
              acceptanceCriteria: ["Shot list has an approved route."],
              actionClass: "generate",
              approvalMode: "auto_allow",
              dependsOn: ["assignment-script-1"],
              status: "ready",
              selectedAdapter: "runway-preview",
              allowedAdapters: ["seedance-preview", "runway-preview"],
              createdAt: "2026-04-14T08:45:00.000Z",
              notes: [
                "external-bridge",
                "bridge:http-json",
                "Retry requested at 2026-04-14T08:48:00.000Z.",
                "Adapter rerouted from seedance-preview to runway-preview at 2026-04-14T08:49:00.000Z.",
              ],
            }),
          ],
        }),
      ),
      "utf8",
    );
    writeFileSync(
      join(executionRunDir, "report.json"),
      JSON.stringify(
        createExecutionRunReportFixture({
          reportId: "report-route-health-1",
          runId: "run-route-health-1",
          recordedAt: "2026-04-14T08:50:00.000Z",
          summary: ["run status=running", "bridge attempts=1 succeeded=1 failed=0"],
          flags: ["run-in-progress", "external-bridge-attempted", "external-bridge-succeeded"],
          run: JSON.parse(
            JSON.stringify(
              createExecutionRunFixture({
                runId: "run-route-health-1",
                updatedAt: "2026-04-14T08:50:00.000Z",
                status: "running",
                assignments: [
                  createExecutionAssignmentFixture({
                    runId: "run-route-health-1",
                    assignmentId: "assignment-script-1",
                    role: "script-planner",
                    objective: "Draft the script outline",
                    deliverable: "draft script outline",
                    inputs: ["goal"],
                    outputs: ["script outline"],
                    acceptanceCriteria: ["Script bridge request is accepted."],
                    actionClass: "generate",
                    approvalMode: "auto_allow",
                    dependsOn: [],
                    status: "completed",
                    selectedAdapter: "script-execution-a",
                    allowedAdapters: ["script-execution-a"],
                    createdAt: "2026-04-14T08:45:00.000Z",
                    completedAt: "2026-04-14T08:47:00.000Z",
                    notes: ["external-bridge", "bridge:http-json"],
                    result: {
                      runId: "run-route-health-1",
                      assignmentId: "assignment-script-1",
                      status: "completed",
                      recordedAt: "2026-04-14T08:47:00.000Z",
                      workerId: "worker-script-1",
                      summary: "Script bridge request accepted.",
                      adapterId: "script-execution-a",
                      bridgeExecution: {
                        kind: "http-json",
                        request: {
                          endpointOrigin: "https://bridge.example.test",
                          endpointPath: "/v1/jobs",
                          method: "POST",
                          timeoutMs: 1_000,
                          authMode: "env",
                          headerKeys: ["authorization"],
                          payloadBytes: 256,
                        },
                        response: {
                          statusCode: 202,
                          accepted: true,
                          requestId: "req-script-1",
                          bodyBytes: 32,
                        },
                      },
                    },
                  }),
                  createExecutionAssignmentFixture({
                    runId: "run-route-health-1",
                    assignmentId: "assignment-shot-1",
                    role: "shot-planner",
                    objective: "Draft the shot list",
                    deliverable: "draft shot list",
                    inputs: ["assignment-script-1"],
                    outputs: ["shot list"],
                    acceptanceCriteria: ["Shot list has an approved route."],
                    actionClass: "generate",
                    approvalMode: "auto_allow",
                    dependsOn: ["assignment-script-1"],
                    status: "ready",
                    selectedAdapter: "runway-preview",
                    allowedAdapters: ["seedance-preview", "runway-preview"],
                    createdAt: "2026-04-14T08:45:00.000Z",
                    notes: [
                      "external-bridge",
                      "bridge:http-json",
                      "Retry requested at 2026-04-14T08:48:00.000Z.",
                      "Adapter rerouted from seedance-preview to runway-preview at 2026-04-14T08:49:00.000Z.",
                    ],
                  }),
                ],
              }),
            ),
          ),
          operatorSurface: {
            directorGoal: "Generate a lighthouse reveal sequence.",
            operatorSummary:
              "Script is accepted and the shot list has been rerouted for the next attempt.",
            nextAction: "wait for the rerouted shot-planner assignment to be claimed.",
          },
        }),
      ),
      "utf8",
    );

    const status = await describeDirectorStatus(workspaceRoot);

    expect(status).toContain("latest route health:");
    expect(status).toContain(
      "assignment-script-1 role=script-planner status=completed route=script-execution-a bridge=accepted status=202",
    );
    expect(status).toContain(
      "assignment-shot-1 role=shot-planner status=ready route=runway-preview last-bridge=seedance-preview",
    );
  });

  it("shows holding-state guidance in director status when the latest report is still waiting", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-cli-holding-status-"));
    tempRoots.push(workspaceRoot);
    const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
    const executionRunDir = join(runtimeDir, "execution", "runs", "run-holding-status-1");
    mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
    mkdirSync(executionRunDir, { recursive: true });
    writeFileSync(
      join(executionRunDir, "run.json"),
      JSON.stringify(
        createExecutionRunFixture({
          runId: "run-holding-status-1",
          updatedAt: "2026-04-19T06:20:00.000Z",
          status: "created",
          assignments: [
            {
              ...createExecutionRunFixture().assignments[0],
              assignmentId: "assignment-holding-status-1",
              status: "pending",
              approvalMode: "operator_approve",
              selectedAdapter: "mock-execution",
            },
          ],
        }),
      ),
      "utf8",
    );
    writeFileSync(
      join(executionRunDir, "report.json"),
      JSON.stringify(
        createExecutionRunReportFixture({
          reportId: "report-holding-status-1",
          runId: "run-holding-status-1",
          recordedAt: "2026-04-19T06:20:00.000Z",
          summary: ["run status=created"],
          flags: ["awaiting-approval-or-dependencies"],
          run: JSON.parse(
            JSON.stringify(
              createExecutionRunFixture({
                runId: "run-holding-status-1",
                updatedAt: "2026-04-19T06:20:00.000Z",
                status: "created",
                assignments: [
                  {
                    ...createExecutionRunFixture().assignments[0],
                    assignmentId: "assignment-holding-status-1",
                    status: "pending",
                    approvalMode: "operator_approve",
                    selectedAdapter: "mock-execution",
                  },
                ],
              }),
            ),
          ),
          events: createExecutionRunFixture().events,
        }),
      ),
      "utf8",
    );

    const status = await describeDirectorStatus(workspaceRoot);

    expect(status).toContain(
      "latest holding state: Run is created and still waiting on approval before any assignment becomes ready.",
    );
    expect(status).toContain(
      "latest holding summary: Run is still created because 1 assignment(s) are waiting on operator approval before the next dispatch can begin.",
    );
    expect(status).toContain(
      "latest next action: review the approval-gated assignments before asking the local worker lane to try again.",
    );
    expect(status).toContain(
      "latest suggested commands: hotflow director run explain --run-id run-holding-status-1 | hotflow director run report --run-id run-holding-status-1",
    );
  });

  it("posts a snapshot to the host API and validates the response", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-cli-evaluate-"));
    tempRoots.push(workspaceRoot);
    const snapshotPath = join(workspaceRoot, "snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify(createSnapshotFixture()), "utf8");

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshotId: "snapshot-1",
        runtimeId: "runtime-1",
        decision: "pass",
        summary: "ready",
        recommendations: [],
        plan: {
          planId: "plan-1",
          status: "ready",
          summary: "ready",
          confidence: 0.9,
          selectedGenerationStyle: "immersive",
          selectedImageBinding: "binding-a",
          selectedVideoBinding: null,
          riskFlags: [],
        },
        execution: {
          executionId: "execution-1",
          selectedGenerationType: "new",
          selectedGenerationStyle: "immersive",
          visiblePrompt: "Project: Director CLI",
        },
        review: {
          overallDecision: "pass",
          blockingReasons: [],
          requiredFixes: [],
        },
      }),
    });

    const result = await evaluateSnapshotWithDirector(snapshotPath, {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.decision).toBe("pass");
    expect(result.plan.planId).toBe("plan-1");
  });

  it("supports runtime snapshot, intake, clarify, blueprint, run, and outcome helper flows", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-cli-beta1-"));
    tempRoots.push(workspaceRoot);
    const snapshotPath = join(workspaceRoot, "snapshot.json");
    const outcomePath = join(workspaceRoot, "outcome.json");
    writeFileSync(snapshotPath, JSON.stringify(createSnapshotFixture()), "utf8");
    writeFileSync(
      outcomePath,
      JSON.stringify({
        apiVersion: DIRECTOR_HOST_API_VERSION,
        snapshotId: "snapshot-1",
        runtimeId: "runtime-1",
        handoffId: "handoff-execution-1",
        outcome: {
          status: "accepted",
          summary: "operator approved preview",
        },
      }),
      "utf8",
    );

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          runtimeId: "director-host-api",
          status: "ready",
          workspaceRoot: "/workspace",
          dataDir: "/workspace/.hotflow",
          defaultProvider: "scripted",
          defaultModel: "hotflow-phase1",
          availableProviders: ["binding-a"],
          knowledgePackCount: 0,
          notes: ["ready"],
          capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
            runtimeId: "director-host-api",
            capabilitySnapshot: {
              snapshotId: "capability-snapshot-runtime",
              runtimeId: "director-host-api",
              capturedAt: "2026-04-11T12:00:00.000Z",
              status: "ready",
              adapters: [
                {
                  adapterId: "binding-a",
                  adapterKind: "media",
                  provider: "mock-media",
                  enabled: true,
                  healthStatus: "ready",
                  dryRunSupported: true,
                  mockOnly: true,
                },
              ],
              notes: ["ready"],
            },
          }).capabilitySnapshot,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: "snapshot-1",
          runtimeId: "runtime-1",
          intakeId: "intake-snapshot-1",
          capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
            capabilitySnapshot: {
              snapshotId: "capability-snapshot-1",
              runtimeId: "runtime-1",
              capturedAt: "2026-04-11T12:00:00.000Z",
              status: "ready",
              adapters: [],
              notes: [],
            },
          }).capabilitySnapshot,
          clarification: createClarificationFixture(),
          alignmentState: "pending",
          alignmentLock: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: "snapshot-1",
          runtimeId: "runtime-1",
          intakeId: "intake-snapshot-1",
          clarification: createClarificationFixture({
            decision: "needs_clarification",
            summary: "Need one more answer before locking alignment.",
            missingFields: ["intent.preferredVideoBinding"],
            questions: [
              {
                questionId: "video-route",
                prompt: "which route?",
                affectsFields: ["intent.preferredVideoBinding"],
                required: false,
                answerKind: "single_select",
              },
            ],
          }),
          alignmentState: "pending",
          alignmentLock: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: "snapshot-1",
          runtimeId: "runtime-1",
          blueprintId: "blueprint-plan-1",
          review: {
            overallDecision: "pass",
            blockingReasons: [],
            requiredFixes: [],
          },
          capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
            capabilitySnapshot: {
              snapshotId: "capability-snapshot-1",
              runtimeId: "runtime-1",
              capturedAt: "2026-04-11T12:00:00.000Z",
              status: "ready",
              adapters: [],
              notes: [],
            },
          }).capabilitySnapshot,
          actionGraph: createActionGraphFixture({
            goal: "goal",
            nodes: [
              {
                nodeId: "node-a1",
                assignmentId: "a1",
                role: "researcher",
                objective: "inspect",
                assignedCapability: "research.synthesis",
                inputs: ["goal"],
                outputs: ["brief"],
                deliverable: "brief",
                acceptanceCriteria: ["done"],
                constraints: [],
                dependsOn: [],
                allowedAdapters: ["binding-a"],
                actionClass: "read",
                approvalMode: "auto_allow",
                timeoutMs: 300000,
                maxDelegationDepth: 1,
                fallbackPolicy: "stop and replan",
                escalationToDirector: true,
              },
            ],
            edges: [],
          }),
          preview: createOperatorPreviewFixture(),
          handoff: createHandoffEnvelopeFixture({
            actionGraphId: "graph-1",
          }),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: "snapshot-1",
          runtimeId: "runtime-1",
          blueprintId: "blueprint-plan-1",
          review: {
            overallDecision: "pass",
            blockingReasons: [],
            requiredFixes: [],
          },
          capabilitySnapshot: createRuntimeCapabilitySnapshotFixture({
            capabilitySnapshot: {
              snapshotId: "capability-snapshot-1",
              runtimeId: "runtime-1",
              capturedAt: "2026-04-11T12:00:00.000Z",
              status: "ready",
              adapters: [],
              notes: [],
            },
          }).capabilitySnapshot,
          actionGraph: createActionGraphFixture({
            goal: "goal",
            nodes: [
              {
                nodeId: "node-a1",
                assignmentId: "a1",
                role: "researcher",
                objective: "inspect",
                assignedCapability: "research.synthesis",
                inputs: ["goal"],
                outputs: ["brief"],
                deliverable: "brief",
                acceptanceCriteria: ["done"],
                constraints: [],
                dependsOn: [],
                allowedAdapters: ["binding-a"],
                actionClass: "read",
                approvalMode: "auto_allow",
                timeoutMs: 300000,
                maxDelegationDepth: 1,
                fallbackPolicy: "stop and replan",
                escalationToDirector: true,
                status: "ready",
                selectedAdapter: null,
              },
            ],
            edges: [],
          }),
          preview: createOperatorPreviewFixture(),
          handoff: createHandoffEnvelopeFixture({
            actionGraphId: "graph-1",
          }),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => createExecutionRunFixture(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            updatedAt: "2026-04-11T12:21:00.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshotId: "snapshot-1",
          blueprintId: "blueprint-plan-1",
          handoffId: "handoff-execution-1",
          stored: true,
          outcome: createOperatorOutcomeFixture(),
        }),
      });

    const runtime = await fetchDirectorRuntimeSnapshot({
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const intake = await submitDirectorIntake(snapshotPath, {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const clarify = await submitDirectorClarify(snapshotPath, {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const blueprint = await submitDirectorBlueprint(snapshotPath, {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const run = await submitDirectorRunCreate(snapshotPath, {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const runStatus = await fetchDirectorRunStatus("run-1", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const outcome = await submitDirectorOutcome(outcomePath, {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(runtime.capabilitySnapshot.runtimeId).toBe("director-host-api");
    expect(intake.intakeId).toBe("intake-snapshot-1");
    expect(clarify.clarification.decision).toBe("needs_clarification");
    expect(blueprint.handoff.handoffId).toBe("handoff-execution-1");
    expect(run.runId).toBe("run-1");
    expect(runStatus.runId).toBe("run-1");
    expect(outcome.outcome.status).toBe("accepted");
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("supports run control and report helper flows", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            status: "running",
            updatedAt: "2026-04-11T12:21:00.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            status: "paused",
            updatedAt: "2026-04-11T12:22:00.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            status: "running",
            updatedAt: "2026-04-11T12:23:00.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            status: "running",
            updatedAt: "2026-04-11T12:24:00.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            status: "running",
            updatedAt: "2026-04-11T12:24:30.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            status: "running",
            updatedAt: "2026-04-11T12:24:45.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunFixture({
            status: "aborted",
            completedAt: "2026-04-11T12:25:00.000Z",
            updatedAt: "2026-04-11T12:25:00.000Z",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          createExecutionRunReportFixture({
            run: createExecutionRunFixture({
              status: "aborted",
              completedAt: "2026-04-11T12:25:00.000Z",
              updatedAt: "2026-04-11T12:25:00.000Z",
            }),
            flags: ["preview-only"],
            summary: ["run status=aborted"],
          }),
      });

    const started = await submitDirectorRunStart("run-1", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const paused = await submitDirectorRunPause("run-1", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resumed = await submitDirectorRunResume("run-1", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const retried = await submitDirectorRunRetry("run-1", "a1", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const approved = await submitDirectorRunApprove("run-1", "a2", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const rerouted = await submitDirectorRunReroute("run-1", "a1", "runway-preview", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const aborted = await submitDirectorRunAbort("run-1", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const report = await fetchDirectorRunReport("run-1", {
      hostUrl: "http://127.0.0.1:3201",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(started.status).toBe("running");
    expect(paused.status).toBe("paused");
    expect(resumed.status).toBe("running");
    expect(retried.status).toBe("running");
    expect(approved.status).toBe("running");
    expect(rerouted.status).toBe("running");
    expect(aborted.status).toBe("aborted");
    expect(report.run.status).toBe("aborted");
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/v1/runs/run-1/start");
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/v1/runs/run-1/pause");
    expect(fetchImpl.mock.calls[2]?.[0]).toContain("/v1/runs/run-1/resume");
    expect(fetchImpl.mock.calls[3]?.[0]).toContain("/v1/runs/run-1/retry");
    expect(fetchImpl.mock.calls[4]?.[0]).toContain("/v1/runs/run-1/approve");
    expect(fetchImpl.mock.calls[5]?.[0]).toContain("/v1/runs/run-1/reroute");
    expect(fetchImpl.mock.calls[6]?.[0]).toContain("/v1/runs/run-1/abort");
    expect(fetchImpl.mock.calls[7]?.[0]).toContain("/v1/runs/run-1/report");
  });

  it("surfaces host-api retry conflict details for non-retryable bridge failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () =>
        JSON.stringify({
          code: "RUN_STATE_CONFLICT",
          message:
            "Assignment assignment-1 failed with non-retryable http_error status 422 and cannot be retried until the remote request or payload is fixed.",
        }),
    });

    await expect(
      submitDirectorRunRetry("run-1", "assignment-1", {
        hostUrl: "http://127.0.0.1:3201",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      "Director run retry failed (409 Conflict): Assignment assignment-1 failed with non-retryable http_error status 422 and cannot be retried until the remote request or payload is fixed.",
    );
  });

  it("surfaces host-api reroute conflict details for invalid adapter choices", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () =>
        JSON.stringify({
          code: "RUN_STATE_CONFLICT",
          message:
            "Assignment assignment-1 cannot reroute to wrong-adapter because it is not in the approved adapter set (seedance-preview, runway-preview).",
        }),
    });

    await expect(
      submitDirectorRunReroute("run-1", "assignment-1", "wrong-adapter", {
        hostUrl: "http://127.0.0.1:3201",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      "Director run reroute failed (409 Conflict): Assignment assignment-1 cannot reroute to wrong-adapter because it is not in the approved adapter set (seedance-preview, runway-preview).",
    );
  });
});
