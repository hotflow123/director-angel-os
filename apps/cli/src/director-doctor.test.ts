import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import { updateDirectorApiProviderSetting } from "@hotflow/director-runtime";
import { afterEach, describe, expect, test } from "vitest";

import { bootstrapDirectorWorkspace } from "./director-bootstrap.js";
import {
  parseDirectorDoctorArgs,
  renderDirectorDoctorReport,
  runDirectorDoctor,
} from "./director-doctor.js";

function createRuntimeSnapshotResponse() {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    runtimeId: "director-host-api",
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-beta9",
      runtimeId: "director-host-api",
      capturedAt: "2026-04-13T12:00:00.000Z",
      status: "ready",
      adapters: [
        {
          adapterId: "seedance-preview",
          adapterKind: "media",
          provider: "seedance",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: false,
          bridge: {
            kind: "http-json",
            endpointOrigin: "https://bridge.example.test",
            endpointPath: "/v1/jobs",
            authMode: "env",
            timeoutMs: 1500,
            headerKeys: ["x-bridge-id"],
          },
          supportedActionClasses: ["generate"],
        },
      ],
      notes: ["single-vertical-ready"],
    },
  } as const;
}

function createRuntimeSnapshotResponseWithoutBridge() {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    runtimeId: "director-host-api",
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-no-bridge",
      runtimeId: "director-host-api",
      capturedAt: "2026-04-13T12:00:00.000Z",
      status: "ready",
      adapters: [
        {
          adapterId: "scripted",
          adapterKind: "media",
          provider: "scripted",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: true,
          supportedActionClasses: ["generate"],
        },
      ],
      notes: ["preview-safe-default"],
    },
  } as const;
}

function createHealthyAssignment(overrides: Record<string, unknown> = {}) {
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

function createExecutionRunArtifact(overrides: Record<string, unknown> = {}) {
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
    assignments: [createHealthyAssignment()],
    events: [],
    notes: ["external-bridge-succeeded"],
    ...overrides,
  };
}

function createExecutionReportArtifact(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "director.execution.run.v1",
    reportId: "report-run-1",
    runId: "run-1",
    run: createExecutionRunArtifact(),
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

describe("director doctor", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses host/json options", () => {
    expect(parseDirectorDoctorArgs(["--json", "--host", "http://127.0.0.1:9000"])).toEqual({
      ok: true,
      value: {
        format: "json",
        help: false,
        hostUrl: "http://127.0.0.1:9000",
      },
    });
  });

  test("reports pass when runtime, bridge, memory, and operator lanes are healthy", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-doctor-pass-"));
    tempRoots.push(workspaceRoot);
    bootstrapDirectorWorkspace(workspaceRoot);

    const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
    const executionRunDir = join(runtimeDir, "execution", "runs", "run-1");
    mkdirSync(join(runtimeDir, "memory", "ingest"), { recursive: true });
    mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
    mkdirSync(executionRunDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "switches.json"),
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "execution.sideEffects.enabled": true,
          "memory.enabled": true,
          "knowledgeRecall.enabled": true,
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(runtimeDir, "observations.ndjson"),
      JSON.stringify({ observationId: "observation-1", source: "evaluation" }),
      "utf8",
    );
    writeFileSync(
      join(runtimeDir, "memory", "index.json"),
      JSON.stringify({
        schemaVersion: "director.memory.index.v1",
        updatedAt: "2026-04-13T12:10:00.000Z",
        entries: [
          {
            recordId: "record-1",
            digestId: "digest-1",
            projectId: "project-1",
            groupId: "group-1",
            anchorIds: ["anchor-a"],
            selectedAdapters: ["seedance-preview"],
            tags: ["continuity"],
            status: "completed",
            recordedAt: "2026-04-13T12:09:00.000Z",
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(
      join(runtimeDir, "memory", "ingest", "run-1.json"),
      JSON.stringify({
        schemaVersion: "director.memory.ingest.audit.v1",
        runId: "run-1",
        reportId: "report-run-1",
        status: "ok",
        recordedAt: "2026-04-13T12:11:00.000Z",
        observationIds: ["observation-1"],
        notes: ["Stored Director memory record record-1."],
        recordId: "record-1",
        digestId: "digest-1",
      }),
      "utf8",
    );
    writeFileSync(
      join(runtimeDir, "proposals", "index.json"),
      JSON.stringify({
        schemaVersion: "director.proposal.index.v1",
        updatedAt: "2026-04-13T12:12:00.000Z",
        entries: [{ proposalId: "proposal-1" }],
      }),
      "utf8",
    );
    writeFileSync(
      join(executionRunDir, "run.json"),
      JSON.stringify(createExecutionRunArtifact()),
      "utf8",
    );
    writeFileSync(
      join(executionRunDir, "report.json"),
      JSON.stringify(createExecutionReportArtifact()),
      "utf8",
    );

    const report = await runDirectorDoctor(workspaceRoot, {
      fetchRuntimeSnapshot: async () => createRuntimeSnapshotResponse(),
      now: () => "2026-04-13T12:20:00.000Z",
    });

    expect(report.status).toBe("pass");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    const output = renderDirectorDoctorReport(report);
    expect(output).toContain("Director Doctor");
    expect(output).toContain("Status: PASS");
    expect(output).toContain("[PASS] bridge");
    expect(output).toContain("[PASS] chain-route-health");
    expect(output).toContain("real-eligible media adapters: seedance-preview");
    expect(output).toContain("verdict=healthy");
    expect(output).toContain("Bridge request was accepted on seedance-preview.");
  });

  test("reports warn when the latest chain is recoverable but degraded", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-doctor-warn-"));
    tempRoots.push(workspaceRoot);
    bootstrapDirectorWorkspace(workspaceRoot);

    const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
    const executionRunDir = join(runtimeDir, "execution", "runs", "run-warn-1");
    mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
    mkdirSync(executionRunDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "switches.json"),
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "execution.sideEffects.enabled": true,
          "memory.enabled": false,
          "knowledgeRecall.enabled": true,
        },
      }),
      "utf8",
    );

    const warnRun = createExecutionRunArtifact({
      runId: "run-warn-1",
      updatedAt: "2026-04-13T12:40:00.000Z",
      status: "failed",
      assignments: [
        createHealthyAssignment({
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
        createHealthyAssignment({
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
        createExecutionReportArtifact({
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
            nextAction:
              "reroute the failed assignment to the approved alternate adapter and retry.",
          },
        }),
      ),
      "utf8",
    );

    const report = await runDirectorDoctor(workspaceRoot, {
      fetchRuntimeSnapshot: async () => createRuntimeSnapshotResponse(),
      now: () => "2026-04-13T12:45:00.000Z",
    });

    expect(report.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "chain-route-health")?.status).toBe("warn");
    const output = renderDirectorDoctorReport(report);
    expect(output).toContain("[WARN] chain-route-health");
    expect(output).toContain("verdict=degraded");
    expect(output).toContain("verdict=reroutable");
    expect(output).toContain(
      "reroute assignment-failed-1 to runway-preview and retry on the new route.",
    );
  });

  test("reports warn, not fail, when configured media API providers lack a registered bridge", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-doctor-api-provider-warn-"));
    tempRoots.push(workspaceRoot);
    bootstrapDirectorWorkspace(workspaceRoot);

    await updateDirectorApiProviderSetting(join(workspaceRoot, ".director-angel", "providers"), {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-key-one",
      now: "2026-04-13T12:00:00.000Z",
    });

    const report = await runDirectorDoctor(workspaceRoot, {
      fetchRuntimeSnapshot: async () => createRuntimeSnapshotResponseWithoutBridge(),
      now: () => "2026-04-13T12:45:00.000Z",
    });

    const bridgeCheck = report.checks.find((check) => check.id === "bridge");
    expect(bridgeCheck?.status).toBe("warn");
    expect(bridgeCheck?.summary).toContain("API media provider");

    const output = renderDirectorDoctorReport(report);
    expect(output).toContain("[WARN] bridge");
    expect(output).toContain("configured API media providers: memefast-api");
    expect(output).toContain("next action: register a real execution bridge manifest");
  });

  test("reports fail when the latest chain is blocked or exhausted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-doctor-route-fail-"));
    tempRoots.push(workspaceRoot);
    bootstrapDirectorWorkspace(workspaceRoot);

    const runtimeDir = join(workspaceRoot, ".director-angel", "runtime");
    const executionRunDir = join(runtimeDir, "execution", "runs", "run-route-fail-1");
    mkdirSync(join(runtimeDir, "proposals"), { recursive: true });
    mkdirSync(executionRunDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "switches.json"),
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "execution.sideEffects.enabled": true,
          "memory.enabled": false,
          "knowledgeRecall.enabled": true,
        },
      }),
      "utf8",
    );

    const failRun = createExecutionRunArtifact({
      runId: "run-route-fail-1",
      updatedAt: "2026-04-13T13:00:00.000Z",
      status: "failed",
      assignments: [
        createHealthyAssignment({
          runId: "run-route-fail-1",
          assignmentId: "assignment-exhausted-1",
          status: "failed",
          selectedAdapter: "seedance-preview",
          allowedAdapters: ["seedance-preview"],
          createdAt: "2026-04-13T12:50:00.000Z",
          completedAt: undefined,
          notes: [
            "external-bridge",
            "bridge:http-json",
            "Retry requested at 2026-04-13T12:55:00.000Z.",
          ],
          result: {
            runId: "run-route-fail-1",
            assignmentId: "assignment-exhausted-1",
            status: "failed",
            recordedAt: "2026-04-13T12:56:00.000Z",
            workerId: "worker-exhausted-1",
            summary: "Bridge request failed and no fallback route remains.",
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
                reason: "invalid_response",
                retryable: false,
                message: "Bridge returned malformed payload",
              },
            },
          },
        }),
        createHealthyAssignment({
          runId: "run-route-fail-1",
          assignmentId: "assignment-blocked-1",
          status: "blocked",
          selectedAdapter: "runway-preview",
          allowedAdapters: ["runway-preview"],
          createdAt: "2026-04-13T12:51:00.000Z",
          completedAt: undefined,
          notes: ["external-bridge", "bridge:http-json"],
          blockingReason: "adapter disabled by operator switch",
          result: undefined,
        }),
      ],
    });

    writeFileSync(join(executionRunDir, "run.json"), JSON.stringify(failRun), "utf8");
    writeFileSync(
      join(executionRunDir, "report.json"),
      JSON.stringify(
        createExecutionReportArtifact({
          reportId: "report-route-fail-1",
          runId: "run-route-fail-1",
          run: failRun,
          recordedAt: "2026-04-13T13:01:00.000Z",
          summary: ["run status=failed", "route blocked"],
          flags: ["external-bridge-failed", "route-blocked"],
          operatorSurface: {
            directorGoal: "Generate a single-shot lighthouse reveal video.",
            operatorSummary:
              "One assignment is exhausted and another is blocked by the operator switch.",
            adapterRoute: "seedance-preview",
            bridgeVerdict: "failed",
            bridgeFailureReason: "invalid_response",
            retryable: false,
            retryAllowed: false,
            nextAction: "repair the route and re-enable the blocked adapter before trying again.",
          },
        }),
      ),
      "utf8",
    );

    const report = await runDirectorDoctor(workspaceRoot, {
      fetchRuntimeSnapshot: async () => createRuntimeSnapshotResponse(),
      now: () => "2026-04-13T13:05:00.000Z",
    });

    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "chain-route-health")?.status).toBe("fail");
    const output = renderDirectorDoctorReport(report);
    expect(output).toContain("[FAIL] chain-route-health");
    expect(output).toContain("verdict=exhausted");
    expect(output).toContain("verdict=blocked");
    expect(output).toContain("Bridge returned malformed payload");
    expect(output).toContain("blocking reason: adapter disabled by operator switch");
  });

  test("reports fail when runtime snapshot is unavailable", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-doctor-fail-"));
    tempRoots.push(workspaceRoot);
    bootstrapDirectorWorkspace(workspaceRoot);

    const report = await runDirectorDoctor(workspaceRoot, {
      fetchRuntimeSnapshot: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8787");
      },
      now: () => "2026-04-13T12:30:00.000Z",
    });

    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "runtime")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "bridge")?.status).toBe("fail");
    expect(renderDirectorDoctorReport(report, "json")).toContain('"status": "fail"');
  });
});
