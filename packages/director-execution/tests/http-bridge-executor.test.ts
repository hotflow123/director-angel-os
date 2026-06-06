import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, test } from "vitest";

import type { AssignmentRun } from "@hotflow/director-execution-contracts";

import { executeAssignmentViaHttpJsonBridge } from "../src/http-bridge-executor.ts";

describe("http-json bridge executor", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0, servers.length).map((server) => server.close()));
  });

  test("completes a real bridge request and redacts credentials from the assignment result", async () => {
    const received: Array<{
      method: string;
      url: string;
      headers: IncomingMessage["headers"];
      body: string;
    }> = [];
    const server = await startBridgeServer(async (request, response) => {
      received.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: await readRequestBody(request),
      });

      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "req-1",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    servers.push(server);

    const result = await executeAssignmentViaHttpJsonBridge(
      createAssignmentFixture({
        selectedAdapter: "seedance-preview",
      }),
      {
        kind: "http-json",
        adapterId: "seedance-preview",
        provider: "seedance",
        baseUrl: server.url,
        submitPath: "/v1/jobs",
        timeoutMs: 1_000,
        authEnvVar: "SEEDANCE_API_KEY",
        headers: {
          "x-bridge-id": "seedance-preview",
        },
      },
      {
        workerId: "worker-bridge",
        now: () => "2026-04-13T12:00:01.000Z",
        env: {
          SEEDANCE_API_KEY: "super-secret-token",
        },
      },
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.method).toBe("POST");
    expect(received[0]?.url).toBe("/v1/jobs");
    expect(received[0]?.headers.authorization).toBe("Bearer super-secret-token");
    expect(received[0]?.headers["x-bridge-id"]).toBe("seedance-preview");
    expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({
      schemaId: "director.execution.http-json-request.v1",
      runId: "run-1",
      assignmentId: "assignment-1",
      workerId: "worker-bridge",
      adapterId: "seedance-preview",
      provider: "seedance",
      inputs: ["locked brief", "knowledge://pack/continuity"],
      outputs: ["bridge job id"],
      acceptanceCriteria: ["Bridge job preserves recalled continuity."],
      constraints: [
        {
          field: "recalledKnowledge",
          requirement: "Apply continuity pack pack://continuity/v2.",
          priority: "required",
          rationale: "Remote executor needs the same recalled context.",
        },
        {
          field: "skill",
          requirement: "Use approved skill skill://seedance-submit.",
          priority: "preferred",
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.adapterId).toBe("seedance-preview");
    expect(result.bridgeExecution).toEqual({
      kind: "http-json",
      request: {
        endpointOrigin: server.url,
        endpointPath: "/v1/jobs",
        method: "POST",
        timeoutMs: 1_000,
        authMode: "env",
        headerKeys: ["x-bridge-id"],
        payloadBytes: expect.any(Number),
      },
      response: {
        statusCode: 202,
        accepted: true,
        requestId: "req-1",
        bodyBytes: expect.any(Number),
      },
    });
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });

  test("fails safely when the bridge credential is missing", async () => {
    const result = await executeAssignmentViaHttpJsonBridge(
      createAssignmentFixture({
        selectedAdapter: "seedance-preview",
      }),
      {
        kind: "http-json",
        adapterId: "seedance-preview",
        provider: "seedance",
        baseUrl: "https://bridge.example.test",
        submitPath: "/v1/jobs",
        timeoutMs: 1_000,
        authEnvVar: "SEEDANCE_API_KEY",
      },
      {
        workerId: "worker-bridge",
        now: () => "2026-04-13T12:05:01.000Z",
        env: {},
      },
    );

    expect(result.status).toBe("failed");
    expect(result.bridgeExecution?.failure).toEqual({
      reason: "configuration_error",
      message: "Bridge credential is not configured.",
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain("SEEDANCE_API_KEY");
  });

  test.each([
    { statusCode: 422, retryable: false },
    { statusCode: 502, retryable: true },
  ])(
    "wraps HTTP $statusCode responses into a structured bridge failure",
    async ({ statusCode, retryable }) => {
      const server = await startBridgeServer(async (_request, response) => {
        response.writeHead(statusCode, {
          "content-type": "application/json",
          "x-request-id": `req-${statusCode}`,
        });
        response.end(JSON.stringify({ accepted: false }));
      });
      servers.push(server);

      const result = await executeAssignmentViaHttpJsonBridge(
        createAssignmentFixture({
          selectedAdapter: "seedance-preview",
        }),
        {
          kind: "http-json",
          adapterId: "seedance-preview",
          provider: "seedance",
          baseUrl: server.url,
          submitPath: "/v1/jobs",
          timeoutMs: 1_000,
        },
        {
          workerId: "worker-bridge",
          now: () => "2026-04-13T12:10:01.000Z",
        },
      );

      expect(result.status).toBe("failed");
      expect(result.bridgeExecution?.failure).toEqual({
        reason: "http_error",
        message: `Bridge request returned HTTP ${statusCode}.`,
        retryable,
        statusCode,
      });
      expect(result.bridgeExecution?.response).toEqual({
        statusCode,
        accepted: false,
        requestId: `req-${statusCode}`,
        bodyBytes: expect.any(Number),
      });
    },
  );

  test("wraps timeouts into a structured bridge failure instead of throwing", async () => {
    const server = await startBridgeServer(async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      response.writeHead(202, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    servers.push(server);

    const result = await executeAssignmentViaHttpJsonBridge(
      createAssignmentFixture({
        selectedAdapter: "seedance-preview",
      }),
      {
        kind: "http-json",
        adapterId: "seedance-preview",
        provider: "seedance",
        baseUrl: server.url,
        submitPath: "/v1/jobs",
        timeoutMs: 10,
      },
      {
        workerId: "worker-bridge",
        now: () => "2026-04-13T12:15:01.000Z",
      },
    );

    expect(result.status).toBe("failed");
    expect(result.bridgeExecution?.failure).toEqual({
      reason: "network_timeout",
      message: "Bridge request timed out.",
      retryable: true,
      statusCode: 504,
    });
  });

  test.each([
    {
      responseBody: { accepted: true, request_id: "legacy-req-1" },
      expectedRequestId: "legacy-req-1",
    },
    { responseBody: { accepted: true, jobId: "legacy-job-1" }, expectedRequestId: "legacy-job-1" },
  ])(
    "normalizes legacy bridge response request identifiers",
    async ({ responseBody, expectedRequestId }) => {
      const server = await startBridgeServer(async (_request, response) => {
        response.writeHead(202, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            schemaVersion: "legacy.bridge.response.v1",
            ...responseBody,
          }),
        );
      });
      servers.push(server);

      const result = await executeAssignmentViaHttpJsonBridge(
        createAssignmentFixture(),
        {
          kind: "http-json",
          adapterId: "seedance-preview",
          provider: "seedance",
          baseUrl: server.url,
          submitPath: "/v1/jobs",
          timeoutMs: 1_000,
        },
        {
          workerId: "worker-bridge",
          now: () => "2026-04-13T12:20:01.000Z",
        },
      );

      expect(result.status).toBe("completed");
      expect(result.bridgeExecution?.response?.requestId).toBe(expectedRequestId);
      expect(JSON.stringify(result)).not.toContain("request_id");
      expect(JSON.stringify(result)).not.toContain("schemaVersion");
    },
  );

  test("prefers response header request id over body request identifiers", async () => {
    const server = await startBridgeServer(async (_request, response) => {
      response.writeHead(202, {
        "content-type": "application/json",
        "x-request-id": "header-req",
      });
      response.end(
        JSON.stringify({
          accepted: true,
          requestId: "body-req",
          request_id: "legacy-req",
          jobId: "legacy-job",
        }),
      );
    });
    servers.push(server);

    const result = await executeAssignmentViaHttpJsonBridge(
      createAssignmentFixture(),
      {
        kind: "http-json",
        adapterId: "seedance-preview",
        provider: "seedance",
        baseUrl: server.url,
        submitPath: "/v1/jobs",
        timeoutMs: 1_000,
      },
      {
        workerId: "worker-bridge",
        now: () => "2026-04-13T12:25:01.000Z",
      },
    );

    expect(result.bridgeExecution?.response?.requestId).toBe("header-req");
  });

  test("normalizes legacy request ids on failed bridge responses", async () => {
    const server = await startBridgeServer(async (_request, response) => {
      response.writeHead(422, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ accepted: false, request_id: "legacy-fail-1" }));
    });
    servers.push(server);

    const result = await executeAssignmentViaHttpJsonBridge(
      createAssignmentFixture(),
      {
        kind: "http-json",
        adapterId: "seedance-preview",
        provider: "seedance",
        baseUrl: server.url,
        submitPath: "/v1/jobs",
        timeoutMs: 1_000,
      },
      {
        workerId: "worker-bridge",
        now: () => "2026-04-13T12:30:01.000Z",
      },
    );

    expect(result.status).toBe("failed");
    expect(result.bridgeExecution?.response?.requestId).toBe("legacy-fail-1");
  });
});

function createAssignmentFixture(overrides: Partial<AssignmentRun> = {}): AssignmentRun {
  return {
    runId: "run-1",
    assignmentId: "assignment-1",
    role: "asset-router",
    objective: "Submit a media job.",
    deliverable: "Create a teaser shot.",
    inputs: ["locked brief", "knowledge://pack/continuity"],
    outputs: ["bridge job id"],
    acceptanceCriteria: ["Bridge job preserves recalled continuity."],
    constraints: [
      {
        field: "recalledKnowledge",
        requirement: "Apply continuity pack pack://continuity/v2.",
        priority: "required",
        rationale: "Remote executor needs the same recalled context.",
      },
      {
        field: "skill",
        requirement: "Use approved skill skill://seedance-submit.",
        priority: "preferred",
      },
    ],
    actionClass: "generate",
    approvalMode: "auto_allow",
    dependsOn: [],
    status: "running",
    selectedAdapter: "seedance-preview",
    allowedAdapters: ["seedance-preview"],
    createdAt: "2026-04-13T12:00:00.000Z",
    startedAt: "2026-04-13T12:00:00.500Z",
    ...overrides,
  };
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
