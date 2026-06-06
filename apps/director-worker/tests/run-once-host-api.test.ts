import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DIRECTOR_HOST_API_VERSION,
  type DirectorBlueprintResponse,
} from "@hotflow/director-host-contracts";
import { FileSystemDirectorAdapterRegistryStore } from "@hotflow/director-runtime";
import { ensureDirectorWorkspace } from "@hotflow/director-workspace";
import { afterEach, describe, expect, test } from "vitest";

import { createDirectorHostApiApp } from "../../director-host-api/src/server.ts";
import { runDirectorWorkerCli } from "../src/main.ts";

describe("director-worker run-once host-api e2e", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("executes script-planner via a real execution adapter from host-api blueprint and run creation", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-host-api-e2e-"));
    tempRoots.push(workspaceRoot);
    ensureDirectorWorkspace({ root: workspaceRoot });

    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: string[] = [];
    const bridgeServer = await startBridgeServer(async (request, response) => {
      received.push(await readRequestBody(request));
      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "req-host-api-e2e-1",
      });
      response.end(JSON.stringify({ accepted: true }));
    });

    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-a",
      baseUrl: bridgeServer.url,
    });

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-host-api-e2e-1",
        createdAt: "2026-04-14T10:00:00.000Z",
        host: {
          hostId: "host-e2e-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-e2e-1",
          title: "Director Worker Host API E2E",
          outline: "为短片制定可执行的分镜与脚本规划。",
        },
        group: {
          groupId: "group-e2e-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-e2e-1"],
        },
        runtime: {
          runtimeId: "runtime-e2e-1",
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
      const intake = {
        intakeId: "intake-host-api-e2e-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["script plan"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-host-api-e2e-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...intake.deliverables],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as DirectorBlueprintResponse;

      const scriptPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "script-planner",
      );
      expect(scriptPlannerNode).toBeDefined();
      if (!scriptPlannerNode) {
        throw new Error("Expected script-planner node in blueprint response.");
      }
      expect(scriptPlannerNode?.selectedAdapter).toBe("script-execution-a");
      expect(scriptPlannerNode?.allowedAdapters).toContain("script-execution-a");
      const runSourceBlueprint: DirectorBlueprintResponse = {
        ...blueprintPayload,
        actionGraph: {
          ...blueprintPayload.actionGraph,
          nodes: [
            {
              ...scriptPlannerNode,
              inputs: ["locked brief", "knowledge://pack/continuity"],
              outputs: ["script outline"],
              acceptanceCriteria: ["Script outline preserves recalled continuity."],
              constraints: [
                ...scriptPlannerNode.constraints,
                {
                  field: "recalledKnowledge",
                  requirement: "Apply continuity pack pack://continuity/v2.",
                  priority: "required",
                  rationale: "Execution bridge must receive recalled knowledge.",
                },
                {
                  field: "skill",
                  requirement: "Use approved skill skill://script-planning.",
                  priority: "preferred",
                },
              ],
              dependsOn: [],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a"],
              actionClass: "generate",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        preview: {
          ...blueprintPayload.preview,
          requiredApprovals: [...blueprintPayload.preview.requiredApprovals],
        },
        handoff: {
          ...blueprintPayload.handoff,
          sideEffectsAllowed: true,
          chosenAdapters: ["script-execution-a"],
        },
      };

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runSourceBlueprint),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as { runId: string };
      expect(runPayload.runId).toBeTruthy();
      await approveRunAssignments({
        host,
        port,
        runId: runPayload.runId,
        assignmentIds: [scriptPlannerNode.assignmentId],
      });

      const workerEnv = {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        SCRIPT_EXECUTION_API_KEY: "host-api-e2e-token",
      };
      for (let attempt = 0; attempt < 6 && received.length === 0; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          ["run-once", "--run-id", runPayload.runId, "--worker-id", "worker-host-api-e2e"],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);
      }

      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0] ?? "{}")).toMatchObject({
        schemaId: "director.execution.http-json-request.v1",
        role: "script-planner",
        adapterId: "script-execution-a",
        inputs: ["locked brief", "knowledge://pack/continuity"],
        outputs: ["script outline"],
        acceptanceCriteria: ["Script outline preserves recalled continuity."],
        constraints: [
          {
            field: "recalledKnowledge",
            requirement: "Apply continuity pack pack://continuity/v2.",
            priority: "required",
            rationale: "Execution bridge must receive recalled knowledge.",
          },
          {
            field: "skill",
            requirement: "Use approved skill skill://script-planning.",
            priority: "preferred",
          },
        ],
      });

      const reportResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/report`,
      );
      expect(reportResponse.ok).toBe(true);
      const reportPayload = (await reportResponse.json()) as {
        flags: string[];
        bridgeMetrics?: {
          attempts: number;
          successes: number;
          failures: number;
        };
      };
      expect(reportPayload.flags).toContain("external-bridge-attempted");
      expect(reportPayload.flags).toContain("external-bridge-succeeded");
      expect(reportPayload.bridgeMetrics).toMatchObject({
        attempts: 1,
        successes: 1,
        failures: 0,
        failedAssignments: [],
      });
    } finally {
      await app.close();
      await bridgeServer.close();
    }
  });

  test("executes script-planner and shot-planner through the same real execution adapter chain", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-host-api-chain-"));
    tempRoots.push(workspaceRoot);
    ensureDirectorWorkspace({ root: workspaceRoot });

    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{
      readonly path: string;
      readonly body: string;
    }> = [];
    const bridgeServer = await startBridgeServer(async (request, response) => {
      received.push({
        path: request.url ?? "/",
        body: await readRequestBody(request),
      });
      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": `req-host-api-chain-${received.length}`,
      });
      response.end(JSON.stringify({ accepted: true }));
    });

    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-a",
      baseUrl: bridgeServer.url,
      supportedRoles: ["script-planner", "shot-planner"],
    });

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-host-api-chain-1",
        createdAt: "2026-04-14T10:20:00.000Z",
        host: {
          hostId: "host-e2e-2",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-e2e-chain-1",
          title: "Director Worker Host API Chain E2E",
          outline: "为短片生成脚本和镜头规划，并把两段都交给真实 execution bridge。",
        },
        group: {
          groupId: "group-e2e-chain-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-e2e-chain-1"],
        },
        runtime: {
          runtimeId: "runtime-e2e-chain-1",
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
      const intake = {
        intakeId: "intake-host-api-chain-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["script plan", "shot plan"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-host-api-chain-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...intake.deliverables],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as DirectorBlueprintResponse;

      const scriptPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "script-planner",
      );
      const shotPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "shot-planner",
      );
      if (!scriptPlannerNode || !shotPlannerNode) {
        throw new Error("Expected script-planner and shot-planner nodes in blueprint response.");
      }
      expect(scriptPlannerNode?.selectedAdapter).toBe("script-execution-a");
      expect(scriptPlannerNode?.allowedAdapters).toContain("script-execution-a");
      expect(shotPlannerNode?.selectedAdapter).toBe("script-execution-a");
      expect(shotPlannerNode?.allowedAdapters).toContain("script-execution-a");
      expect(blueprintPayload.handoff.sideEffectsAllowed).toBe(true);

      const runSourceBlueprint: DirectorBlueprintResponse = {
        ...blueprintPayload,
        actionGraph: {
          ...blueprintPayload.actionGraph,
          nodes: [
            {
              ...scriptPlannerNode,
              dependsOn: [],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a"],
              actionClass: "generate",
            },
            {
              ...shotPlannerNode,
              dependsOn: [scriptPlannerNode.assignmentId],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a", "script-execution-b"],
              actionClass: "generate",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        preview: {
          ...blueprintPayload.preview,
          requiredApprovals: [...blueprintPayload.preview.requiredApprovals],
        },
        handoff: {
          ...blueprintPayload.handoff,
          sideEffectsAllowed: true,
          chosenAdapters: ["script-execution-a", "script-execution-b"],
        },
      };

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runSourceBlueprint),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as { runId: string };
      expect(runPayload.runId).toBeTruthy();
      await approveRunAssignments({
        host,
        port,
        runId: runPayload.runId,
        assignmentIds: [scriptPlannerNode.assignmentId, shotPlannerNode.assignmentId],
      });

      const workerEnv = {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        SCRIPT_EXECUTION_API_KEY: "host-api-chain-token",
      };

      for (let attempt = 0; attempt < 8 && received.length < 2; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          ["run-once", "--run-id", runPayload.runId, "--worker-id", "worker-host-api-chain"],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);
      }

      expect(received).toHaveLength(2);
      expect(received.map((request) => request.path)).toEqual([
        "/v1/script-jobs",
        "/v1/script-jobs",
      ]);
      expect(received.map((request) => JSON.parse(request.body).role)).toEqual([
        "script-planner",
        "shot-planner",
      ]);
      expect(received.map((request) => JSON.parse(request.body).adapterId)).toEqual([
        "script-execution-a",
        "script-execution-a",
      ]);

      const reportResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/report`,
      );
      expect(reportResponse.ok).toBe(true);
      const reportPayload = (await reportResponse.json()) as {
        flags: string[];
        bridgeMetrics?: {
          attempts: number;
          successes: number;
          failures: number;
        };
      };
      expect(reportPayload.flags).toContain("external-bridge-attempted");
      expect(reportPayload.flags).toContain("external-bridge-succeeded");
      expect(reportPayload.bridgeMetrics).toMatchObject({
        attempts: 2,
        successes: 2,
        failures: 0,
        failedAssignments: [],
      });
    } finally {
      await app.close();
      await bridgeServer.close();
    }
  });

  test("surfaces shot-planner bridge failure and retries only the failed dual execution assignment", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-host-api-retry-"));
    tempRoots.push(workspaceRoot);
    ensureDirectorWorkspace({ root: workspaceRoot });

    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{
      readonly path: string;
      readonly body: string;
    }> = [];
    const bridgeServer = await startBridgeServer(async (request, response) => {
      const body = await readRequestBody(request);
      received.push({
        path: request.url ?? "/",
        body,
      });

      if (received.length === 2) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        response.writeHead(202, {
          "content-type": "application/json",
          "x-request-id": "req-host-api-retry-too-late",
        });
        response.end(JSON.stringify({ accepted: true }));
        return;
      }

      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id":
          received.length === 1 ? "req-host-api-retry-script-1" : "req-host-api-retry-shot-1",
      });
      response.end(JSON.stringify({ accepted: true }));
    });

    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-a",
      baseUrl: bridgeServer.url,
      timeoutMs: 50,
      supportedRoles: ["script-planner", "shot-planner"],
    });
    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-b",
      baseUrl: bridgeServer.url,
      timeoutMs: 50,
      supportedRoles: ["shot-planner"],
    });
    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-b",
      baseUrl: bridgeServer.url,
      timeoutMs: 50,
      supportedRoles: ["shot-planner"],
    });

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-host-api-retry-1",
        createdAt: "2026-04-14T10:40:00.000Z",
        host: {
          hostId: "host-e2e-3",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-e2e-retry-1",
          title: "Director Worker Host API Retry E2E",
          outline: "为短片生成脚本与镜头规划，若镜头桥接失败则只重试失败 assignment。",
        },
        group: {
          groupId: "group-e2e-retry-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-e2e-retry-1"],
        },
        runtime: {
          runtimeId: "runtime-e2e-retry-1",
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
      const intake = {
        intakeId: "intake-host-api-retry-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["script plan", "shot plan"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-host-api-retry-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...intake.deliverables],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as DirectorBlueprintResponse;

      const scriptPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "script-planner",
      );
      const shotPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "shot-planner",
      );
      if (!scriptPlannerNode || !shotPlannerNode) {
        throw new Error("Expected script-planner and shot-planner nodes in blueprint response.");
      }

      const runSourceBlueprint: DirectorBlueprintResponse = {
        ...blueprintPayload,
        actionGraph: {
          ...blueprintPayload.actionGraph,
          nodes: [
            {
              ...scriptPlannerNode,
              dependsOn: [],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a"],
              actionClass: "generate",
            },
            {
              ...shotPlannerNode,
              dependsOn: [scriptPlannerNode.assignmentId],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a", "script-execution-b"],
              actionClass: "generate",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        preview: {
          ...blueprintPayload.preview,
          requiredApprovals: [...blueprintPayload.preview.requiredApprovals],
        },
        handoff: {
          ...blueprintPayload.handoff,
          sideEffectsAllowed: true,
          chosenAdapters: ["script-execution-a", "script-execution-b"],
        },
      };

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runSourceBlueprint),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as { runId: string };
      expect(runPayload.runId).toBeTruthy();
      await approveRunAssignments({
        host,
        port,
        runId: runPayload.runId,
        assignmentIds: [scriptPlannerNode.assignmentId, shotPlannerNode.assignmentId],
      });

      const workerEnv = {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        SCRIPT_EXECUTION_API_KEY: "host-api-retry-token",
      };

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          [
            "run-once",
            "--run-id",
            runPayload.runId,
            "--worker-id",
            `worker-host-api-retry-${attempt}`,
          ],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);

        const statusResponse = await fetch(
          `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}`,
        );
        expect(statusResponse.ok).toBe(true);
        const statusPayload = (await statusResponse.json()) as { status: string };
        if (statusPayload.status === "failed") {
          break;
        }
      }

      expect(received).toHaveLength(2);
      expect(received.map((request) => JSON.parse(request.body).role)).toEqual([
        "script-planner",
        "shot-planner",
      ]);

      const failedReportResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/report`,
      );
      expect(failedReportResponse.ok).toBe(true);
      const failedReportPayload = (await failedReportResponse.json()) as {
        run: { status: string };
        flags: string[];
        operatorSurface: {
          objective?: string;
          deliverable?: string;
          bridgeVerdict?: string;
          bridgeFailureReason?: string;
          retryable?: boolean;
          retryAllowed?: boolean;
          bridgeStatus?: number;
        };
        bridgeMetrics?: {
          attempts: number;
          successes: number;
          failures: number;
          failedAssignments: Array<{ assignmentId: string }>;
        };
      };
      expect(failedReportPayload.run.status).toBe("failed");
      expect(failedReportPayload.flags).toContain("external-bridge-failed");
      expect(failedReportPayload.operatorSurface).toMatchObject({
        objective: shotPlannerNode.objective,
        deliverable: shotPlannerNode.deliverable,
        bridgeVerdict: "failed",
        bridgeFailureReason: "network_timeout",
        retryable: true,
        retryAllowed: true,
        bridgeStatus: 504,
      });
      expect(failedReportPayload.bridgeMetrics).toMatchObject({
        attempts: 2,
        successes: 1,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: shotPlannerNode.assignmentId,
          },
        ],
      });

      const retryResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assignmentId: shotPlannerNode.assignmentId,
          }),
        },
      );
      expect(retryResponse.ok).toBe(true);
      const retryPayload = (await retryResponse.json()) as {
        status: string;
        assignments: Array<{ assignmentId: string; status: string }>;
      };
      expect(retryPayload.status).toBe("running");
      expect(
        retryPayload.assignments.find(
          (assignment) => assignment.assignmentId === shotPlannerNode.assignmentId,
        )?.status,
      ).toBe("ready");

      for (let attempt = 0; attempt < 6 && received.length < 3; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          [
            "run-once",
            "--run-id",
            runPayload.runId,
            "--worker-id",
            `worker-host-api-retry-final-${attempt}`,
          ],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);
      }

      expect(received).toHaveLength(3);
      expect(received.map((request) => JSON.parse(request.body).role)).toEqual([
        "script-planner",
        "shot-planner",
        "shot-planner",
      ]);
      expect(received.map((request) => JSON.parse(request.body).assignmentId)).toEqual([
        scriptPlannerNode.assignmentId,
        shotPlannerNode.assignmentId,
        shotPlannerNode.assignmentId,
      ]);

      const finalRunResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}`,
      );
      expect(finalRunResponse.ok).toBe(true);
      const finalRunPayload = (await finalRunResponse.json()) as {
        status: string;
        assignments: Array<{
          role: string;
          result?: {
            bridgeExecution?: {
              response?: {
                requestId?: string;
              };
            };
          };
        }>;
      };
      expect(finalRunPayload.status).toBe("completed");
      expect(
        finalRunPayload.assignments.find((assignment) => assignment.role === "shot-planner")?.result
          ?.bridgeExecution?.response?.requestId,
      ).toBe("req-host-api-retry-shot-1");
    } finally {
      await app.close();
      await bridgeServer.close();
    }
  });

  test("rejects retry for a non-retryable shot-planner bridge failure", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-host-api-nonretryable-"));
    tempRoots.push(workspaceRoot);
    ensureDirectorWorkspace({ root: workspaceRoot });

    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{
      readonly path: string;
      readonly body: string;
    }> = [];
    const bridgeServer = await startBridgeServer(async (request, response) => {
      const body = await readRequestBody(request);
      received.push({
        path: request.url ?? "/",
        body,
      });

      if (received.length === 2) {
        response.writeHead(422, {
          "content-type": "application/json",
          "x-request-id": "req-host-api-http-422",
        });
        response.end(JSON.stringify({ accepted: false, error: "payload rejected" }));
        return;
      }

      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "req-host-api-nonretryable-script-1",
      });
      response.end(JSON.stringify({ accepted: true }));
    });

    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-a",
      baseUrl: bridgeServer.url,
      timeoutMs: 50,
      supportedRoles: ["script-planner", "shot-planner"],
    });
    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-b",
      baseUrl: bridgeServer.url,
      timeoutMs: 50,
      supportedRoles: ["shot-planner"],
    });

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-host-api-nonretryable-1",
        createdAt: "2026-04-14T10:50:00.000Z",
        host: {
          hostId: "host-e2e-4",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-e2e-nonretryable-1",
          title: "Director Worker Host API Non-Retryable E2E",
          outline: "为短片生成脚本与镜头规划，若镜头桥接返回 422，则拒绝 retry。",
        },
        group: {
          groupId: "group-e2e-nonretryable-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-e2e-nonretryable-1"],
        },
        runtime: {
          runtimeId: "runtime-e2e-nonretryable-1",
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
      const intake = {
        intakeId: "intake-host-api-nonretryable-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["script plan", "shot plan"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-host-api-nonretryable-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...intake.deliverables],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as DirectorBlueprintResponse;

      const scriptPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "script-planner",
      );
      const shotPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "shot-planner",
      );
      if (!scriptPlannerNode || !shotPlannerNode) {
        throw new Error("Expected script-planner and shot-planner nodes in blueprint response.");
      }

      const runSourceBlueprint: DirectorBlueprintResponse = {
        ...blueprintPayload,
        actionGraph: {
          ...blueprintPayload.actionGraph,
          nodes: [
            {
              ...scriptPlannerNode,
              dependsOn: [],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a"],
              actionClass: "generate",
            },
            {
              ...shotPlannerNode,
              dependsOn: [scriptPlannerNode.assignmentId],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a", "script-execution-b"],
              actionClass: "generate",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        preview: {
          ...blueprintPayload.preview,
          requiredApprovals: [...blueprintPayload.preview.requiredApprovals],
        },
        handoff: {
          ...blueprintPayload.handoff,
          sideEffectsAllowed: true,
          chosenAdapters: ["script-execution-a", "script-execution-b"],
        },
      };

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runSourceBlueprint),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as { runId: string };
      expect(runPayload.runId).toBeTruthy();
      await approveRunAssignments({
        host,
        port,
        runId: runPayload.runId,
        assignmentIds: [scriptPlannerNode.assignmentId, shotPlannerNode.assignmentId],
      });

      const workerEnv = {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        SCRIPT_EXECUTION_API_KEY: "host-api-nonretryable-token",
      };

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          [
            "run-once",
            "--run-id",
            runPayload.runId,
            "--worker-id",
            `worker-host-api-nonretryable-${attempt}`,
          ],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);

        const statusResponse = await fetch(
          `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}`,
        );
        expect(statusResponse.ok).toBe(true);
        const statusPayload = (await statusResponse.json()) as { status: string };
        if (statusPayload.status === "failed") {
          break;
        }
      }

      expect(received).toHaveLength(2);
      expect(received.map((request) => JSON.parse(request.body).role)).toEqual([
        "script-planner",
        "shot-planner",
      ]);

      const failedReportResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/report`,
      );
      expect(failedReportResponse.ok).toBe(true);
      const failedReportPayload = (await failedReportResponse.json()) as {
        run: { status: string };
        flags: string[];
        operatorSurface: {
          objective?: string;
          deliverable?: string;
          bridgeVerdict?: string;
          bridgeFailureReason?: string;
          retryable?: boolean;
          retryAllowed?: boolean;
          bridgeStatus?: number;
          nextAction?: string;
        };
      };
      expect(failedReportPayload.run.status).toBe("failed");
      expect(failedReportPayload.flags).toContain("external-bridge-failed");
      expect(failedReportPayload.operatorSurface).toMatchObject({
        objective: shotPlannerNode.objective,
        deliverable: shotPlannerNode.deliverable,
        bridgeVerdict: "failed",
        bridgeFailureReason: "http_error",
        retryable: false,
        retryAllowed: false,
        bridgeStatus: 422,
        nextAction:
          "inspect the remote bridge request and payload before re-running the assignment.",
      });

      const retryResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assignmentId: shotPlannerNode.assignmentId,
          }),
        },
      );
      expect(retryResponse.status).toBe(409);
      const retryPayload = (await retryResponse.json()) as {
        code: string;
        message: string;
      };
      expect(retryPayload.code).toBe("RUN_STATE_CONFLICT");
      expect(retryPayload.message).toContain("non-retryable http_error status 422");
      expect(received).toHaveLength(2);
    } finally {
      await app.close();
      await bridgeServer.close();
    }
  });

  test("rejects a second retry after the retry budget is exhausted for a retryable shot-planner bridge failure", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-host-api-retry-budget-"));
    tempRoots.push(workspaceRoot);
    ensureDirectorWorkspace({ root: workspaceRoot });

    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{
      readonly path: string;
      readonly body: string;
    }> = [];
    const bridgeServer = await startBridgeServer(async (request, response) => {
      const body = await readRequestBody(request);
      received.push({
        path: request.url ?? "/",
        body,
      });

      if (received.length === 1) {
        response.writeHead(202, {
          "content-type": "application/json",
          "x-request-id": "req-host-api-retry-budget-script-1",
        });
        response.end(JSON.stringify({ accepted: true }));
        return;
      }

      response.writeHead(502, {
        "content-type": "application/json",
        "x-request-id":
          received.length === 2
            ? "req-host-api-retry-budget-shot-1"
            : "req-host-api-retry-budget-shot-2",
      });
      response.end(JSON.stringify({ accepted: false, error: "upstream unavailable" }));
    });

    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-a",
      baseUrl: bridgeServer.url,
      timeoutMs: 50,
      supportedRoles: ["script-planner", "shot-planner"],
    });
    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-b",
      baseUrl: bridgeServer.url,
      timeoutMs: 50,
      supportedRoles: ["shot-planner"],
    });

    const app = createDirectorHostApiApp({
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
      },
    });
    const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });

    try {
      const snapshot = {
        apiVersion: DIRECTOR_HOST_API_VERSION,
        schemaId: "director.host.snapshot.v1",
        snapshotId: "snapshot-host-api-retry-budget-1",
        createdAt: "2026-04-14T11:10:00.000Z",
        host: {
          hostId: "host-e2e-retry-budget-1",
          triggerSource: "cli",
        },
        project: {
          projectId: "project-e2e-retry-budget-1",
          title: "Director Worker Host API Retry Budget E2E",
          outline: "为短片生成脚本与镜头规划，镜头桥接若连续两次 502，则第二次 retry 应被拒绝。",
        },
        group: {
          groupId: "group-e2e-retry-budget-1",
          generationStyle: "immersive",
          generationType: "new",
          sceneCount: 1,
          anchorIds: ["anchor-e2e-retry-budget-1"],
        },
        runtime: {
          runtimeId: "runtime-e2e-retry-budget-1",
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
      const intake = {
        intakeId: "intake-host-api-retry-budget-1",
        submittedAt: snapshot.createdAt,
        objective: snapshot.project.outline,
        desiredOutcome: snapshot.project.outline,
        deliverables: ["script plan", "shot plan"],
      };

      const blueprintResponse = await fetch(`http://${host}:${port}/v1/blueprint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiVersion: DIRECTOR_HOST_API_VERSION,
          snapshot,
          intake,
          alignmentLock: {
            lockId: "alignment-lock-host-api-retry-budget-1",
            sourceIntakeId: intake.intakeId,
            state: "locked",
            lockedAt: snapshot.createdAt,
            objective: intake.objective,
            desiredOutcome: intake.desiredOutcome,
            deliverables: [...intake.deliverables],
            lockedConstraints: [],
            lockedFields: [],
          },
        }),
      });
      expect(blueprintResponse.ok).toBe(true);
      const blueprintPayload = (await blueprintResponse.json()) as DirectorBlueprintResponse;

      const scriptPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "script-planner",
      );
      const shotPlannerNode = blueprintPayload.actionGraph.nodes.find(
        (node) => node.role === "shot-planner",
      );
      if (!scriptPlannerNode || !shotPlannerNode) {
        throw new Error("Expected script-planner and shot-planner nodes in blueprint response.");
      }

      const runSourceBlueprint: DirectorBlueprintResponse = {
        ...blueprintPayload,
        actionGraph: {
          ...blueprintPayload.actionGraph,
          nodes: [
            {
              ...scriptPlannerNode,
              dependsOn: [],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a"],
              actionClass: "generate",
            },
            {
              ...shotPlannerNode,
              dependsOn: [scriptPlannerNode.assignmentId],
              status: "awaiting_approval",
              approvalMode: "operator_approve",
              escalationToDirector: false,
              selectedAdapter: "script-execution-a",
              allowedAdapters: ["script-execution-a", "script-execution-b"],
              actionClass: "generate",
            },
          ],
          edges: [],
          stopConditions: [],
        },
        preview: {
          ...blueprintPayload.preview,
          requiredApprovals: [...blueprintPayload.preview.requiredApprovals],
        },
        handoff: {
          ...blueprintPayload.handoff,
          sideEffectsAllowed: true,
          chosenAdapters: ["script-execution-a", "script-execution-b"],
        },
      };

      const createRunResponse = await fetch(`http://${host}:${port}/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runSourceBlueprint),
      });
      expect(createRunResponse.status).toBe(201);
      const runPayload = (await createRunResponse.json()) as { runId: string };
      expect(runPayload.runId).toBeTruthy();
      await approveRunAssignments({
        host,
        port,
        runId: runPayload.runId,
        assignmentIds: [scriptPlannerNode.assignmentId, shotPlannerNode.assignmentId],
      });

      const workerEnv = {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        SCRIPT_EXECUTION_API_KEY: "host-api-retry-budget-token",
      };

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          [
            "run-once",
            "--run-id",
            runPayload.runId,
            "--worker-id",
            `worker-host-api-retry-budget-a-${attempt}`,
          ],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);

        const statusResponse = await fetch(
          `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}`,
        );
        expect(statusResponse.ok).toBe(true);
        const statusPayload = (await statusResponse.json()) as { status: string };
        if (statusPayload.status === "failed") {
          break;
        }
      }

      expect(received).toHaveLength(2);

      const firstRetryResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assignmentId: shotPlannerNode.assignmentId,
          }),
        },
      );
      expect(firstRetryResponse.ok).toBe(true);

      for (let attempt = 0; attempt < 6 && received.length < 3; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          [
            "run-once",
            "--run-id",
            runPayload.runId,
            "--worker-id",
            `worker-host-api-retry-budget-b-${attempt}`,
          ],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);

        const statusResponse = await fetch(
          `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}`,
        );
        expect(statusResponse.ok).toBe(true);
        const statusPayload = (await statusResponse.json()) as { status: string };
        if (statusPayload.status === "failed" && received.length >= 3) {
          break;
        }
      }

      expect(received).toHaveLength(3);
      expect(received.map((request) => JSON.parse(request.body).role)).toEqual([
        "script-planner",
        "shot-planner",
        "shot-planner",
      ]);

      const exhaustedReportResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/report`,
      );
      expect(exhaustedReportResponse.ok).toBe(true);
      const exhaustedReportPayload = (await exhaustedReportResponse.json()) as {
        run: { status: string };
        operatorSurface: {
          bridgeVerdict?: string;
          bridgeFailureReason?: string;
          retryable?: boolean;
          retryAllowed?: boolean;
          rerouteCandidates?: string[];
          bridgeStatus?: number;
          nextAction?: string;
        };
      };
      expect(exhaustedReportPayload.run.status).toBe("failed");
      expect(exhaustedReportPayload.operatorSurface).toMatchObject({
        bridgeVerdict: "failed",
        bridgeFailureReason: "http_error",
        retryable: true,
        retryAllowed: false,
        bridgeStatus: 502,
        nextAction:
          "retry budget is exhausted; repair the route, reroute the adapter, or choose a failover path before re-running the assignment.",
      });

      const secondRetryResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assignmentId: shotPlannerNode.assignmentId,
          }),
        },
      );
      expect(secondRetryResponse.status).toBe(409);
      const secondRetryPayload = (await secondRetryResponse.json()) as {
        code: string;
        message: string;
      };
      expect(secondRetryPayload.code).toBe("RUN_STATE_CONFLICT");
      expect(secondRetryPayload.message).toContain("exhausted the retry budget (1/1)");

      const rerouteResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/reroute`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assignmentId: shotPlannerNode.assignmentId,
            adapterId: "script-execution-b",
          }),
        },
      );
      expect(rerouteResponse.ok).toBe(true);

      const retryAfterRerouteResponse = await fetch(
        `http://${host}:${port}/v1/runs/${encodeURIComponent(runPayload.runId)}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assignmentId: shotPlannerNode.assignmentId,
          }),
        },
      );
      expect(retryAfterRerouteResponse.ok).toBe(true);

      for (let attempt = 0; attempt < 6 && received.length < 4; attempt += 1) {
        const exitCode = await runDirectorWorkerCli(
          [
            "run-once",
            "--run-id",
            runPayload.runId,
            "--worker-id",
            `worker-host-api-reroute-final-${attempt}`,
          ],
          {
            env: workerEnv,
          },
        );
        expect(exitCode).toBe(0);
      }

      expect(received).toHaveLength(4);
      expect(received.map((request) => JSON.parse(request.body).adapterId)).toEqual([
        "script-execution-a",
        "script-execution-a",
        "script-execution-a",
        "script-execution-b",
      ]);
    } finally {
      await app.close();
      await bridgeServer.close();
    }
  });
});

function writeSwitchDocument(
  workspaceRoot: string,
  overrides: {
    readonly features?: Record<string, boolean>;
    readonly roleOverrides?: Record<string, boolean>;
    readonly adapterOverrides?: Record<string, boolean>;
  },
): void {
  writeFileSync(
    join(workspaceRoot, ".director-angel", "runtime", "switches.json"),
    JSON.stringify({
      schemaId: "director.switches.v1",
      ...overrides,
    }),
    "utf8",
  );
}

async function approveRunAssignments(input: {
  readonly host: string;
  readonly port: number;
  readonly runId: string;
  readonly assignmentIds: readonly string[];
}): Promise<void> {
  for (const assignmentId of input.assignmentIds) {
    const response = await fetch(
      `http://${input.host}:${input.port}/v1/runs/${encodeURIComponent(input.runId)}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      },
    );
    const responseBody = await response.text();
    expect(
      response.ok,
      `Expected approval of ${assignmentId} to succeed, got ${response.status}: ${responseBody}`,
    ).toBe(true);
  }
}

async function registerExecutionBridgeAdapterFixture(
  workspaceRoot: string,
  overrides: {
    readonly adapterId: string;
    readonly baseUrl: string;
    readonly submitPath?: string;
    readonly timeoutMs?: number;
    readonly supportedRoles?: readonly ("script-planner" | "shot-planner")[];
  },
): Promise<void> {
  const store = new FileSystemDirectorAdapterRegistryStore({
    rootPath: join(workspaceRoot, ".director-angel", "adapters", "registry"),
    clock: () => "2026-04-14T10:00:00.000Z",
  });

  await store.upsertManifest({
    adapterId: overrides.adapterId,
    adapterKind: "execution",
    provider: "script-executor",
    enabled: true,
    healthStatus: "ready",
    dryRunSupported: true,
    mockOnly: false,
    riskLevel: "high",
    approvalMode: "operator_approve",
    permissionScopes: ["execution.generate"],
    dataRetentionPolicy: "test-bridge-retains-none",
    rateLimitPolicy: "test-bridge-unlimited",
    budgetPolicy: "test-budget-only",
    supportedActionClasses: ["generate"],
    ...(overrides.supportedRoles === undefined
      ? {}
      : { supportedRoles: [...overrides.supportedRoles] }),
    bridge: {
      kind: "http-json",
      baseUrl: overrides.baseUrl,
      submitPath: overrides.submitPath ?? "/v1/script-jobs",
      timeoutMs: overrides.timeoutMs ?? 500,
      authEnvVar: "SCRIPT_EXECUTION_API_KEY",
      headers: {
        "x-bridge-id": overrides.adapterId,
      },
    },
  });
}

async function startBridgeServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void,
): Promise<{ readonly url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
