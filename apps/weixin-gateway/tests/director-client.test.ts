import { describe, expect, it } from "vitest";

import {
  formatDirectorGatewayReply,
  governDirectorMemoryPublication,
  invokeDirectorTool,
  previewDirectorMemoryRecall,
  readDirectorMemoryStatus,
  readDirectorToolsEffective,
  sendMessageToDirector,
} from "../src/director-client.js";
import type { FetchLike } from "../src/types.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("director client bridge", () => {
  it("attaches the configured Host API bearer token to shared client requests", async () => {
    const previous = process.env.DIRECTOR_HOST_API_BEARER_TOKEN;
    process.env.DIRECTOR_HOST_API_BEARER_TOKEN = "weixin-token";
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, headers: init?.headers });
      return jsonResponse({
        schemaId: "director.host.memory-status.v1",
        enabled: true,
      });
    };

    try {
      await readDirectorMemoryStatus({
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      });
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "DIRECTOR_HOST_API_BEARER_TOKEN");
      } else {
        process.env.DIRECTOR_HOST_API_BEARER_TOKEN = previous;
      }
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer weixin-token",
    });
  });

  it("submits a Weixin message and advances it through blueprint/run/status", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/entry/message")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "ready_for_blueprint",
            nextAction: "blueprint",
          },
          turn: { summary: "Create a short video." },
          intake: {
            alignmentLock: { objective: "Create a short video.", notes: [] },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/blueprint")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "ready_for_run",
            nextAction: "run",
          },
          blueprint: {
            blueprintId: "blueprint-1",
            handoff: { handoffId: "handoff-1" },
          },
        });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/runs")) {
        return jsonResponse(
          {
            session: {
              entrySessionId: "entry-1",
              state: "ready_for_run",
              nextAction: "run",
            },
            run: { runId: "run-1", status: "created" },
          },
          201,
        );
      }
      if (url.endsWith("/v1/runs/run-1/start")) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/v1/entry/sessions/entry-1/status")) {
        return jsonResponse({
          session: {
            entrySessionId: "entry-1",
            state: "run_in_progress",
            nextAction: "wait",
          },
          run: { runId: "run-1", status: "running" },
          report: {
            reportId: "report-1",
            operatorSurface: { operatorSummary: "正在执行本地 run。" },
          },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    };

    const result = await sendMessageToDirector(
      {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
      {
        peerId: "friend@im.wechat",
        messageId: "wx-msg-1",
        receivedAtMs: 1_713_000_000_000,
        text: "Create a short video.",
      },
    );

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/entry/message",
      "/v1/entry/sessions/entry-1/blueprint",
      "/v1/entry/sessions/entry-1/runs",
      "/v1/runs/run-1/start",
      "/v1/entry/sessions/entry-1/status",
    ]);
    expect(calls[0]?.body).toContain('"channel":"personal-weixin"');
    expect(result.status?.run?.status).toBe("running");
    const reply = formatDirectorGatewayReply(result);
    expect(reply).toContain("制作入口已记录：Create a short video.");
    expect(reply).not.toContain("蓝图：");
    expect(reply).not.toContain("Run：");
    expect(reply).not.toContain("制作流程");
  });

  it("reads memory status and previews runtime memory recall through Host API", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/memory/status")) {
        return jsonResponse({
          schemaId: "director.host.memory-status.v1",
          enabled: true,
          runtimeMemory: { storeStatus: "ok", recordCount: 1 },
          longTerm: { status: "hit", signals: [{ id: "long-term-memory:memory" }] },
        });
      }
      if (url.endsWith("/v1/memory/recall-preview")) {
        return jsonResponse({
          schemaId: "director.host.memory-recall-preview.v1",
          enabled: true,
          packet: {
            status: "ok",
            hits: [{ recordId: "memory-1", summary: "复用连续性锚点。" }],
          },
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    };
    const options = {
      hostApiUrl: "http://127.0.0.1:3201",
      hostId: "personal-weixin",
      agentId: "director",
      channel: "personal-weixin",
      autoAdvance: true,
      autoStartRun: true,
      fetchFn,
    };

    const status = await readDirectorMemoryStatus(options);
    const recall = await previewDirectorMemoryRecall(options, {
      projectId: "project-1",
      groupId: "group-1",
      knowledgeSignalTags: ["continuity"],
      maxHits: 2,
    });

    expect(status).toMatchObject({
      enabled: true,
      runtimeMemory: { recordCount: 1 },
    });
    expect(recall).toMatchObject({
      enabled: true,
      packet: { status: "ok" },
    });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/v1/memory/status",
      "/v1/memory/recall-preview",
    ]);
    expect(calls[1]?.body).toContain('"projectId":"project-1"');
    expect(calls[1]?.body).toContain('"knowledgeSignalTags":["continuity"]');
  });

  it("governs published runtime memory through the shared Host API", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.endsWith("/v1/memory/publications/memory-1/demote")) {
        return jsonResponse({
          schemaId: "director.host.memory-publication-governance.v1",
          action: "demote",
          recordId: "memory-1",
          result: {
            status: "ok",
            recordId: "memory-1",
            governanceStatus: "demoted",
          },
          text: "已降权记忆：memory-1，当前状态：demoted",
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    };

    const result = await governDirectorMemoryPublication(
      {
        hostApiUrl: "http://127.0.0.1:3201",
        hostId: "personal-weixin",
        agentId: "director",
        channel: "personal-weixin",
        autoAdvance: true,
        autoStartRun: true,
        fetchFn,
      },
      {
        recordId: "memory-1",
        action: "demote",
        actor: "director-weixin-gateway",
        note: "来源有用但置信度偏低",
      },
    );

    expect(result).toMatchObject({
      schemaId: "director.host.memory-publication-governance.v1",
      action: "demote",
      recordId: "memory-1",
      result: {
        status: "ok",
        governanceStatus: "demoted",
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        actor: "director-weixin-gateway",
        note: "来源有用但置信度偏低",
      }),
    });
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/v1/memory/publications/memory-1/demote");
  });

  it("reads and invokes external tools through the shared Host API tool control plane", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.includes("/v1/tools/effective")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.effective.v1",
          agentId: "director",
          sessionKey: "weixin:bot:friend",
          profile: "weixin",
          effectiveCount: 1,
          unavailableCount: 0,
          groups: [],
          tools: [
            {
              id: "browser_navigate",
              canInvoke: true,
              metadata: { modelToolName: "browser_navigate" },
            },
          ],
        });
      }
      if (url.endsWith("/v1/tools/invoke")) {
        return jsonResponse({
          schemaVersion: "director.external-tools.invoke.v1",
          ok: true,
          toolName: "browser_navigate",
          toolId: "browser_navigate",
          operationId: "browser.navigate",
          status: "success",
          content: "status: success\nsummary: Navigated.",
          output: { title: "Example" },
          trace: [],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    };
    const options = {
      hostApiUrl: "http://127.0.0.1:3201",
      hostId: "personal-weixin",
      agentId: "director",
      channel: "personal-weixin",
      autoAdvance: true,
      autoStartRun: true,
      fetchFn,
    };

    const effective = await readDirectorToolsEffective(options, {
      agentId: "director",
      sessionKey: "weixin:bot:friend",
      profile: "weixin",
      includeUnavailable: true,
    });
    const invoked = await invokeDirectorTool(options, {
      toolId: "browser_navigate",
      operationId: "browser.navigate",
      args: { url: "https://example.test" },
    });

    expect(effective.tools[0]?.id).toBe("browser_navigate");
    expect(invoked).toMatchObject({ ok: true, toolId: "browser_navigate" });
    expect(calls.map((call) => `${call.method ?? "GET"}:${new URL(call.url).pathname}`)).toEqual([
      "GET:/v1/tools/effective",
      "POST:/v1/tools/invoke",
    ]);
    expect(calls[0]?.url).toContain("sessionKey=weixin%3Abot%3Afriend");
    expect(calls[1]?.body).toContain('"toolId":"browser_navigate"');
  });

  it("keeps internal continuity review guidance out of gateway replies", () => {
    const reply = formatDirectorGatewayReply({
      intake: {
        session: {
          entrySessionId: "entry-1",
          state: "ready_for_run",
          nextAction: "run",
        },
        turn: {
          summary:
            "现在去搜索微信公众号的文章，找一下有没有新seedance2.0最新的文章学习这方面的制作经验",
        },
        intake: {
          alignmentLock: {
            objective:
              "现在去搜索微信公众号的文章，找一下有没有新seedance2.0最新的文章学习这方面的制作经验 needs operator review before execution handoff.",
            notes: [],
          },
        },
      },
      blueprint: {
        session: {
          entrySessionId: "entry-1",
          state: "ready_for_run",
          nextAction: "run",
        },
        blueprint: {
          review: {
            requiredFixes: [
              "Add at least one anchor so the director can preserve continuity.",
              "Review recalled run 5609a138-e428-4161-a6cb-f9bbcac82e3d before changing continuity-sensitive decisions.",
              "Review published knowledge pack director-experience-experience-learning-sources-1f0eb6f070e1 before changing continuity-sensitive decisions.",
              "Operator approval is required before execution handoff can continue.",
            ],
          },
          preview: {
            warnings: [
              "Matched 3 approved Skill(s): external.hermes-agent.skills.research.llm-wiki.",
            ],
          },
        },
      },
    });

    expect(reply).toContain("制作入口已记录：现在去搜索微信公众号");
    expect(reply).toContain("缺少连续性锚点");
    expect(reply).not.toContain("needs operator review");
    expect(reply).not.toContain("Review recalled run");
    expect(reply).not.toContain("Review published knowledge pack");
    expect(reply).not.toContain("Matched 3 approved Skill");
    expect(reply).not.toContain("5609a138");
    expect(reply).not.toContain("director-experience");
  });
});
