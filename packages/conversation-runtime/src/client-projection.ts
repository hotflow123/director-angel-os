import type { ConversationRuntimeUnifiedEvent } from "./runtime-events.js";
import type { ConversationRuntimeResult } from "./types.js";
import { renderConversationRuntimeResultUserFacingText } from "./user-facing-reply-renderer.js";

export type ConversationRuntimeClientProjectionSurface =
  | "desktop.rich"
  | "wechat.text"
  | "cli.text"
  | "host.json";

export interface ConversationRuntimeClientProjectionInput {
  readonly surface: ConversationRuntimeClientProjectionSurface;
  readonly result: Pick<
    ConversationRuntimeResult,
    "finalText" | "events" | "replySource" | "runtimeEventsV1" | "userFacingProjection"
  >;
  readonly evidenceDisclosure?: unknown;
  readonly includeRunSteps?: boolean;
}

export interface ConversationRuntimeClientProjectionRunStep {
  readonly key: string;
  readonly kind: "command" | "tool" | "evidence" | "model" | "error";
  readonly state: "active" | "done" | "failed";
  readonly label: string;
}

export interface ConversationRuntimeClientProjection {
  readonly schemaVersion: "conversation-runtime.client-projection.v1";
  readonly surface: ConversationRuntimeClientProjectionSurface;
  readonly mainText: string;
  readonly text: string;
  readonly evidenceLines: readonly string[];
  readonly statusLines: readonly string[];
  readonly runSteps: readonly ConversationRuntimeClientProjectionRunStep[];
  readonly metadata: {
    readonly hasEvidence: boolean;
    readonly runStepCount: number;
  };
}

export function projectConversationRuntimeClientReply(
  input: ConversationRuntimeClientProjectionInput,
): ConversationRuntimeClientProjection {
  const mainText = renderConversationRuntimeResultUserFacingText(input.result).trim();
  const evidenceLines = createClientProjectionEvidenceLines(input.evidenceDisclosure);
  const runSteps =
    input.includeRunSteps === false
      ? []
      : createClientProjectionRunSteps(input.result.runtimeEventsV1 ?? []);
  const text =
    input.surface === "desktop.rich" || evidenceLines.length === 0
      ? mainText
      : [mainText, ...evidenceLines].filter((line) => line.trim().length > 0).join("\n\n");
  return {
    schemaVersion: "conversation-runtime.client-projection.v1",
    surface: input.surface,
    mainText,
    text,
    evidenceLines,
    statusLines: [],
    runSteps,
    metadata: {
      hasEvidence: evidenceLines.length > 0,
      runStepCount: runSteps.length,
    },
  };
}

function createClientProjectionRunSteps(
  events: readonly ConversationRuntimeUnifiedEvent[],
): readonly ConversationRuntimeClientProjectionRunStep[] {
  return events
    .map((event, index) => formatClientProjectionRuntimeEvent(event, index))
    .filter((step): step is ConversationRuntimeClientProjectionRunStep => step !== null);
}

function formatClientProjectionRuntimeEvent(
  event: ConversationRuntimeUnifiedEvent,
  index: number,
): ConversationRuntimeClientProjectionRunStep | null {
  if (
    event.kind === "tool.started" ||
    event.kind === "tool.completed" ||
    event.kind === "tool.failed"
  ) {
    const toolName = readRecordString(event.payload, "toolName") ?? "受控工具";
    const readableToolName = humanizeClientProjectionToolName(toolName);
    return {
      key: `runtime:${event.eventId ?? index}`,
      kind: "tool",
      state:
        event.kind === "tool.started" ? "active" : event.kind === "tool.failed" ? "failed" : "done",
      label:
        event.kind === "tool.started"
          ? `正在执行 ${readableToolName}`
          : event.kind === "tool.failed"
            ? `${readableToolName} 执行失败`
            : `已执行 ${readableToolName}`,
    };
  }
  if (event.kind === "evidence.read") {
    const sourceUrl = readRecordString(event.payload, "sourceUrl");
    return {
      key: `runtime:${event.eventId ?? index}`,
      kind: "evidence",
      state: "done",
      label: sourceUrl === undefined ? "已读取证据来源" : `已读取 ${sourceUrl}`,
    };
  }
  if (event.kind === "model.final") {
    return {
      key: `runtime:${event.eventId ?? index}`,
      kind: "model",
      state: "done",
      label: "已整理最终回复",
    };
  }
  if (event.kind === "turn.failed") {
    return {
      key: `runtime:${event.eventId ?? index}`,
      kind: "error",
      state: "failed",
      label: readRecordString(event.payload, "message") ?? "执行失败",
    };
  }
  return null;
}

function createClientProjectionEvidenceLines(evidenceDisclosure: unknown): readonly string[] {
  const source = readFirstClientProjectionEvidenceSource(evidenceDisclosure);
  if (source === null) {
    return [];
  }
  const sourceRef = readFirstRecordString(source, ["url", "sourceUrl", "sourceRef", "ref"]);
  if (sourceRef === undefined) {
    return [];
  }
  const fullBodyChars = readFirstRecordNumber(source, [
    "fullBodyChars",
    "fullTextChars",
    "bodyChars",
    "chars",
  ]);
  const readStatus = humanizeClientProjectionReadStatus(
    readFirstRecordString(source, ["readStatus", "status", "sourceAccessStatus"]),
  );
  const primaryLine = [
    `证据来源：${sourceRef}`,
    fullBodyChars === undefined ? undefined : `全文 ${fullBodyChars} 字符`,
    readStatus,
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ");
  const mediaLine = createClientProjectionMediaBoundaryLine(source);
  return mediaLine === undefined ? [primaryLine] : [primaryLine, mediaLine];
}

function readFirstClientProjectionEvidenceSource(
  evidenceDisclosure: unknown,
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(evidenceDisclosure)) {
    return null;
  }
  const sources = evidenceDisclosure.sources;
  if (Array.isArray(sources)) {
    const source = sources.find(isRecord);
    return source ?? null;
  }
  return evidenceDisclosure;
}

function createClientProjectionMediaBoundaryLine(
  source: Readonly<Record<string, unknown>>,
): string | undefined {
  const mediaCount = readFirstRecordNumber(source, ["mediaCount", "media_count"]);
  if (mediaCount === undefined || mediaCount <= 0) {
    return undefined;
  }
  const authorized =
    source.mediaUnderstandingAuthorized === true ||
    source.mediaAuthorized === true ||
    source.mediaUnderstandingStatus === "authorized" ||
    source.mediaUnderstandingStatus === "understood";
  if (authorized) {
    return `媒体已理解：文本已读，媒体 ${mediaCount} 个已授权理解。`;
  }
  return `媒体未理解：文本已读，媒体 ${mediaCount} 个尚未授权理解；未授权前不能把图片、视频或音频内容当结论。`;
}

function humanizeClientProjectionReadStatus(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "read" || normalized === "ready" || normalized === "success") {
    return "已读取";
  }
  if (normalized === "failed" || normalized === "error") {
    return "读取失败";
  }
  if (normalized === "pending") {
    return "待读取";
  }
  return value.trim().length > 0 ? value.trim() : undefined;
}

function humanizeClientProjectionToolName(value: string): string {
  return value
    .replace(/^director\./u, "")
    .split(/[._:-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function readFirstRecordString(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readRecordString(record, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readFirstRecordNumber(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readRecordString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
