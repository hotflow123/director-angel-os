import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { DirectorBlueprintResponse } from "@hotflow/director-host-contracts";

import { ExecutionRunBuilder } from "../src/builder.ts";
import { buildExecutionRunDelegations } from "../src/delegation-adapter.ts";
import { ExecutionRunService } from "../src/service.ts";
import { FileSystemRunStore } from "../src/store.ts";

describe("ExecutionRunService", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "director-execution-service-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test("progresses assignments by dependency order and persists a run report", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:00:01.000Z",
      "2026-04-12T00:00:02.000Z",
      "2026-04-12T00:00:03.000Z",
      "2026-04-12T00:00:04.000Z",
      "2026-04-12T00:00:05.000Z",
      "2026-04-12T00:00:06.000Z",
      "2026-04-12T00:00:07.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());

    const startedRun = await service.startRun("run-1");
    expect(startedRun.status).toBe("running");
    expect(startedRun.startedAt).toBe("2026-04-12T00:00:02.000Z");

    const firstClaim = await service.claimNextReadyAssignment("run-1", "worker-a");
    expect(firstClaim?.assignment.assignmentId).toBe("assignment-1");
    expect(firstClaim?.assignment.status).toBe("running");

    const afterFirstCompletion = await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "completed",
      recordedAt: "2026-04-12T00:00:04.000Z",
      workerId: "worker-a",
      summary: "Research pass completed.",
      adapterId: "mock-execution",
      notes: ["preview-safe"],
    });
    const secondAssignmentAfterUnblock = afterFirstCompletion.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-2",
    );
    expect(secondAssignmentAfterUnblock?.status).toBe("ready");

    const secondClaim = await service.claimNextReadyAssignment("run-1", "worker-a");
    expect(secondClaim?.assignment.assignmentId).toBe("assignment-2");

    const completedRun = await service.completeAssignment("run-1", "assignment-2", {
      runId: "run-1",
      assignmentId: "assignment-2",
      status: "completed",
      recordedAt: "2026-04-12T00:00:06.000Z",
      workerId: "worker-a",
      summary: "Script draft completed.",
      adapterId: "mock-execution",
    });
    expect(completedRun.status).toBe("completed");
    expect(completedRun.completedAt).toBe("2026-04-12T00:00:06.000Z");

    const report = await service.collectRunReport("run-1");
    expect(report.run.status).toBe("completed");
    expect(report.summary[0]).toContain("run status=completed");
    expect(report.flags).toContain("preview-only");
    expect(report.operatorSurface).toMatchObject({
      directorGoal: "deliver preview",
      operatorSummary: "preview",
      objective: "Inspect the brief",
      deliverable: "prepare outline",
      adapterRoute: "mock-execution",
    });

    const persistedReport = await service.getReport("run-1");
    expect(persistedReport?.reportId).toBe(report.reportId);
    expect(persistedReport?.events.length).toBeGreaterThanOrEqual(5);
  });

  test("adapts execution assignments into worker delegation records", async () => {
    const service = createService(workspaceRoot, ["2026-04-12T00:01:01.000Z"]);
    const run = await service.createRunFromBlueprint(createBlueprintFixture());

    const delegations = buildExecutionRunDelegations(run);

    expect(delegations).toHaveLength(1);
    expect(delegations[0]).toMatchObject({
      id: "delegation_run_1_assignment_1",
      taskId: "assignment-1",
      workerId: "director-researcher",
      fromAgent: "director",
      specialization: "explore",
      targetAgent: "researcher-agent",
      status: "queued",
    });
    expect(delegations[0]?.instruction).toContain("Objective: Inspect the brief");
    expect(delegations[0]?.contextSnapshot).toContain("run=run-1");

    const allDelegations = buildExecutionRunDelegations(run, { includePending: true });
    expect(allDelegations.map((delegation) => delegation.workerId)).toEqual([
      "director-researcher",
      "director-script-planner",
    ]);
    expect(allDelegations[1]?.verificationRequest).toMatchObject({
      verifierId: "director-qc-reviewer",
      verificationId: "verification_run_1_assignment_2",
    });
  });

  test("role-scoped workers only claim their matching crew assignment", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:02:01.000Z",
      "2026-04-12T00:02:02.000Z",
      "2026-04-12T00:02:03.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          ...createBlueprintFixture().actionGraph,
          nodes: createBlueprintFixture().actionGraph.nodes.map((node) => ({
            ...node,
            dependsOn: [],
            approvalMode: "auto_allow",
            status: "ready",
          })),
        },
      }),
    );
    await service.startRun("run-1");

    const scriptClaim = await service.claimNextReadyAssignment("run-1", "director-script-planner");
    expect(scriptClaim?.assignment.role).toBe("script-planner");

    const researcherClaim = await service.claimNextReadyAssignment("run-1", "director-researcher");
    expect(researcherClaim?.assignment.role).toBe("researcher");
  });

  test("releases pending auto-allow root assignments during a safety-policy pass", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:10:01.000Z",
      "2026-04-12T00:10:02.000Z",
      "2026-04-12T00:10:03.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        review: {
          overallDecision: "warn",
          blockingReasons: [],
          requiredFixes: ["Operator review is required for downstream work."],
        },
        actionGraph: {
          ...createBlueprintFixture().actionGraph,
          nodes: createBlueprintFixture().actionGraph.nodes.map((node, index) => ({
            ...node,
            status: "awaiting_approval",
            approvalMode: index === 0 ? "auto_allow" : "operator_approve",
          })),
        },
      }),
    );
    await service.startRun("run-1");

    const advanced = await service.applySafetyPolicy("run-1", {
      executionEnabled: true,
      pauseAll: false,
    });
    const rootAssignment = advanced.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-1",
    );
    const gatedAssignment = advanced.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-2",
    );

    expect(rootAssignment?.status).toBe("ready");
    expect(gatedAssignment?.status).toBe("pending");
    expect(advanced.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "assignment-status-changed",
          message: "Assignment assignment-1 is ready to run.",
        }),
      ]),
    );
  });

  test("records bridge execution summary and flags in the run report", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:05:01.000Z",
      "2026-04-12T00:05:02.000Z",
      "2026-04-12T00:05:03.000Z",
      "2026-04-12T00:05:04.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge");

    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:03.000Z",
      workerId: "worker-bridge",
      summary: "Bridge request timed out.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        failure: {
          reason: "network_timeout",
          message: "Bridge request timed out.",
          retryable: true,
          statusCode: 504,
        },
      },
    });

    const report = await service.collectRunReport("run-1");
    expect(report.flags).toContain("external-bridge-attempted");
    expect(report.flags).toContain("external-bridge-failed");
    expect(report.summary).toContain("bridge attempts=1 succeeded=0 failed=1");
    expect(report.operatorSurface).toMatchObject({
      directorGoal: "deliver preview",
      operatorSummary: "preview",
      objective: "Inspect the brief",
      deliverable: "prepare outline",
      adapterRoute: "seedance-preview",
      bridgeVerdict: "failed",
      bridgeFailureReason: "network_timeout",
      retryable: true,
      retryAllowed: true,
      bridgeStatus: 504,
      nextAction: "review the failure and retry when the side-effect boundary is safe.",
      bridgeAttempts: {
        attempts: 1,
        successes: 0,
        failures: 1,
      },
    });
    expect(report.bridgeMetrics).toEqual({
      attempts: 1,
      successes: 0,
      failures: 1,
      failedAssignments: [
        {
          assignmentId: "assignment-1",
          reason: "network_timeout",
          retryable: true,
          statusCode: 504,
        },
      ],
    });
  });

  test("records non-retryable configuration bridge guidance in the operator surface", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:05:01.000Z",
      "2026-04-12T00:05:02.000Z",
      "2026-04-12T00:05:03.000Z",
      "2026-04-12T00:05:04.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge-config");

    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:03.000Z",
      workerId: "worker-bridge-config",
      summary: "Bridge credential is not configured.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        failure: {
          reason: "configuration_error",
          message: "Bridge credential is not configured.",
          retryable: false,
        },
      },
    });

    const report = await service.collectRunReport("run-1");
    expect(report.operatorSurface).toMatchObject({
      bridgeVerdict: "failed",
      bridgeFailureReason: "configuration_error",
      retryable: false,
      retryAllowed: false,
      nextAction: "fix the adapter bridge configuration before retrying.",
    });
  });

  test("rejects retry for non-retryable bridge http failures", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:05:01.000Z",
      "2026-04-12T00:05:02.000Z",
      "2026-04-12T00:05:03.000Z",
      "2026-04-12T00:05:04.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge-http-422");

    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:03.000Z",
      workerId: "worker-bridge-http-422",
      summary: "Bridge request returned HTTP 422.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 422,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 422.",
          retryable: false,
          statusCode: 422,
        },
      },
    });

    const report = await service.collectRunReport("run-1");
    expect(report.operatorSurface).toMatchObject({
      bridgeVerdict: "failed",
      bridgeFailureReason: "http_error",
      retryable: false,
      retryAllowed: false,
      bridgeStatus: 422,
      nextAction: "inspect the remote bridge request and payload before re-running the assignment.",
    });

    await expect(service.retryAssignment("run-1", "assignment-1")).rejects.toThrow(
      "failed with non-retryable http_error status 422 and cannot be retried until the remote request or payload is fixed",
    );
  });

  test("closes the retry path after the retry budget is exhausted for a retryable bridge failure", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:05:11.000Z",
      "2026-04-12T00:05:12.000Z",
      "2026-04-12T00:05:13.000Z",
      "2026-04-12T00:05:14.000Z",
      "2026-04-12T00:05:15.000Z",
      "2026-04-12T00:05:16.000Z",
      "2026-04-12T00:05:17.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge-http-502-a");

    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:13.000Z",
      workerId: "worker-bridge-http-502-a",
      summary: "Bridge request returned HTTP 502.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 502,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502.",
          retryable: true,
          statusCode: 502,
        },
      },
    });

    const retriedRun = await service.retryAssignment("run-1", "assignment-1");
    expect(retriedRun.status).toBe("running");
    expect(
      retriedRun.assignments.find((assignment) => assignment.assignmentId === "assignment-1")
        ?.notes,
    ).toContain("Retry requested at 2026-04-12T00:05:14.000Z.");

    await service.claimNextReadyAssignment("run-1", "worker-bridge-http-502-b");
    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:16.000Z",
      workerId: "worker-bridge-http-502-b",
      summary: "Bridge request returned HTTP 502 again.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 502,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502 again.",
          retryable: true,
          statusCode: 502,
        },
      },
    });

    const exhaustedReport = await service.collectRunReport("run-1");
    expect(exhaustedReport.operatorSurface).toMatchObject({
      bridgeVerdict: "failed",
      bridgeFailureReason: "http_error",
      retryable: true,
      retryAllowed: false,
      bridgeStatus: 502,
      nextAction:
        "retry budget is exhausted; repair the route, reroute the adapter, or choose a failover path before re-running the assignment.",
    });

    await expect(service.retryAssignment("run-1", "assignment-1")).rejects.toThrow(
      "exhausted the retry budget (1/1) for retryable http_error status 502",
    );
  });

  test("reroutes an exhausted bridge assignment onto an approved alternate adapter and reopens retry", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:05:11.000Z",
      "2026-04-12T00:05:12.000Z",
      "2026-04-12T00:05:13.000Z",
      "2026-04-12T00:05:14.000Z",
      "2026-04-12T00:05:15.000Z",
      "2026-04-12T00:05:16.000Z",
      "2026-04-12T00:05:17.000Z",
      "2026-04-12T00:05:18.000Z",
      "2026-04-12T00:05:19.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-reroute-1",
          blueprintId: "blueprint-1",
          goal: "deliver reroute recovery",
          nodes: [
            {
              nodeId: "node-bridge-1",
              assignmentId: "assignment-1",
              role: "asset-router",
              objective: "Submit the remote generation request",
              inputs: ["approved brief"],
              outputs: ["remote request"],
              deliverable: "send a bounded adapter request",
              acceptanceCriteria: ["Bridge request is bounded."],
              constraints: [],
              dependsOn: [],
              allowedAdapters: ["seedance-preview", "runway-preview"],
              actionClass: "generate",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "seedance-preview",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        handoff: {
          handoffId: "handoff-reroute-1",
          blueprintId: "blueprint-1",
          createdAt: "2026-04-12T00:00:00.000Z",
          alignmentLockId: "lock-1",
          actionGraphId: "graph-reroute-1",
          previewSummary: "reroute",
          capabilityMatches: [],
          mediaRequests: [],
          expectedArtifacts: [],
          chosenAdapters: ["seedance-preview", "runway-preview"],
          sideEffectsAllowed: true,
          notes: ["external-bridge"],
        },
      }),
    );
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge-http-502-a");

    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:13.000Z",
      workerId: "worker-bridge-http-502-a",
      summary: "Bridge request returned HTTP 502.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 502,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502.",
          retryable: true,
          statusCode: 502,
        },
      },
    });

    await service.retryAssignment("run-1", "assignment-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge-http-502-b");
    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:16.000Z",
      workerId: "worker-bridge-http-502-b",
      summary: "Bridge request returned HTTP 502 again.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 502,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502 again.",
          retryable: true,
          statusCode: 502,
        },
      },
    });

    const exhaustedReport = await service.collectRunReport("run-1");
    expect(exhaustedReport.operatorSurface).toMatchObject({
      adapterRoute: "seedance-preview",
      bridgeVerdict: "failed",
      retryAllowed: false,
      rerouteCandidates: ["runway-preview"],
    });

    await expect(service.retryAssignment("run-1", "assignment-1")).rejects.toThrow(
      "exhausted the retry budget (1/1) for retryable http_error status 502",
    );

    const reroutedRun = await service.rerouteAssignment("run-1", "assignment-1", "runway-preview");
    const reroutedAssignment = reroutedRun.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-1",
    );
    expect(reroutedAssignment?.selectedAdapter).toBe("runway-preview");
    expect(
      reroutedAssignment?.notes?.some((note) =>
        note.startsWith("Adapter rerouted from seedance-preview to runway-preview at "),
      ),
    ).toBe(true);

    const reroutedReport = await service.collectRunReport("run-1");
    expect(reroutedReport.operatorSurface).toMatchObject({
      adapterRoute: "runway-preview",
      lastBridgeRoute: "seedance-preview",
      bridgeVerdict: "failed",
      retryAllowed: true,
    });
    expect(reroutedReport.operatorSurface?.rerouteCandidates).toBeUndefined();

    const retriedAfterReroute = await service.retryAssignment("run-1", "assignment-1");
    expect(
      retriedAfterReroute.assignments.find(
        (assignment) => assignment.assignmentId === "assignment-1",
      )?.status,
    ).toBe("ready");
  });

  test("records structured route recovery evidence in assignment events", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:07:11.000Z",
      "2026-04-12T00:07:12.000Z",
      "2026-04-12T00:07:13.000Z",
      "2026-04-12T00:07:14.000Z",
      "2026-04-12T00:07:15.000Z",
      "2026-04-12T00:07:16.000Z",
      "2026-04-12T00:07:17.000Z",
      "2026-04-12T00:07:18.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-route-audit-1",
          blueprintId: "blueprint-1",
          goal: "deliver route audit closure",
          nodes: [
            {
              nodeId: "node-route-audit-1",
              assignmentId: "assignment-1",
              role: "asset-router",
              objective: "Submit the remote generation request",
              inputs: ["approved brief"],
              outputs: ["remote request"],
              deliverable: "send a bounded adapter request",
              acceptanceCriteria: ["Bridge request is bounded."],
              constraints: [],
              dependsOn: [],
              allowedAdapters: ["seedance-preview", "runway-preview"],
              actionClass: "generate",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "seedance-preview",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        handoff: {
          handoffId: "handoff-route-audit-1",
          blueprintId: "blueprint-1",
          createdAt: "2026-04-12T00:00:00.000Z",
          alignmentLockId: "lock-1",
          actionGraphId: "graph-route-audit-1",
          previewSummary: "route audit",
          capabilityMatches: [],
          mediaRequests: [],
          expectedArtifacts: [],
          chosenAdapters: ["seedance-preview", "runway-preview"],
          sideEffectsAllowed: true,
          notes: ["external-bridge"],
        },
      }),
    );
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-route-audit-a");

    const firstFailedRun = await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:07:13.000Z",
      workerId: "worker-route-audit-a",
      summary: "Bridge request returned HTTP 502.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 502,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502.",
          retryable: true,
          statusCode: 502,
        },
      },
    });

    const failedEvent = [...firstFailedRun.events]
      .reverse()
      .find(
        (event) =>
          event.type === "assignment-status-changed" &&
          event.payload?.assignmentId === "assignment-1" &&
          event.payload?.nextStatus === "failed",
      );
    expect(failedEvent?.payload).toMatchObject({
      assignmentId: "assignment-1",
      previousStatus: "running",
      nextStatus: "failed",
      adapterId: "seedance-preview",
      bridgeKind: "http-json",
      bridgeVerdict: "failed",
      bridgeFailureReason: "http_error",
      bridgeRetryable: true,
      bridgeStatus: 502,
    });

    const retriedRun = await service.retryAssignment("run-1", "assignment-1");
    const retryEvent = [...retriedRun.events]
      .reverse()
      .find(
        (event) =>
          event.type === "assignment-status-changed" &&
          event.payload?.assignmentId === "assignment-1" &&
          event.message.includes("reset for retry"),
      );
    expect(retryEvent?.payload).toMatchObject({
      assignmentId: "assignment-1",
      adapterId: "seedance-preview",
      retryCount: 1,
      retryLimit: 1,
    });

    await service.claimNextReadyAssignment("run-1", "worker-route-audit-b");
    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:07:16.000Z",
      workerId: "worker-route-audit-b",
      summary: "Bridge request returned HTTP 502 again.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 502,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502 again.",
          retryable: true,
          statusCode: 502,
        },
      },
    });

    const reroutedRun = await service.rerouteAssignment("run-1", "assignment-1", "runway-preview");
    const rerouteEvent = [...reroutedRun.events]
      .reverse()
      .find(
        (event) =>
          event.type === "log" &&
          event.payload?.assignmentId === "assignment-1" &&
          event.payload?.nextAdapterId === "runway-preview",
      );
    expect(rerouteEvent?.payload).toMatchObject({
      assignmentId: "assignment-1",
      previousAdapterId: "seedance-preview",
      nextAdapterId: "runway-preview",
    });

    const retriedAfterReroute = await service.retryAssignment("run-1", "assignment-1");
    const retryAfterRerouteEvent = [...retriedAfterReroute.events]
      .reverse()
      .find(
        (event) =>
          event.type === "assignment-status-changed" &&
          event.payload?.assignmentId === "assignment-1" &&
          event.message.includes("reset for retry"),
      );
    expect(retryAfterRerouteEvent?.payload).toMatchObject({
      assignmentId: "assignment-1",
      adapterId: "runway-preview",
      retryCount: 1,
      retryLimit: 1,
    });
  });

  test("rejects reroute to an adapter outside the approved set", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:05:11.000Z",
      "2026-04-12T00:05:12.000Z",
      "2026-04-12T00:05:13.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-reroute-2",
          blueprintId: "blueprint-1",
          goal: "deliver reroute recovery",
          nodes: [
            {
              nodeId: "node-bridge-1",
              assignmentId: "assignment-1",
              role: "asset-router",
              objective: "Submit the remote generation request",
              inputs: ["approved brief"],
              outputs: ["remote request"],
              deliverable: "send a bounded adapter request",
              acceptanceCriteria: ["Bridge request is bounded."],
              constraints: [],
              dependsOn: [],
              allowedAdapters: ["seedance-preview", "runway-preview"],
              actionClass: "generate",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "seedance-preview",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        handoff: {
          handoffId: "handoff-reroute-2",
          blueprintId: "blueprint-1",
          createdAt: "2026-04-12T00:00:00.000Z",
          alignmentLockId: "lock-1",
          actionGraphId: "graph-reroute-2",
          previewSummary: "reroute",
          capabilityMatches: [],
          mediaRequests: [],
          expectedArtifacts: [],
          chosenAdapters: ["seedance-preview", "runway-preview"],
          sideEffectsAllowed: true,
          notes: ["external-bridge"],
        },
      }),
    );
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge-http-502-a");

    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:05:13.000Z",
      workerId: "worker-bridge-http-502-a",
      summary: "Bridge request returned HTTP 502.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 502,
          accepted: false,
          bodyBytes: 64,
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502.",
          retryable: true,
          statusCode: 502,
        },
      },
    });

    await expect(
      service.rerouteAssignment("run-1", "assignment-1", "wrong-adapter"),
    ).rejects.toThrow(
      "Assignment assignment-1 cannot reroute to wrong-adapter because it is not in the approved adapter set (seedance-preview, runway-preview).",
    );
  });

  test("prefers the failed bridge assignment in operator surface for a dual execution chain", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:06:01.000Z",
      "2026-04-12T00:06:02.000Z",
      "2026-04-12T00:06:03.000Z",
      "2026-04-12T00:06:04.000Z",
      "2026-04-12T00:06:05.000Z",
      "2026-04-12T00:06:06.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-dual-1",
          blueprintId: "blueprint-1",
          goal: "deliver dual execution",
          nodes: [
            {
              nodeId: "node-script-1",
              assignmentId: "assignment-script-1",
              role: "script-planner",
              objective: "Draft the script outline",
              inputs: ["approved brief"],
              outputs: ["script outline"],
              deliverable: "draft script outline",
              acceptanceCriteria: ["Script outline is deterministic."],
              constraints: [],
              dependsOn: [],
              allowedAdapters: ["script-execution-a"],
              actionClass: "generate",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "script-execution-a",
            },
            {
              nodeId: "node-shot-1",
              assignmentId: "assignment-shot-1",
              role: "shot-planner",
              objective: "Draft the shot list",
              inputs: ["script outline"],
              outputs: ["shot list"],
              deliverable: "draft shot list",
              acceptanceCriteria: ["Shot list is deterministic."],
              constraints: [],
              dependsOn: ["assignment-script-1"],
              allowedAdapters: ["script-execution-a"],
              actionClass: "generate",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "script-execution-a",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        handoff: {
          handoffId: "handoff-1",
          blueprintId: "blueprint-1",
          createdAt: "2026-04-12T00:00:00.000Z",
          alignmentLockId: "lock-1",
          actionGraphId: "graph-dual-1",
          previewSummary: "preview",
          capabilityMatches: [],
          mediaRequests: [],
          expectedArtifacts: [],
          chosenAdapters: ["script-execution-a"],
          sideEffectsAllowed: true,
          notes: ["external-bridge-enabled"],
        },
      }),
    );
    await service.startRun("run-1");

    const scriptClaim = await service.claimNextReadyAssignment("run-1", "worker-dual");
    expect(scriptClaim?.assignment.assignmentId).toBe("assignment-script-1");

    await service.completeAssignment("run-1", "assignment-script-1", {
      runId: "run-1",
      assignmentId: "assignment-script-1",
      status: "completed",
      recordedAt: "2026-04-12T00:06:03.000Z",
      workerId: "worker-dual",
      summary: "Script bridge request accepted.",
      adapterId: "script-execution-a",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/script-jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 202,
          accepted: true,
          requestId: "req-script-1",
          bodyBytes: 64,
        },
      },
    });

    const shotClaim = await service.claimNextReadyAssignment("run-1", "worker-dual");
    expect(shotClaim?.assignment.assignmentId).toBe("assignment-shot-1");

    await service.completeAssignment("run-1", "assignment-shot-1", {
      runId: "run-1",
      assignmentId: "assignment-shot-1",
      status: "failed",
      recordedAt: "2026-04-12T00:06:05.000Z",
      workerId: "worker-dual",
      summary: "Shot bridge request timed out.",
      adapterId: "script-execution-a",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/script-jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        failure: {
          reason: "network_timeout",
          message: "Bridge request timed out.",
          retryable: true,
          statusCode: 504,
        },
      },
    });

    const report = await service.collectRunReport("run-1");
    expect(report.summary).toContain("bridge attempts=2 succeeded=1 failed=1");
    expect(report.operatorSurface).toMatchObject({
      directorGoal: "deliver dual execution",
      operatorSummary: "preview",
      objective: "Draft the shot list",
      deliverable: "draft shot list",
      adapterRoute: "script-execution-a",
      bridgeVerdict: "failed",
      bridgeFailureReason: "network_timeout",
      retryable: true,
      retryAllowed: true,
      bridgeStatus: 504,
      nextAction: "review the failure and retry when the side-effect boundary is safe.",
      bridgeAttempts: {
        attempts: 2,
        successes: 1,
        failures: 1,
      },
    });
    expect(report.bridgeMetrics).toEqual({
      attempts: 2,
      successes: 1,
      failures: 1,
      failedAssignments: [
        {
          assignmentId: "assignment-shot-1",
          reason: "network_timeout",
          retryable: true,
          statusCode: 504,
        },
      ],
    });
  });

  test("records operator surface fields for a successful bridge run report", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:07:01.000Z",
      "2026-04-12T00:07:02.000Z",
      "2026-04-12T00:07:03.000Z",
      "2026-04-12T00:07:04.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-1",
          blueprintId: "blueprint-1",
          goal: "deliver preview",
          nodes: [
            {
              nodeId: "node-1",
              assignmentId: "assignment-1",
              role: "asset-router",
              objective: "Submit a media generation request",
              inputs: ["approved brief"],
              outputs: ["bridge job"],
              deliverable: "send a bounded adapter request",
              acceptanceCriteria: ["request is accepted"],
              constraints: [],
              dependsOn: [],
              allowedAdapters: ["seedance-preview"],
              actionClass: "generate",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "seedance-preview",
            },
          ],
          edges: [],
          stopConditions: [],
        },
      }),
    );
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-bridge");

    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "completed",
      recordedAt: "2026-04-12T00:07:03.000Z",
      workerId: "worker-bridge",
      summary: "Bridge request accepted.",
      adapterId: "seedance-preview",
      bridgeExecution: {
        kind: "http-json",
        request: {
          endpointOrigin: "https://bridge.example.test",
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 10_000,
          authMode: "env",
          headerKeys: ["authorization"],
          payloadBytes: 256,
        },
        response: {
          statusCode: 202,
          accepted: true,
          requestId: "req-1",
          bodyBytes: 64,
        },
      },
    });

    const report = await service.collectRunReport("run-1");
    expect(report.operatorSurface).toMatchObject({
      directorGoal: "deliver preview",
      operatorSummary: "preview",
      objective: "Submit a media generation request",
      deliverable: "send a bounded adapter request",
      adapterRoute: "seedance-preview",
      bridgeVerdict: "accepted",
      requestAccepted: true,
      bridgeStatus: 202,
      requestId: "req-1",
      nextAction: "track the remote request by request id and wait for the downstream result.",
      bridgeAttempts: {
        attempts: 1,
        successes: 1,
        failures: 0,
      },
    });
  });

  test("keeps operator approval assignments pending after dependencies complete", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:10:01.000Z",
      "2026-04-12T00:10:02.000Z",
      "2026-04-12T00:10:03.000Z",
      "2026-04-12T00:10:04.000Z",
      "2026-04-12T00:10:05.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-1",
          blueprintId: "blueprint-1",
          goal: "deliver preview",
          nodes: [
            {
              nodeId: "node-1",
              assignmentId: "assignment-1",
              role: "researcher",
              objective: "Inspect the brief",
              inputs: ["snapshot"],
              outputs: ["research brief"],
              deliverable: "prepare outline",
              acceptanceCriteria: ["Goal is explicit."],
              constraints: [],
              dependsOn: [],
              allowedAdapters: [],
              actionClass: "read",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "mock-execution",
            },
            {
              nodeId: "node-2",
              assignmentId: "assignment-2",
              role: "script-planner",
              objective: "Draft the shot plan",
              inputs: ["research brief"],
              outputs: ["shot plan"],
              deliverable: "draft shot plan",
              acceptanceCriteria: ["Plan is deterministic."],
              constraints: [],
              dependsOn: ["assignment-1"],
              allowedAdapters: ["mock-execution"],
              actionClass: "write",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              status: "awaiting_approval",
              selectedAdapter: "mock-execution",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        preview: {
          previewId: "preview-1",
          summary: "preview",
          warnings: [],
          blockedReasons: [],
          requiredApprovals: ["script-planner:assignment-2"],
        },
      }),
    );

    await service.startRun("run-1");
    const firstClaim = await service.claimNextReadyAssignment("run-1", "worker-b");
    expect(firstClaim?.assignment.assignmentId).toBe("assignment-1");

    const runAfterCompletion = await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "completed",
      recordedAt: "2026-04-12T00:10:04.000Z",
      workerId: "worker-b",
      summary: "Research pass completed.",
    });
    const gatedAssignment = runAfterCompletion.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-2",
    );
    expect(gatedAssignment?.status).toBe("pending");

    const nextClaim = await service.claimNextReadyAssignment("run-1", "worker-b");
    expect(nextClaim).toBeNull();

    const report = await service.collectRunReport("run-1");
    expect(report.flags).toContain("awaiting-approval-or-dependencies");
  });

  test("approves an operator-gated assignment after dependencies complete", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:10:01.000Z",
      "2026-04-12T00:10:02.000Z",
      "2026-04-12T00:10:03.000Z",
      "2026-04-12T00:10:04.000Z",
      "2026-04-12T00:10:05.000Z",
      "2026-04-12T00:10:06.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-1",
          blueprintId: "blueprint-1",
          goal: "deliver preview",
          nodes: [
            {
              nodeId: "node-1",
              assignmentId: "assignment-1",
              role: "researcher",
              objective: "Inspect the brief",
              inputs: ["snapshot"],
              outputs: ["research brief"],
              deliverable: "prepare outline",
              acceptanceCriteria: ["Goal is explicit."],
              constraints: [],
              dependsOn: [],
              allowedAdapters: [],
              actionClass: "read",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "mock-execution",
            },
            {
              nodeId: "node-2",
              assignmentId: "assignment-2",
              role: "script-planner",
              objective: "Draft the shot plan",
              inputs: ["research brief"],
              outputs: ["shot plan"],
              deliverable: "draft shot plan",
              acceptanceCriteria: ["Plan is deterministic."],
              constraints: [],
              dependsOn: ["assignment-1"],
              allowedAdapters: ["mock-execution"],
              actionClass: "write",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              status: "awaiting_approval",
              selectedAdapter: "mock-execution",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        preview: {
          previewId: "preview-1",
          summary: "preview",
          warnings: [],
          blockedReasons: [],
          requiredApprovals: ["script-planner:assignment-2"],
        },
      }),
    );

    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-b");
    await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "completed",
      recordedAt: "2026-04-12T00:10:04.000Z",
      workerId: "worker-b",
      summary: "Research pass completed.",
    });

    const approvedRun = await service.approveAssignment("run-1", "assignment-2");
    const approvedAssignment = approvedRun.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-2",
    );
    expect(approvedAssignment?.status).toBe("ready");
    expect(approvedAssignment?.blockingReason).toBeUndefined();
    expect(
      approvedAssignment?.notes?.some((note) => note.startsWith("Approved by operator at ")),
    ).toBe(true);
    expect(
      approvedRun.events.some(
        (event) =>
          event.type === "assignment-status-changed" &&
          event.payload?.assignmentId === "assignment-2" &&
          event.payload?.previousStatus === "pending" &&
          event.payload?.nextStatus === "ready",
      ),
    ).toBe(true);

    const nextClaim = await service.claimNextReadyAssignment("run-1", "worker-b");
    expect(nextClaim?.assignment.assignmentId).toBe("assignment-2");
  });

  test("rejects approval for assignments that do not require operator approval", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:10:01.000Z",
      "2026-04-12T00:10:02.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");

    await expect(service.approveAssignment("run-1", "assignment-1")).rejects.toThrow(
      "Assignment assignment-1 does not require operator approval.",
    );
  });

  test("pauses and resumes without losing ready work produced by an in-flight assignment", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:20:01.000Z",
      "2026-04-12T00:20:02.000Z",
      "2026-04-12T00:20:03.000Z",
      "2026-04-12T00:20:04.000Z",
      "2026-04-12T00:20:05.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");

    const claimed = await service.claimNextReadyAssignment("run-1", "worker-c");
    expect(claimed?.assignment.assignmentId).toBe("assignment-1");

    const pausedRun = await service.pauseRun("run-1");
    expect(pausedRun.status).toBe("paused");
    expect(await service.claimNextReadyAssignment("run-1", "worker-c")).toBeNull();

    const afterCompletion = await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "completed",
      recordedAt: "2026-04-12T00:20:04.000Z",
      workerId: "worker-c",
      summary: "Research pass completed while paused.",
    });
    const readyAssignment = afterCompletion.assignments.find(
      (assignment) => assignment.assignmentId === "assignment-2",
    );
    expect(afterCompletion.status).toBe("paused");
    expect(readyAssignment?.status).toBe("ready");

    const resumedRun = await service.resumeRun("run-1");
    expect(resumedRun.status).toBe("running");
    const nextClaim = await service.claimNextReadyAssignment("run-1", "worker-c");
    expect(nextClaim?.assignment.assignmentId).toBe("assignment-2");
  });

  test("aborts the run and marks all non-terminal assignments as aborted", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:30:00.000Z",
      "2026-04-12T00:30:01.000Z",
      "2026-04-12T00:30:02.000Z",
      "2026-04-12T00:30:03.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-d");

    const abortedRun = await service.abortRun("run-1");
    expect(abortedRun.status).toBe("aborted");
    expect(abortedRun.completedAt).toBe("2026-04-12T00:30:03.000Z");
    expect(abortedRun.assignments.map((assignment) => assignment.status)).toEqual([
      "aborted",
      "aborted",
    ]);
    expect(await service.claimNextReadyAssignment("run-1", "worker-d")).toBeNull();
  });

  test("retries a failed assignment and reopens dependent blocked work", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:40:01.000Z",
      "2026-04-12T00:40:02.000Z",
      "2026-04-12T00:40:03.000Z",
      "2026-04-12T00:40:04.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");
    await service.claimNextReadyAssignment("run-1", "worker-e");

    const failedRun = await service.completeAssignment("run-1", "assignment-1", {
      runId: "run-1",
      assignmentId: "assignment-1",
      status: "failed",
      recordedAt: "2026-04-12T00:40:03.000Z",
      workerId: "worker-e",
      summary: "Research pass failed.",
    });
    expect(failedRun.status).toBe("failed");
    expect(
      failedRun.assignments.find((assignment) => assignment.assignmentId === "assignment-2")
        ?.status,
    ).toBe("blocked");

    const retriedRun = await service.retryAssignment("run-1", "assignment-1");
    expect(retriedRun.status).toBe("running");
    expect(
      retriedRun.assignments.find((assignment) => assignment.assignmentId === "assignment-1")
        ?.status,
    ).toBe("ready");
    expect(
      retriedRun.assignments.find((assignment) => assignment.assignmentId === "assignment-2")
        ?.status,
    ).toBe("pending");
  });

  test("pauses a running run when execution pause safety policy is active", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:50:01.000Z",
      "2026-04-12T00:50:02.000Z",
      "2026-04-12T00:50:03.000Z",
      "2026-04-12T00:50:04.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");

    const pausedRun = await service.applySafetyPolicy("run-1", { pauseAll: true });
    expect(pausedRun.status).toBe("paused");
    expect(await service.claimNextReadyAssignment("run-1", "worker-f")).toBeNull();
    expect(
      pausedRun.events.some(
        (event) =>
          event.type === "run-status-changed" &&
          event.message.includes("paused by execution safety policy"),
      ),
    ).toBe(true);

    const report = await service.collectRunReport("run-1");
    expect(report.flags).toContain("run-paused");
  });

  test("skips disabled roles and blocks their dependents under safety policy", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T00:55:01.000Z",
      "2026-04-12T00:55:02.000Z",
      "2026-04-12T00:55:03.000Z",
      "2026-04-12T00:55:04.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");

    const gatedRun = await service.applySafetyPolicy("run-1", {
      disabledRoles: ["researcher"],
    });
    expect(gatedRun.status).toBe("failed");
    expect(gatedRun.assignments.map((assignment) => assignment.status)).toEqual([
      "skipped",
      "blocked",
    ]);
    expect(gatedRun.assignments[0]?.notes?.join(" ")).toContain("Role researcher");
    expect(
      gatedRun.events.some(
        (event) =>
          event.type === "assignment-status-changed" &&
          event.message.includes("role researcher is disabled"),
      ),
    ).toBe(true);

    const report = await service.collectRunReport("run-1");
    expect(report.flags).toContain("has-skipped-assignments");
    expect(report.flags).toContain("has-blocked-assignments");
  });

  test("blocks assignments when their adapters are disabled by safety policy", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T01:00:01.000Z",
      "2026-04-12T01:00:02.000Z",
      "2026-04-12T01:00:03.000Z",
      "2026-04-12T01:00:04.000Z",
    ]);
    await service.createRunFromBlueprint(createBlueprintFixture());
    await service.startRun("run-1");

    const gatedRun = await service.applySafetyPolicy("run-1", {
      disabledAdapters: ["mock-execution"],
    });
    expect(gatedRun.status).toBe("failed");
    expect(gatedRun.assignments.map((assignment) => assignment.status)).toEqual([
      "blocked",
      "blocked",
    ]);
    expect(gatedRun.assignments[0]?.blockingReason).toContain("mock-execution");

    const report = await service.collectRunReport("run-1");
    expect(report.flags).toContain("has-blocked-assignments");
  });

  test("times out running assignments and records an audit event", async () => {
    const service = createService(workspaceRoot, [
      "2026-04-12T01:10:01.000Z",
      "2026-04-12T01:10:02.000Z",
      "2026-04-12T01:10:03.000Z",
      "2026-04-12T01:10:04.000Z",
      "2026-04-12T01:10:05.000Z",
    ]);
    await service.createRunFromBlueprint(
      createBlueprintFixture({
        actionGraph: {
          graphId: "graph-1",
          blueprintId: "blueprint-1",
          goal: "deliver preview",
          nodes: [
            {
              nodeId: "node-1",
              assignmentId: "assignment-1",
              role: "researcher",
              objective: "Inspect the brief",
              inputs: ["snapshot"],
              outputs: ["research brief"],
              deliverable: "prepare outline",
              acceptanceCriteria: ["Goal is explicit."],
              constraints: [],
              dependsOn: [],
              allowedAdapters: [],
              actionClass: "read",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "mock-execution",
              timeoutMs: 1000,
            },
            {
              nodeId: "node-2",
              assignmentId: "assignment-2",
              role: "script-planner",
              objective: "Draft the shot plan",
              inputs: ["research brief"],
              outputs: ["shot plan"],
              deliverable: "draft shot plan",
              acceptanceCriteria: ["Plan is deterministic."],
              constraints: [],
              dependsOn: ["assignment-1"],
              allowedAdapters: ["mock-execution"],
              actionClass: "write",
              approvalMode: "auto_allow",
              escalationToDirector: false,
              status: "ready",
              selectedAdapter: "mock-execution",
            },
          ],
          edges: [],
          stopConditions: [],
        },
      }),
    );
    await service.startRun("run-1");
    const claimed = await service.claimNextReadyAssignment("run-1", "worker-timeout");
    expect(claimed?.assignment.assignmentId).toBe("assignment-1");

    const timedOutRun = await service.applySafetyPolicy("run-1");
    expect(timedOutRun.status).toBe("failed");
    expect(timedOutRun.assignments.map((assignment) => assignment.status)).toEqual([
      "failed",
      "blocked",
    ]);
    expect(timedOutRun.assignments[0]?.result?.summary).toContain("timed out after 1000ms");
    expect(
      timedOutRun.events.some(
        (event) =>
          event.type === "assignment-status-changed" &&
          event.payload?.assignmentId === "assignment-1" &&
          event.payload?.timeoutMs === 1000,
      ),
    ).toBe(true);

    const report = await service.collectRunReport("run-1");
    expect(report.flags).toContain("has-failures");
    expect(report.flags).toContain("has-blocked-assignments");
  });
});

function createService(workspaceRoot: string, timestamps: string[]) {
  let eventCounter = 0;
  const store = new FileSystemRunStore({ rootPath: workspaceRoot });
  return new ExecutionRunService({
    store,
    builder: new ExecutionRunBuilder({
      idProvider: () => "run-1",
      clock: () => "2026-04-12T00:00:00.000Z",
    }),
    eventIdProvider: () => `event-${++eventCounter}`,
    clock: () => timestamps.shift() ?? "2026-04-12T00:59:59.000Z",
  });
}

function createBlueprintFixture(
  overrides: Partial<DirectorBlueprintResponse> = {},
): DirectorBlueprintResponse {
  return {
    apiVersion: "director-host-api.v1",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-1",
    review: {
      overallDecision: "pass",
      blockingReasons: [],
      requiredFixes: [],
    },
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-1",
      runtimeId: "runtime-1",
      capturedAt: "2026-04-12T00:00:00.000Z",
      status: "ready",
      adapters: [],
      notes: [],
    },
    actionGraph: {
      graphId: "graph-1",
      blueprintId: "blueprint-1",
      goal: "deliver preview",
      nodes: [
        {
          nodeId: "node-1",
          assignmentId: "assignment-1",
          role: "researcher",
          objective: "Inspect the brief",
          inputs: ["snapshot"],
          outputs: ["research brief"],
          deliverable: "prepare outline",
          acceptanceCriteria: ["Goal is explicit."],
          constraints: [],
          dependsOn: [],
          allowedAdapters: [],
          actionClass: "read",
          approvalMode: "auto_allow",
          escalationToDirector: false,
          status: "ready",
          selectedAdapter: "mock-execution",
        },
        {
          nodeId: "node-2",
          assignmentId: "assignment-2",
          role: "script-planner",
          objective: "Draft the shot plan",
          inputs: ["research brief"],
          outputs: ["shot plan"],
          deliverable: "draft shot plan",
          acceptanceCriteria: ["Plan is deterministic."],
          constraints: [],
          dependsOn: ["assignment-1"],
          allowedAdapters: ["mock-execution"],
          actionClass: "write",
          approvalMode: "auto_allow",
          escalationToDirector: false,
          status: "ready",
          selectedAdapter: "mock-execution",
        },
      ],
      edges: [],
      stopConditions: [],
    },
    preview: {
      previewId: "preview-1",
      summary: "preview",
      warnings: [],
      blockedReasons: [],
      requiredApprovals: [],
    },
    handoff: {
      handoffId: "handoff-1",
      blueprintId: "blueprint-1",
      createdAt: "2026-04-12T00:00:00.000Z",
      alignmentLockId: "lock-1",
      actionGraphId: "graph-1",
      previewSummary: "preview",
      capabilityMatches: [],
      mediaRequests: [],
      expectedArtifacts: [],
      chosenAdapters: ["mock-execution"],
      sideEffectsAllowed: false,
      notes: ["preview-only"],
    },
    ...overrides,
  };
}
