import { describe, expect, it } from "vitest";

import {
  type ConversationRuntimeToolExecutionInput,
  type ConversationRuntimeToolExecutionOutput,
  orchestrateConversationRuntimeUrlLearningRead,
} from "../src/index.js";

function toolResult(input: {
  readonly callId: string;
  readonly toolName: string;
  readonly ok: boolean;
  readonly output: Readonly<Record<string, unknown>>;
  readonly error?: string;
}): ConversationRuntimeToolExecutionOutput {
  return {
    callId: input.callId,
    toolName: input.toolName,
    ok: input.ok,
    content: JSON.stringify(input.output),
    output: input.output,
    ...(input.error === undefined ? {} : { error: input.error }),
  };
}

describe("URL learning read orchestrator", () => {
  it("uses read-only OpenCLI before web extraction for X status learning URLs", async () => {
    const calls: Array<{
      readonly name: string;
      readonly args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await orchestrateConversationRuntimeUrlLearningRead({
      url: "https://x.com/MrLarus/status/2058431541655572649?s=46",
      turnId: "turn-x-learning",
      sessionKey: "session-x-learning",
      userText: "学习这个 https://x.com/MrLarus/status/2058431541655572649?s=46",
      executeTool: async (input: ConversationRuntimeToolExecutionInput) => {
        calls.push({ name: input.call.name, args: input.call.args });
        if (
          input.call.name === "director.opencli.invoke" &&
          input.call.args.operationId === "opencli.twitter.article"
        ) {
          return toolResult({
            callId: input.call.id,
            toolName: input.call.name,
            ok: false,
            output: {
              status: "error",
              summary: "当前 OpenCLI 没有这个命令：opencli.twitter.article",
              failures: ["当前 OpenCLI 没有这个命令：opencli.twitter.article"],
            },
            error: "opencli-command-not-found",
          });
        }
        return toolResult({
          callId: input.call.id,
          toolName: input.call.name,
          ok: true,
          output: {
            status: "success",
            url: "https://x.com/MrLarus/status/2058431541655572649",
            title: "餐饮异形展架/立牌",
            body: "用 ChatGPT-Image2 生成餐饮异形展架/立牌，不同风格大标题、主推菜、卖点标签可以一次性直出。",
          },
        });
      },
    });

    expect(calls.map((call) => call.name)).toEqual([
      "director.opencli.invoke",
      "director.opencli.invoke",
    ]);
    expect(calls.map((call) => call.args.operationId)).toEqual([
      "opencli.twitter.article",
      "opencli.twitter.thread",
    ]);
    expect(result.status).toBe("trusted");
    expect(result.source?.via).toBe("opencli");
    expect(result.source?.body).toContain("餐饮异形展架");
  });

  it("blocks OpenCLI X reads when the returned body is an access shell", async () => {
    const result = await orchestrateConversationRuntimeUrlLearningRead({
      url: "https://x.com/MrLarus/status/2058431541655572649",
      turnId: "turn-x-login-shell",
      sessionKey: "session-x-login-shell",
      userText: "学习这个 X 链接",
      executeTool: async (input: ConversationRuntimeToolExecutionInput) =>
        toolResult({
          callId: input.call.id,
          toolName: input.call.name,
          ok: true,
          output: {
            status: "success",
            url: "https://x.com/i/flow/login",
            title: "登录 X",
            body: "X 的新用户？立即注册。使用 Google 账号注册。使用 Apple 注册。登录后查看更多内容。",
          },
        }),
    });

    expect(result.status).toBe("blocked");
    expect(result.source).toBeUndefined();
    expect(result.failures.join("\n")).toContain("low-quality extracted content");
  });

  it("reroutes blocked WeChat extracts through browser navigate and snapshot", async () => {
    const calls: Array<{
      readonly name: string;
      readonly args: Readonly<Record<string, unknown>>;
    }> = [];
    const result = await orchestrateConversationRuntimeUrlLearningRead({
      url: "https://mp.weixin.qq.com/s/example",
      turnId: "turn-url-learning",
      sessionKey: "session-url-learning",
      userText: "学习这个链接 https://mp.weixin.qq.com/s/example",
      executeTool: async (input: ConversationRuntimeToolExecutionInput) => {
        calls.push({ name: input.call.name, args: input.call.args });
        if (input.call.name === "web_extract") {
          return toolResult({
            callId: input.call.id,
            toolName: input.call.name,
            ok: false,
            output: {
              status: "blocked",
              url: "https://mp.weixin.qq.com/s/example",
              title: "环境异常",
              body: "当前环境异常，完成验证后即可继续访问。视频 小程序 赞 在看",
              text_preview: "当前环境异常，完成验证后即可继续访问。视频 小程序 赞 在看",
              quality: { status: "blocked", publishable: false },
              failures: ["low-quality extracted content"],
              candidate_count: 0,
              next_actions: ["retry with browser_navigate profile=angel and browser_snapshot"],
            },
            error: "low-quality extracted content",
          });
        }
        if (input.call.name === "browser_navigate") {
          return toolResult({
            callId: input.call.id,
            toolName: input.call.name,
            ok: true,
            output: {
              status: "success",
              url: "https://mp.weixin.qq.com/s/example",
              title: "文章标题",
            },
          });
        }
        return toolResult({
          callId: input.call.id,
          toolName: input.call.name,
          ok: true,
          output: {
            status: "success",
            url: "https://mp.weixin.qq.com/s/example",
            title: "文章标题",
            text: `${"这是一篇关于导演经验的长文章。".repeat(20)}它详细拆解了镜头调度、人物动机、节奏设计和分镜执行的完整方法。`,
          },
        });
      },
    });

    expect(calls.map((call) => call.name)).toEqual([
      "web_extract",
      "browser_navigate",
      "browser_snapshot",
    ]);
    expect(calls[1]?.args).toMatchObject({ profile: "angel" });
    expect(calls[2]?.args).toMatchObject({
      full: true,
      mode: "readable",
      compact: true,
      refs: true,
      urls: true,
    });
    expect(result.status).toBe("trusted");
    expect(result.source?.via).toBe("browser_snapshot");
    expect(result.source?.body).toContain("镜头调度");
  });

  it("fails closed when browser fallback is still verification or button residue", async () => {
    const result = await orchestrateConversationRuntimeUrlLearningRead({
      url: "https://mp.weixin.qq.com/s/blocked",
      turnId: "turn-blocked",
      sessionKey: "session-blocked",
      executeTool: async (input: ConversationRuntimeToolExecutionInput) => {
        if (input.call.name === "web_extract") {
          return toolResult({
            callId: input.call.id,
            toolName: input.call.name,
            ok: false,
            output: {
              status: "blocked",
              url: "https://mp.weixin.qq.com/s/blocked",
              title: "环境异常",
              text_preview: "当前环境异常，完成验证后即可继续访问。视频 小程序 赞 在看",
              quality: { status: "blocked", publishable: false },
              failures: ["low-quality extracted content"],
              candidate_count: 0,
            },
            error: "low-quality extracted content",
          });
        }
        if (input.call.name === "browser_navigate") {
          return toolResult({
            callId: input.call.id,
            toolName: input.call.name,
            ok: true,
            output: { status: "success", url: "https://mp.weixin.qq.com/s/blocked" },
          });
        }
        return toolResult({
          callId: input.call.id,
          toolName: input.call.name,
          ok: true,
          output: {
            status: "success",
            url: "https://mp.weixin.qq.com/s/blocked",
            title: "微信公众平台",
            text: "当前环境异常，完成验证后即可继续访问。视频 小程序 赞 ，轻点两下取消赞 在看 ，轻点两下取消在看",
          },
        });
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.candidateCount).toBe(0);
    expect(result.source).toBeUndefined();
    expect(result.failures.join("\n")).toContain("verification, login, or UI residue");
  });

  it("fails closed without browser fallback instead of pretending the URL was learned", async () => {
    const result = await orchestrateConversationRuntimeUrlLearningRead({
      url: "https://mp.weixin.qq.com/s/no-browser",
      turnId: "turn-no-browser",
      sessionKey: "session-no-browser",
      browserFallback: false,
      executeTool: async (input: ConversationRuntimeToolExecutionInput) =>
        toolResult({
          callId: input.call.id,
          toolName: input.call.name,
          ok: false,
          output: {
            status: "blocked",
            url: "https://mp.weixin.qq.com/s/no-browser",
            title: "环境异常",
            text_preview: "当前环境异常，完成验证后即可继续访问。",
            quality: { status: "blocked", publishable: false },
            failures: ["low-quality extracted content"],
            candidate_count: 0,
          },
          error: "low-quality extracted content",
        }),
    });

    expect(result.status).toBe("blocked");
    expect(result.candidateCount).toBe(0);
    expect(result.source).toBeUndefined();
    expect(result.attempts.map((attempt) => attempt.toolName)).toEqual(["web_extract"]);
    expect(result.nextActions.join("\n")).toContain("interactive browser automation");
  });
});
