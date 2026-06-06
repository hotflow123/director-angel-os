import {
  DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION,
  EXECUTION_BRIDGE_FAILURE_REASONS,
  isAssignmentResult,
  isAssignmentRun,
  isAssignmentRunStatus,
  isExecutionBridgeExecution,
  isExecutionEvent,
  isExecutionRun,
  isExecutionRunReport,
  isExecutionRunStatus,
} from "../src/index.ts";

describe("director-execution-contracts guards", () => {
  it("validates assignment run status", () => {
    expect(isAssignmentRunStatus("ready")).toBe(true);
    expect(isAssignmentRunStatus("unknown" as never)).toBe(false);
  });

  it("validates execution run status", () => {
    expect(isExecutionRunStatus("running")).toBe(true);
    expect(isExecutionRunStatus("bogus" as never)).toBe(false);
  });

  it("validates assignment run shape", () => {
    const run = {
      runId: "run-1",
      assignmentId: "assignment-a",
      role: "researcher" as const,
      objective: "Inspect the locked brief.",
      deliverable: "Research brief",
      inputs: ["snapshot", "knowledge://pack/continuity"],
      outputs: ["research brief"],
      acceptanceCriteria: ["Preserves recalled continuity."],
      constraints: [
        {
          field: "recalledKnowledge",
          requirement: "Apply continuity pack pack://continuity/v2.",
          priority: "required" as const,
          rationale: "Execution needs the recalled operating constraint.",
        },
        {
          field: "skill",
          requirement: "Use approved skill skill://research-brief.",
          priority: "preferred" as const,
        },
      ],
      actionClass: "read" as const,
      approvalMode: "auto_allow" as const,
      dependsOn: [],
      status: "ready" as const,
      createdAt: new Date().toISOString(),
      notes: ["ready"],
    };
    expect(isAssignmentRun(run)).toBe(true);
  });

  it("validates assignment result shape", () => {
    const result = {
      runId: "run-1",
      assignmentId: "assignment-a",
      status: "completed" as const,
      recordedAt: new Date().toISOString(),
      workerId: "worker-1",
      summary: "Mock execution completed.",
      adapterId: "mock-execution",
      notes: ["preview-safe"],
    };
    expect(isAssignmentResult(result)).toBe(true);
  });

  it("validates bridge execution shape", () => {
    const bridgeExecution = {
      kind: "http-json" as const,
      request: {
        endpointOrigin: "https://bridge.example.test",
        endpointPath: "/v1/jobs",
        method: "POST" as const,
        timeoutMs: 15_000,
        authMode: "env" as const,
        headerKeys: ["authorization", "x-trace-id"],
        payloadBytes: 512,
      },
      response: {
        statusCode: 202,
        accepted: true,
        requestId: "req-1",
        bodyBytes: 128,
      },
    };

    expect(isExecutionBridgeExecution(bridgeExecution)).toBe(true);
    expect(
      isAssignmentResult({
        runId: "run-1",
        assignmentId: "assignment-a",
        status: "completed" as const,
        recordedAt: new Date().toISOString(),
        workerId: "worker-1",
        summary: "Bridge execution completed.",
        adapterId: "seedance-preview",
        bridgeExecution,
      }),
    ).toBe(true);
  });

  it("validates bridge execution failure shape", () => {
    const bridgeExecution = {
      kind: "http-json" as const,
      request: {
        endpointOrigin: "https://bridge.example.test",
        endpointPath: "/v1/jobs",
        method: "POST" as const,
        timeoutMs: 10_000,
        authMode: "none" as const,
      },
      failure: {
        reason: "network_timeout" as const,
        message: "Bridge request timed out.",
        retryable: true,
        statusCode: 504,
      },
    };

    expect(EXECUTION_BRIDGE_FAILURE_REASONS).toContain("network_timeout");
    expect(isExecutionBridgeExecution(bridgeExecution)).toBe(true);
    expect(
      isAssignmentResult({
        runId: "run-1",
        assignmentId: "assignment-a",
        status: "failed" as const,
        recordedAt: new Date().toISOString(),
        workerId: "worker-1",
        summary: "Bridge execution failed.",
        bridgeExecution,
      }),
    ).toBe(true);
  });

  it("validates execution event shape", () => {
    const event = {
      eventId: "event-1",
      runId: "run-1",
      type: "run-created" as const,
      occurredAt: new Date().toISOString(),
      message: "test",
    };
    expect(isExecutionEvent(event)).toBe(true);
  });

  it("validates execution run shape", () => {
    const run = {
      schemaVersion: DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION,
      runId: "run-1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      handoffId: "handoff-1",
      actionGraphId: "graph-1",
      goal: "Build a preview-safe run.",
      previewSummary: "Ready to preview.",
      sideEffectsAllowed: false,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "created" as const,
      assignments: [
        {
          runId: "run-1",
          assignmentId: "assignment-a",
          role: "researcher" as const,
          objective: "Inspect the locked brief.",
          deliverable: "Research brief",
          actionClass: "read" as const,
          approvalMode: "auto_allow" as const,
          dependsOn: [],
          status: "ready" as const,
          createdAt: new Date().toISOString(),
          result: {
            runId: "run-1",
            assignmentId: "assignment-a",
            status: "completed" as const,
            recordedAt: new Date().toISOString(),
            workerId: "worker-1",
            summary: "Mock execution completed.",
          },
        },
      ],
      events: [
        {
          eventId: "event-1",
          runId: "run-1",
          type: "run-created" as const,
          occurredAt: new Date().toISOString(),
          message: "starting",
        },
      ],
    };
    expect(isExecutionRun(run)).toBe(true);
  });

  it("validates execution run report", () => {
    const run = {
      schemaVersion: DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION,
      runId: "run-1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      handoffId: "handoff-1",
      actionGraphId: "graph-1",
      goal: "Build a preview-safe run.",
      previewSummary: "Ready to preview.",
      sideEffectsAllowed: false,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "created" as const,
      assignments: [],
      events: [],
    };
    const report = {
      schemaVersion: DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION,
      reportId: "report-1",
      runId: "run-1",
      run,
      recordedAt: new Date().toISOString(),
      summary: ["nothing"],
      flags: [],
      operatorSurface: {
        directorGoal: "Build a preview-safe run.",
        operatorSummary: "Ready to preview.",
        objective: "Inspect the locked brief.",
        deliverable: "Research brief",
        adapterRoute: "seedance-preview",
        lastBridgeRoute: "seedance-preview",
        bridgeVerdict: "failed" as const,
        bridgeFailureReason: "network_timeout",
        retryable: true,
        retryAllowed: true,
        rerouteCandidates: ["runway-preview"],
        bridgeStatus: 504,
        nextAction: "review the failure and retry when the side-effect boundary is safe.",
        bridgeAttempts: {
          attempts: 1,
          successes: 0,
          failures: 1,
        },
      },
      bridgeMetrics: {
        attempts: 1,
        successes: 0,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: "assignment-a",
            reason: "network_timeout",
            retryable: true,
            statusCode: 504,
          },
        ],
      },
      events: [],
    };
    expect(isExecutionRunReport(report)).toBe(true);
  });
});
