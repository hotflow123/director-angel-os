import { createHash } from "node:crypto";

import type {
  ConversationRuntimeModelToolCall,
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionOutput,
} from "./model-tool-loop.js";

export type ConversationRuntimeToolHookPhase = "beforeCall" | "afterCall" | "persistResult";
export type ConversationRuntimeToolHookDecisionStatus = "allow" | "modify" | "deny";
export type ConversationRuntimeToolHookPipelineStatus = "allowed" | "denied";

export interface ConversationRuntimeToolHookTraceEntry {
  readonly phase: ConversationRuntimeToolHookPhase;
  readonly hookName: string;
  readonly status: ConversationRuntimeToolHookDecisionStatus;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeToolHookInputBase {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool?: ConversationRuntimeModelToolDefinition;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeToolBeforeCallInput
  extends ConversationRuntimeToolHookInputBase {}

export type ConversationRuntimeToolBeforeCallDecision =
  | {
      readonly status: "allow";
      readonly reason?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "modify";
      readonly call: ConversationRuntimeModelToolCall;
      readonly reason?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "deny";
      readonly reason: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    };

export interface ConversationRuntimeToolAfterCallInput
  extends ConversationRuntimeToolHookInputBase {
  readonly result: ConversationRuntimeToolExecutionOutput;
}

export type ConversationRuntimeToolResultHookDecision =
  | {
      readonly status: "allow";
      readonly reason?: string;
      readonly requiresAudit?: boolean;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "modify";
      readonly result: ConversationRuntimeToolExecutionOutput;
      readonly reason?: string;
      readonly requiresAudit?: boolean;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "deny";
      readonly reason: string;
      readonly requiresAudit?: boolean;
      readonly metadata?: Readonly<Record<string, unknown>>;
    };

export interface ConversationRuntimeToolHook {
  readonly name: string;
  readonly beforeCall?: (
    input: ConversationRuntimeToolBeforeCallInput,
  ) => MaybePromise<ConversationRuntimeToolBeforeCallDecision>;
  readonly afterCall?: (
    input: ConversationRuntimeToolAfterCallInput,
  ) => MaybePromise<ConversationRuntimeToolResultHookDecision>;
  readonly persistResult?: (
    input: ConversationRuntimeToolAfterCallInput,
  ) => MaybePromise<ConversationRuntimeToolResultHookDecision>;
}

export interface RunConversationRuntimeToolHookPipelineBeforeCallInput
  extends ConversationRuntimeToolBeforeCallInput {
  readonly hooks: readonly ConversationRuntimeToolHook[];
}

export type ConversationRuntimeToolHookPipelineBeforeCallResult =
  | {
      readonly status: "allowed";
      readonly call: ConversationRuntimeModelToolCall;
      readonly trace: readonly ConversationRuntimeToolHookTraceEntry[];
    }
  | {
      readonly status: "denied";
      readonly call: ConversationRuntimeModelToolCall;
      readonly deniedBy: string;
      readonly reason: string;
      readonly trace: readonly ConversationRuntimeToolHookTraceEntry[];
    };

export interface RunConversationRuntimeToolHookPipelineResultInput
  extends ConversationRuntimeToolAfterCallInput {
  readonly hooks: readonly ConversationRuntimeToolHook[];
}

export type ConversationRuntimeToolHookPipelineResult =
  | {
      readonly status: "allowed";
      readonly result: ConversationRuntimeToolExecutionOutput;
      readonly trace: readonly ConversationRuntimeToolHookTraceEntry[];
      readonly requiresAudit: boolean;
    }
  | {
      readonly status: "denied";
      readonly result: ConversationRuntimeToolExecutionOutput;
      readonly deniedBy: string;
      readonly reason: string;
      readonly trace: readonly ConversationRuntimeToolHookTraceEntry[];
      readonly requiresAudit: boolean;
    };

export interface ConversationRuntimeToolLoopDetectorOptions {
  readonly name?: string;
  readonly maxRepeats: number;
  readonly scope?: "global" | "session" | "turn";
}

type MaybePromise<T> = T | Promise<T>;

export async function runConversationRuntimeToolHookPipelineBeforeCall(
  input: RunConversationRuntimeToolHookPipelineBeforeCallInput,
): Promise<ConversationRuntimeToolHookPipelineBeforeCallResult> {
  let call = input.call;
  const trace: ConversationRuntimeToolHookTraceEntry[] = [];

  for (const hook of input.hooks) {
    if (hook.beforeCall === undefined) {
      continue;
    }
    const decision = await runBeforeCallHookSafely(hook.name, () =>
      hook.beforeCall?.({
        ...input,
        call,
      }),
    );
    trace.push(createTraceEntry("beforeCall", hook.name, decision));
    if (decision.status === "deny") {
      return {
        status: "denied",
        call,
        deniedBy: hook.name,
        reason: decision.reason,
        trace,
      };
    }
    if (decision.status === "modify") {
      call = decision.call;
    }
  }

  return { status: "allowed", call, trace };
}

export async function runConversationRuntimeToolHookPipelineAfterCall(
  input: RunConversationRuntimeToolHookPipelineResultInput,
): Promise<ConversationRuntimeToolHookPipelineResult> {
  return runConversationRuntimeToolHookPipelineForResult("afterCall", input);
}

export async function runConversationRuntimeToolHookPipelinePersistResult(
  input: RunConversationRuntimeToolHookPipelineResultInput,
): Promise<ConversationRuntimeToolHookPipelineResult> {
  return runConversationRuntimeToolHookPipelineForResult("persistResult", input);
}

export function createConversationRuntimeToolLoopDetector(
  options: ConversationRuntimeToolLoopDetectorOptions,
): ConversationRuntimeToolHook {
  const maxRepeats = Math.max(1, Math.floor(options.maxRepeats));
  const scope = options.scope ?? "session";
  const countsByKey = new Map<string, number>();

  return {
    name: options.name ?? "tool-loop-detector",
    beforeCall: ({ turnId, sessionKey, call }) => {
      const argsHash = hashConversationRuntimeToolArgs(call.args);
      const key = createToolLoopDetectorKey({ scope, turnId, sessionKey, call, argsHash });
      const nextCount = (countsByKey.get(key) ?? 0) + 1;
      countsByKey.set(key, nextCount);

      if (nextCount > maxRepeats) {
        return {
          status: "deny",
          reason: "tool-loop-threshold-exceeded",
          metadata: { argsHash, count: nextCount, maxRepeats, toolName: call.name },
        };
      }

      return {
        status: "allow",
        reason: "tool-loop-observed",
        metadata: { argsHash, count: nextCount, maxRepeats, toolName: call.name },
      };
    },
  };
}

export function hashConversationRuntimeToolArgs(args: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(stableJsonStringify(args)).digest("hex");
}

async function runConversationRuntimeToolHookPipelineForResult(
  phase: "afterCall" | "persistResult",
  input: RunConversationRuntimeToolHookPipelineResultInput,
): Promise<ConversationRuntimeToolHookPipelineResult> {
  let result = input.result;
  let requiresAudit = false;
  const trace: ConversationRuntimeToolHookTraceEntry[] = [];

  for (const hook of input.hooks) {
    const runner = phase === "afterCall" ? hook.afterCall : hook.persistResult;
    if (runner === undefined) {
      continue;
    }
    const decision = await runResultHookSafely(phase, hook.name, () =>
      runner({
        ...input,
        result,
      }),
    );
    requiresAudit = requiresAudit || decision.requiresAudit === true;
    trace.push(createTraceEntry(phase, hook.name, decision));
    if (decision.status === "deny") {
      return {
        status: "denied",
        result,
        deniedBy: hook.name,
        reason: decision.reason,
        trace,
        requiresAudit,
      };
    }
    if (decision.status === "modify") {
      result = decision.result;
    }
  }

  return { status: "allowed", result, trace, requiresAudit };
}

async function runBeforeCallHookSafely(
  hookName: string,
  run: () => MaybePromise<ConversationRuntimeToolBeforeCallDecision | undefined>,
): Promise<ConversationRuntimeToolBeforeCallDecision> {
  try {
    const decision = await run();
    return decision ?? ({ status: "allow" } as ConversationRuntimeToolBeforeCallDecision);
  } catch (error) {
    return {
      status: "deny",
      reason: "tool-hook-failed",
      metadata: {
        phase: "beforeCall",
        hookName,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function runResultHookSafely(
  phase: "afterCall" | "persistResult",
  hookName: string,
  run: () => MaybePromise<ConversationRuntimeToolResultHookDecision | undefined>,
): Promise<ConversationRuntimeToolResultHookDecision> {
  try {
    const decision = await run();
    return decision ?? ({ status: "allow" } as ConversationRuntimeToolResultHookDecision);
  } catch (error) {
    return {
      status: "deny",
      reason: "tool-hook-failed",
      metadata: {
        phase,
        hookName,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function createTraceEntry(
  phase: ConversationRuntimeToolHookPhase,
  hookName: string,
  decision: ConversationRuntimeToolBeforeCallDecision | ConversationRuntimeToolResultHookDecision,
): ConversationRuntimeToolHookTraceEntry {
  return {
    phase,
    hookName,
    status: decision.status,
    ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    ...(decision.metadata === undefined ? {} : { metadata: decision.metadata }),
  };
}

function createToolLoopDetectorKey(input: {
  readonly scope: "global" | "session" | "turn";
  readonly turnId: string;
  readonly sessionKey: string;
  readonly call: ConversationRuntimeModelToolCall;
  readonly argsHash: string;
}): string {
  const base = `${input.call.name}:${input.argsHash}`;
  if (input.scope === "global") {
    return base;
  }
  if (input.scope === "turn") {
    return `${input.sessionKey}:${input.turnId}:${base}`;
  }
  return `${input.sessionKey}:${base}`;
}

function stableJsonStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return JSON.stringify(value);
  }
  if (valueType === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (valueType === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return "null";
}
