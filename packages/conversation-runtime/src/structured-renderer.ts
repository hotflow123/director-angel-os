import type {
  ConversationRuntimeEvent,
  ConversationRuntimeReplySource,
  ConversationRuntimeResult,
  ConversationRuntimeTurnDecision,
} from "./types.js";
import { renderConversationRuntimeUserFacingFailureReply } from "./user-facing-reply-renderer.js";

export type ConversationRuntimeStructuredRenderCode =
  | "model-unavailable"
  | "production-final-unavailable"
  | "production-port-unavailable"
  | "turn-user-text"
  | "local-command"
  | "silent";

export interface ConversationRuntimeStructuredRenderInput {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly turn: ConversationRuntimeTurnDecision;
  readonly code: ConversationRuntimeStructuredRenderCode;
  readonly detail?: string;
}

export interface ConversationRuntimeStructuredRenderOutput {
  readonly replySource: ConversationRuntimeReplySource;
  readonly finalText?: string;
  readonly events: readonly ConversationRuntimeEvent[];
}

export interface ConversationRuntimeStructuredStatusTextInput {
  readonly title: string;
  readonly status: string;
  readonly reason: string;
  readonly detail?: string;
  readonly nextAction?: string;
  readonly runId?: string;
}

export interface ConversationRuntimeApprovalTextOptions {
  readonly trustedOperatorApproveText?: string;
  readonly trustedOperatorRejectText?: string;
  readonly desktopFallback?: boolean;
  readonly compact?: boolean;
}

export interface ConversationRuntimeApprovalDecisionTextInput {
  readonly title?: string;
  readonly status: string;
  readonly toolName?: string;
  readonly reason?: string;
  readonly detail?: string;
  readonly resultText?: string;
  readonly nextAction?: string;
  readonly actorKind?: "requester" | "trusted-operator" | "desktop-operator" | (string & {});
  readonly maxResultChars?: number;
  readonly includeMachineStatus?: boolean;
  readonly userFacing?: boolean;
}

interface AgentOsProcessCapabilityLedgerSummaryLike {
  readonly totalEntries: number;
  readonly riskyHostEntries: number;
  readonly entries: readonly AgentOsProcessCapabilityLedgerEntryLike[];
}

interface AgentOsProcessCapabilityLedgerEntryLike {
  readonly runnerKind: string;
  readonly status: string;
  readonly backend?: string;
  readonly command?: string;
  readonly operationId?: string;
  readonly process?: {
    readonly pid?: number;
  };
}

export function renderConversationRuntimeStructuredReply(
  input: ConversationRuntimeStructuredRenderInput,
): ConversationRuntimeStructuredRenderOutput {
  if (input.code === "silent") {
    return {
      replySource: "structured-renderer",
      events: [],
    };
  }

  if (input.code === "model-unavailable") {
    const internalMessage =
      input.detail ?? "模型不可用：当前没有可用的模型供应方，无法处理这条对话。";
    const reply = renderConversationRuntimeUserFacingFailureReply({
      code: "model_unavailable",
      message: internalMessage,
    });
    return {
      replySource: "degraded-error",
      finalText: reply.text,
      events: [
        {
          id: `${input.turnId}:degraded:model-unavailable`,
          kind: "runtime.error",
          turnId: input.turnId,
          sessionKey: input.sessionKey,
          occurredAtMs: input.occurredAtMs,
          payload: {
            message: internalMessage,
            code: reply.kind,
            recoverable: true,
          },
        },
      ],
    };
  }

  if (input.code === "production-port-unavailable") {
    const text =
      input.detail ?? "制作运行时不可用：当前没有可用的制作执行端口，无法启动或继续这次任务。";
    return {
      replySource: "degraded-error",
      finalText: text,
      events: [
        {
          id: `${input.turnId}:degraded:production-port-unavailable`,
          kind: "runtime.error",
          turnId: input.turnId,
          sessionKey: input.sessionKey,
          occurredAtMs: input.occurredAtMs,
          payload: {
            message: text,
            code: "production_port_unavailable",
            recoverable: true,
          },
        },
      ],
    };
  }

  if (input.code === "production-final-unavailable") {
    const text = input.detail ?? "制作运行没有返回模型生成的最终成品，已按降级状态处理。";
    return {
      replySource: "degraded-error",
      events: [
        {
          id: `${input.turnId}:degraded:production-final-unavailable`,
          kind: "runtime.error",
          turnId: input.turnId,
          sessionKey: input.sessionKey,
          occurredAtMs: input.occurredAtMs,
          payload: {
            message: text,
            code: "production_final_unavailable",
            recoverable: true,
          },
        },
      ],
    };
  }

  if (input.code === "turn-user-text") {
    const text = input.turn.userText.trim();
    return {
      replySource: "structured-renderer",
      ...(text.length === 0 ? {} : { finalText: text }),
      events:
        text.length === 0
          ? []
          : [
              {
                id: `${input.turnId}:structured:turn-user-text`,
                kind: "runtime.final",
                turnId: input.turnId,
                sessionKey: input.sessionKey,
                occurredAtMs: input.occurredAtMs,
                payload: {
                  text,
                  responsePolicy: input.turn.responsePolicy,
                  audience: input.turn.audience,
                  replySource: "structured-renderer",
                },
              },
            ],
    };
  }

  const commandName =
    input.turn.intent.command?.name ?? input.turn.intent.command?.raw ?? input.turn.intent.kind;
  const text = `命令已解析：${commandName}`;
  return {
    replySource: "structured-renderer",
    finalText: text,
    events: [
      {
        id: `${input.turnId}:structured:local-command`,
        kind: "runtime.final",
        turnId: input.turnId,
        sessionKey: input.sessionKey,
        occurredAtMs: input.occurredAtMs,
        payload: {
          text,
          responsePolicy: input.turn.responsePolicy,
          audience: input.turn.audience,
          replySource: "structured-renderer",
        },
      },
    ],
  };
}

export function renderConversationRuntimeStructuredStatusText(
  input: ConversationRuntimeStructuredStatusTextInput,
): string {
  return [
    input.title,
    `  status: ${input.status}`,
    `  reason: ${input.reason}`,
    ...(input.detail === undefined ? [] : [`  detail: ${input.detail}`]),
    ...(input.runId === undefined ? [] : [`  run id: ${input.runId}`]),
    ...(input.nextAction === undefined ? [] : [`  next action: ${input.nextAction}`]),
  ].join("\n");
}

export function renderConversationRuntimeApprovalText(
  runtimeResult: Pick<ConversationRuntimeResult, "events">,
  options: ConversationRuntimeApprovalTextOptions = {},
): string | null {
  const approvalEvent = runtimeResult.events.find(isRuntimeApprovalEvent);
  const approval = approvalEvent?.payload.approval;
  if (approval === undefined) {
    return null;
  }
  const metadata = approval.metadata;
  const toolName =
    isObject(metadata) && typeof metadata.toolName === "string"
      ? metadata.toolName
      : "runtime.tool";
  const permissionStatus =
    isObject(metadata) && typeof metadata.permissionStatus === "string"
      ? metadata.permissionStatus
      : approval.status;
  const summary =
    typeof approval.summary === "string" && approval.summary.trim().length > 0
      ? humanizeApprovalSummary(approval.summary.trim())
      : `${toolName} 需要确认后才能执行。`;
  const approveText = options.trustedOperatorApproveText ?? "approve";
  const rejectText = options.trustedOperatorRejectText ?? "reject";
  const nextAction =
    permissionStatus === "ask" && options.desktopFallback
      ? `请在桌面端确认，或回复「${approveText}」继续执行，回复「${rejectText}」取消。`
      : `回复「${approveText}」继续执行，回复「${rejectText}」取消。`;
  const processLedgerLines = formatAgentOsProcessCapabilityLedgerApprovalLines(metadata);
  if (options.compact === true) {
    return [approval.title, summary, ...processLedgerLines, nextAction]
      .filter((line) => line.trim().length > 0)
      .join("\n");
  }

  return renderConversationRuntimeStructuredStatusText({
    title: "Runtime tool approval:",
    status: approval.status,
    reason: processLedgerLines.length === 0 ? summary : [summary, ...processLedgerLines].join("\n"),
    detail: `tool: ${toolName}`,
    nextAction,
  });
}

export function renderConversationRuntimeApprovalDecisionText(
  input: ConversationRuntimeApprovalDecisionTextInput,
): string {
  const parsedDetail = parseApprovalDecisionDetail(input.detail);
  const status = input.status.trim() || "unknown";
  const toolName =
    normalizeApprovalText(input.toolName) ??
    normalizeApprovalText(parsedDetail.toolName) ??
    "受控工具";
  const rawResultText = normalizeApprovalText(input.resultText) ?? parsedDetail.resultText;
  const resultText =
    input.userFacing === true ? humanizeApprovalResultText(rawResultText) : rawResultText;
  const summary = formatApprovalDecisionSummary(status, input.actorKind);
  const nextAction =
    normalizeApprovalText(input.nextAction) ?? formatApprovalDecisionNextAction(status);
  const visibleNextAction =
    input.userFacing === true ? humanizeApprovalNextAction(nextAction) : nextAction;
  const lines = [
    normalizeApprovalText(input.title) ?? "工具确认",
    ...(input.includeMachineStatus === false ? [] : [`status: ${status}`]),
    summary,
    `工具：${toolName}`,
    ...(resultText === undefined
      ? []
      : [`结果：${truncateApprovalResult(resultText, input.maxResultChars ?? 900)}`]),
    ...(visibleNextAction === undefined ? [] : [`下一步：${visibleNextAction}`]),
  ];
  return lines.filter((line) => line.trim().length > 0).join("\n");
}

function humanizeApprovalSummary(summary: string): string {
  return summary
    .replace(/当前请求者不是可信操作员/gu, "当前联系人没有权限")
    .replace(/当前微信联系人不是可信操作员/gu, "当前联系人没有权限")
    .replace(/可信操作员/gu, "你");
}

function isRuntimeApprovalEvent(
  event: ConversationRuntimeEvent,
): event is ConversationRuntimeEvent<"runtime.approval"> {
  return event.kind === "runtime.approval";
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatAgentOsProcessCapabilityLedgerApprovalLines(metadata: unknown): readonly string[] {
  const ledger = readAgentOsProcessCapabilityLedger(metadata);
  if (ledger === null || ledger.totalEntries <= 0) {
    return [];
  }
  return [
    `Agent OS 进程账本：total=${ledger.totalEntries} host=${ledger.riskyHostEntries}`,
    ...ledger.entries.slice(0, 3).map(formatAgentOsProcessCapabilityLedgerEntry),
  ];
}

function readAgentOsProcessCapabilityLedger(
  metadata: unknown,
): AgentOsProcessCapabilityLedgerSummaryLike | null {
  const direct = readAgentOsProcessCapabilityLedgerFromRecord(metadata);
  if (direct !== null) {
    return direct;
  }
  return readAgentOsProcessCapabilityLedgerFromRecord(
    isObject(metadata) ? metadata.decisionMetadata : undefined,
  );
}

function readAgentOsProcessCapabilityLedgerFromRecord(
  value: unknown,
): AgentOsProcessCapabilityLedgerSummaryLike | null {
  if (!isObject(value)) {
    return null;
  }
  const ledger = value.agentOsProcessCapabilityLedger;
  if (!isObject(ledger) || !Array.isArray(ledger.entries)) {
    return null;
  }
  const totalEntries = readFiniteNumber(ledger.totalEntries);
  const riskyHostEntries = readFiniteNumber(ledger.riskyHostEntries);
  if (totalEntries === undefined || riskyHostEntries === undefined) {
    return null;
  }
  const entries = ledger.entries.flatMap((entry): AgentOsProcessCapabilityLedgerEntryLike[] => {
    if (
      !isObject(entry) ||
      typeof entry.runnerKind !== "string" ||
      typeof entry.status !== "string"
    ) {
      return [];
    }
    return [
      {
        runnerKind: entry.runnerKind,
        status: entry.status,
        ...(typeof entry.backend === "string" ? { backend: entry.backend } : {}),
        ...(typeof entry.command === "string" ? { command: entry.command } : {}),
        ...(typeof entry.operationId === "string" ? { operationId: entry.operationId } : {}),
        ...(isObject(entry.process) && typeof entry.process.pid === "number"
          ? { process: { pid: entry.process.pid } }
          : {}),
      },
    ];
  });
  return { totalEntries, riskyHostEntries, entries };
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatAgentOsProcessCapabilityLedgerEntry(
  entry: AgentOsProcessCapabilityLedgerEntryLike,
): string {
  return [
    entry.runnerKind,
    ...(entry.backend === undefined ? [] : [`backend=${entry.backend}`]),
    `status=${entry.status}`,
    ...(entry.command === undefined
      ? []
      : [`command=${truncateApprovalInlineValue(entry.command, 120)}`]),
    ...(entry.operationId === undefined ? [] : [`operation=${entry.operationId}`]),
    ...(entry.process?.pid === undefined ? [] : [`pid=${entry.process.pid}`]),
  ].join(" ");
}

function truncateApprovalInlineValue(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatApprovalDecisionSummary(
  status: string,
  actorKind: ConversationRuntimeApprovalDecisionTextInput["actorKind"],
): string {
  if (status === "approved") {
    return actorKind === "trusted-operator"
      ? "可信操作员已确认，工具已执行。"
      : "已确认，工具已执行。";
  }
  if (status === "failed") {
    return "已收到确认，但工具执行失败。";
  }
  if (status === "rejected") {
    return actorKind === "trusted-operator"
      ? "可信操作员已拒绝，本次工具不会执行。"
      : "已拒绝，本次工具不会执行。";
  }
  if (status === "untrusted") {
    return "这条确认没有执行：只有发起人或可信操作员可以处理。";
  }
  if (status === "missing") {
    return "没有找到仍在等待确认的工具操作。";
  }
  if (status === "expired") {
    return "这条确认已过期，没有执行。";
  }
  return "工具确认状态已更新。";
}

function formatApprovalDecisionNextAction(status: string): string | undefined {
  if (status === "failed") {
    return "查看工具结果后重试，或换一个更安全的操作方式。";
  }
  if (status === "untrusted") {
    return "请让发起人回复确认/拒绝，或由可信操作员处理。";
  }
  if (status === "missing" || status === "expired") {
    return "重新发起需要工具的请求。";
  }
  return undefined;
}

function parseApprovalDecisionDetail(detail: string | undefined): {
  readonly toolName?: string;
  readonly resultText?: string;
} {
  const text = normalizeApprovalText(detail);
  if (text === undefined) {
    return {};
  }
  const toolMatch = /^tool:\s*(.+)$/imu.exec(text);
  const resultMatch = /^result:\s*([\s\S]+)$/imu.exec(text);
  return {
    ...(toolMatch?.[1] === undefined ? {} : { toolName: toolMatch[1].trim() }),
    ...(resultMatch?.[1] === undefined ? {} : { resultText: resultMatch[1].trim() }),
  };
}

function humanizeApprovalResultText(value: string | undefined): string | undefined {
  const text = normalizeApprovalText(value);
  if (text === undefined) {
    return undefined;
  }
  const summary = readApprovalResultField(text, "summary");
  if (summary !== undefined) {
    return summary;
  }
  const message = readApprovalResultField(text, "message");
  if (message !== undefined && !isMachineApprovalResultLine(message)) {
    return message;
  }
  const readableLines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isMachineApprovalResultLine(line));
  return readableLines.length === 0 ? undefined : readableLines.slice(0, 3).join("\n");
}

function humanizeApprovalNextAction(value: string | undefined): string | undefined {
  const text = normalizeApprovalText(value);
  if (text === undefined) {
    return undefined;
  }
  const replacements: Array<[RegExp, string]> = [
    [
      /ask the requester or a trusted operator to approve or reject the pending tool call/iu,
      "请让发起人回复确认/拒绝，或由可信操作员处理。",
    ],
    [
      /inspect the runtime tool result before retrying/iu,
      "查看工具结果后重试，或换一个更安全的操作方式。",
    ],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) {
      return replacement;
    }
  }
  return text;
}

function readApprovalResultField(text: string, field: string): string | undefined {
  const pattern = new RegExp(`^${field}\\s*[:：]\\s*(.+)$`, "imu");
  return normalizeApprovalText(pattern.exec(text)?.[1]);
}

function isMachineApprovalResultLine(line: string): boolean {
  return /^(?:status|skill_id|enabled|snapshot_version|next_actions|server|config_path|test_status|tool_count|inherited_source)\s*[:：]/iu.test(
    line,
  );
}

function normalizeApprovalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

function truncateApprovalResult(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
