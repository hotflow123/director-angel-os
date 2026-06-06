import type {
  ToolCall,
  ToolExecutionResult,
  ToolJournalEvent,
  ToolJournalObject,
  ToolJournalValue,
} from "./contracts.js";

export function createToolCallPlannedJournalEvent(call: ToolCall): ToolJournalEvent {
  return {
    eventType: "tool.call_planned",
    occurredAtMs: Date.now(),
    payload: {
      toolCallId: call.id,
      toolName: call.name,
      args: toToolJournalValue(call.args),
    },
  };
}

export function createToolResultJournalEvent(result: ToolExecutionResult): ToolJournalEvent {
  return {
    eventType: "tool.result",
    occurredAtMs: Date.now(),
    payload: {
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      ok: result.ok,
      ...(result.output === undefined ? {} : { output: toToolJournalValue(result.output) }),
      error: result.error ?? null,
      ...(result.resolution === undefined ? {} : { resolution: result.resolution }),
    },
  };
}

function toToolJournalValue(value: unknown): ToolJournalValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toToolJournalValue(item));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...Object.fromEntries(
        Object.entries(value)
          .filter(([, nestedValue]) => nestedValue !== undefined)
          .map(([key, nestedValue]) => [key, toToolJournalValue(nestedValue)]),
      ),
      ...("cause" in value && value.cause !== undefined
        ? { cause: toToolJournalValue(value.cause) }
        : {}),
    } satisfies ToolJournalObject;
  }

  if (typeof value === "object") {
    const journalObject: ToolJournalObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) {
        continue;
      }
      journalObject[key] = toToolJournalValue(nestedValue);
    }
    return journalObject;
  }

  return String(value);
}
