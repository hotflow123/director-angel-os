import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createConversationRuntimeToolRedactionHook,
  createFileConversationRuntimeToolEvidenceStore,
  runConversationRuntimeModelToolLoop,
  runConversationRuntimeToolHookPipelinePersistResult,
} from "../src/index.js";

describe("conversation runtime tool redaction", () => {
  it("redacts secrets from tool results before evidence content is stored", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "angel-tool-redaction-"));
    const store = createFileConversationRuntimeToolEvidenceStore({
      rootPath,
      nowMs: () => 1_000,
    });

    const result = await runConversationRuntimeModelToolLoop({
      turnId: "turn-redaction-store",
      sessionKey: "session-redaction",
      messages: [{ role: "user", content: "读取并存证" }],
      tools: [{ name: "web_extract", description: "Extract web page", readOnly: true }],
      toolEvidenceStore: store,
      toolHooks: [createConversationRuntimeToolRedactionHook()],
      callModel: ({ messages }) => {
        if (messages.some((message) => message.role === "tool")) {
          return { finalText: "已读。" };
        }
        return {
          toolCalls: [
            {
              id: "tool-redaction-1",
              name: "web_extract",
              args: { url: "https://example.com/secret" },
              readOnly: true,
            },
          ],
        };
      },
      executeTool: ({ call }) => ({
        callId: call.id,
        toolName: call.name,
        ok: true,
        content:
          "Authorization: Bearer sk-live-secret-value\nclient_secret=director-secret\npassword=hunter2",
      }),
    });

    const evidenceId = result.memoryEvidenceRecords[0]?.id;
    expect(evidenceId).toBeDefined();
    const content = store.readToolResultEvidenceContent(evidenceId ?? "");
    expect(content?.content).toContain("[REDACTED:");
    expect(content?.content).not.toContain("sk-live-secret-value");
    expect(content?.content).not.toContain("director-secret");
    expect(content?.content).not.toContain("hunter2");
  });

  it("denies persistence when a redactor reports failure", async () => {
    const result = await runConversationRuntimeToolHookPipelinePersistResult({
      turnId: "turn-redaction-failed",
      sessionKey: "session-redaction",
      call: {
        id: "tool-redaction-failed-1",
        name: "web_extract",
        args: { url: "https://example.com" },
        readOnly: true,
      },
      result: {
        callId: "tool-redaction-failed-1",
        toolName: "web_extract",
        ok: true,
        content: "Bearer sk-live-secret-value",
      },
      hooks: [
        createConversationRuntimeToolRedactionHook({
          redactText: () => ({
            status: "failed",
            text: "",
            findings: [],
            reason: "redaction engine unavailable",
          }),
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "denied",
      deniedBy: "tool-redaction",
      reason: "tool-redaction-failed",
    });
  });
});
