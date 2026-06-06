import type { RuntimeDegradeSurface } from "@hotflow/contracts";

import type {
  AuditEvent,
  ContextSection,
  ExecutionPolicy,
  MemoryEntry,
  MemoryLike,
  MemoryRecallLike,
  ModelLike,
  ModelResponse,
  PolicyDecision,
  RecallBlock,
  SessionLike,
  SessionSnapshot,
  StreamEventRecord,
  ToolCall,
  ToolLike,
  ToolResult,
} from "./contracts.js";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutLabel: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(timeoutLabel));
    }, timeoutMs);

    operation
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function createReplayFingerprint(input: {
  readonly response: ModelResponse;
  readonly toolResults: readonly ToolResult[];
  readonly recallBlocks: readonly RecallBlock[];
  readonly contextSections: readonly ContextSection[];
  readonly degradations: readonly RuntimeDegradeSurface[];
  readonly auditEvents: readonly AuditEvent[];
  readonly streamEvents: readonly StreamEventRecord[];
  readonly recovery?: TurnRecoveryTrace;
  readonly status: TurnStatusSnapshot;
  readonly session: SessionSnapshot;
}): string {
  return JSON.stringify({
    output: input.response.output,
    tools: input.toolResults.map((result) => ({
      name: result.name,
      callId: result.callId,
      ok: result.ok,
      value: result.value,
      error: result.error,
    })),
    recallBlocks: input.recallBlocks.map((block) => ({
      id: block.id,
      summary: block.summary,
      confidence: block.confidence,
      source: block.source,
    })),
    contextSections: input.contextSections.map((section) => ({
      id: section.id,
      title: section.title,
      content: section.content,
      priority: section.priority,
    })),
    degradations: input.degradations.map((degradation) => ({
      stage: degradation.stage,
      severity: degradation.severity,
      reason: degradation.reason,
      message: degradation.message,
      recoverable: degradation.recoverable,
    })),
    audit: input.auditEvents.map((event) => ({
      kind: event.kind,
      detail: event.detail,
    })),
    stream: input.streamEvents.map((event) => ({
      kind: event.kind,
      detail: event.detail,
    })),
    recovery:
      input.recovery === undefined
        ? null
        : {
            interrupted: input.recovery.interrupted,
            resumed: input.recovery.resumed,
            checkpointToolIndex: input.recovery.checkpointToolIndex,
            totalToolCalls: input.recovery.totalToolCalls,
          },
    status: {
      latestTurnId: input.status.latestTurnId,
      phase: input.status.phase,
      recoveryHint:
        input.status.recoveryHint === undefined
          ? null
          : {
              checkpointToolIndex: input.status.recoveryHint.checkpointToolIndex,
              totalToolCalls: input.status.recoveryHint.totalToolCalls,
              nextToolIndex: input.status.recoveryHint.nextToolIndex,
            },
    },
    sessionTurn: input.session.turn,
  });
}

export interface TurnResult {
  readonly response: ModelResponse;
  readonly toolResults: readonly ToolResult[];
  readonly session: SessionSnapshot;
  readonly memory: readonly MemoryEntry[];
  readonly contextSections: readonly ContextSection[];
  readonly recallBlocks: readonly RecallBlock[];
  readonly degradations: readonly RuntimeDegradeSurface[];
  readonly auditEvents: readonly AuditEvent[];
  readonly streamEvents: readonly StreamEventRecord[];
  readonly recovery?: TurnRecoveryTrace;
  readonly status: TurnStatusSnapshot;
  readonly replayFingerprint: string;
}

export interface TurnRecoveryPlan {
  readonly interruptAfterToolCalls: number;
}

export interface TurnRunOptions {
  readonly recoveryPlan?: TurnRecoveryPlan;
}

export interface TurnRecoveryTrace {
  readonly interrupted: boolean;
  readonly resumed: boolean;
  readonly checkpointToolIndex: number;
  readonly totalToolCalls: number;
}

export interface TurnStatusSnapshot {
  readonly latestTurnId: string;
  readonly phase: "running" | "interrupted" | "resumed" | "completed" | "failed";
  readonly recoveryHint?: {
    readonly checkpointToolIndex: number;
    readonly totalToolCalls: number;
    readonly nextToolIndex: number;
  };
}

export interface ScenarioStep {
  readonly input: string;
  readonly runOptions?: TurnRunOptions;
  readonly assert?: (result: TurnResult, index: number) => void | Promise<void>;
}

export interface ScenarioRunnerOptions {
  readonly model: ModelLike;
  readonly memory: MemoryLike;
  readonly session: SessionLike;
  readonly tools?: readonly ToolLike[];
  readonly policy?: ExecutionPolicy;
  readonly recall?: MemoryRecallLike;
  readonly toolTimeoutMs?: number;
  readonly emitAudit?: (event: AuditEvent) => void;
  readonly emitStream?: (event: StreamEventRecord) => void;
}

export class ScenarioRunner {
  private readonly model: ModelLike;
  private readonly memory: MemoryLike;
  private readonly session: SessionLike;
  private readonly tools: Map<string, ToolLike>;
  private readonly policy: ExecutionPolicy | undefined;
  private readonly recall: MemoryRecallLike | undefined;
  private readonly toolTimeoutMs: number;
  private readonly emitAudit: ((event: AuditEvent) => void) | undefined;
  private readonly emitStream: ((event: StreamEventRecord) => void) | undefined;

  constructor(options: ScenarioRunnerOptions) {
    this.model = options.model;
    this.memory = options.memory;
    this.session = options.session;
    this.tools = new Map((options.tools ?? []).map((tool) => [tool.name, tool]));
    this.policy = options.policy;
    this.recall = options.recall;
    this.toolTimeoutMs = options.toolTimeoutMs ?? 30_000;
    this.emitAudit = options.emitAudit;
    this.emitStream = options.emitStream;
  }

  private recordAuditEvent(
    store: AuditEvent[],
    turn: number,
    kind: AuditEvent["kind"],
    detail: Record<string, unknown>,
  ): void {
    const event: AuditEvent = {
      kind,
      turn,
      timestamp: Date.now(),
      detail,
    };
    store.push(event);
    this.emitAudit?.(event);
  }

  private recordStreamEvent(
    store: StreamEventRecord[],
    turn: number,
    kind: StreamEventRecord["kind"],
    detail: Record<string, unknown>,
  ): void {
    const event: StreamEventRecord = {
      kind,
      turn,
      timestamp: Date.now(),
      detail,
    };
    store.push(event);
    this.emitStream?.(event);
  }

  private addDegradation(
    store: RuntimeDegradeSurface[],
    streamEvents: StreamEventRecord[],
    turn: number,
    degradation: RuntimeDegradeSurface,
  ): void {
    store.push(degradation);
    this.recordStreamEvent(streamEvents, turn, "stream.degraded", {
      stage: degradation.stage,
      severity: degradation.severity,
      reason: degradation.reason,
      message: degradation.message,
    });
  }

  private async evaluatePolicy(
    turn: number,
    call: ToolCall,
    auditEvents: AuditEvent[],
    memory: readonly MemoryEntry[],
    session: SessionSnapshot,
  ): Promise<PolicyDecision> {
    if (!this.policy) {
      const defaultDecision: PolicyDecision = { verdict: "allow" };
      return defaultDecision;
    }

    const decision = await this.policy.evaluateToolCall({
      call,
      memory,
      session,
    });

    const kind =
      decision.verdict === "allow"
        ? "policy.allow"
        : decision.verdict === "deny"
          ? "policy.deny"
          : decision.verdict === "ask"
            ? "policy.ask"
            : "policy.degrade";

    this.recordAuditEvent(auditEvents, turn, kind, {
      toolName: call.name,
      callId: call.callId ?? null,
      reason: decision.reason ?? null,
    });

    return decision;
  }

  private async invokeTool(tool: ToolLike, args: unknown, timeoutMs: number): Promise<unknown> {
    return withTimeout(
      Promise.resolve(tool.invoke(args)),
      timeoutMs,
      `Tool "${tool.name}" timed out after ${timeoutMs}ms`,
    );
  }

  private buildContextSections(
    input: string,
    recallBlocks: readonly RecallBlock[],
  ): readonly ContextSection[] {
    const sections: ContextSection[] = [
      {
        id: "user-input",
        title: "User Input",
        content: input,
        priority: 100,
      },
    ];

    for (const block of recallBlocks) {
      sections.push({
        id: `recall-${block.id}`,
        title: "Recall",
        content: block.summary,
        priority: 50,
        ...(block.source !== undefined ? { tags: [block.source] } : {}),
      });
    }

    return sections;
  }

  private restoreMemorySnapshot(snapshot: readonly MemoryEntry[]): void {
    this.memory.reset();
    for (const entry of snapshot) {
      this.memory.append({
        role: entry.role,
        content: entry.content,
        ...(entry.name !== undefined ? { name: entry.name } : {}),
        ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
        timestamp: entry.timestamp,
      });
    }
  }

  private buildRecoveryTrace(
    recoveryPlan: TurnRecoveryPlan | undefined,
    recoveryCheckpointIndex: number | undefined,
    totalToolCalls: number,
  ): TurnRecoveryTrace | undefined {
    if (!recoveryPlan || recoveryCheckpointIndex === undefined) {
      return undefined;
    }

    return {
      interrupted: true,
      resumed: true,
      checkpointToolIndex: recoveryCheckpointIndex,
      totalToolCalls,
    };
  }

  private setTurnStatus(
    turnId: string,
    phase: TurnStatusSnapshot["phase"],
    recoveryHint?: TurnStatusSnapshot["recoveryHint"],
  ): void {
    this.session.setState("latestTurnId", turnId);
    this.session.setState("turnStatusPhase", phase);
    if (recoveryHint === undefined) {
      this.session.setState("turnRecoveryHint", undefined);
      return;
    }
    this.session.setState("turnRecoveryHint", recoveryHint);
  }

  private readTurnStatus(turnId: string): TurnStatusSnapshot {
    const phase =
      this.session.getState<TurnStatusSnapshot["phase"]>("turnStatusPhase") ?? "running";
    const recoveryHint =
      this.session.getState<TurnStatusSnapshot["recoveryHint"]>("turnRecoveryHint");
    return {
      latestTurnId: this.session.getState<string>("latestTurnId") ?? turnId,
      phase,
      ...(recoveryHint === undefined ? {} : { recoveryHint }),
    };
  }

  async runTurn(input: string, options: TurnRunOptions = {}): Promise<TurnResult> {
    const auditEvents: AuditEvent[] = [];
    const streamEvents: StreamEventRecord[] = [];
    const degradations: RuntimeDegradeSurface[] = [];
    const currentSession = this.session.snapshot();
    const turn = currentSession.turn + 1;
    const turnId = `${currentSession.id}:turn-${turn}`;
    this.setTurnStatus(turnId, "running");

    this.memory.append({ role: "user", content: input });
    this.recordStreamEvent(streamEvents, turn, "stream.started", {
      inputLength: input.length,
    });

    let recallBlocks: readonly RecallBlock[] = [];
    if (this.recall) {
      try {
        recallBlocks = await this.recall.recall({
          query: input,
          memory: this.memory.list(),
          session: this.session.snapshot(),
        });
      } catch (error) {
        const degradation: RuntimeDegradeSurface = {
          stage: "runtime",
          category: "memory",
          action: "degrade",
          severity: "minor",
          reason: "context-pressure",
          message: `Memory recall degraded: ${toErrorMessage(error)}`,
          recoverable: true,
        };
        this.addDegradation(degradations, streamEvents, turn, degradation);
        this.recordAuditEvent(auditEvents, turn, "memory.degraded", {
          message: degradation.message,
        });
        recallBlocks = [];
      }
    }
    const contextSections = this.buildContextSections(input, recallBlocks);

    let response: ModelResponse;
    try {
      response = await this.model.complete({
        input,
        memory: this.memory.list(),
        session: this.session.snapshot(),
      });
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      const degradation: RuntimeDegradeSurface = {
        stage: "model",
        category: "provider",
        action: "degrade",
        severity: "major",
        reason: "model-limited",
        message: `Model runtime failed: ${errorMessage}`,
        recoverable: true,
      };
      this.addDegradation(degradations, streamEvents, turn, degradation);
      this.recordAuditEvent(auditEvents, turn, "runtime.model_failed", {
        message: errorMessage,
      });
      this.recordStreamEvent(streamEvents, turn, "stream.aborted", {
        reason: "model_failure",
        message: errorMessage,
      });
      this.setTurnStatus(turnId, "failed");
      const session = this.session.advanceTurn();
      const status = this.readTurnStatus(turnId);
      const fallbackResponse: ModelResponse = {
        output: "",
      };
      const replayFingerprint = createReplayFingerprint({
        response: fallbackResponse,
        toolResults: [],
        recallBlocks,
        contextSections,
        degradations,
        auditEvents,
        streamEvents,
        status,
        session,
      });

      return {
        response: fallbackResponse,
        toolResults: [],
        session,
        memory: this.memory.list(),
        contextSections,
        recallBlocks,
        degradations,
        auditEvents,
        streamEvents,
        status,
        replayFingerprint,
      };
    }

    this.memory.append({ role: "assistant", content: response.output });
    this.recordStreamEvent(streamEvents, turn, "stream.chunk", {
      index: 0,
      delta: response.output,
    });

    const toolCalls = [...(response.toolCalls ?? [])];
    const toolResults: ToolResult[] = [];
    let toolCallIndex = 0;
    let recoveryCheckpointIndex: number | undefined;
    while (toolCallIndex < toolCalls.length) {
      if (
        recoveryCheckpointIndex === undefined &&
        options.recoveryPlan &&
        toolCallIndex === options.recoveryPlan.interruptAfterToolCalls
      ) {
        recoveryCheckpointIndex = toolCallIndex;
        const memoryCheckpoint = this.memory.list();
        this.recordAuditEvent(auditEvents, turn, "runtime.interrupted", {
          checkpointToolIndex: recoveryCheckpointIndex,
          totalToolCalls: toolCalls.length,
        });
        this.recordStreamEvent(streamEvents, turn, "stream.interrupted", {
          checkpointToolIndex: recoveryCheckpointIndex,
          totalToolCalls: toolCalls.length,
        });
        this.setTurnStatus(turnId, "interrupted", {
          checkpointToolIndex: recoveryCheckpointIndex,
          totalToolCalls: toolCalls.length,
          nextToolIndex: recoveryCheckpointIndex,
        });
        this.restoreMemorySnapshot(memoryCheckpoint);
        this.recordAuditEvent(auditEvents, turn, "runtime.resumed", {
          checkpointToolIndex: recoveryCheckpointIndex,
          totalToolCalls: toolCalls.length,
        });
        this.recordStreamEvent(streamEvents, turn, "stream.resumed", {
          checkpointToolIndex: recoveryCheckpointIndex,
          totalToolCalls: toolCalls.length,
        });
        this.setTurnStatus(turnId, "resumed", {
          checkpointToolIndex: recoveryCheckpointIndex,
          totalToolCalls: toolCalls.length,
          nextToolIndex: recoveryCheckpointIndex,
        });
      }

      const toolCall = toolCalls[toolCallIndex];
      if (toolCall === undefined) {
        break;
      }
      const policyDecision = await this.evaluatePolicy(
        turn,
        toolCall,
        auditEvents,
        this.memory.list(),
        this.session.snapshot(),
      );
      if (policyDecision.verdict === "deny" || policyDecision.verdict === "ask") {
        const deniedReason =
          policyDecision.verdict === "ask"
            ? (policyDecision.reason ?? `Tool "${toolCall.name}" requires approval`)
            : (policyDecision.reason ?? `Tool "${toolCall.name}" denied by policy`);
        const deniedResult: ToolResult =
          toolCall.callId === undefined
            ? {
                name: toolCall.name,
                ok: false,
                error: deniedReason,
              }
            : {
                name: toolCall.name,
                callId: toolCall.callId,
                ok: false,
                error: deniedReason,
              };
        toolResults.push(deniedResult);
        this.memory.append({
          role: "tool",
          name: toolCall.name,
          content: JSON.stringify(deniedResult),
        });
        toolCallIndex += 1;
        continue;
      }

      if (policyDecision.verdict === "degrade" && policyDecision.degradation) {
        this.addDegradation(degradations, streamEvents, turn, policyDecision.degradation);
      }

      const tool = this.tools.get(toolCall.name);
      if (!tool) {
        const missing: ToolResult =
          toolCall.callId === undefined
            ? {
                name: toolCall.name,
                ok: false,
                error: `Tool "${toolCall.name}" is not registered`,
              }
            : {
                name: toolCall.name,
                callId: toolCall.callId,
                ok: false,
                error: `Tool "${toolCall.name}" is not registered`,
              };
        toolResults.push(missing);
        this.memory.append({
          role: "tool",
          name: toolCall.name,
          content: JSON.stringify(missing),
        });
        toolCallIndex += 1;
        continue;
      }

      try {
        const timeoutMs = toolCall.timeoutMs ?? this.toolTimeoutMs;
        this.recordStreamEvent(streamEvents, turn, "stream.tool-call", {
          toolName: tool.name,
          callId: toolCall.callId ?? null,
          timeoutMs,
          risk: toolCall.risk ?? null,
        });
        this.recordAuditEvent(auditEvents, turn, "tool.started", {
          toolName: tool.name,
          callId: toolCall.callId ?? null,
          timeoutMs,
        });

        const value = await this.invokeTool(tool, toolCall.args, timeoutMs);
        const success: ToolResult =
          toolCall.callId === undefined
            ? {
                name: tool.name,
                ok: true,
                value,
              }
            : {
                name: tool.name,
                callId: toolCall.callId,
                ok: true,
                value,
              };
        toolResults.push(success);
        this.recordAuditEvent(auditEvents, turn, "tool.finished", {
          toolName: tool.name,
          callId: toolCall.callId ?? null,
          ok: true,
        });
        this.memory.append({
          role: "tool",
          name: tool.name,
          content: JSON.stringify(success),
        });
      } catch (error) {
        const errorMessage = toErrorMessage(error);
        if (errorMessage.includes("timed out after")) {
          const timeoutDegradation: RuntimeDegradeSurface = {
            stage: "tool",
            category: "tool",
            action: "degrade",
            severity: "major",
            reason: "latency-budget",
            message: errorMessage,
            recoverable: true,
          };
          this.addDegradation(degradations, streamEvents, turn, timeoutDegradation);
          this.recordAuditEvent(auditEvents, turn, "tool.timeout", {
            toolName: tool.name,
            callId: toolCall.callId ?? null,
            message: errorMessage,
          });
        } else {
          this.recordAuditEvent(auditEvents, turn, "tool.finished", {
            toolName: tool.name,
            callId: toolCall.callId ?? null,
            ok: false,
            error: errorMessage,
          });
        }
        const failed: ToolResult =
          toolCall.callId === undefined
            ? {
                name: tool.name,
                ok: false,
                error: errorMessage,
              }
            : {
                name: tool.name,
                callId: toolCall.callId,
                ok: false,
                error: errorMessage,
              };
        toolResults.push(failed);
        this.memory.append({
          role: "tool",
          name: tool.name,
          content: JSON.stringify(failed),
        });
      }
      toolCallIndex += 1;
    }

    this.setTurnStatus(
      turnId,
      "completed",
      recoveryCheckpointIndex === undefined
        ? undefined
        : {
            checkpointToolIndex: recoveryCheckpointIndex,
            totalToolCalls: toolCalls.length,
            nextToolIndex: toolCalls.length,
          },
    );
    const session = this.session.advanceTurn();
    const status = this.readTurnStatus(turnId);
    this.recordStreamEvent(streamEvents, turn, "stream.completed", {
      toolCalls: toolResults.length,
    });
    const recovery = this.buildRecoveryTrace(
      options.recoveryPlan,
      recoveryCheckpointIndex,
      toolCalls.length,
    );
    const replayFingerprint = createReplayFingerprint({
      response,
      toolResults,
      recallBlocks,
      contextSections,
      degradations,
      auditEvents,
      streamEvents,
      ...(recovery !== undefined ? { recovery } : {}),
      status,
      session,
    });

    return {
      response,
      toolResults,
      session,
      memory: this.memory.list(),
      contextSections,
      recallBlocks,
      degradations,
      auditEvents,
      streamEvents,
      ...(recovery !== undefined ? { recovery } : {}),
      status,
      replayFingerprint,
    };
  }

  async runScenario(steps: readonly ScenarioStep[]): Promise<readonly TurnResult[]> {
    const results: TurnResult[] = [];
    for (const [index, step] of steps.entries()) {
      const result = await this.runTurn(step.input, step.runOptions);
      if (step.assert) {
        await step.assert(result, index);
      }
      results.push(result);
    }
    return results;
  }
}
