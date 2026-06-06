import { describe, expect, it } from "vitest";

import type {
  ConversationRuntimeModelToolCall,
  ConversationRuntimeToolExecutionOutput,
} from "../src/model-tool-loop.js";
import {
  createConversationRuntimeToolLoopDetector,
  runConversationRuntimeToolHookPipelineAfterCall,
  runConversationRuntimeToolHookPipelineBeforeCall,
  runConversationRuntimeToolHookPipelinePersistResult,
} from "../src/tool-hooks.js";

describe("conversation runtime tool hook pipeline", () => {
  it("runs before-call hooks in order and lets explicit modifications flow forward", async () => {
    const seenBySecondHook: unknown[] = [];
    const call = createToolCall({ url: "https://example.com/a" });

    const result = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-hooks-1",
      sessionKey: "session-hooks",
      call,
      hooks: [
        {
          name: "learning-budget",
          beforeCall: ({ call }) => ({
            status: "modify",
            reason: "cap text extraction for this turn",
            call: {
              ...call,
              args: { ...call.args, maxChars: 12_000 },
            },
          }),
        },
        {
          name: "audit-visible-args",
          beforeCall: ({ call }) => {
            seenBySecondHook.push(call.args.maxChars);
            return { status: "allow", reason: "modified args visible" };
          },
        },
      ],
    });

    expect(result.status).toBe("allowed");
    expect(result.call.args).toMatchObject({ maxChars: 12_000 });
    expect(seenBySecondHook).toEqual([12_000]);
    expect(result.trace).toEqual([
      expect.objectContaining({
        phase: "beforeCall",
        hookName: "learning-budget",
        status: "modify",
      }),
      expect.objectContaining({
        phase: "beforeCall",
        hookName: "audit-visible-args",
        status: "allow",
      }),
    ]);
  });

  it("stops before-call hooks when a hook denies the tool call", async () => {
    const calls: string[] = [];

    const result = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-hooks-deny",
      sessionKey: "session-hooks",
      call: createToolCall({ url: "https://blocked.example.com" }),
      hooks: [
        {
          name: "domain-policy",
          beforeCall: () => {
            calls.push("domain-policy");
            return { status: "deny", reason: "domain outside authorized scope" };
          },
        },
        {
          name: "must-not-run",
          beforeCall: () => {
            calls.push("must-not-run");
            return { status: "allow" };
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: "denied",
      deniedBy: "domain-policy",
      reason: "domain outside authorized scope",
    });
    expect(calls).toEqual(["domain-policy"]);
    expect(result.trace).toEqual([
      expect.objectContaining({
        phase: "beforeCall",
        hookName: "domain-policy",
        status: "deny",
      }),
    ]);
  });

  it("denies repeated identical tool calls after the configured loop threshold", async () => {
    const detector = createConversationRuntimeToolLoopDetector({
      name: "repeat-web-extract",
      maxRepeats: 2,
    });
    const call = createToolCall({ url: "https://example.com/repeat" });

    const first = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-loop",
      sessionKey: "session-hooks",
      call,
      hooks: [detector],
    });
    const second = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-loop",
      sessionKey: "session-hooks",
      call,
      hooks: [detector],
    });
    const third = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-loop",
      sessionKey: "session-hooks",
      call,
      hooks: [detector],
    });

    expect(first.status).toBe("allowed");
    expect(second.status).toBe("allowed");
    expect(third).toMatchObject({
      status: "denied",
      deniedBy: "repeat-web-extract",
      reason: "tool-loop-threshold-exceeded",
    });
  });

  it("lets after-call hooks normalize tool results before persistence hooks request audit", async () => {
    const result = await runConversationRuntimeToolHookPipelineAfterCall({
      turnId: "turn-after",
      sessionKey: "session-hooks",
      call: createToolCall({ url: "https://example.com/result" }),
      result: createToolResult({ content: "raw observation" }),
      hooks: [
        {
          name: "trim-observation",
          afterCall: ({ result }) => ({
            status: "modify",
            reason: "trim visible result",
            result: { ...result, content: "normalized observation" },
          }),
        },
      ],
    });

    const persist = await runConversationRuntimeToolHookPipelinePersistResult({
      turnId: "turn-after",
      sessionKey: "session-hooks",
      call: createToolCall({ url: "https://example.com/result" }),
      result: result.result,
      hooks: [
        {
          name: "approval-ledger-audit",
          persistResult: ({ result }) => ({
            status: "modify",
            reason: "auto-approved tools must be auditable",
            requiresAudit: true,
            result: {
              ...result,
              metadata: {
                ...result.metadata,
                auditRequiredBy: "approval-ledger-audit",
              },
            },
          }),
        },
      ],
    });

    expect(result.status).toBe("allowed");
    expect(result.result.content).toBe("normalized observation");
    expect(persist.status).toBe("allowed");
    expect(persist.requiresAudit).toBe(true);
    expect(persist.result.metadata).toMatchObject({
      auditRequiredBy: "approval-ledger-audit",
    });
  });
});

function createToolCall(args: Readonly<Record<string, unknown>>): ConversationRuntimeModelToolCall {
  return {
    id: "call-1",
    name: "web_extract",
    args,
    readOnly: true,
  };
}

function createToolResult(input: {
  readonly content: string;
}): ConversationRuntimeToolExecutionOutput {
  return {
    callId: "call-1",
    toolName: "web_extract",
    ok: true,
    content: input.content,
  };
}
