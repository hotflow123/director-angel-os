import type { TaskItem } from "@hotflow/contracts";
import { PolicyRuntime, decision, staticRule } from "@hotflow/policy-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  ToolDispatcher,
  ToolInputValidationError,
  ToolRegistry,
  createTasksTodoWriteTool,
  defineToolInputSchema,
} from "../src/index.js";

function createDeferredSignal() {
  let resolveSignal: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });

  return {
    promise,
    resolve() {
      resolveSignal?.();
    },
  };
}

async function flushDispatchQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ToolDispatcher", () => {
  it("dispatches registered tools", async () => {
    const registry = new ToolRegistry();
    registry.register(
      createTasksTodoWriteTool({
        async write(items) {
          return {
            items,
          };
        },
      }),
    );

    const dispatcher = new ToolDispatcher(registry);
    const result = await dispatcher.dispatch(
      {
        id: "call_1",
        name: "tasks.todo_write",
        args: {
          items: [{ id: "t1", content: "one", status: "todo" }],
        },
      },
      { sessionId: "session_1", turnId: "turn_1" },
    );

    expect(result.ok).toBe(true);
    expect(result.resolution).toBe("executed");
    expect(result.output).toMatchObject({
      items: [{ id: "t1", content: "one", status: "todo" }],
    });
  });

  it("returns denied result when policy blocks a tool call", async () => {
    const registry = new ToolRegistry();
    const write = vi.fn(async (items: TaskItem[]) => ({ items }));
    registry.register(
      createTasksTodoWriteTool({
        write,
      }),
    );

    const policy = new PolicyRuntime({
      executionPolicy: {
        blockedCapabilities: ["tasks.write"],
        denyByDefault: false,
      },
    });

    const dispatcher = new ToolDispatcher(registry, {
      policy,
    });

    const result = await dispatcher.dispatch(
      {
        id: "call_2",
        name: "tasks.todo_write",
        args: {
          items: [{ id: "t1", content: "one", status: "todo" }],
        },
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("denied");
    expect(result.error).toContain("blocked");
    expect(result.policyDecision?.verdict).toBe("deny");
    expect(write).not.toHaveBeenCalled();
  });

  it("blocks high-risk tools until approval exists", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      toolCallId: "call_sensitive",
      toolName: "shell.exec",
      ok: true,
      output: "done",
    }));
    registry.register({
      name: "shell.exec",
      description: "run shell command",
      timeoutMs: 2_000,
      readOnly: false,
      capabilities: ["shell.exec"],
      riskLevel: "high",
      requiresApproval: true,
      execute,
    });

    const dispatcher = new ToolDispatcher(registry);

    const blocked = await dispatcher.dispatch(
      {
        id: "call_sensitive",
        name: "shell.exec",
        args: { cmd: "echo hi" },
      },
      { sessionId: "session_1" },
    );

    const approved = await dispatcher.dispatch(
      {
        id: "call_sensitive_approved",
        name: "shell.exec",
        args: { cmd: "echo hi" },
      },
      {
        sessionId: "session_1",
        approval: {
          status: "approved",
          approver: "human-review",
        },
      },
    );

    expect(blocked.ok).toBe(false);
    expect(blocked.resolution).toBe("approval_required");
    expect(blocked.policyDecision?.verdict).toBe("ask");
    expect(approved.ok).toBe(true);
    expect(approved.resolution).toBe("executed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns degraded result from policy runtime without executing tool", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      toolCallId: "call_5",
      toolName: "web.fetch",
      ok: true,
      output: "payload",
    }));
    registry.register({
      name: "web.fetch",
      description: "fetch content",
      timeoutMs: 3_000,
      readOnly: true,
      capabilities: ["network.fetch"],
      riskLevel: "medium",
      execute,
    });

    const policy = new PolicyRuntime({
      defaultDecision: decision.allow("allow by default"),
      rules: [
        staticRule(
          "degrade-network",
          (input) => input.resource === "web.fetch",
          decision.degrade("network degraded", ["network.fetch"]),
        ),
      ],
    });

    const dispatcher = new ToolDispatcher(registry, { policy });
    const result = await dispatcher.dispatch(
      {
        id: "call_5",
        name: "web.fetch",
        args: { url: "https://example.com" },
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("degraded");
    expect(result.degradation?.stage).toBe("policy");
    expect(result.policyDecision?.verdict).toBe("degrade");
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails invalid tool input before availability, policy, and execution", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      toolCallId: "call_validate",
      toolName: "test.validate",
      ok: true,
      output: "ok",
    }));
    const checkFn = vi.fn(() => true);
    registry.register({
      name: "test.validate",
      description: "validates input",
      timeoutMs: 100,
      readOnly: true,
      inputSchema: defineToolInputSchema<{ value: string }>((input) => {
        if (
          typeof input !== "object" ||
          input === null ||
          Array.isArray(input) ||
          typeof (input as { value?: unknown }).value !== "string"
        ) {
          throw new ToolInputValidationError("Expected args.value to be a string.");
        }

        return { value: (input as { value: string }).value };
      }),
      capabilities: ["test.validate"],
      riskLevel: "low",
      checkFn,
      execute,
    });

    const auditSink = vi.fn();
    const onError = vi.fn();
    const policy = new PolicyRuntime({
      defaultDecision: decision.allow("allow by default"),
    });
    const dispatcher = new ToolDispatcher(registry, {
      policy,
      auditSink,
      hooks: {
        onError,
      },
    });

    const result = await dispatcher.dispatch(
      {
        id: "call_validate",
        name: "test.validate",
        args: { value: 42 },
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("failed");
    expect(result.error).toBe(
      'Tool "test.validate" input validation failed: Expected args.value to be a string.',
    );
    expect(result.metadata).toMatchObject({
      validationError: "Expected args.value to be a string.",
    });
    expect(result.policyDecision).toBeUndefined();
    expect(checkFn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe("validation");
    expect(String(onError.mock.calls[0]?.[3])).toContain("Expected args.value to be a string");

    const kinds = auditSink.mock.calls.map((call) => call[0]?.kind);
    expect(kinds).toEqual(["tool.dispatch.started", "tool.dispatch.failed"]);
  });

  it("validates builtin tasks.todo_write args before calling the port", async () => {
    const registry = new ToolRegistry();
    const write = vi.fn(async (items: TaskItem[]) => ({ items }));
    registry.register(
      createTasksTodoWriteTool({
        write,
      }),
    );

    const dispatcher = new ToolDispatcher(registry);
    const result = await dispatcher.dispatch(
      {
        id: "call_invalid_todo_write",
        name: "tasks.todo_write",
        args: {
          items: [{ id: "t1", status: "todo" }],
        },
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("failed");
    expect(result.error).toContain("args.items[0].content");
    expect(write).not.toHaveBeenCalled();
  });

  it("returns missing result when required environment variables are absent", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      toolCallId: "call_env_required",
      toolName: "test.requires-env",
      ok: true,
      output: "ok",
    }));
    registry.register({
      name: "test.requires-env",
      description: "requires runtime env",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.requires-env"],
      riskLevel: "low",
      requiresEnv: ["HOTFLOW_TEST_REQUIRED_TOKEN"],
      execute,
    });

    const previousValue = process.env.HOTFLOW_TEST_REQUIRED_TOKEN;
    Reflect.deleteProperty(process.env, "HOTFLOW_TEST_REQUIRED_TOKEN");

    try {
      const dispatcher = new ToolDispatcher(registry);
      const result = await dispatcher.dispatch(
        {
          id: "call_env_required",
          name: "test.requires-env",
          args: {},
        },
        { sessionId: "session_1" },
      );

      expect(result.ok).toBe(false);
      expect(result.resolution).toBe("missing");
      expect(result.error).toBe(
        'Tool "test.requires-env" is unavailable because required environment variables are missing: HOTFLOW_TEST_REQUIRED_TOKEN.',
      );
      expect(result.metadata).toMatchObject({
        availabilityReason: "missing_required_env",
        missingEnvVars: ["HOTFLOW_TEST_REQUIRED_TOKEN"],
      });
      expect(result.policyDecision).toBeUndefined();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      if (previousValue === undefined) {
        Reflect.deleteProperty(process.env, "HOTFLOW_TEST_REQUIRED_TOKEN");
      } else {
        process.env.HOTFLOW_TEST_REQUIRED_TOKEN = previousValue;
      }
    }
  });

  it("returns missing result when availability check reports unavailable", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      toolCallId: "call_check_false",
      toolName: "test.check-false",
      ok: true,
      output: "ok",
    }));
    const checkFn = vi.fn(() => false);
    registry.register({
      name: "test.check-false",
      description: "blocked by availability check",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.check-false"],
      riskLevel: "low",
      checkFn,
      execute,
    });

    const dispatcher = new ToolDispatcher(registry);
    const result = await dispatcher.dispatch(
      {
        id: "call_check_false",
        name: "test.check-false",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("missing");
    expect(result.error).toBe(
      'Tool "test.check-false" is unavailable because its availability check returned false.',
    );
    expect(result.metadata).toMatchObject({
      availabilityReason: "check_unavailable",
    });
    expect(result.policyDecision).toBeUndefined();
    expect(checkFn).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails safely when availability check throws", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      toolCallId: "call_check_error",
      toolName: "test.check-error",
      ok: true,
      output: "ok",
    }));
    const checkFn = vi.fn(() => {
      throw new Error("probe exploded");
    });
    registry.register({
      name: "test.check-error",
      description: "availability check throws",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.check-error"],
      riskLevel: "low",
      checkFn,
      execute,
    });

    const auditSink = vi.fn();
    const onError = vi.fn();
    const dispatcher = new ToolDispatcher(registry, {
      auditSink,
      hooks: {
        onError,
      },
    });

    const result = await dispatcher.dispatch(
      {
        id: "call_check_error",
        name: "test.check-error",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("failed");
    expect(result.error).toBe('Tool "test.check-error" availability check failed: probe exploded');
    expect(result.metadata).toMatchObject({
      availabilityReason: "check_error",
      availabilityError: "probe exploded",
    });
    expect(checkFn).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe("availability");
    expect(String(onError.mock.calls[0]?.[3])).toContain("probe exploded");

    const kinds = auditSink.mock.calls.map((call) => call[0]?.kind);
    expect(kinds).toEqual(["tool.dispatch.started", "tool.dispatch.failed"]);
  });

  it("emits audit events for dispatch lifecycle", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.audit",
      description: "audit test tool",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.audit"],
      riskLevel: "low",
      async execute() {
        return {
          toolCallId: "call_audit",
          toolName: "test.audit",
          ok: true,
          output: "ok",
        };
      },
    });

    const auditSink = vi.fn();
    const dispatcher = new ToolDispatcher(registry, { auditSink });
    const result = await dispatcher.dispatch(
      {
        id: "call_audit",
        name: "test.audit",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(true);
    const kinds = auditSink.mock.calls.map((call) => call[0]?.kind);
    expect(kinds).toEqual([
      "tool.dispatch.started",
      "tool.dispatch.policy_decision",
      "tool.dispatch.completed",
    ]);
  });

  it("owns tool journal closure when a journal sink is configured", async () => {
    const registry = new ToolRegistry();
    const trace: string[] = [];
    registry.register({
      name: "test.journal",
      description: "journal closure test tool",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.journal"],
      riskLevel: "low",
      async execute() {
        trace.push("execute");
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: { ok: true },
          resolution: "executed",
        };
      },
    });

    const journalSink = vi.fn((event) => {
      trace.push(`journal:${event.eventType}`);
    });
    const dispatcher = new ToolDispatcher(registry, { journalSink });
    const result = await dispatcher.dispatch(
      {
        id: "call_journal",
        name: "test.journal",
        args: { topic: "runtime" },
      },
      { sessionId: "session_1", turnId: "turn_1" },
    );

    expect(dispatcher.managesJournalClosure).toBe(true);
    expect(result.ok).toBe(true);
    expect(trace).toEqual(["journal:tool.call_planned", "execute", "journal:tool.result"]);
    expect(journalSink.mock.calls.map((call) => call[0]?.eventType)).toEqual([
      "tool.call_planned",
      "tool.result",
    ]);
    expect(journalSink.mock.calls[0]?.[0]?.payload).toMatchObject({
      toolCallId: "call_journal",
      toolName: "test.journal",
      args: { topic: "runtime" },
    });
    expect(journalSink.mock.calls[1]?.[0]?.payload).toMatchObject({
      toolCallId: "call_journal",
      toolName: "test.journal",
      ok: true,
      output: { ok: true },
      resolution: "executed",
    });
  });

  it("records a tool.result journal closure even when validation fails before execution", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({
      toolCallId: "ignored",
      toolName: "ignored",
      ok: true,
      output: "ok",
    }));
    registry.register({
      name: "test.validation-journal",
      description: "validation journal boundary",
      timeoutMs: 100,
      readOnly: true,
      inputSchema: defineToolInputSchema<{ value: string }>((input) => {
        if (
          typeof input !== "object" ||
          input === null ||
          Array.isArray(input) ||
          typeof (input as { value?: unknown }).value !== "string"
        ) {
          throw new ToolInputValidationError("Expected args.value to be a string.");
        }

        return { value: (input as { value: string }).value };
      }),
      capabilities: ["test.validation-journal"],
      riskLevel: "low",
      execute,
    });

    const journalSink = vi.fn();
    const dispatcher = new ToolDispatcher(registry, { journalSink });
    const result = await dispatcher.dispatch(
      {
        id: "call_validation_journal",
        name: "test.validation-journal",
        args: { value: 42 },
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
    expect(journalSink.mock.calls.map((call) => call[0]?.eventType)).toEqual(["tool.result"]);
    expect(journalSink.mock.calls[0]?.[0]?.payload).toMatchObject({
      toolCallId: "call_validation_journal",
      toolName: "test.validation-journal",
      ok: false,
      error:
        'Tool "test.validation-journal" input validation failed: Expected args.value to be a string.',
      resolution: "failed",
    });
  });

  it("fails tools that exceed timeoutMs and preserves dispatch audit closure", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.timeout",
      description: "times out before producing a result",
      timeoutMs: 10,
      readOnly: true,
      capabilities: ["test.timeout"],
      riskLevel: "low",
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "late",
        };
      },
    });

    const auditSink = vi.fn();
    const afterDispatch = vi.fn();
    const onError = vi.fn();
    const dispatcher = new ToolDispatcher(registry, {
      auditSink,
      hooks: {
        afterDispatch,
        onError,
      },
    });

    const result = await dispatcher.dispatch(
      {
        id: "call_timeout",
        name: "test.timeout",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("failed");
    expect(result.error).toBe('Tool "test.timeout" timed out after 10ms.');
    expect(result.metadata).toMatchObject({ timeoutMs: 10 });
    expect(result.policyDecision?.verdict).toBe("allow");

    expect(afterDispatch).toHaveBeenCalledTimes(1);
    expect(afterDispatch.mock.calls[0]?.[2]).toMatchObject({
      toolCallId: "call_timeout",
      toolName: "test.timeout",
      ok: false,
      resolution: "failed",
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe("execute");
    expect(onError.mock.calls[0]?.[3]).toBeInstanceOf(Error);
    expect(String(onError.mock.calls[0]?.[3])).toContain("timed out after 10ms");

    const kinds = auditSink.mock.calls.map((call) => call[0]?.kind);
    expect(kinds).toEqual([
      "tool.dispatch.started",
      "tool.dispatch.policy_decision",
      "tool.dispatch.failed",
    ]);
  });

  it("converts tool exceptions into failed results", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.fail",
      description: "always fails",
      timeoutMs: 100,
      readOnly: false,
      capabilities: ["test.fail"],
      riskLevel: "medium",
      async execute() {
        throw new Error("boom");
      },
    });

    const dispatcher = new ToolDispatcher(registry);
    const result = await dispatcher.dispatch(
      {
        id: "call_3",
        name: "test.fail",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("failed");
    expect(result.error).toBe("boom");
  });

  it("normalizes missing resolution to failed when tool returns ok=false", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.soft-fail",
      description: "returns an error result without explicit resolution",
      timeoutMs: 100,
      readOnly: false,
      capabilities: ["test.soft-fail"],
      riskLevel: "medium",
      async execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: false,
          error: "validation failed",
        };
      },
    });

    const dispatcher = new ToolDispatcher(registry);
    const result = await dispatcher.dispatch(
      {
        id: "call_soft_fail",
        name: "test.soft-fail",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("failed");
    expect(result.error).toBe("validation failed");
  });

  it("normalizes missing resolution to degraded when tool returns degradation", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.degraded",
      description: "returns degraded surface without explicit resolution",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["test.degraded"],
      riskLevel: "low",
      async execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: false,
          degradation: {
            stage: "tool",
            category: "tool",
            action: "degrade",
            severity: "minor",
            reason: "fallback",
            message: "degraded mode",
            recoverable: true,
          },
        };
      },
    });

    const dispatcher = new ToolDispatcher(registry);
    const result = await dispatcher.dispatch(
      {
        id: "call_degraded",
        name: "test.degraded",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.resolution).toBe("degraded");
    expect(result.degradation?.stage).toBe("tool");
  });

  it("uses explicit resolution as source of truth for normalized execution status", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.explicit-resolution",
      description: "returns explicit non-executed resolution",
      timeoutMs: 100,
      readOnly: false,
      capabilities: ["test.explicit-resolution"],
      riskLevel: "medium",
      async execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          resolution: "failed",
          error: "explicitly failed",
        };
      },
    });

    const dispatcher = new ToolDispatcher(registry);
    const result = await dispatcher.dispatch(
      {
        id: "call_explicit_resolution",
        name: "test.explicit-resolution",
        args: {},
      },
      { sessionId: "session_1" },
    );

    expect(result.resolution).toBe("failed");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("explicitly failed");
  });

  it("dispatchMany runs contiguous read-only calls in parallel and keeps write barriers serial", async () => {
    const registry = new ToolRegistry();
    const started: string[] = [];
    const finished: string[] = [];
    const controlled = new Map<string, ReturnType<typeof createDeferredSignal>>();

    const registerControlledTool = (name: string, readOnly: boolean) => {
      registry.register({
        name,
        description: `${name} controlled tool`,
        timeoutMs: 1_000,
        readOnly,
        capabilities: [name],
        riskLevel: "low",
        async execute() {
          started.push(name);
          const signal = createDeferredSignal();
          controlled.set(name, signal);
          await signal.promise;
          finished.push(name);
          return {
            toolCallId: `result_${name}`,
            toolName: name,
            ok: true,
            output: name,
            resolution: "executed" as const,
          };
        },
      });
    };

    registerControlledTool("read.alpha", true);
    registerControlledTool("read.beta", true);
    registerControlledTool("write.gamma", false);
    registerControlledTool("read.delta", true);

    const dispatcher = new ToolDispatcher(registry);
    const pending = dispatcher.dispatchMany(
      [
        { id: "call_alpha", name: "read.alpha", args: {} },
        { id: "call_beta", name: "read.beta", args: {} },
        { id: "call_gamma", name: "write.gamma", args: {} },
        { id: "call_delta", name: "read.delta", args: {} },
      ],
      { sessionId: "session_1" },
      "ordered",
    );

    await flushDispatchQueue();
    expect(started).toEqual(["read.alpha", "read.beta"]);

    controlled.get("read.alpha")?.resolve();
    await flushDispatchQueue();
    expect(started).toEqual(["read.alpha", "read.beta"]);
    expect(finished).toEqual(["read.alpha"]);

    controlled.get("read.beta")?.resolve();
    await flushDispatchQueue();
    expect(started).toEqual(["read.alpha", "read.beta", "write.gamma"]);
    expect(finished).toEqual(["read.alpha", "read.beta"]);

    controlled.get("write.gamma")?.resolve();
    await flushDispatchQueue();
    expect(started).toEqual(["read.alpha", "read.beta", "write.gamma", "read.delta"]);
    expect(finished).toEqual(["read.alpha", "read.beta", "write.gamma"]);

    controlled.get("read.delta")?.resolve();
    const results = await pending;

    expect(results.map((result) => result.toolName)).toEqual([
      "read.alpha",
      "read.beta",
      "write.gamma",
      "read.delta",
    ]);
    expect(finished).toEqual(["read.alpha", "read.beta", "write.gamma", "read.delta"]);
  });

  it("dispatchMany keeps first-wins merge semantics after parallel read-only execution", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "read.fail",
      description: "read-only failure",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["read.fail"],
      riskLevel: "low",
      async execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: false,
          error: "miss",
          resolution: "failed" as const,
        };
      },
    });
    registry.register({
      name: "read.hit",
      description: "read-only success",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["read.hit"],
      riskLevel: "low",
      async execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "hit",
          resolution: "executed" as const,
        };
      },
    });

    const dispatcher = new ToolDispatcher(registry);
    const results = await dispatcher.dispatchMany(
      [
        { id: "call_fail", name: "read.fail", args: {} },
        { id: "call_hit", name: "read.hit", args: {} },
      ],
      { sessionId: "session_1" },
      "first-wins",
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      toolCallId: "call_hit",
      toolName: "read.hit",
      ok: true,
      resolution: "executed",
    });
  });

  it("dispatchMany keeps all-or-nothing merge semantics after parallel read-only execution", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "read.one",
      description: "read-only success",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["read.one"],
      riskLevel: "low",
      async execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: true,
          output: "one",
          resolution: "executed" as const,
        };
      },
    });
    registry.register({
      name: "read.two",
      description: "read-only failure",
      timeoutMs: 100,
      readOnly: true,
      capabilities: ["read.two"],
      riskLevel: "low",
      async execute() {
        return {
          toolCallId: "ignored",
          toolName: "ignored",
          ok: false,
          error: "boom",
          resolution: "failed" as const,
        };
      },
    });

    const dispatcher = new ToolDispatcher(registry);
    const results = await dispatcher.dispatchMany(
      [
        { id: "call_one", name: "read.one", args: {} },
        { id: "call_two", name: "read.two", args: {} },
      ],
      { sessionId: "session_1" },
      "all-or-nothing",
    );

    expect(results).toEqual([]);
  });
});
