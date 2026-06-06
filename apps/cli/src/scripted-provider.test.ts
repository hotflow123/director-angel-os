import { describe, expect, test } from "vitest";

import { ScriptedGoldenPathProvider } from "./scripted-provider.js";

describe("ScriptedGoldenPathProvider", () => {
  test("requests file read as first tool call", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [{ role: "user", content: "Read /tmp/README.md and summarize it." }],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls?.[0]?.name).toBe("filesystem.read_text");
  });

  test("supports non-markdown file paths", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [{ role: "user", content: "Read /tmp/project/package.json and summarize it." }],
    });

    const toolCall = result.toolCalls?.[0];
    expect(toolCall?.name).toBe("filesystem.read_text");
    expect(toolCall?.argumentsJson).toContain("/tmp/project/package.json");
  });

  test("requests todo write after file read", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [
        {
          role: "assistant",
          content: "Tool: filesystem.read_text\nAgent OS repository details...",
        },
      ],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls?.[0]?.name).toBe("tasks.todo_write");
  });

  test("requests todo write after structured filesystem tool result", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [
        {
          role: "assistant",
          content: "I need to inspect the file first.",
          toolCalls: [
            {
              id: "read_text_1",
              name: "filesystem.read_text",
              argumentsJson: '{"path":"/tmp/README.md"}',
            },
          ],
        },
        {
          role: "tool",
          name: "filesystem.read_text",
          toolCallId: "read_text_1",
          content: '{"ok":true,"resolution":"executed","output":"Agent OS repository details..."}',
        },
      ],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls?.[0]?.name).toBe("tasks.todo_write");
  });

  test("completes with stop after todo write", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [{ role: "assistant", content: "Tool: tasks.todo_write persisted." }],
    });

    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toBeUndefined();
    expect(result.text).toContain("Todo list has been persisted");
  });

  test("completes with stop after structured todo write tool result", async () => {
    const provider = new ScriptedGoldenPathProvider();
    const result = await provider.generate({
      model: "hotflow-phase1",
      messages: [
        {
          role: "assistant",
          content: "I will persist the todo list now.",
          toolCalls: [
            {
              id: "todo_write_1",
              name: "tasks.todo_write",
              argumentsJson: '{"items":[]}',
            },
          ],
        },
        {
          role: "tool",
          name: "tasks.todo_write",
          toolCallId: "todo_write_1",
          content: '{"ok":true,"resolution":"executed","output":{"items":[]}}',
        },
      ],
    });

    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toBeUndefined();
    expect(result.text).toContain("Todo list has been persisted");
  });
});
