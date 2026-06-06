import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ExecutionRunBuilder, FileSystemRunStore } from "@hotflow/director-execution";
import type { DirectorBlueprintResponse } from "@hotflow/director-host-contracts";
import {
  FileSystemDirectorAdapterRegistryStore,
  updateDirectorApiProviderSetting,
} from "@hotflow/director-runtime";
import { ensureDirectorWorkspace } from "@hotflow/director-workspace";
import { SessionStore } from "@hotflow/sessions";
import { readSessionWorkerMailbox } from "@hotflow/tasks-core";
import { afterEach, describe, expect, test } from "vitest";

import { ExecutionRunService } from "../../../packages/director-execution/src/service.ts";
import { runDirectorWorkerCli } from "../src/main.ts";

describe("director-worker run-once", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("runs a dependency-ordered preview-safe execution and writes a report", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-12T01:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-12T01:00:01.000Z",
          "2026-04-12T01:00:02.000Z",
          "2026-04-12T01:00:03.000Z",
          "2026-04-12T01:00:04.000Z",
          "2026-04-12T01:00:05.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-12T01:00:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(createBlueprintFixture());

    let stdout = "";
    let stderr = "";
    const exitCode = await runDirectorWorkerCli(
      ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
      {
        env: {
          ...process.env,
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        },
        io: {
          stdout(message: string) {
            stdout += message;
          },
          stderr(message: string) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain('"status": "completed"');
    expect(stdout).toContain('"executedAssignments"');

    const run = await service.getRun("run-1");
    expect(run?.status).toBe("completed");
    expect(run?.assignments.map((assignment) => assignment.status)).toEqual([
      "completed",
      "completed",
    ]);

    const report = await service.getReport("run-1");
    expect(report?.run.status).toBe("completed");
    expect(report?.flags).toContain("preview-only");

    const workerStore = new SessionStore({
      dbPath: join(workspaceRoot, ".hotflow", "sessions", "worker-jobs.sqlite"),
    });
    try {
      const mailbox = readSessionWorkerMailbox(workerStore, "run-1", {
        workerId: "director-researcher",
      });
      expect(mailbox.mailboxSize).toBe(0);
      expect(mailbox.notifications).toEqual([]);
    } finally {
      workerStore.close();
    }
  });

  test("does not dispatch work when execution.pause_all is enabled before run start", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-12T02:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = ["2026-04-12T02:00:01.000Z", "2026-04-12T02:00:02.000Z"];
        return () => timestamps.shift() ?? "2026-04-12T02:00:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(createBlueprintFixture());
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.pause_all": true,
      },
    });

    const exitCode = await runDirectorWorkerCli(
      ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
      {
        env: {
          ...process.env,
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        },
      },
    );

    expect(exitCode).toBe(0);

    const run = await service.getRun("run-1");
    expect(run?.status).toBe("created");
    expect(run?.assignments.map((assignment) => assignment.status)).toEqual(["ready", "pending"]);

    const report = await service.getReport("run-1");
    expect(report?.run.status).toBe("created");
    expect(report?.flags).not.toContain("run-in-progress");
  });

  test("writes project memory, ingest audit files, and trace proposals after a completed run", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-memory-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-12T05:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-12T05:00:01.000Z",
          "2026-04-12T05:00:02.000Z",
          "2026-04-12T05:00:03.000Z",
          "2026-04-12T05:00:04.000Z",
          "2026-04-12T05:00:05.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-12T05:00:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(createBlueprintFixture());
    writeObservationFixture(workspaceRoot, [
      createEvaluationObservationFixture(),
      createOutcomeObservationFixture(),
    ]);

    const exitCode = await runDirectorWorkerCli(
      ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
      {
        env: {
          ...process.env,
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        },
      },
    );

    expect(exitCode).toBe(0);

    const indexDocument = readJson(workspaceRoot, ".director-angel/runtime/memory/index.json") as {
      entries: Array<{ recordId: string }>;
    };
    const recordId = indexDocument.entries[0]?.recordId;
    const recordDocument = readJson(
      workspaceRoot,
      `.director-angel/runtime/memory/records/${recordId}.json`,
    ) as {
      digest: {
        projectId: string;
        groupId: string;
        observationRefs: Array<{ observationId: string }>;
      };
    };
    const auditDocument = readJson(
      workspaceRoot,
      ".director-angel/runtime/memory/ingest/run-1.json",
    ) as {
      status: string;
      observationIds: string[];
    };
    const proposalIndexDocument = readJson(
      workspaceRoot,
      ".director-angel/runtime/proposals/index.json",
    ) as {
      entries: Array<{ proposalId: string }>;
    };
    const proposalId = proposalIndexDocument.entries[0]?.proposalId;
    const proposalDocument = readJson(
      workspaceRoot,
      `.director-angel/runtime/proposals/records/${proposalId}.json`,
    ) as {
      recordId: string;
      runId: string;
      status: string;
    };

    expect(indexDocument.entries).toHaveLength(1);
    expect(recordDocument.digest.projectId).toBe("project-1");
    expect(recordDocument.digest.groupId).toBe("group-1");
    expect(recordDocument.digest.observationRefs.map((ref) => ref.observationId)).toEqual([
      "observation-evaluation-1",
      "observation-outcome-1",
    ]);
    expect(auditDocument.status).toBe("ok");
    expect(auditDocument.observationIds).toEqual([
      "observation-evaluation-1",
      "observation-outcome-1",
    ]);
    expect(proposalIndexDocument.entries).toHaveLength(1);
    expect(proposalDocument.recordId).toBe(recordId);
    expect(proposalDocument.runId).toBe("run-1");
    expect(proposalDocument.status).toBe("pending");
  });

  test("skips disabled roles before dispatch and blocks downstream work", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-12T03:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-12T03:00:01.000Z",
          "2026-04-12T03:00:02.000Z",
          "2026-04-12T03:00:03.000Z",
          "2026-04-12T03:00:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-12T03:00:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(createBlueprintFixture());
    writeSwitchDocument(workspaceRoot, {
      roleOverrides: {
        researcher: false,
      },
    });

    const exitCode = await runDirectorWorkerCli(
      ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
      {
        env: {
          ...process.env,
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        },
      },
    );

    expect(exitCode).toBe(0);

    const run = await service.getRun("run-1");
    expect(run?.status).toBe("failed");
    expect(run?.assignments.map((assignment) => assignment.status)).toEqual(["skipped", "blocked"]);
    expect(run?.assignments[0]?.notes?.join(" ")).toContain("Role researcher");

    const report = await service.getReport("run-1");
    expect(report?.flags).toContain("has-skipped-assignments");
    expect(report?.flags).toContain("has-blocked-assignments");
  });

  test("degrades memory ingest safely without breaking the worker result", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-memory-degraded-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-12T06:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-12T06:00:01.000Z",
          "2026-04-12T06:00:02.000Z",
          "2026-04-12T06:00:03.000Z",
          "2026-04-12T06:00:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-12T06:00:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(createBlueprintFixture());

    const exitCode = await runDirectorWorkerCli(
      ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
      {
        env: {
          ...process.env,
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        },
      },
    );

    expect(exitCode).toBe(0);

    const run = await service.getRun("run-1");
    const report = await service.getReport("run-1");
    const auditDocument = readJson(
      workspaceRoot,
      ".director-angel/runtime/memory/ingest/run-1.json",
    ) as {
      status: string;
      notes: string[];
    };

    expect(run?.status).toBe("completed");
    expect(report?.run.status).toBe("completed");
    expect(auditDocument.status).toBe("degraded");
    expect(auditDocument.notes.join(" ")).toMatch(/evaluation/i);

    expect(existsSync(join(workspaceRoot, ".director-angel/runtime/proposals/index.json"))).toBe(
      false,
    );
  });

  test("blocks disabled adapters before dispatch", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-12T04:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-12T04:00:01.000Z",
          "2026-04-12T04:00:02.000Z",
          "2026-04-12T04:00:03.000Z",
          "2026-04-12T04:00:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-12T04:00:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(createBlueprintFixture());
    writeSwitchDocument(workspaceRoot, {
      adapterOverrides: {
        "mock-execution": false,
      },
    });

    const exitCode = await runDirectorWorkerCli(
      ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
      {
        env: {
          ...process.env,
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
        },
      },
    );

    expect(exitCode).toBe(0);

    const run = await service.getRun("run-1");
    expect(run?.status).toBe("failed");
    expect(run?.assignments.map((assignment) => assignment.status)).toEqual(["blocked", "blocked"]);
    expect(run?.assignments[0]?.blockingReason).toContain("mock-execution");

    const report = await service.getReport("run-1");
    expect(report?.flags).toContain("has-blocked-assignments");
  });

  test("keeps using the mock path when a persisted bridge adapter is selected but side effects stay disabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-mock-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:00:01.000Z",
          "2026-04-13T08:00:02.000Z",
          "2026-04-13T08:00:03.000Z",
          "2026-04-13T08:00:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:00:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview"),
    );

    const received: string[] = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push(await readRequestBody(request));
      response.writeHead(202, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "token-should-not-be-used",
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(received).toEqual([]);

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("completed");
      expect(run?.assignments[0]?.result?.summary).toContain("Mock executed");
      expect(run?.assignments[0]?.result?.bridgeExecution).toBeUndefined();

      const report = await service.getReport("run-1");
      expect(report?.flags).not.toContain("external-bridge-attempted");
    } finally {
      await server.close();
    }
  });

  test("dispatches a persisted bridge adapter through the real http-json executor when side effects are enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-real-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:10:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:10:01.000Z",
          "2026-04-13T08:10:02.000Z",
          "2026-04-13T08:10:03.000Z",
          "2026-04-13T08:10:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:10:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview", {
        requiresOperatorApproval: true,
      }),
    );
    await service.approveAssignment("run-1", "assignment-bridge-1");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{
      headers: IncomingMessage["headers"];
      body: string;
    }> = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push({
        headers: request.headers,
        body: await readRequestBody(request),
      });
      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "req-worker-1",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "worker-secret-token",
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0]?.headers.authorization).toBe("Bearer worker-secret-token");
      expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({
        schemaId: "director.execution.http-json-request.v1",
        assignmentId: "assignment-bridge-1",
        workerId: "worker-test",
        adapterId: "seedance-preview",
      });

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("completed");
      expect(run?.assignments[0]?.result?.summary).toContain("Bridge executed");
      expect(run?.assignments[0]?.result?.bridgeExecution?.response).toEqual({
        statusCode: 202,
        accepted: true,
        requestId: "req-worker-1",
        bodyBytes: expect.any(Number),
      });
      expect(JSON.stringify(run)).not.toContain("worker-secret-token");

      const report = await service.getReport("run-1");
      expect(report?.flags).toContain("external-bridge-attempted");
      expect(report?.flags).toContain("external-bridge-succeeded");
      expect(report?.bridgeMetrics).toEqual({
        attempts: 1,
        successes: 1,
        failures: 0,
        failedAssignments: [],
      });
    } finally {
      await server.close();
    }
  });

  test("blocks a persisted side-effect bridge when operator approval evidence is missing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-policy-block-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:12:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:12:01.000Z",
          "2026-04-13T08:12:02.000Z",
          "2026-04-13T08:12:03.000Z",
          "2026-04-13T08:12:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:12:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview"),
    );
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: string[] = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push(await readRequestBody(request));
      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "req-worker-policy-blocked",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "worker-secret-token",
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(received).toEqual([]);

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("failed");
      expect(run?.assignments[0]?.result?.summary).toContain("Bridge policy blocked");
      expect(run?.assignments[0]?.result?.bridgeExecution).toEqual({
        kind: "http-json",
        request: {
          endpointOrigin: server.url,
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 500,
          authMode: "env",
          headerKeys: ["x-bridge-id"],
        },
        failure: {
          reason: "policy_blocked",
          message:
            "Bridge adapter seedance-preview requires operator approval evidence before real generate execution.",
          retryable: false,
        },
      });
      expect(JSON.stringify(run)).not.toContain("worker-secret-token");

      const report = await service.getReport("run-1");
      expect(report?.flags).toContain("external-bridge-attempted");
      expect(report?.flags).toContain("external-bridge-failed");
      expect(report?.bridgeMetrics).toEqual({
        attempts: 1,
        successes: 0,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: "assignment-bridge-1",
            reason: "policy_blocked",
            retryable: false,
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  test("dispatches a configured API provider bridge even when it is not persisted in the registry", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-api-provider-bridge-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T09:00:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T09:00:01.000Z",
          "2026-04-13T09:00:02.000Z",
          "2026-04-13T09:00:03.000Z",
          "2026-04-13T09:00:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T09:00:59.000Z";
      })(),
    });
    await updateDirectorApiProviderSetting(join(directorWorkspace.root, "providers"), {
      providerId: "memefast-api",
      key: "apiKey",
      value: "provider-secret-token",
      now: "2026-04-13T09:00:00.000Z",
    });
    await service.createRunFromBlueprint(createSingleAssignmentBlueprintFixture("memefast-api"));
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{
      readonly path: string;
      readonly body: string;
      readonly authorization?: string;
    }> = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push({
        path: request.url ?? "/",
        body: await readRequestBody(request),
        ...(request.headers.authorization === undefined
          ? {}
          : { authorization: String(request.headers.authorization) }),
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": "req-api-provider-1",
      });
      response.end(JSON.stringify({ accepted: true, providerId: "memefast-api" }));
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            DIRECTOR_API_PROVIDER_BRIDGE_BASE_URL: server.url,
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0]?.path).toBe("/v1/bridges/api-provider/media-submit");
      expect(received[0]?.authorization).toBeUndefined();
      expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({
        schemaId: "director.execution.http-json-request.v1",
        assignmentId: "assignment-bridge-1",
        workerId: "worker-test",
        adapterId: "memefast-api",
        provider: "memefast-api",
        role: "asset-router",
      });

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("completed");
      expect(run?.assignments[0]?.result?.summary).toContain("Bridge executed");
      expect(JSON.stringify(run)).not.toContain("provider-secret-token");

      const report = await service.getReport("run-1");
      expect(report?.flags).toContain("external-bridge-attempted");
      expect(report?.flags).toContain("external-bridge-succeeded");
    } finally {
      await server.close();
    }
  });

  test("dispatches a persisted execution bridge adapter for a non-media assignment when side effects are enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-execution-bridge-real-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:15:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:15:01.000Z",
          "2026-04-13T08:15:02.000Z",
          "2026-04-13T08:15:03.000Z",
          "2026-04-13T08:15:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:15:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createExecutionAssignmentBlueprintFixture("script-execution-a", {
        requiresOperatorApproval: true,
      }),
    );
    await service.approveAssignment("run-1", "assignment-script-bridge-1");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{
      headers: IncomingMessage["headers"];
      body: string;
    }> = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push({
        headers: request.headers,
        body: await readRequestBody(request),
      });
      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "req-script-1",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-a",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SCRIPT_EXECUTION_API_KEY: "worker-script-token",
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(received).toHaveLength(1);
      expect(received[0]?.headers.authorization).toBe("Bearer worker-script-token");
      expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({
        schemaId: "director.execution.http-json-request.v1",
        assignmentId: "assignment-script-bridge-1",
        workerId: "worker-test",
        adapterId: "script-execution-a",
        role: "script-planner",
        actionClass: "generate",
      });

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("completed");
      expect(run?.assignments[0]?.result?.summary).toContain("Bridge executed");
      expect(run?.assignments[0]?.result?.adapterId).toBe("script-execution-a");
      expect(run?.assignments[0]?.result?.bridgeExecution?.response).toEqual({
        statusCode: 202,
        accepted: true,
        requestId: "req-script-1",
        bodyBytes: expect.any(Number),
      });
      expect(JSON.stringify(run)).not.toContain("worker-script-token");
    } finally {
      await server.close();
    }
  });

  test("keeps using the mock path for a preview-only execution run even if side effects are globally enabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-execution-bridge-preview-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:17:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:17:01.000Z",
          "2026-04-13T08:17:02.000Z",
          "2026-04-13T08:17:03.000Z",
          "2026-04-13T08:17:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:17:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createExecutionAssignmentBlueprintFixture("script-execution-a", {
        sideEffectsAllowed: false,
      }),
    );
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: Array<{ body: string }> = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push({
        body: await readRequestBody(request),
      });
      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "req-script-preview-1",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    await registerExecutionBridgeAdapterFixture(workspaceRoot, {
      adapterId: "script-execution-a",
      baseUrl: server.url,
      submitPath: "/v1/script-jobs",
      authEnvVar: "SCRIPT_EXECUTION_API_KEY",
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SCRIPT_EXECUTION_API_KEY: "worker-script-token",
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(received).toEqual([]);

      const run = await service.getRun("run-1");
      expect(run?.sideEffectsAllowed).toBe(false);
      expect(run?.status).toBe("completed");
      expect(run?.assignments[0]?.result?.summary).toContain("Mock executed");
      expect(run?.assignments[0]?.result?.bridgeExecution).toBeUndefined();

      const report = await service.getReport("run-1");
      expect(report?.flags).toContain("preview-only");
      expect(report?.flags).not.toContain("external-bridge-attempted");
    } finally {
      await server.close();
    }
  });

  test("records a structured bridge HTTP failure without crashing the worker loop", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-http-failure-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:20:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:20:01.000Z",
          "2026-04-13T08:20:02.000Z",
          "2026-04-13T08:20:03.000Z",
          "2026-04-13T08:20:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:20:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview", {
        requiresOperatorApproval: true,
      }),
    );
    await service.approveAssignment("run-1", "assignment-bridge-1");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const server = await startBridgeServer(async (_request, response) => {
      response.writeHead(502, {
        "content-type": "application/json",
        "x-request-id": "req-worker-502",
      });
      response.end(JSON.stringify({ accepted: false }));
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "worker-secret-token",
          },
        },
      );

      expect(exitCode).toBe(0);

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("failed");
      expect(run?.assignments[0]?.result?.status).toBe("failed");
      expect(run?.assignments[0]?.result?.bridgeExecution).toEqual({
        kind: "http-json",
        request: {
          endpointOrigin: server.url,
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 500,
          authMode: "env",
          headerKeys: ["x-bridge-id"],
          payloadBytes: expect.any(Number),
        },
        response: {
          statusCode: 502,
          accepted: false,
          requestId: "req-worker-502",
          bodyBytes: expect.any(Number),
        },
        failure: {
          reason: "http_error",
          message: "Bridge request returned HTTP 502.",
          retryable: true,
          statusCode: 502,
        },
      });
      expect(JSON.stringify(run)).not.toContain("worker-secret-token");

      const report = await service.getReport("run-1");
      expect(report?.flags).toContain("external-bridge-attempted");
      expect(report?.flags).toContain("external-bridge-failed");
      expect(report?.flags).toContain("has-failures");
      expect(report?.flags).not.toContain("external-bridge-succeeded");
      expect(report?.bridgeMetrics).toEqual({
        attempts: 1,
        successes: 0,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: "assignment-bridge-1",
            reason: "http_error",
            retryable: true,
            statusCode: 502,
          },
        ],
      });
      expect(JSON.stringify(report)).not.toContain("worker-secret-token");
      expect(JSON.stringify(report)).not.toContain("SEEDANCE_API_KEY");
    } finally {
      await server.close();
    }
  });

  test("records a structured bridge timeout without breaking the run report pipeline", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-timeout-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:30:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:30:01.000Z",
          "2026-04-13T08:30:02.000Z",
          "2026-04-13T08:30:03.000Z",
          "2026-04-13T08:30:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:30:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview", {
        requiresOperatorApproval: true,
      }),
    );
    await service.approveAssignment("run-1", "assignment-bridge-1");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const server = await startBridgeServer(async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      response.writeHead(202, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
      timeoutMs: 10,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "worker-secret-token",
          },
        },
      );

      expect(exitCode).toBe(0);

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("failed");
      expect(run?.assignments[0]?.result?.bridgeExecution?.failure).toEqual({
        reason: "network_timeout",
        message: "Bridge request timed out.",
        retryable: true,
        statusCode: 504,
      });

      const report = await service.getReport("run-1");
      expect(report?.flags).toContain("external-bridge-attempted");
      expect(report?.flags).toContain("external-bridge-failed");
      expect(report?.bridgeMetrics).toEqual({
        attempts: 1,
        successes: 0,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: "assignment-bridge-1",
            reason: "network_timeout",
            retryable: true,
            statusCode: 504,
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  test("records a non-retryable invalid bridge response and surfaces contract guidance", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-invalid-response-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:35:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:35:01.000Z",
          "2026-04-13T08:35:02.000Z",
          "2026-04-13T08:35:03.000Z",
          "2026-04-13T08:35:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:35:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview", {
        requiresOperatorApproval: true,
      }),
    );
    await service.approveAssignment("run-1", "assignment-bridge-1");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const server = await startBridgeServer(async (_request, response) => {
      response.writeHead(202, {
        "content-type": "application/json",
      });
      response.end("this-is-not-json");
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "worker-secret-token",
          },
        },
      );

      expect(exitCode).toBe(0);

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("failed");
      expect(run?.assignments[0]?.result?.bridgeExecution).toEqual({
        kind: "http-json",
        request: {
          endpointOrigin: server.url,
          endpointPath: "/v1/jobs",
          method: "POST",
          timeoutMs: 500,
          authMode: "env",
          headerKeys: ["x-bridge-id"],
          payloadBytes: expect.any(Number),
        },
        response: {
          statusCode: 202,
          bodyBytes: expect.any(Number),
        },
        failure: {
          reason: "invalid_response",
          message: "Bridge response was not valid JSON.",
          retryable: false,
          statusCode: 202,
        },
      });

      const report = await service.getReport("run-1");
      expect(report?.operatorSurface).toMatchObject({
        bridgeVerdict: "failed",
        bridgeFailureReason: "invalid_response",
        retryable: false,
        bridgeStatus: 202,
        nextAction: "inspect the bridge response contract before re-running the assignment.",
      });
      expect(report?.bridgeMetrics).toEqual({
        attempts: 1,
        successes: 0,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: "assignment-bridge-1",
            reason: "invalid_response",
            retryable: false,
            statusCode: 202,
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  test("records a non-retryable HTTP 422 bridge failure and surfaces request guidance", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-http-422-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:37:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:37:01.000Z",
          "2026-04-13T08:37:02.000Z",
          "2026-04-13T08:37:03.000Z",
          "2026-04-13T08:37:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:37:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview", {
        requiresOperatorApproval: true,
      }),
    );
    await service.approveAssignment("run-1", "assignment-bridge-1");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const server = await startBridgeServer(async (_request, response) => {
      response.writeHead(422, {
        "content-type": "application/json",
        "x-request-id": "req-worker-422",
      });
      response.end(JSON.stringify({ accepted: false, error: "payload rejected" }));
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "worker-secret-token",
          },
        },
      );

      expect(exitCode).toBe(0);

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("failed");
      expect(run?.assignments[0]?.result?.bridgeExecution?.failure).toEqual({
        reason: "http_error",
        message: "Bridge request returned HTTP 422.",
        retryable: false,
        statusCode: 422,
      });

      const report = await service.getReport("run-1");
      expect(report?.operatorSurface).toMatchObject({
        bridgeVerdict: "failed",
        bridgeFailureReason: "http_error",
        retryable: false,
        bridgeStatus: 422,
        nextAction:
          "inspect the remote bridge request and payload before re-running the assignment.",
      });
      expect(report?.bridgeMetrics).toEqual({
        attempts: 1,
        successes: 0,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: "assignment-bridge-1",
            reason: "http_error",
            retryable: false,
            statusCode: 422,
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  test("fails safely when a real bridge adapter requires a missing credential", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-worker-bridge-missing-auth-"));
    tempRoots.push(workspaceRoot);
    const directorWorkspace = ensureDirectorWorkspace({ root: workspaceRoot });
    const service = new ExecutionRunService({
      store: new FileSystemRunStore({
        rootPath: join(directorWorkspace.runtime, "execution"),
      }),
      builder: new ExecutionRunBuilder({
        idProvider: () => "run-1",
        clock: () => "2026-04-13T08:40:00.000Z",
      }),
      eventIdProvider: (() => {
        let counter = 0;
        return () => `event-${++counter}`;
      })(),
      clock: (() => {
        const timestamps = [
          "2026-04-13T08:40:01.000Z",
          "2026-04-13T08:40:02.000Z",
          "2026-04-13T08:40:03.000Z",
          "2026-04-13T08:40:04.000Z",
        ];
        return () => timestamps.shift() ?? "2026-04-13T08:40:59.000Z";
      })(),
    });
    await service.createRunFromBlueprint(
      createSingleAssignmentBlueprintFixture("seedance-preview", {
        requiresOperatorApproval: true,
      }),
    );
    await service.approveAssignment("run-1", "assignment-bridge-1");
    writeSwitchDocument(workspaceRoot, {
      features: {
        "execution.sideEffects.enabled": true,
      },
    });

    const received: string[] = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push(await readRequestBody(request));
      response.writeHead(202, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    await registerBridgeAdapterFixture(workspaceRoot, {
      adapterId: "seedance-preview",
      baseUrl: server.url,
    });

    try {
      const exitCode = await runDirectorWorkerCli(
        ["run-once", "--run-id", "run-1", "--worker-id", "worker-test"],
        {
          env: {
            ...process.env,
            HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
            HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
            SEEDANCE_API_KEY: "",
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(received).toEqual([]);

      const run = await service.getRun("run-1");
      expect(run?.status).toBe("failed");
      expect(run?.assignments[0]?.result?.bridgeExecution?.failure).toEqual({
        reason: "configuration_error",
        message: "Bridge credential is not configured.",
        retryable: false,
      });
      expect(JSON.stringify(run)).not.toContain("SEEDANCE_API_KEY");

      const report = await service.getReport("run-1");
      expect(report?.flags).toContain("external-bridge-attempted");
      expect(report?.flags).toContain("external-bridge-failed");
      expect(report?.bridgeMetrics).toEqual({
        attempts: 1,
        successes: 0,
        failures: 1,
        failedAssignments: [
          {
            assignmentId: "assignment-bridge-1",
            reason: "configuration_error",
            retryable: false,
          },
        ],
      });
      expect(JSON.stringify(report)).not.toContain("SEEDANCE_API_KEY");
    } finally {
      await server.close();
    }
  });
});

function createBlueprintFixture(): DirectorBlueprintResponse {
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
      capturedAt: "2026-04-12T01:00:00.000Z",
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
      createdAt: "2026-04-12T01:00:00.000Z",
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
  };
}

function createSingleAssignmentBlueprintFixture(
  selectedAdapter: string,
  options: {
    readonly requiresOperatorApproval?: boolean;
  } = {},
): DirectorBlueprintResponse {
  const requiresOperatorApproval = options.requiresOperatorApproval ?? false;

  return {
    apiVersion: "director-host-api.v1",
    snapshotId: "snapshot-bridge-1",
    runtimeId: "runtime-bridge-1",
    blueprintId: "blueprint-bridge-1",
    review: {
      overallDecision: "pass",
      blockingReasons: [],
      requiredFixes: [],
    },
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-bridge-1",
      runtimeId: "runtime-bridge-1",
      capturedAt: "2026-04-13T08:00:00.000Z",
      status: "ready",
      adapters: [],
      notes: [],
    },
    actionGraph: {
      graphId: "graph-bridge-1",
      blueprintId: "blueprint-bridge-1",
      goal: "submit a single real bridge request",
      nodes: [
        {
          nodeId: "node-bridge-1",
          assignmentId: "assignment-bridge-1",
          role: "asset-router",
          objective: "Submit a media generation request",
          inputs: ["prompt"],
          outputs: ["bridge job"],
          deliverable: "send a bounded adapter request",
          acceptanceCriteria: ["request is accepted"],
          constraints: [],
          dependsOn: [],
          allowedAdapters: [selectedAdapter],
          actionClass: "generate",
          approvalMode: requiresOperatorApproval ? "operator_approve" : "auto_allow",
          escalationToDirector: false,
          status: requiresOperatorApproval ? "awaiting_approval" : "ready",
          selectedAdapter,
        },
      ],
      edges: [],
      stopConditions: [],
    },
    preview: {
      previewId: "preview-bridge-1",
      summary: "bridge preview",
      warnings: [],
      blockedReasons: [],
      requiredApprovals: [],
    },
    handoff: {
      handoffId: "handoff-bridge-1",
      blueprintId: "blueprint-bridge-1",
      createdAt: "2026-04-13T08:00:00.000Z",
      alignmentLockId: "lock-bridge-1",
      actionGraphId: "graph-bridge-1",
      previewSummary: "bridge preview",
      capabilityMatches: [],
      mediaRequests: [],
      expectedArtifacts: [],
      chosenAdapters: [selectedAdapter],
      sideEffectsAllowed: true,
      notes: [],
    },
  };
}

function createExecutionAssignmentBlueprintFixture(
  selectedAdapter: string,
  options: {
    readonly sideEffectsAllowed?: boolean;
    readonly requiresOperatorApproval?: boolean;
  } = {},
): DirectorBlueprintResponse {
  const sideEffectsAllowed = options.sideEffectsAllowed ?? true;
  const requiresOperatorApproval = options.requiresOperatorApproval ?? false;

  return {
    apiVersion: "director-host-api.v1",
    snapshotId: "snapshot-script-bridge-1",
    runtimeId: "runtime-script-bridge-1",
    blueprintId: "blueprint-script-bridge-1",
    review: {
      overallDecision: "pass",
      blockingReasons: [],
      requiredFixes: [],
    },
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-script-bridge-1",
      runtimeId: "runtime-script-bridge-1",
      capturedAt: "2026-04-13T08:15:00.000Z",
      status: "ready",
      adapters: [],
      notes: [],
    },
    actionGraph: {
      graphId: "graph-script-bridge-1",
      blueprintId: "blueprint-script-bridge-1",
      goal: "submit a single real execution handoff request",
      nodes: [
        {
          nodeId: "node-script-bridge-1",
          assignmentId: "assignment-script-bridge-1",
          role: "script-planner",
          objective: "Submit a deterministic script outline request",
          inputs: ["aligned brief"],
          outputs: ["script outline"],
          deliverable: "send a bounded script execution request",
          acceptanceCriteria: ["request is accepted"],
          constraints: [],
          dependsOn: [],
          allowedAdapters: [selectedAdapter],
          actionClass: "generate",
          approvalMode: requiresOperatorApproval ? "operator_approve" : "auto_allow",
          escalationToDirector: false,
          status: requiresOperatorApproval ? "awaiting_approval" : "ready",
          selectedAdapter,
        },
      ],
      edges: [],
      stopConditions: [],
    },
    preview: {
      previewId: "preview-script-bridge-1",
      summary: "execution bridge preview",
      warnings: [],
      blockedReasons: [],
      requiredApprovals: [],
    },
    handoff: {
      handoffId: "handoff-script-bridge-1",
      blueprintId: "blueprint-script-bridge-1",
      createdAt: "2026-04-13T08:15:00.000Z",
      alignmentLockId: "lock-script-bridge-1",
      actionGraphId: "graph-script-bridge-1",
      previewSummary: "execution bridge preview",
      capabilityMatches: [],
      mediaRequests: [],
      expectedArtifacts: [],
      chosenAdapters: [selectedAdapter],
      sideEffectsAllowed,
      notes: sideEffectsAllowed ? [] : ["preview-only"],
    },
  };
}

async function registerBridgeAdapterFixture(
  workspaceRoot: string,
  overrides: {
    readonly adapterId: string;
    readonly baseUrl: string;
    readonly submitPath?: string;
    readonly timeoutMs?: number;
  },
): Promise<void> {
  const store = new FileSystemDirectorAdapterRegistryStore({
    rootPath: join(workspaceRoot, ".director-angel", "adapters", "registry"),
    clock: () => "2026-04-13T08:00:00.000Z",
  });

  await store.upsertManifest({
    adapterId: overrides.adapterId,
    adapterKind: "media",
    provider: "seedance",
    bindingId: "seedance-preview",
    enabled: true,
    healthStatus: "ready",
    dryRunSupported: true,
    mockOnly: false,
    riskLevel: "high",
    approvalMode: "operator_approve",
    permissionScopes: ["media.generate"],
    dataRetentionPolicy: "test-bridge-retains-none",
    rateLimitPolicy: "test-bridge-unlimited",
    budgetPolicy: "test-budget-only",
    supportedActionClasses: ["generate"],
    mediaCapability: {
      adapterId: overrides.adapterId,
      adapterKind: "media",
      provider: "seedance",
      supportedModes: ["text_to_video"],
      inputModalities: ["text"],
      outputArtifactTypes: ["video"],
      supportsAsync: false,
      healthStatus: "ready",
    },
    bridge: {
      kind: "http-json",
      baseUrl: overrides.baseUrl,
      submitPath: overrides.submitPath ?? "/v1/jobs",
      timeoutMs: overrides.timeoutMs ?? 500,
      authEnvVar: "SEEDANCE_API_KEY",
      headers: {
        "x-bridge-id": overrides.adapterId,
      },
    },
  });
}

async function registerExecutionBridgeAdapterFixture(
  workspaceRoot: string,
  overrides: {
    readonly adapterId: string;
    readonly baseUrl: string;
    readonly submitPath?: string;
    readonly timeoutMs?: number;
  },
): Promise<void> {
  const store = new FileSystemDirectorAdapterRegistryStore({
    rootPath: join(workspaceRoot, ".director-angel", "adapters", "registry"),
    clock: () => "2026-04-13T08:15:00.000Z",
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

function writeObservationFixture(workspaceRoot: string, observations: readonly unknown[]): void {
  writeFileSync(
    join(workspaceRoot, ".director-angel", "runtime", "observations.ndjson"),
    observations
      .map((observation) => JSON.stringify(observation))
      .join("\n")
      .concat("\n"),
    "utf8",
  );
}

function createEvaluationObservationFixture() {
  return {
    schemaId: "director.observation.v1",
    observationId: "observation-evaluation-1",
    recordedAt: "2026-04-12T04:59:00.000Z",
    source: "evaluation",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    workingContext: {
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      operatorId: "operator-1",
      goal: "Create a launch teaser.",
      projectLabel: "Project One",
      projectId: "project-1",
      groupId: "group-1",
      generationType: "new",
      generationStyle: "immersive",
      sceneCount: 2,
      continuityPriority: "high",
      anchorIds: ["anchor-a", "anchor-b"],
    },
    recallHints: {
      preferredBindings: ["seedance"],
      requiredBindings: [],
      fallbackBindings: ["kling"],
      continuityAnchorIds: ["anchor-a", "anchor-b"],
      knowledgeSignalTags: ["continuity", "character"],
      deliverables: ["Create a launch teaser."],
    },
    recalledKnowledgePacks: [],
    recallStatus: "disabled",
    recallNotes: ["Memory recall disabled for fixture."],
    evaluation: {
      decision: "pass",
      actionGraphReadiness: "ready",
      selectedAdapters: ["mock-execution"],
      blockedReasons: [],
      warnings: [],
    },
    notes: ["fixture=evaluation"],
  };
}

function createOutcomeObservationFixture() {
  return {
    schemaId: "director.observation.v1",
    observationId: "observation-outcome-1",
    recordedAt: "2026-04-12T05:10:00.000Z",
    source: "outcome",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-1",
    handoffId: "handoff-1",
    recalledKnowledgePacks: [],
    recallStatus: "disabled",
    recallNotes: ["Outcome fixtures do not perform recall."],
    outcome: {
      outcomeId: "outcome-1",
      status: "accepted",
      recordedAt: "2026-04-12T05:10:00.000Z",
      operatorId: "operator-1",
      notes: ["Looks good."],
    },
    notes: ["fixture=outcome"],
  };
}

function readJson(workspaceRoot: string, relativePath: string): unknown {
  return JSON.parse(readFileSync(join(workspaceRoot, relativePath), "utf8")) as unknown;
}
