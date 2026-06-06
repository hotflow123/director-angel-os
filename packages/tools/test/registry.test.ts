import { describe, expect, it } from "vitest";

import { ToolRegistry } from "../src/index.js";

describe("ToolRegistry availability", () => {
  it("lists only tools whose env requirements and availability checks pass", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.available",
      description: "available tool",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.available"],
      riskLevel: "low",
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });
    registry.register({
      name: "test.needs-env",
      description: "requires env",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.needs-env"],
      riskLevel: "low",
      requiresEnv: ["HOTFLOW_REQUIRED_TOKEN"],
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });
    registry.register({
      name: "test.check-false",
      description: "check false",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.check-false"],
      riskLevel: "low",
      checkFn: () => false,
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });

    const available = registry.listAvailable({
      HOTFLOW_REQUIRED_TOKEN: "",
    });

    expect(available.map((tool) => tool.name)).toEqual(["test.available"]);
  });

  it("describes missing env and availability check errors without hiding the reason", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.needs-env",
      description: "requires env",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.needs-env"],
      riskLevel: "low",
      requiresEnv: ["HOTFLOW_REQUIRED_TOKEN"],
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });
    registry.register({
      name: "test.check-error",
      description: "check error",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.check-error"],
      riskLevel: "low",
      checkFn() {
        throw new Error("availability probe failed");
      },
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });

    const missingEnvAvailability = registry.getAvailability("test.needs-env", {
      HOTFLOW_REQUIRED_TOKEN: "",
    });
    const checkErrorAvailability = registry.getAvailability("test.check-error");

    expect(missingEnvAvailability).toMatchObject({
      available: false,
      reason: "missing_required_env",
      missingEnvVars: ["HOTFLOW_REQUIRED_TOKEN"],
    });
    expect(checkErrorAvailability).toMatchObject({
      available: false,
      reason: "check_error",
      error: "availability probe failed",
    });
  });

  it("groups registered tools into toolsets and exposes schema descriptors for available tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "filesystem.read_text",
      description: "read text",
      timeoutMs: 100,
      readOnly: true,
      schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
          },
        },
        required: ["path"],
      },
      toolset: "filesystem",
      toolsetDescription: "Workspace-scoped file reading tools.",
      toolsetEnabledByDefault: true,
      capabilities: ["filesystem.read"],
      riskLevel: "low",
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });
    registry.register({
      name: "tasks.todo_write",
      description: "write todos",
      timeoutMs: 100,
      readOnly: false,
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
          },
        },
        required: ["items"],
      },
      toolset: "tasks",
      toolsetDescription: "Task board mutation tools.",
      toolsetEnabledByDefault: true,
      capabilities: ["tasks.write"],
      riskLevel: "medium",
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });
    registry.register({
      name: "hidden.needs-env",
      description: "hidden schema",
      timeoutMs: 100,
      readOnly: true,
      schema: {
        type: "object",
      },
      toolset: "filesystem",
      requiresEnv: ["HIDDEN_TOKEN"],
      capabilities: ["hidden.needs-env"],
      riskLevel: "low",
      execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "ok",
        };
      },
    });

    expect(registry.listToolsets()).toEqual([
      {
        name: "filesystem",
        description: "Workspace-scoped file reading tools.",
        tools: ["filesystem.read_text", "hidden.needs-env"],
        enabledByDefault: true,
      },
      {
        name: "tasks",
        description: "Task board mutation tools.",
        tools: ["tasks.todo_write"],
        enabledByDefault: true,
      },
    ]);

    expect(registry.getSchemas("filesystem", { HIDDEN_TOKEN: "" })).toEqual([
      {
        name: "filesystem.read_text",
        description: "read text",
        toolset: "filesystem",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
            },
          },
          required: ["path"],
        },
      },
    ]);
    expect(registry.getSchemas({ HIDDEN_TOKEN: "" }).map((entry) => entry.name)).toEqual([
      "filesystem.read_text",
      "tasks.todo_write",
    ]);
  });
});
