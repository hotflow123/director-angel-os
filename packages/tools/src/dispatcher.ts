import { createRuntimeDegradeSurface } from "@hotflow/contracts";
import { PolicyRuntime, decision } from "@hotflow/policy-runtime";
import type {
  PolicyDecision,
  ToolCapability,
  ToolDispatchPolicyRuntime,
  ToolRiskLevel,
} from "@hotflow/policy-runtime";
import type {
  ToolAuditEvent,
  ToolAvailability,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolDispatcherOptions,
  ToolExecutionResolution,
  ToolExecutionResult,
  ToolJournalEvent,
  ToolMergeStrategy,
  ToolSchemaDescriptor,
} from "./contracts.js";
import { createToolCallPlannedJournalEvent, createToolResultJournalEvent } from "./journal.js";
import { mergeToolResults } from "./merge-strategy.js";
import type { ToolRegistry } from "./registry.js";
import { ToolInputValidationError } from "./schema.js";

const DEFAULT_POLICY_RUNTIME = new PolicyRuntime({
  executionPolicy: {
    denyByDefault: false,
    approvalRequiredAtOrAbove: "high",
  },
  defaultDecision: decision.allow("Tool dispatch allowed by default policy runtime"),
});

interface ResolvedCapabilityProfile {
  capabilities: readonly ToolCapability[];
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
}

export class ToolDispatcher {
  private readonly policy: ToolDispatchPolicyRuntime;
  public readonly managesJournalClosure: boolean;

  public constructor(
    private readonly registry: ToolRegistry,
    private readonly options: ToolDispatcherOptions = {},
  ) {
    this.policy = options.policy ?? DEFAULT_POLICY_RUNTIME;
    this.managesJournalClosure = options.journalSink !== undefined;
  }

  public async dispatch(call: ToolCall, context: ToolContext): Promise<ToolExecutionResult> {
    let workingCall = call;
    try {
      await this.options.hooks?.beforeDispatch?.(workingCall, context);
    } catch (error) {
      await this.options.hooks?.onError?.("beforeDispatch", workingCall, context, error);
      return {
        toolCallId: workingCall.id,
        toolName: workingCall.name,
        ok: false,
        error: `Tool dispatch pre-hook failed: ${normalizeError(error)}`,
        resolution: "failed",
      };
    }

    const definition = this.registry.get(workingCall.name);
    const capabilityProfile = resolveCapabilityProfile(definition, workingCall.name);
    await this.emitAudit({
      kind: "tool.dispatch.started",
      occurredAtMs: Date.now(),
      call: workingCall,
      context,
      toolName: workingCall.name,
      capabilities: capabilityProfile.capabilities,
      riskLevel: capabilityProfile.riskLevel,
    });

    if (!definition) {
      const result: ToolExecutionResult = {
        toolCallId: workingCall.id,
        toolName: workingCall.name,
        ok: false,
        error: `Tool "${workingCall.name}" is not registered.`,
        resolution: "missing",
      };
      await this.emitJournal(createToolResultJournalEvent(result), workingCall, context);
      await this.runAfterDispatch(workingCall, context, result);
      await this.emitAudit({
        kind: "tool.dispatch.completed",
        occurredAtMs: Date.now(),
        call: workingCall,
        context,
        toolName: workingCall.name,
        capabilities: capabilityProfile.capabilities,
        riskLevel: capabilityProfile.riskLevel,
        result,
      });
      return result;
    }

    try {
      workingCall = validateToolCallArgs(workingCall, definition);
    } catch (error) {
      await this.options.hooks?.onError?.("validation", workingCall, context, error);
      const failed = createValidationFailureResult(workingCall, definition.name, error);
      await this.emitJournal(createToolResultJournalEvent(failed), workingCall, context);
      await this.runAfterDispatch(workingCall, context, failed);
      await this.emitAudit({
        kind: "tool.dispatch.failed",
        occurredAtMs: Date.now(),
        call: workingCall,
        context,
        toolName: definition.name,
        capabilities: capabilityProfile.capabilities,
        riskLevel: capabilityProfile.riskLevel,
        result: failed,
        ...(failed.error ? { error: failed.error } : {}),
      });
      return failed;
    }

    const availability = this.registry.getAvailability(workingCall.name);
    if (availability && !availability.available) {
      if (availability.reason === "check_error") {
        const failureError =
          availability.error ?? availability.message ?? "Tool availability check failed.";
        await this.options.hooks?.onError?.("availability", workingCall, context, failureError);
        const failed = createAvailabilityCheckFailedResult(
          workingCall,
          definition.name,
          availability,
        );
        await this.emitJournal(createToolResultJournalEvent(failed), workingCall, context);
        await this.runAfterDispatch(workingCall, context, failed);
        await this.emitAudit({
          kind: "tool.dispatch.failed",
          occurredAtMs: Date.now(),
          call: workingCall,
          context,
          toolName: definition.name,
          capabilities: capabilityProfile.capabilities,
          riskLevel: capabilityProfile.riskLevel,
          result: failed,
          ...(failed.error ? { error: failed.error } : {}),
        });
        return failed;
      }

      const result = resultFromAvailability(workingCall, definition.name, availability);
      await this.emitJournal(createToolResultJournalEvent(result), workingCall, context);
      await this.runAfterDispatch(workingCall, context, result);
      await this.emitAudit({
        kind: "tool.dispatch.completed",
        occurredAtMs: Date.now(),
        call: workingCall,
        context,
        toolName: definition.name,
        capabilities: capabilityProfile.capabilities,
        riskLevel: capabilityProfile.riskLevel,
        result,
      });
      return result;
    }

    await this.emitJournal(createToolCallPlannedJournalEvent(workingCall), workingCall, context);

    let policyDecision: PolicyDecision;
    try {
      policyDecision = await this.policy.evaluateToolDispatch({
        toolName: definition.name,
        actor: context.actor ?? context.sessionId,
        metadata: {
          callId: workingCall.id,
          sessionId: context.sessionId,
          ...(context.turnId ? { turnId: context.turnId } : {}),
          ...(context.workspaceRoot ? { workspaceRoot: context.workspaceRoot } : {}),
        },
        capabilityProfile: {
          toolName: definition.name,
          capabilities: capabilityProfile.capabilities,
          riskLevel: capabilityProfile.riskLevel,
          requiresApproval: capabilityProfile.requiresApproval,
        },
        ...(context.approval ? { approval: context.approval } : {}),
      });
    } catch (error) {
      await this.options.hooks?.onError?.("policy", workingCall, context, error);
      const failed: ToolExecutionResult = {
        toolCallId: workingCall.id,
        toolName: definition.name,
        ok: false,
        error: `Tool policy evaluation failed: ${normalizeError(error)}`,
        resolution: "failed",
      };
      await this.emitJournal(createToolResultJournalEvent(failed), workingCall, context);
      await this.runAfterDispatch(workingCall, context, failed);
      await this.emitAudit({
        kind: "tool.dispatch.failed",
        occurredAtMs: Date.now(),
        call: workingCall,
        context,
        toolName: definition.name,
        capabilities: capabilityProfile.capabilities,
        riskLevel: capabilityProfile.riskLevel,
        result: failed,
        ...(failed.error ? { error: failed.error } : {}),
      });
      return failed;
    }

    await this.emitAudit({
      kind: "tool.dispatch.policy_decision",
      occurredAtMs: Date.now(),
      call: workingCall,
      context,
      toolName: definition.name,
      capabilities: capabilityProfile.capabilities,
      riskLevel: capabilityProfile.riskLevel,
      policyDecision,
    });

    if (policyDecision.verdict !== "allow") {
      const result = resultFromPolicyDecision(workingCall, definition.name, policyDecision);
      await this.emitJournal(createToolResultJournalEvent(result), workingCall, context);
      await this.runAfterDispatch(workingCall, context, result);
      await this.emitAudit({
        kind: "tool.dispatch.completed",
        occurredAtMs: Date.now(),
        call: workingCall,
        context,
        toolName: definition.name,
        capabilities: capabilityProfile.capabilities,
        riskLevel: capabilityProfile.riskLevel,
        policyDecision,
        result,
      });
      return result;
    }

    try {
      const result = await executeToolWithTimeout(definition, workingCall, context);
      const normalized = finalizeToolResult({
        rawResult: result,
        call: workingCall,
        toolName: definition.name,
        policyDecision,
      });
      await this.emitJournal(createToolResultJournalEvent(normalized), workingCall, context);
      await this.runAfterDispatch(workingCall, context, normalized);
      await this.emitAudit({
        kind: "tool.dispatch.completed",
        occurredAtMs: Date.now(),
        call: workingCall,
        context,
        toolName: definition.name,
        capabilities: capabilityProfile.capabilities,
        riskLevel: capabilityProfile.riskLevel,
        policyDecision,
        result: normalized,
      });
      return normalized;
    } catch (error) {
      await this.options.hooks?.onError?.("execute", workingCall, context, error);
      const failed = finalizeToolResult({
        rawResult: createExecutionFailureResult(workingCall, definition.name, error),
        call: workingCall,
        toolName: definition.name,
        policyDecision,
      });
      await this.emitJournal(createToolResultJournalEvent(failed), workingCall, context);
      await this.runAfterDispatch(workingCall, context, failed);
      await this.emitAudit({
        kind: "tool.dispatch.failed",
        occurredAtMs: Date.now(),
        call: workingCall,
        context,
        toolName: definition.name,
        capabilities: capabilityProfile.capabilities,
        riskLevel: capabilityProfile.riskLevel,
        policyDecision,
        result: failed,
        ...(failed.error ? { error: failed.error } : {}),
      });
      return failed;
    }
  }

  public async dispatchMany(
    calls: readonly ToolCall[],
    context: ToolContext,
    strategy: ToolMergeStrategy = "ordered",
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    for (const batch of createDispatchBatches(this.registry, calls)) {
      if (batch.mode === "parallel") {
        results.push(
          ...(await Promise.all(batch.calls.map((call) => this.dispatch(call, context)))),
        );
        continue;
      }

      for (const call of batch.calls) {
        results.push(await this.dispatch(call, context));
      }
    }

    return mergeToolResults(strategy, results);
  }

  public getSchemas(toolset?: string): ToolSchemaDescriptor[] {
    return this.registry.getSchemas(toolset);
  }

  private async runAfterDispatch(
    call: ToolCall,
    context: ToolContext,
    result: ToolExecutionResult,
  ): Promise<void> {
    try {
      await this.options.hooks?.afterDispatch?.(call, context, result);
    } catch (error) {
      await this.options.hooks?.onError?.("afterDispatch", call, context, error);
    }
  }

  private async emitAudit(event: ToolAuditEvent): Promise<void> {
    if (!this.options.auditSink) {
      return;
    }

    try {
      await this.options.auditSink(event);
    } catch (error) {
      try {
        await this.options.hooks?.onError?.("audit", event.call, event.context, error);
      } catch {
        // Avoid dispatch failure when audit/error hooks both fail.
      }
    }
  }

  private async emitJournal(
    event: ToolJournalEvent,
    call: ToolCall,
    context: ToolContext,
  ): Promise<void> {
    if (!this.options.journalSink) {
      return;
    }

    try {
      await this.options.journalSink(event, context);
    } catch (error) {
      try {
        await this.options.hooks?.onError?.("journal", call, context, error);
      } catch {
        // Avoid losing the original journal failure if the error hook also fails.
      }
      throw error;
    }
  }
}

class ToolExecutionTimeoutError extends Error {
  public readonly timeoutMs: number;

  public constructor(
    public readonly toolName: string,
    timeoutMs: number,
  ) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms.`);
    this.name = "ToolExecutionTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

type ToolDispatchBatch = {
  readonly mode: "parallel" | "serial";
  readonly calls: readonly ToolCall[];
};

function createDispatchBatches(
  registry: ToolRegistry,
  calls: readonly ToolCall[],
): ToolDispatchBatch[] {
  const batches: ToolDispatchBatch[] = [];
  let parallelBatch: ToolCall[] = [];

  const flushParallelBatch = () => {
    if (parallelBatch.length === 0) {
      return;
    }

    batches.push({
      mode: "parallel",
      calls: parallelBatch,
    });
    parallelBatch = [];
  };

  for (const call of calls) {
    if (isParallelSafeCall(registry, call)) {
      parallelBatch.push(call);
      continue;
    }

    flushParallelBatch();
    batches.push({
      mode: "serial",
      calls: [call],
    });
  }

  flushParallelBatch();
  return batches;
}

function isParallelSafeCall(registry: ToolRegistry, call: ToolCall): boolean {
  const definition = registry.get(call.name);
  return definition?.readOnly === true;
}

function validateToolCallArgs(call: ToolCall, definition: ToolDefinition): ToolCall {
  if (!definition.inputSchema) {
    return call;
  }

  return {
    ...call,
    args: definition.inputSchema.parse(call.args),
  };
}

async function executeToolWithTimeout(
  definition: ToolDefinition,
  call: ToolCall,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const timeoutMs = definition.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await definition.execute(call.args, context);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ToolExecutionTimeoutError(definition.name, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(definition.execute(call.args, context)),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function finalizeToolResult(input: {
  rawResult: ToolExecutionResult;
  call: ToolCall;
  toolName: string;
  policyDecision: PolicyDecision;
}): ToolExecutionResult {
  const mergedMetadata = mergeMetadata(input.rawResult.metadata, input.policyDecision.metadata);
  const normalizedResolution = normalizeResolution(input.rawResult);
  return {
    ...input.rawResult,
    toolCallId: input.call.id,
    toolName: input.toolName,
    ok: normalizedResolution === "executed",
    resolution: normalizedResolution,
    policyDecision: input.policyDecision,
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
  };
}

function normalizeResolution(result: ToolExecutionResult): ToolExecutionResolution {
  if (result.resolution !== undefined) {
    return result.resolution;
  }

  if (result.ok) {
    return "executed";
  }

  if (result.degradation !== undefined) {
    return "degraded";
  }

  return "failed";
}

function resolveCapabilityProfile(
  definition:
    | {
        readOnly: boolean;
        capabilities?: readonly ToolCapability[];
        riskLevel?: ToolRiskLevel;
        requiresApproval?: boolean;
      }
    | undefined,
  toolName: string,
): ResolvedCapabilityProfile {
  if (!definition) {
    return {
      capabilities: [],
      riskLevel: "low",
      requiresApproval: false,
    };
  }

  return {
    capabilities:
      definition.capabilities && definition.capabilities.length > 0
        ? [...definition.capabilities]
        : [toolName],
    riskLevel: definition.riskLevel ?? (definition.readOnly ? "low" : "medium"),
    requiresApproval: definition.requiresApproval ?? false,
  };
}

function resultFromPolicyDecision(
  call: ToolCall,
  toolName: string,
  policyDecision: PolicyDecision,
): ToolExecutionResult {
  const resolution = mapPolicyVerdictToResolution(policyDecision.verdict);
  const mergedMetadata = mergeMetadata(
    policyDecision.metadata,
    policyDecision.degradedCapabilities
      ? { degradedCapabilities: [...policyDecision.degradedCapabilities] }
      : undefined,
  );
  return {
    toolCallId: call.id,
    toolName,
    ok: false,
    error: policyDecision.reason,
    resolution,
    ...(policyDecision.verdict === "degrade"
      ? {
          degradation:
            policyDecision.degradation ??
            createDefaultPolicyDegradation(
              policyDecision.reason,
              policyDecision.degradedCapabilities ?? [],
            ),
        }
      : {}),
    policyDecision,
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
  };
}

function mapPolicyVerdictToResolution(verdict: PolicyDecision["verdict"]): ToolExecutionResolution {
  switch (verdict) {
    case "deny":
      return "denied";
    case "ask":
      return "approval_required";
    case "degrade":
      return "degraded";
    case "allow":
      return "executed";
    default:
      return "failed";
  }
}

function createDefaultPolicyDegradation(
  message: string,
  degradedCapabilities: readonly ToolCapability[],
) {
  return createRuntimeDegradeSurface({
    stage: "policy" as const,
    category: "policy",
    severity: "major" as const,
    reason: "policy-restricted" as const,
    message,
    recoverable: true,
    metadata: {
      degradedCapabilities: [...degradedCapabilities],
    },
  });
}

function mergeMetadata(
  base: Readonly<Record<string, unknown>> | undefined,
  extra: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!base && !extra) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
}

function createExecutionFailureResult(
  call: ToolCall,
  toolName: string,
  error: unknown,
): ToolExecutionResult {
  if (error instanceof ToolExecutionTimeoutError) {
    return {
      toolCallId: call.id,
      toolName,
      ok: false,
      error: error.message,
      resolution: "failed",
      metadata: {
        timeoutMs: error.timeoutMs,
      },
    };
  }

  return {
    toolCallId: call.id,
    toolName,
    ok: false,
    error: normalizeError(error),
    resolution: "failed",
  };
}

function createValidationFailureResult(
  call: ToolCall,
  toolName: string,
  error: unknown,
): ToolExecutionResult {
  const message =
    error instanceof ToolInputValidationError
      ? error.message
      : `Tool input validation failed: ${normalizeError(error)}`;
  return {
    toolCallId: call.id,
    toolName,
    ok: false,
    error: `Tool "${toolName}" input validation failed: ${message}`,
    resolution: "failed",
    metadata: {
      validationError: message,
    },
  };
}

function resultFromAvailability(
  call: ToolCall,
  toolName: string,
  availability: ToolAvailability,
): ToolExecutionResult {
  return {
    toolCallId: call.id,
    toolName,
    ok: false,
    error: availability.message ?? `Tool "${toolName}" is unavailable.`,
    resolution: "missing",
    metadata: {
      availabilityReason: availability.reason ?? "check_unavailable",
      ...(availability.missingEnvVars ? { missingEnvVars: [...availability.missingEnvVars] } : {}),
    },
  };
}

function createAvailabilityCheckFailedResult(
  call: ToolCall,
  toolName: string,
  availability: ToolAvailability,
): ToolExecutionResult {
  return {
    toolCallId: call.id,
    toolName,
    ok: false,
    error: availability.message ?? `Tool "${toolName}" availability check failed.`,
    resolution: "failed",
    metadata: {
      availabilityReason: availability.reason ?? "check_error",
      ...(availability.error ? { availabilityError: availability.error } : {}),
    },
  };
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
