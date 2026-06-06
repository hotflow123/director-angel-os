import type { ConversationRuntimeToolExecutionOutput } from "./model-tool-loop.js";
import type { ConversationRuntimeToolHook } from "./tool-hooks.js";

export interface ConversationRuntimeToolRedactionFinding {
  readonly kind: string;
  readonly count: number;
}

export type ConversationRuntimeToolTextRedactionResult =
  | {
      readonly status: "ok";
      readonly text: string;
      readonly findings: readonly ConversationRuntimeToolRedactionFinding[];
    }
  | {
      readonly status: "failed";
      readonly text: string;
      readonly findings: readonly ConversationRuntimeToolRedactionFinding[];
      readonly reason: string;
    };

export interface ConversationRuntimeToolRedactionHookOptions {
  readonly name?: string;
  readonly redactText?: (text: string) => ConversationRuntimeToolTextRedactionResult;
}

export function createConversationRuntimeToolRedactionHook(
  options: ConversationRuntimeToolRedactionHookOptions = {},
): ConversationRuntimeToolHook {
  const hookName = options.name ?? "tool-redaction";
  const redactText = options.redactText ?? redactConversationRuntimeToolText;
  return {
    name: hookName,
    persistResult: ({ result }) => {
      const redacted = redactToolExecutionOutput(result, redactText);
      if (redacted.status === "failed") {
        return {
          status: "deny",
          reason: "tool-redaction-failed",
          metadata: {
            failureReason: redacted.reason,
          },
        };
      }
      if (!redacted.changed) {
        return { status: "allow", reason: "tool-redaction-clean" };
      }
      return {
        status: "modify",
        reason: "tool-redaction-applied",
        result: redacted.result,
        metadata: {
          redactionFindingCount: redacted.findings.reduce((sum, item) => sum + item.count, 0),
          redactionKinds: [...new Set(redacted.findings.map((item) => item.kind))],
        },
      };
    },
  };
}

export function redactConversationRuntimeToolText(
  text: string,
): ConversationRuntimeToolTextRedactionResult {
  let output = text;
  const findings = new Map<string, number>();

  output = redactPattern(output, findings, "bearer-token", /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu);
  output = redactPattern(output, findings, "openai-api-key", /\bsk-[A-Za-z0-9_-]{8,}\b/gu);
  output = redactPattern(output, findings, "github-token", /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/gu);
  output = redactPattern(output, findings, "slack-token", /\bxox[abprs]-[A-Za-z0-9-]{8,}\b/gu);
  output = redactPattern(output, findings, "huggingface-token", /\bhf_[A-Za-z0-9]{8,}\b/gu);
  output = output.replace(
    /\b(api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|authorization)\s*[:=]\s*["']?([^"',\s;&]{3,})["']?/giu,
    (match, rawKey: string) => {
      const kind = normalizeSecretKind(rawKey);
      addFinding(findings, kind);
      const separator = match.includes("=") ? "=" : ":";
      return `${rawKey}${separator}[REDACTED:${kind}]`;
    },
  );
  output = output.replace(
    /"(access_token|refresh_token|id_token|assertion|subject_token|client_secret|api_key|password|secret|authorization)"\s*:\s*"[^"]*"/giu,
    (_match, rawKey: string) => {
      const kind = normalizeSecretKind(rawKey);
      addFinding(findings, kind);
      return `"${rawKey}":"[REDACTED:${kind}]"`;
    },
  );

  return {
    status: "ok",
    text: output,
    findings: [...findings.entries()].map(([kind, count]) => ({ kind, count })),
  };
}

function redactToolExecutionOutput(
  result: ConversationRuntimeToolExecutionOutput,
  redactText: (text: string) => ConversationRuntimeToolTextRedactionResult,
):
  | {
      readonly status: "ok";
      readonly changed: boolean;
      readonly result: ConversationRuntimeToolExecutionOutput;
      readonly findings: readonly ConversationRuntimeToolRedactionFinding[];
    }
  | {
      readonly status: "failed";
      readonly reason: string;
    } {
  const content = redactText(result.content);
  if (content.status === "failed") {
    return { status: "failed", reason: content.reason };
  }
  const error = result.error === undefined ? undefined : redactText(result.error);
  if (error?.status === "failed") {
    return { status: "failed", reason: error.reason };
  }
  const output = redactUnknownValue(result.output, redactText);
  if (output.status === "failed") {
    return { status: "failed", reason: output.reason };
  }
  const metadata = redactUnknownValue(result.metadata, redactText);
  if (metadata.status === "failed") {
    return { status: "failed", reason: metadata.reason };
  }

  const findings = [
    ...content.findings,
    ...(error?.findings ?? []),
    ...output.findings,
    ...metadata.findings,
  ];
  const changed =
    content.text !== result.content ||
    error?.text !== result.error ||
    output.changed ||
    metadata.changed;
  return {
    status: "ok",
    changed,
    result: {
      ...result,
      content: content.text,
      ...(error === undefined ? {} : { error: error.text }),
      ...(output.value === undefined ? {} : { output: output.value }),
      metadata: {
        ...(isRecord(metadata.value) ? metadata.value : (result.metadata ?? {})),
        ...(findings.length === 0
          ? {}
          : {
              toolRedaction: {
                applied: true,
                findings,
              },
            }),
      },
    },
    findings,
  };
}

function redactUnknownValue(
  value: unknown,
  redactText: (text: string) => ConversationRuntimeToolTextRedactionResult,
):
  | {
      readonly status: "ok";
      readonly value: unknown;
      readonly changed: boolean;
      readonly findings: readonly ConversationRuntimeToolRedactionFinding[];
    }
  | {
      readonly status: "failed";
      readonly reason: string;
    } {
  if (typeof value === "string") {
    const redacted = redactText(value);
    if (redacted.status === "failed") {
      return { status: "failed", reason: redacted.reason };
    }
    return {
      status: "ok",
      value: redacted.text,
      changed: redacted.text !== value,
      findings: redacted.findings,
    };
  }
  if (Array.isArray(value)) {
    return redactArrayValue(value, redactText);
  }
  if (isRecord(value)) {
    return redactRecordValue(value, redactText);
  }
  return { status: "ok", value, changed: false, findings: [] };
}

function redactArrayValue(
  value: readonly unknown[],
  redactText: (text: string) => ConversationRuntimeToolTextRedactionResult,
) {
  let changed = false;
  const findings: ConversationRuntimeToolRedactionFinding[] = [];
  const items: unknown[] = [];
  for (const item of value) {
    const redacted = redactUnknownValue(item, redactText);
    if (redacted.status === "failed") {
      return redacted;
    }
    changed = changed || redacted.changed;
    findings.push(...redacted.findings);
    items.push(redacted.value);
  }
  return { status: "ok" as const, value: items, changed, findings };
}

function redactRecordValue(
  value: Readonly<Record<string, unknown>>,
  redactText: (text: string) => ConversationRuntimeToolTextRedactionResult,
) {
  let changed = false;
  const findings: ConversationRuntimeToolRedactionFinding[] = [];
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const redacted = redactUnknownValue(item, redactText);
    if (redacted.status === "failed") {
      return redacted;
    }
    changed = changed || redacted.changed;
    findings.push(...redacted.findings);
    record[key] = redacted.value;
  }
  return { status: "ok" as const, value: record, changed, findings };
}

function redactPattern(
  text: string,
  findings: Map<string, number>,
  kind: string,
  pattern: RegExp,
): string {
  return text.replace(pattern, () => {
    addFinding(findings, kind);
    return `[REDACTED:${kind}]`;
  });
}

function addFinding(findings: Map<string, number>, kind: string): void {
  findings.set(kind, (findings.get(kind) ?? 0) + 1);
}

function normalizeSecretKind(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/_/gu, "-");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
