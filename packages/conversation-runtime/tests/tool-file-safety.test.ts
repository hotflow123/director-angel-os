import { describe, expect, it } from "vitest";

import {
  createConversationRuntimeToolFileSafetyHook,
  runConversationRuntimeToolHookPipelineBeforeCall,
} from "../src/index.js";

describe("conversation runtime tool file safety", () => {
  it("denies local credential paths before a tool can execute", async () => {
    const result = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-file-safety",
      sessionKey: "session-file-safety",
      call: {
        id: "tool-file-1",
        name: "read_file",
        args: { path: "/Users/example/project/.env" },
      },
      hooks: [createConversationRuntimeToolFileSafetyHook()],
    });

    expect(result).toMatchObject({
      status: "denied",
      deniedBy: "tool-file-safety",
      reason: "tool-file-safety-denylist",
    });
    expect(result.trace[0]?.metadata).toMatchObject({
      ruleId: "env-file",
      matchedPath: "/Users/example/project/.env",
    });
  });

  it("denies nested ssh private key paths but allows public web URLs", async () => {
    const denied = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-file-safety-nested",
      sessionKey: "session-file-safety",
      call: {
        id: "tool-file-2",
        name: "batch_read",
        args: { files: ["README.md", "~/.ssh/id_ed25519"] },
      },
      hooks: [createConversationRuntimeToolFileSafetyHook()],
    });
    const allowed = await runConversationRuntimeToolHookPipelineBeforeCall({
      turnId: "turn-file-safety-url",
      sessionKey: "session-file-safety",
      call: {
        id: "tool-file-3",
        name: "web_extract",
        args: { url: "https://example.com/.env-not-a-local-file" },
        readOnly: true,
      },
      hooks: [createConversationRuntimeToolFileSafetyHook()],
    });

    expect(denied).toMatchObject({
      status: "denied",
      deniedBy: "tool-file-safety",
    });
    expect(denied.trace[0]?.metadata).toMatchObject({
      ruleId: "ssh-private-key",
      matchedPath: "~/.ssh/id_ed25519",
    });
    expect(allowed.status).toBe("allowed");
  });
});
