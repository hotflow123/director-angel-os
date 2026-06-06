import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { renderDirectorV1Usage, runDirectorV1Command } from "./director-v1.js";

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 201 ? "Created" : "OK",
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("Director V1 operator CLI", () => {
  it("renders the director-angel operator surface in help", () => {
    const usage = renderDirectorV1Usage("director-angel");

    expect(usage).toContain("director-angel binding list");
    expect(usage).toContain("director-angel session create");
    expect(usage).toContain("director-angel task submit");
    expect(usage).toContain("director-angel catalog model-adapters");
    expect(usage).toContain("director-angel learning jobs run");
    expect(usage).toContain("director-angel capabilities");
  });

  it("exposes director-angel as a bin alias without removing hotflow", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      bin?: Record<string, string>;
    };

    expect(packageJson.bin).toMatchObject({
      hotflow: "./dist/main.js",
      "director-angel": "./dist/director-angel-main.js",
    });
  });

  it("calls bindings, sessions, tasks, task events, catalog, learning jobs, and capabilities", async () => {
    const calls: Array<{ pathname: string; method?: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const pathname = new URL(String(url)).pathname;
      calls.push({
        pathname,
        method: init.method,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (pathname === "/v1/client-bindings") {
        return okJson({ binding: { bindingId: "desktop-main" } }, 201);
      }
      if (pathname === "/v1/sessions") {
        return okJson({ session: { sessionId: "session-main" } }, 201);
      }
      if (pathname === "/v1/tasks") {
        return okJson({ task: { taskId: "task-main", status: "running" } }, 201);
      }
      if (pathname === "/v1/tasks/task-main/events") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            'event: task.status\ndata: {"taskId":"task-main","status":"running"}\n\n',
        } as Response;
      }
      if (pathname === "/v1/catalog/model-adapters") {
        return okJson({ adapters: [{ adapterId: "scripted" }] });
      }
      if (pathname === "/v1/learning/jobs") {
        return okJson({ job: { jobId: "learn-1", status: "created" } }, 201);
      }
      if (pathname === "/v1/learning/jobs/learn-1/run") {
        return okJson({ job: { jobId: "learn-1", status: "succeeded" }, result: {} });
      }
      if (pathname === "/v1/capabilities") {
        return okJson({ resources: ["/v1/tasks"], streaming: { sse: true } });
      }
      return okJson({ error: "unexpected" }, 404);
    });
    const stdout = vi.fn();

    await expect(
      runDirectorV1Command(
        [
          "binding",
          "create",
          "--binding-id",
          "desktop-main",
          "--client-id",
          "desktop-main",
          "--host",
          "http://127.0.0.1:3201",
        ],
        { fetchImpl, stdout },
      ),
    ).resolves.toBe(0);
    await runDirectorV1Command(
      ["session", "create", "--binding-id", "desktop-main", "--peer-id", "desktop-local"],
      { fetchImpl, stdout },
    );
    await runDirectorV1Command(
      ["task", "submit", "--session-id", "session-main", "--text", "生成短剧分镜"],
      { fetchImpl, stdout },
    );
    await runDirectorV1Command(["task", "events", "--task-id", "task-main"], {
      fetchImpl,
      stdout,
    });
    await runDirectorV1Command(["catalog", "model-adapters"], { fetchImpl, stdout });
    await runDirectorV1Command(
      ["learning", "jobs", "create", "--kind", "text", "--source-id", "lesson", "--text", "经验"],
      { fetchImpl, stdout },
    );
    await runDirectorV1Command(["learning", "jobs", "run", "--job-id", "learn-1"], {
      fetchImpl,
      stdout,
    });
    await runDirectorV1Command(["capabilities"], { fetchImpl, stdout });

    expect(calls.map((call) => `${call.method ?? "GET"}:${call.pathname}`)).toEqual([
      "POST:/v1/client-bindings",
      "POST:/v1/sessions",
      "POST:/v1/tasks",
      "GET:/v1/tasks/task-main/events",
      "GET:/v1/catalog/model-adapters",
      "POST:/v1/learning/jobs",
      "POST:/v1/learning/jobs/learn-1/run",
      "GET:/v1/capabilities",
    ]);
    expect(calls[2]?.body).toMatchObject({
      sessionId: "session-main",
      text: "生成短剧分镜",
      start: true,
    });
    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("task-main");
  });

  it("attaches the configured Host API bearer token to V1 requests", async () => {
    const previous = process.env.DIRECTOR_HOST_API_BEARER_TOKEN;
    process.env.DIRECTOR_HOST_API_BEARER_TOKEN = "cli-token";
    const calls: Array<{ pathname: string; headers?: HeadersInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({
        pathname: new URL(String(url)).pathname,
        headers: init.headers,
      });
      return okJson({ resources: [] });
    });
    const stdout = vi.fn();

    try {
      await expect(
        runDirectorV1Command(["capabilities"], {
          fetchImpl,
          stdout,
        }),
      ).resolves.toBe(0);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "DIRECTOR_HOST_API_BEARER_TOKEN");
      } else {
        process.env.DIRECTOR_HOST_API_BEARER_TOKEN = previous;
      }
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe("/v1/capabilities");
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer cli-token",
    });
  });

  it("returns a failed exit code and writes the Host API error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: async () => JSON.stringify({ message: "session is not ready" }),
    })) as unknown as typeof fetch;
    const stdout = vi.fn();

    await expect(
      runDirectorV1Command(["task", "status", "--task-id", "task-main"], {
        fetchImpl,
        stdout,
      }),
    ).resolves.toBe(1);

    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "session is not ready",
    );
  });
});
