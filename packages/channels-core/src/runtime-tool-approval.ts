export type ChannelRuntimeToolApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ChannelRuntimeToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly readOnly?: boolean;
  readonly requiresApproval?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ChannelRuntimeToolApprovalRecord {
  readonly schemaVersion: "director.channel.runtime-tool-approval.v1";
  readonly approvalId: string;
  readonly status: ChannelRuntimeToolApprovalStatus;
  readonly channel: string;
  readonly peerId: string;
  readonly requestedByPeerId?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly toolName: string;
  readonly toolCall: ChannelRuntimeToolCall;
  readonly eventId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly sourceMessageId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt?: string;
  readonly decidedByPeerId?: string;
  readonly result?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ChannelRuntimeToolApprovalDecision = "approve" | "reject";

export interface ChannelRuntimeToolApprovalIntent {
  readonly decision: ChannelRuntimeToolApprovalDecision;
}

export const CHANNEL_RUNTIME_TOOL_APPROVAL_DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

export function parseChannelRuntimeToolApprovalIntent(
  text: string,
): ChannelRuntimeToolApprovalIntent | null {
  const normalized = text.trim().replace(/\s+/gu, "");
  if (normalized.length === 0) {
    return null;
  }
  if (/^(确认|批准|同意|执行|继续)(这个|该)?(工具|能力|操作|审批|确认)?$/u.test(normalized)) {
    return { decision: "approve" };
  }
  if (
    /^(拒绝|取消|不同意|不要|别执行|停止)(这个|该)?(工具|能力|操作|审批|确认)?$/u.test(normalized)
  ) {
    return { decision: "reject" };
  }
  if (/^(不要|不用|别|先别|暂不)(执行|继续执行|操作)$/u.test(normalized)) {
    return { decision: "reject" };
  }
  return null;
}

export function expireChannelRuntimeToolApprovalRecords(
  records: readonly ChannelRuntimeToolApprovalRecord[],
  options: {
    readonly now?: string | Date;
    readonly maxAgeMs?: number;
  } = {},
): {
  readonly expiredCount: number;
  readonly records: readonly ChannelRuntimeToolApprovalRecord[];
} {
  const nowDate =
    options.now instanceof Date
      ? options.now
      : typeof options.now === "string"
        ? new Date(options.now)
        : new Date();
  const nowMs = nowDate.getTime();
  const maxAgeMs =
    typeof options.maxAgeMs === "number" && Number.isFinite(options.maxAgeMs)
      ? Math.max(0, options.maxAgeMs)
      : CHANNEL_RUNTIME_TOOL_APPROVAL_DEFAULT_MAX_AGE_MS;
  if (!Number.isFinite(nowMs)) {
    return { expiredCount: 0, records };
  }

  const nowIso = nowDate.toISOString();
  let expiredCount = 0;
  const next = records.map((record) => {
    if (record.status !== "pending") {
      return record;
    }
    const updatedAtMs = Date.parse(record.updatedAt);
    const createdAtMs = Date.parse(record.createdAt);
    const basisMs = Number.isFinite(updatedAtMs)
      ? updatedAtMs
      : Number.isFinite(createdAtMs)
        ? createdAtMs
        : nowMs;
    if (nowMs - basisMs <= maxAgeMs) {
      return record;
    }
    expiredCount += 1;
    return {
      ...record,
      status: "expired" as const,
      updatedAt: nowIso,
      decidedAt: nowIso,
      metadata: {
        ...(record.metadata ?? {}),
        expiredReason: "runtime-tool-approval-timeout",
        maxAgeMs,
      },
    };
  });

  return { expiredCount, records: next };
}

export function buildChannelRuntimeToolApprovalReply(input: {
  readonly permissionStatus?: string;
  readonly toolName?: string;
  readonly summary?: string;
  readonly untrustedRequester?: boolean;
  readonly trustedOperatorApproveText?: string;
  readonly trustedOperatorRejectText?: string;
  readonly desktopFallback?: boolean;
}): string {
  const toolName =
    typeof input.toolName === "string" && input.toolName.trim().length > 0
      ? input.toolName.trim()
      : "这个能力";
  const summary =
    typeof input.summary === "string" && input.summary.trim().length > 0
      ? input.summary.trim()
      : `${toolName} 需要确认后才能执行。`;

  if (input.permissionStatus === "ask" || input.untrustedRequester === true) {
    const lines = ["这个操作会改系统能力，已先停住，没有直接执行。"];
    const approve = input.trustedOperatorApproveText ?? "确认";
    const reject = input.trustedOperatorRejectText ?? "拒绝";
    lines.push(`回复「${approve}」继续执行，或回复「${reject}」取消。`);
    if (input.desktopFallback === true) {
      lines.push("也可以选择在桌面端确认。");
    }
    return lines.join("\n");
  }

  return summary;
}
