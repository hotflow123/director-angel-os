import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createGatewayApp } from "../src/server.js";

interface TestGatewayHandle {
  readonly close: () => Promise<void>;
  readonly readmePath: string;
  readonly runtime: ReturnType<typeof createGatewayApp>["runtime"];
  readonly url: string;
}

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("gateway server", () => {
  test("returns structured health response", async () => {
    const gateway = await startGateway();
    try {
      const response = await fetch(`${gateway.url}/health`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "ok",
        app: "@hotflow/gateway",
        defaultProvider: "scripted",
        defaultProviderAvailable: true,
      });
    } finally {
      await gateway.close();
    }
  });

  test("returns a compact preflight response when gateway runtime is ready", async () => {
    const gateway = await startGateway();
    try {
      const response = await fetch(`${gateway.url}/v1/runtime/preflight`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "pass",
        readiness: "ready",
        app: "@hotflow/gateway",
        recommendedCommand: "hotflow preflight",
        recommendedRoute: {
          method: "POST",
          path: "/v1/channel/message",
        },
        surfaces: {
          runtime: {
            status: "pass",
          },
          provider: {
            status: "pass",
            defaultProviderAvailable: true,
          },
        },
      });
      expect(String(body.summaryText)).toContain("ready");
    } finally {
      await gateway.close();
    }
  });

  test("accepts direct channel messages and returns engine output", async () => {
    const gateway = await startGateway();
    try {
      const sessionKey = "agent:agent-main:direct:user_1";
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_1",
          messageId: "msg_1",
          receivedAtMs: 1710000000000,
          text: `Read ${gateway.readmePath} and summarize it.`,
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_1",
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "accepted",
        routeKind: "direct",
        sessionKey,
        toolCallCount: 2,
      });
      expect(String(body.output)).toContain("Todo list has been persisted");

      const reasoningEvent = gateway.runtime.sessionStore
        .listStreamEvents(sessionKey)
        .find((entry) => entry.event.kind === "stream.reasoning");
      expect(
        (reasoningEvent?.event.payload as Record<string, unknown> | undefined)?.decision,
      ).toMatchObject({
        strategy: "react",
      });
    } finally {
      await gateway.close();
    }
  });

  test("accepts thread channel messages and preserves thread session routing", async () => {
    const gateway = await startGateway();
    try {
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_1",
          messageId: "msg_2",
          receivedAtMs: 1710000001000,
          text: `Read ${gateway.readmePath} and summarize it.`,
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "thread",
            peerId: "user_1",
            threadId: "thread_1",
            baseSessionId: "session_base_1",
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "accepted",
        routeKind: "thread",
        sessionKey: "agent:agent-main:thread:session_base_1:thread_1:user_1",
      });
    } finally {
      await gateway.close();
    }
  });

  test("rejects invalid direct routing payloads", async () => {
    const gateway = await startGateway();
    try {
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_1",
          messageId: "msg_3",
          receivedAtMs: 1710000002000,
          text: "Hello",
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_1",
            baseSessionId: "session_base_1",
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        code: "VALIDATION_FAILURE",
      });
      expect(String(body.message)).toContain("baseSessionId");
    } finally {
      await gateway.close();
    }
  });

  test("surfaces missing default provider as structured runtime error", async () => {
    const gateway = await startGateway({
      env: {
        HOTFLOW_DEFAULT_PROVIDER: "openai-compatible",
      },
    });
    try {
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_1",
          messageId: "msg_4",
          receivedAtMs: 1710000003000,
          text: `Read ${gateway.readmePath} and summarize it.`,
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_1",
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        code: "DEFAULT_PROVIDER_UNAVAILABLE",
        metadata: {
          defaultProvider: "openai-compatible",
          preflightRoute: {
            method: "GET",
            path: "/v1/runtime/preflight",
          },
          preflight: {
            status: "fail",
            readiness: "blocked",
            recommendedCommand: "hotflow doctor",
          },
        },
      });
    } finally {
      await gateway.close();
    }
  });

  test("blocks preflight when the configured default provider is unavailable", async () => {
    const gateway = await startGateway({
      env: {
        HOTFLOW_DEFAULT_PROVIDER: "openai-compatible",
      },
    });
    try {
      const response = await fetch(`${gateway.url}/v1/runtime/preflight`);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "fail",
        readiness: "blocked",
        recommendedCommand: "hotflow doctor",
        surfaces: {
          provider: {
            status: "fail",
            defaultProvider: "openai-compatible",
            defaultProviderAvailable: false,
          },
        },
      });
      expect(body.recommendedRoute).toBeUndefined();
      expect(String(body.summaryText)).toContain("blocked");
    } finally {
      await gateway.close();
    }
  });

  test("surfaces transient provider failures with failover metadata", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("rate limited", {
          status: 429,
          headers: {
            "content-type": "text/plain",
          },
        }),
    ) as typeof fetch;
    const gateway = await startGateway({
      env: {
        HOTFLOW_DEFAULT_PROVIDER: "openai-live",
        HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
      },
      fetchImpl,
    });
    try {
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_1",
          messageId: "msg_5",
          receivedAtMs: 1710000004000,
          text: "Trigger a transient provider failure.",
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_1",
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        code: "PROVIDER_TRANSIENT_ERROR",
        metadata: {
          kind: "provider-transient",
          action: "failover",
          providerId: "openai-live",
          providerStage: "generate",
          providerCode: "HTTP_429",
          retryable: true,
          statusCode: 429,
          operatorVisible: false,
        },
      });
    } finally {
      await gateway.close();
    }
  });

  test("surfaces fatal provider failures with abort metadata", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("unauthorized", {
          status: 401,
          headers: {
            "content-type": "text/plain",
          },
        }),
    ) as typeof fetch;
    const gateway = await startGateway({
      env: {
        HOTFLOW_DEFAULT_PROVIDER: "openai-live",
        HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
      },
      fetchImpl,
    });
    try {
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_1",
          messageId: "msg_6",
          receivedAtMs: 1710000005000,
          text: "Trigger a fatal provider failure.",
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_1",
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(502);
      expect(body).toMatchObject({
        code: "PROVIDER_FATAL_ERROR",
        metadata: {
          kind: "provider-fatal",
          action: "abort",
          providerId: "openai-live",
          providerStage: "generate",
          providerCode: "HTTP_401",
          retryable: false,
          statusCode: 401,
          operatorVisible: true,
        },
      });
    } finally {
      await gateway.close();
    }
  });

  test("allows gateway message metadata to override the default reasoning strategy", async () => {
    const gateway = await startGateway();
    try {
      const sessionKey = "agent:agent-main:direct:user_reasoning";
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_reasoning",
          messageId: "msg_reasoning",
          receivedAtMs: 1710000006000,
          text: `Read ${gateway.readmePath} and summarize it.`,
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_reasoning",
          },
          metadata: {
            reasoning: {
              reasoningStrategy: "plan-execute",
            },
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "accepted",
        sessionKey,
      });

      const reasoningEvent = gateway.runtime.sessionStore
        .listStreamEvents(sessionKey)
        .find((entry) => entry.event.kind === "stream.reasoning");
      expect(
        (reasoningEvent?.event.payload as Record<string, unknown> | undefined)?.decision,
      ).toMatchObject({
        strategy: "plan-execute",
      });
    } finally {
      await gateway.close();
    }
  });

  test("allows root metadata reasoning fields when metadata.reasoning is absent", async () => {
    const gateway = await startGateway();
    try {
      const sessionKey = "agent:agent-main:direct:user_reasoning_root";
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_reasoning_root",
          messageId: "msg_reasoning_root",
          receivedAtMs: 1710000007000,
          text: `Read ${gateway.readmePath} and summarize it.`,
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_reasoning_root",
          },
          metadata: {
            reasoningStrategy: "plan-execute",
            requiresTools: false,
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "accepted",
        sessionKey,
      });

      const reasoningEvent = gateway.runtime.sessionStore
        .listStreamEvents(sessionKey)
        .find((entry) => entry.event.kind === "stream.reasoning");
      expect(
        (reasoningEvent?.event.payload as Record<string, unknown> | undefined)?.decision,
      ).toMatchObject({
        strategy: "plan-execute",
      });
    } finally {
      await gateway.close();
    }
  });

  test("rejects mixed root and nested gateway reasoning override shapes", async () => {
    const gateway = await startGateway();
    try {
      const response = await fetch(`${gateway.url}/v1/channel/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          channel: "webchat",
          agentId: "agent-main",
          peerId: "user_reasoning_mixed",
          messageId: "msg_reasoning_mixed",
          receivedAtMs: 1710000008000,
          text: "Hello",
          routingHint: {
            agentId: "agent-main",
            channel: "webchat",
            routeKind: "direct",
            peerId: "user_reasoning_mixed",
          },
          metadata: {
            reasoningStrategy: "react",
            reasoning: {
              reasoningStrategy: "plan-execute",
            },
          },
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        code: "VALIDATION_FAILURE",
      });
      expect(String(body.message)).toContain(
        'either at "metadata.*" or under "metadata.reasoning.*"',
      );
    } finally {
      await gateway.close();
    }
  });
});

interface StartGatewayOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

async function startGateway(options: StartGatewayOptions = {}): Promise<TestGatewayHandle> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-gateway-"));
  cleanupPaths.push(workspaceRoot);

  const dataDir = join(workspaceRoot, ".hotflow");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  const readmePath = join(workspaceRoot, "README.md");
  writeFileSync(readmePath, "Agent OS repository details for gateway tests.\n", "utf8");

  const app = createGatewayApp({
    env: {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_GATEWAY_SESSION_DB_PATH: join(dataDir, "sessions", "gateway-test.sqlite"),
      ...(options.env ?? {}),
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const started = await app.start({ host: "127.0.0.1", port: 0 });

  return {
    readmePath,
    runtime: app.runtime,
    url: `http://${normalizeHost(started.host)}:${started.port}`,
    close() {
      return app.close();
    },
  };
}

function normalizeHost(host: string): string {
  return host === "::" ? "127.0.0.1" : host;
}
