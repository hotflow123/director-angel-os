export type ConversationRuntimeUserFacingFailureKind =
  | "model_unavailable"
  | "provider_missing_key"
  | "provider_upstream_failed"
  | "tool_failed"
  | "channel_delivery_failed"
  | "user_stopped"
  | "permission_denied"
  | "source_access_limited"
  | "runtime_failed";

export interface ConversationRuntimeUserFacingFailure {
  readonly kind: ConversationRuntimeUserFacingFailureKind;
  readonly recoverable: boolean;
  readonly internalMessage?: string;
}

export interface ClassifyConversationRuntimeFailureInput {
  readonly error?: unknown;
  readonly code?: string;
  readonly message?: string;
}

export function classifyConversationRuntimeFailure(
  input: ClassifyConversationRuntimeFailureInput,
): ConversationRuntimeUserFacingFailure {
  const internalMessage = normalizeFailureMessage(input);
  const explicitCodeFailure = classifyExplicitFailureCode(input.code, internalMessage);
  if (explicitCodeFailure !== undefined) {
    return explicitCodeFailure;
  }
  const text = [input.code ?? "", internalMessage].join("\n");
  if (/iLink\s+sendmessage\s+failed|sendmessage\s+failed|channel[_ -]?delivery/iu.test(text)) {
    return {
      kind: "channel_delivery_failed",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  if (/source[_ -]?access[_ -]?limited|captcha|verify|验证|访问受限|环境异常/iu.test(text)) {
    return {
      kind: "source_access_limited",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  if (looksLikeProviderMissingKey(text)) {
    return {
      kind: "provider_missing_key",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  if (looksLikeProviderUpstreamFailure(text)) {
    return {
      kind: "provider_upstream_failed",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  if (/model[_ -]?unavailable|provider|model|api|模型|供应方/iu.test(text)) {
    return {
      kind: "model_unavailable",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  if (/permission|approval|sandbox|denied|rejected|权限|确认|拒绝/iu.test(text)) {
    return {
      kind: "permission_denied",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  if (/abort|cancel|stop|interrupt|停止|取消|中断/iu.test(text)) {
    return {
      kind: "user_stopped",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  if (/tool|mcp|browser|exec|工具/iu.test(text)) {
    return {
      kind: "tool_failed",
      recoverable: true,
      ...(internalMessage === undefined ? {} : { internalMessage }),
    };
  }
  return {
    kind: "runtime_failed",
    recoverable: true,
    ...(internalMessage === undefined ? {} : { internalMessage }),
  };
}

export function toConversationRuntimeFailureCode(
  failure: ConversationRuntimeUserFacingFailure,
): string {
  return failure.kind;
}

function normalizeFailureMessage(
  input: ClassifyConversationRuntimeFailureInput,
): string | undefined {
  if (typeof input.message === "string" && input.message.trim().length > 0) {
    return input.message.trim();
  }
  if (input.error instanceof Error && input.error.message.trim().length > 0) {
    return input.error.message.trim();
  }
  if (input.error !== undefined) {
    const message = String(input.error).trim();
    return message.length === 0 ? undefined : message;
  }
  return undefined;
}

function classifyExplicitFailureCode(
  code: string | undefined,
  internalMessage: string | undefined,
): ConversationRuntimeUserFacingFailure | undefined {
  switch (code) {
    case "model_unavailable": {
      const text = internalMessage ?? "";
      if (looksLikeProviderMissingKey(text)) {
        return {
          kind: "provider_missing_key",
          recoverable: true,
          ...(internalMessage === undefined ? {} : { internalMessage }),
        };
      }
      if (looksLikeProviderUpstreamFailure(text)) {
        return {
          kind: "provider_upstream_failed",
          recoverable: true,
          ...(internalMessage === undefined ? {} : { internalMessage }),
        };
      }
      return {
        kind: "model_unavailable",
        recoverable: true,
        ...(internalMessage === undefined ? {} : { internalMessage }),
      };
    }
    case "provider_missing_key":
    case "provider_upstream_failed":
    case "tool_failed":
    case "channel_delivery_failed":
    case "user_stopped":
    case "permission_denied":
    case "source_access_limited":
    case "runtime_failed":
      return {
        kind: code,
        recoverable: true,
        ...(internalMessage === undefined ? {} : { internalMessage }),
      };
    default:
      return undefined;
  }
}

function looksLikeProviderUpstreamFailure(text: string): boolean {
  return /(?:http\s*)?(?:status\s*)?(?:408|409|425|429|5\d\d)\b|service\s+unavailable|bad\s+gateway|gateway\s+timeout|rate\s*limit|too\s+many\s+requests|fetch\s+failed|network|timeout|timed?\s*out|econnreset|econnrefused|enotfound|etimedout|上游|供应方.*(?:失败|超时|不可用)|模型调用失败：?(?:HTTP|fetch failed|network|timeout|timed?\s*out|econnreset|econnrefused|enotfound|etimedout)/iu.test(
    text,
  );
}

function looksLikeProviderMissingKey(text: string): boolean {
  return /missing[_ -]?(?:api[_ -]?)?key|no\s+api\s+key|api\s+key\s+(?:missing|not\s+configured|is\s+required)|未配置.*key|key\s*未配置|没有可用的\s*API\s*Key/iu.test(
    text,
  );
}
