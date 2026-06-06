import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  type ChannelSlashCommandEnvelope,
  appendRecentChannelContext,
  buildSafeRewriteObjective,
  createProductionResultSystemPrompt,
  evaluateProductionContentSafety,
  humanizeProductionResultText,
  isSafeRewriteConfirmation,
  looksLikeChannelContextOnlyMessage,
  looksLikeProductionSupplement,
  needsHumanTraffickingBoundary,
  orchestrateConversationTurn,
  parseChannelRuntimeToolApprovalIntent,
  parseChannelConfirmation as parseConfirmation,
  renderChannelCapabilityOverviewProjection,
  renderChannelLearningStatusProjection,
  renderChannelWorkspaceStatusProjection,
  selectRecentChannelContextLines,
} from "@hotflow/channels-core";
import type { ChannelRuntimeToolApprovalIntent } from "@hotflow/channels-core";
import {
  type ConversationRuntimeAttachment,
  type ConversationRuntimeBrowserToolProvider,
  type ConversationRuntimeCapabilityPacket,
  type ConversationRuntimeEvent,
  type ConversationRuntimeLearningArtifactProjectionInput,
  type ConversationRuntimeLearningProjectionCandidate,
  type ConversationRuntimeLearningProjectionEvidence,
  type ConversationRuntimeLearningProjectionFailure,
  type ConversationRuntimeMcpServerConfig,
  type ConversationRuntimeModelToolDefinition,
  type ConversationRuntimeModelToolMessage,
  type ConversationRuntimeReplySource,
  type ConversationRuntimeResult,
  type ConversationRuntimeTurnDecision,
  type ConversationRuntimeUserFacingProjection,
  type ExternalProviderAuthConfig,
  type ExternalProviderStoredConfig,
  type ExternalToolCheckFunction,
  createAsyncConversationRuntimeToolRegistry,
  createBuiltinBrowserToolExecutors,
  createBuiltinExternalProviderManifests,
  createBuiltinWebToolExecutors,
  createBuiltinXToolExecutors,
  createConversationRunRegistry,
  createConversationRuntimeLearningArtifactProjection,
  createConversationRuntimeMcpClient,
  createConversationRuntimeMemoryRetrievalProviderRegistry,
  createConversationRuntimeWritableMergedMcpServers,
  createDefaultConversationRuntimeToolHooks,
  createDirectorConversationRuntimeTools,
  createExternalProviderAuthRegistry,
  createFileConversationRunRegistryStore,
  createFileConversationRuntimeToolEvidenceStore,
  createFileConversationRuntimeWebExtractArtifactReader,
  createFileConversationRuntimeWebExtractArtifactStore,
  createFileLearningArtifactStore,
  createMcpToolExecutor,
  createPendingLearningArtifactFromResult,
  createSourceAccessLimitedLearningArtifactFromRuntimeResult,
  createToolSearchExecutor,
  isActiveConversationTurnRunStatus,
  loadConversationRuntimeMergedMcpConfig,
  orchestrateConversationRuntimeUrlLearningRead,
  projectConversationRuntimeClientReply,
  renderConversationRuntimeApprovalDecisionText,
  renderConversationRuntimeApprovalText,
  renderConversationRuntimeStructuredReply,
  renderConversationRuntimeStructuredStatusText,
  renderConversationRuntimeUserFacingFailureReply,
  resolveEffectiveModelTools,
  runConversationRuntimeChannelTurn,
  runConversationRuntimeTurn,
  writeConversationRuntimeMcpJsonConfig,
} from "@hotflow/conversation-runtime";
import {
  type DirectorWorkingMemoryRecallBlockLike,
  resolveDirectorWorkspaceCapabilityContext,
} from "@hotflow/director-knowledge";
import {
  type DirectorApiProviderTextCompletionCapabilityRoute,
  createDirectorComfyUiVisibleWorkflowDraft,
  loadDirectorApiProviderConfig,
  loadDirectorComfyUiConfig,
  loadDirectorSwitchState,
  parseDirectorComfyUiWorkflowDraftIntent,
  publishDirectorComfyUiTemplateBridge,
  runDirectorApiProviderTextCompletion,
  runDirectorComfyUiWorkflow,
} from "@hotflow/director-runtime";
import { runDirectorWorkerOnce } from "@hotflow/director-worker";
import { createDefaultRuntimeMemory } from "@hotflow/runtime-bootstrap";
import { formatSkillExplanationSurfaceForToolObservation } from "@hotflow/skills";

import {
  type DirectorGatewayOptions,
  type DirectorGatewayResult,
  type DirectorKnowledgeAction,
  type DirectorRunControlAction,
  type DirectorSkillProposalAction,
  actOnDirectorExperienceCandidate,
  actOnDirectorKnowledgeCandidate,
  actOnDirectorSkillProposal,
  applyDirectorMaintenanceFromGateway,
  checkDirectorSkillCuratorWriteGuard,
  confirmDirectorRun,
  controlDirectorRun,
  extractDirectorGatewaySessionSnapshot,
  followupDirectorClientRuntimeTask,
  getDirectorClientRuntimeTask,
  getDirectorEntrySessionStatus,
  getDirectorRun,
  getDirectorRunDelegations,
  governDirectorMemoryPublication,
  invokeDirectorTool,
  learnDirectorFromDirectory,
  learnDirectorFromQuery,
  learnDirectorFromText,
  learnDirectorFromUrl,
  listDirectorExperienceCandidates,
  listDirectorKnowledgeCandidates,
  listDirectorSkillProposals,
  listDirectorSkills,
  previewDirectorKnowledgeRecall,
  previewDirectorMaintenance,
  previewDirectorMemoryRecall,
  proposeDirectorSkillFromExperience,
  readDirectorMemoryStatus,
  readDirectorRuntimeCapabilitySnapshot,
  readDirectorToolsEffective,
  sendMessageToDirector,
  setDirectorSkillEnablement,
  stopDirectorClientRuntimeTask,
  useDirectorSkill,
  viewDirectorSkill,
} from "./director-client.js";
import {
  SESSION_EXPIRED_ERRCODE,
  extractWeixinText,
  getWeixinUpdates,
  notifyWeixinStart,
  notifyWeixinStop,
  sendWeixinTextMessage,
} from "./ilink.js";
import {
  type PeerDirectorSessionState,
  type WeixinRuntimeToolApprovalRecord,
  appendPeerConversationTurn,
  claimWeixinMessageForProcessing,
  expireWeixinRuntimeToolApprovals,
  findPendingWeixinRuntimeToolApproval,
  getContextToken,
  loadDeliveredWeixinSubagentAnnounceIds,
  loadPeerConversationTurns,
  loadPeerSession,
  loadSyncBuf,
  markWeixinMessageProcessed,
  markWeixinMessageProcessingFailed,
  markWeixinSubagentAnnouncesDelivered,
  normalizeWeixinPeerId,
  saveContextToken,
  savePeerSession,
  saveSyncBuf,
  saveWeixinRuntimeToolApproval,
  updateWeixinRuntimeToolApproval,
} from "./store.js";
import type { FetchLike, WeixinAccount, WeixinMessage } from "./types.js";

type WeixinExternalProviderAuthConfig = ExternalProviderAuthConfig;

export type WeixinDmPolicy = "open" | "allowlist" | "disabled";

export interface WeixinWorkerRunOnceResult {
  readonly run: {
    readonly runId: string;
    readonly status: string;
    readonly goal?: string;
    readonly previewSummary?: string;
    readonly assignments?: readonly {
      readonly assignmentId?: string;
      readonly role?: string;
      readonly status?: string;
      readonly result?: {
        readonly summary?: string;
      };
    }[];
  };
  readonly report: {
    readonly reportId: string;
    readonly flags?: readonly string[];
    readonly summary?: readonly string[];
    readonly operatorSurface?: {
      readonly directorGoal?: string;
      readonly operatorSummary?: string;
      readonly objective?: string;
      readonly deliverable?: string;
      readonly adapterRoute?: string;
      readonly bridgeVerdict?: string;
      readonly bridgeFailureReason?: string;
      readonly requestAccepted?: boolean;
      readonly requestId?: string;
      readonly nextAction?: string;
    };
  };
  readonly executedAssignments: readonly string[];
}

interface WeixinActiveRunStatusSnapshot {
  readonly run?: {
    readonly runId?: string;
    readonly status?: string;
  };
  readonly runtimeWarningSummary?: string;
  readonly report?: {
    readonly operatorSurface?: {
      readonly operatorSummary?: string;
      readonly nextAction?: string;
    };
  };
}

interface WeixinSubagentAnnounce {
  readonly announceId?: string;
  readonly requesterSessionKey?: string;
  readonly requesterOrigin?: string;
  readonly deliveryTarget?: string;
  readonly userFacingText?: string;
}

interface WeixinCapabilityCommandResult {
  readonly reply: string;
}

interface WeixinDynamicChatReply {
  readonly reply: string;
  readonly source: "conversation-runtime";
  readonly replySource: ConversationRuntimeReplySource;
  readonly providerId?: string | null;
  readonly model?: string | null;
  readonly message?: string | null;
  readonly runtimeResult?: ConversationRuntimeResult;
}

interface WeixinRuntimeToolTurnCache {
  readonly experienceCandidates: Map<string, Record<string, unknown>>;
}

export type WeixinRunWorkerOnce = (input: {
  readonly runId: string;
  readonly workerId: string;
}) => Promise<WeixinWorkerRunOnceResult>;

type RuntimeFetch = typeof fetch;
type WeixinApiProviderFetchInit = {
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: string | FormData;
  readonly signal?: AbortSignal;
};
type WeixinApiProviderFetchAdapter = (
  url: string,
  init: WeixinApiProviderFetchInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  text(): Promise<string>;
}>;

export interface WeixinGatewayConfig {
  readonly home: string;
  readonly workspaceRoot?: string;
  readonly account: WeixinAccount;
  readonly director: DirectorGatewayOptions;
  readonly dmPolicy: WeixinDmPolicy;
  readonly allowedUsers: readonly string[];
  readonly trustedOperatorUsers?: readonly string[];
  readonly useHostToolControlPlane?: boolean;
  readonly fetchFn?: FetchLike;
  readonly apiProviderFetch?: FetchLike;
  readonly runWorkerOnce?: WeixinRunWorkerOnce;
  readonly log?: (message: string) => void;
  readonly error?: (message: string) => void;
}

function createWeixinRuntimeFetch(fetchFn: FetchLike | undefined): RuntimeFetch | undefined {
  if (fetchFn === undefined) {
    return undefined;
  }
  return (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = normalizeFetchHeaders(
      (init as { readonly headers?: unknown } | undefined)?.headers,
    );
    const response = await fetchFn(url, {
      ...(init?.method === undefined ? {} : { method: init.method }),
      ...(headers === undefined ? {} : { headers }),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
      ...(init?.signal === null || init?.signal === undefined ? {} : { signal: init.signal }),
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText ?? "",
      headers: {
        get(name: string) {
          return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null;
        },
      },
      url,
      async text() {
        return await response.text();
      },
    } as unknown as Response;
  }) as RuntimeFetch;
}

function createWeixinApiProviderFetchAdapter(
  fetchFn: FetchLike | undefined,
): WeixinApiProviderFetchAdapter | undefined {
  if (fetchFn === undefined) {
    return undefined;
  }
  return async (url, init) => {
    if (init.body !== undefined && typeof init.body !== "string") {
      throw new Error(
        "Weixin API provider fetch adapter does not support multipart request bodies.",
      );
    }
    const response = await fetchFn(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
    if (response === undefined) {
      throw new Error("API provider fetch adapter returned no response.");
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText ?? "",
      text: response.text.bind(response),
    };
  };
}

function normalizeFetchHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map(([key, item]) => [String(key), String(item)]));
  }
  if (typeof value === "object" && value !== null) {
    const maybeHeaders = value as {
      readonly forEach?: (callback: (value: string, key: string) => void) => void;
    };
    if (typeof maybeHeaders.forEach === "function") {
      const headers: Record<string, string> = {};
      maybeHeaders.forEach((item, key) => {
        headers[key] = item;
      });
      return headers;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
  }
  return undefined;
}

function defaultLog(message: string): void {
  console.log(message);
}

function defaultError(message: string): void {
  console.error(message);
}

function isAllowed(config: WeixinGatewayConfig, peerId: string): boolean {
  if (config.dmPolicy === "disabled") {
    return false;
  }
  if (config.dmPolicy === "allowlist") {
    return config.allowedUsers.includes(peerId);
  }
  return true;
}

function isTrustedOperator(config: WeixinGatewayConfig, peerId: string | undefined): boolean {
  const normalizedPeerId = peerId?.trim();
  if (normalizedPeerId === undefined || normalizedPeerId.length === 0) {
    return false;
  }
  const explicitTrustedUsers = config.trustedOperatorUsers ?? [];
  if (explicitTrustedUsers.length > 0) {
    return explicitTrustedUsers.includes(normalizedPeerId);
  }
  return config.dmPolicy === "allowlist" && config.allowedUsers.includes(normalizedPeerId);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function timestampValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function isSelfMessage(account: WeixinAccount, message: WeixinMessage): boolean {
  const from = stringValue(message.from_user_id);
  return from !== undefined && from.length > 0 && from === account.accountId;
}

function isGroupMessage(message: WeixinMessage): boolean {
  const roomId = stringValue(message.room_id) || stringValue(message.chat_room_id);
  return Boolean(roomId) || stringValue(message.from_user_id).includes("@chatroom");
}

function resolvePeerId(message: WeixinMessage): string {
  return stringValue(message.from_user_id);
}

function resolveMessageId(message: WeixinMessage): string {
  return (
    stringValue(message.message_id) || `weixin-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function cleanObjectiveForRefinement(value: string): string {
  return (
    value
      .replace(/^\/(?:制作|生产|创建|生成)\s*/u, "")
      .split(/\n(?:补充内容|执行意图|安全边界)[:：]/u)[0]
      ?.replace(/\s+needs operator review before execution handoff\.?$/iu, "")
      .trim() || "上一条制作任务"
  );
}

function cleanUserFacingText(value: string): string {
  const cleaned = value
    .replace(/^\/(?:制作|生产|创建|生成)\s*/u, "")
    .replace(/\s+needs operator review before execution handoff\.?$/giu, "")
    .trim();
  return cleaned.split(/\n(?:补充内容|执行意图|安全边界)[:：]/u)[0]?.trim() ?? cleaned;
}

function buildRefinedDirectorText(session: PeerDirectorSessionState, supplement: string): string {
  const objective = cleanObjectiveForRefinement(session.lastObjective ?? "上一条制作任务");
  const safetyBoundary = needsHumanTraffickingBoundary(supplement)
    ? "\n安全边界：如果涉及买卖人口、胁迫婚姻或伤害女性，必须按批判、救助、法律后果与受害者主体性处理，不能美化或合理化。"
    : "";
  return (
    [
      `/制作 ${objective}`,
      `补充内容：${supplement}`,
      "执行意图：这是对上一条微信任务的补充与确认，不要把确认话术当作新的制作目标。",
    ].join("\n") + safetyBoundary
  );
}

function buildInitialDirectorText(text: string): string {
  return needsHumanTraffickingBoundary(text) && !text.includes("安全边界：")
    ? `${text}\n安全边界：如果涉及买卖人口、胁迫婚姻或伤害女性，必须按批判、救助、法律后果与受害者主体性处理，不能美化或合理化。`
    : text;
}

function formatSafetyDialogueReply(input: {
  readonly safeRewriteObjective: string;
  readonly debugNotes?: readonly string[];
  readonly ruleId?: string;
  readonly reason?: string;
  readonly floor?: string;
  readonly canOverride?: boolean;
  readonly requiresApproval?: boolean;
  readonly auditEvent?: string;
}): string {
  return [
    "这个主题不能写成“拐卖婚姻最后爱情美满”。",
    "这样会美化拐卖、买妻或强迫婚姻，所以我不能按这个立场做。",
    ...(input.debugNotes === undefined
      ? []
      : [
          "",
          `开发者调试：${input.ruleId ?? "content-policy"} · ${input.reason ?? "命中内容策略"}`,
          `策略层级：floor=${input.floor ?? "unknown"}；canOverride=${String(input.canOverride ?? false)}；requiresApproval=${String(input.requiresApproval ?? false)}`,
          ...(input.auditEvent === undefined ? [] : [`审计事件：${input.auditEvent}`]),
          ...input.debugNotes.map((note) => `- ${note}`),
        ]),
    "",
    "我可以改成批判和救助方向：",
    input.safeRewriteObjective,
    "",
    "回复「确认改写」，我就按这个安全方向直接给你出一版；也可以直接发新的主题。",
  ].join("\n");
}

function saveDirectorSessionFromResult(
  config: WeixinGatewayConfig,
  peerId: string,
  result: Parameters<typeof extractDirectorGatewaySessionSnapshot>[0],
  supplement?: string,
  lastObjective?: string,
): PeerDirectorSessionState {
  const snapshot = extractDirectorGatewaySessionSnapshot(result);
  const objective = lastObjective ?? snapshot.lastObjective;
  const state: PeerDirectorSessionState = {
    peerId,
    ...(snapshot.entrySessionId === undefined ? {} : { entrySessionId: snapshot.entrySessionId }),
    ...(snapshot.blueprintId === undefined ? {} : { blueprintId: snapshot.blueprintId }),
    ...(snapshot.runId === undefined ? {} : { runId: snapshot.runId }),
    ...(objective === undefined ? {} : { lastObjective: objective }),
    ...(supplement === undefined ? {} : { lastSupplement: supplement }),
    pendingApprovalAssignmentIds: snapshot.pendingApprovalAssignmentIds,
    updatedAt: new Date().toISOString(),
  };
  savePeerSession(config.home, config.account.normalizedAccountId, peerId, state);
  return state;
}

async function runWorkerForConfirmedRun(
  config: WeixinGatewayConfig,
  runId: string,
): Promise<WeixinWorkerRunOnceResult | null> {
  const runner = config.runWorkerOnce ?? runDirectorWorkerOnce;
  try {
    return await runner({
      runId,
      workerId: "director-weixin-gateway",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      run: { runId, status: "running" },
      executedAssignments: [],
      report: {
        reportId: `report-${runId}`,
        flags: ["worker-run-failed"],
        summary: [`worker run failed: ${message}`],
      },
    };
  }
}

function formatWeixinConfirmedExecutionReply(_input: {
  readonly runId: string;
  readonly objective?: string | undefined;
  readonly supplement?: string | undefined;
  readonly approvedCount: number;
  readonly workerResult?: WeixinWorkerRunOnceResult | null | undefined;
  readonly refinedBlueprint?: boolean | undefined;
}): string {
  return formatWeixinProductionModelUnavailableReply("continued");
}

interface WeixinProductionModelDraft {
  readonly ok: boolean;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly output?: string;
}

function formatWeixinAutoExecutionReply(input: {
  readonly directorResult: DirectorGatewayResult;
  readonly runId: string;
  readonly objective?: string | undefined;
  readonly supplement?: string | undefined;
  readonly approvedCount: number;
  readonly workerResult?: WeixinWorkerRunOnceResult | null | undefined;
  readonly modelDraft?: WeixinProductionModelDraft | null | undefined;
  readonly safeRewrite?: boolean | undefined;
}): string {
  const modelOutput = humanizeWeixinProductionText(input.modelDraft?.output ?? "");
  const safetyPrefix = input.safeRewrite ? "已按批判、脱困和追责方向改写：\n\n" : "";
  if (input.modelDraft?.ok === true && modelOutput.length > 0) {
    return `${safetyPrefix}${truncateForWeixin(modelOutput, 1800)}`;
  }
  return `${safetyPrefix}${formatWeixinProductionModelUnavailableReply("executed")}`;
}

function formatWeixinProductionModelUnavailableReply(mode: "executed" | "continued"): string {
  return mode === "continued"
    ? "模型不可用：制作运行已继续，但没有模型生成最终成品文案，不能用本地模板冒充制作结果。"
    : "模型不可用：制作运行已执行，但没有模型生成最终成品文案，不能用本地模板冒充制作结果。";
}

function translateRunStatus(status: string): string {
  const map: Record<string, string> = {
    aborted: "已中止",
    completed: "已完成",
    created: "已创建",
    failed: "失败",
    paused: "已暂停",
    running: "运行中",
  };
  return map[status] ?? status;
}

function shortId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function truncateForWeixin(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...（已截断）`;
}

function recordWeixinUserTurn(
  config: WeixinGatewayConfig,
  peerId: string,
  message: WeixinMessage,
  text: string,
): void {
  appendPeerConversationTurn(config.home, config.account.normalizedAccountId, peerId, {
    role: "user",
    text,
    messageId: resolveMessageId(message),
    createdAt: new Date(timestampValue(message.create_time_ms)).toISOString(),
  });
}

function recordWeixinAssistantTurn(
  config: WeixinGatewayConfig,
  peerId: string,
  text: string,
  transcriptMessages?: readonly ConversationRuntimeModelToolMessage[],
): void {
  appendPeerConversationTurn(config.home, config.account.normalizedAccountId, peerId, {
    role: "assistant",
    text,
    ...(transcriptMessages === undefined || transcriptMessages.length === 0
      ? {}
      : { transcriptMessages: normalizeWeixinRuntimeTranscriptMessages(transcriptMessages) }),
    createdAt: new Date().toISOString(),
  });
}

function toWeixinErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWeixinDeliveryFailure(error: unknown): boolean {
  return /iLink\s+sendmessage\s+failed|sendmessage\s+failed/iu.test(toWeixinErrorMessage(error));
}

function renderWeixinDeliveryFailureLog(error: unknown): string {
  return `微信发送通道失败：${toWeixinErrorMessage(error)}`;
}

function renderWeixinUserFacingFailureReply(error: unknown): string {
  return renderConversationRuntimeUserFacingFailureReply({
    error,
    surface: "weixin",
  }).text;
}

async function trySendReply(
  config: WeixinGatewayConfig,
  peerId: string,
  text: string,
  options: {
    readonly runtimeResult?: ConversationRuntimeResult;
    readonly errorLog?: (message: string) => void;
  } = {},
): Promise<boolean> {
  try {
    if (options.runtimeResult === undefined) {
      await sendReply(config, peerId, text);
    } else {
      await sendRuntimeReply({
        config,
        peerId,
        text,
        runtimeResult: options.runtimeResult,
      });
    }
    return true;
  } catch (error) {
    if (isWeixinDeliveryFailure(error)) {
      options.errorLog?.(renderWeixinDeliveryFailureLog(error));
      return false;
    }
    throw error;
  }
}

function loadWeixinRuntimeHistory(
  config: WeixinGatewayConfig,
  peerId: string,
): readonly ConversationRuntimeModelToolMessage[] {
  return loadPeerConversationTurns(config.home, config.account.normalizedAccountId, peerId)
    .flatMap((turn) => {
      if (isPollutedWeixinConversationHistoryText(turn.text)) {
        return [];
      }
      if (turn.transcriptMessages !== undefined && turn.transcriptMessages.length > 0) {
        return turn.transcriptMessages.filter(
          (message) => !isPollutedWeixinConversationHistoryText(message.content),
        );
      }
      return [
        {
          role: turn.role,
          content: turn.text,
          ...(turn.messageId === undefined
            ? {}
            : {
                metadata: {
                  messageId: turn.messageId,
                  projectedFromWeixinConversation: true,
                },
              }),
        } satisfies ConversationRuntimeModelToolMessage,
      ];
    })
    .slice(-24);
}

function normalizeWeixinRuntimeTranscriptMessages(
  messages: readonly ConversationRuntimeModelToolMessage[],
) {
  return messages.flatMap((message) => {
    if (message.role === "system") {
      return [];
    }
    return [
      {
        role: message.role,
        content: message.content,
        ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
        ...(message.toolCalls === undefined || message.toolCalls.length === 0
          ? {}
          : { toolCalls: message.toolCalls }),
        ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
      },
    ];
  });
}

function loadRecentWeixinUserContext(
  config: WeixinGatewayConfig,
  peerId: string,
): readonly string[] {
  return loadPeerConversationTurns(config.home, config.account.normalizedAccountId, peerId)
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text);
}

function withRecentWeixinContext(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly text: string;
}): string {
  return appendRecentChannelContext({
    text: input.text,
    contextLines: selectRecentChannelContextLines(
      loadRecentWeixinUserContext(input.config, input.peerId),
      { maxLines: 3 },
    ),
    separator: "\n",
  });
}

function withRecentWeixinDialogueContext(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly text: string;
}): string {
  const context = loadPeerConversationTurns(
    input.config.home,
    input.config.account.normalizedAccountId,
    input.peerId,
  )
    .filter((turn) => turn.text !== input.text)
    .filter((turn) => !isPollutedWeixinConversationHistoryText(turn.text))
    .slice(-6)
    .map((turn) => `${turn.role === "assistant" ? "Angel" : "用户"}：${turn.text}`);
  if (context.length === 0) {
    return input.text;
  }
  return `${input.text}\n\n近期对话（只用于理解当前聊天，不要写入长期记忆）：\n${context.join("\n")}`;
}

function isPollutedWeixinConversationHistoryText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return false;
  }
  if (/_sentryDebugIds|sentry-dbid|webpackChunk|__NEXT_DATA__|window\.__/iu.test(normalized)) {
    return true;
  }
  if (
    /Something went wrong|privacy related extensions|Try again Some privacy/iu.test(normalized) &&
    /(这个链接我看过了|学到|经验提炼|Web lesson|候选|可用要点)/u.test(normalized)
  ) {
    return true;
  }
  return (
    /环境异常.*视频.*小程序.*轻点两下|赞.*轻点两下取消赞|在看.*轻点两下取消在看/isu.test(
      normalized,
    ) && /(学到|经验提炼|候选|Web lesson|可用要点)/u.test(normalized)
  );
}

function humanizeWeixinProductionText(value: string): string {
  return humanizeProductionResultText(value);
}

function isRunActiveSessionCommand(commandId: string): boolean {
  return commandId.startsWith("run.");
}

function createWeixinSourceId(prefix: string, message: WeixinMessage): string {
  return `${prefix}-${resolveMessageId(message).replace(/[^a-z0-9._-]/giu, "-")}`;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function extractFirstUrl(value: string): string | null {
  return /https?:\/\/\S+/iu.exec(value)?.[0]?.replace(/[，,。.;；]+$/u, "") ?? null;
}

function readWeixinLearningUrlFromTurn(
  intent: ReturnType<typeof orchestrateConversationTurn>["intent"],
): string | null {
  const metadata = intent.metadata;
  if (
    metadata !== undefined &&
    metadata.sourceKind === "url" &&
    typeof metadata.url === "string" &&
    metadata.url.trim().length > 0 &&
    intent.kind === "learning-admit"
  ) {
    return metadata.url.trim();
  }
  if (intent.kind !== "learning-admit") {
    return null;
  }
  return extractFirstUrl(intent.objective ?? "");
}

function extractFirstPath(value: string): string | null {
  return /(?:^|\s)(\/(?:Volumes|Users|tmp|var)\/\S+|~\/\S+|\.{1,2}\/\S+)/u.exec(value)?.[1] ?? null;
}

async function runWeixinRuntimeUrlLearning(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly message: WeixinMessage;
  readonly url: string;
}): Promise<string> {
  const sourceId = createWeixinSourceId("weixin-url", input.message);
  const userText = extractWeixinText(input.message.item_list ?? []);
  const result = await runWeixinUrlLearningReadAndAdmit({
    config: input.config,
    peerId: input.peerId,
    sourceId,
    url: input.url,
    nowMs: timestampValue(input.message.create_time_ms),
    messageId: resolveMessageId(input.message),
    ...(userText.length === 0 ? {} : { userText }),
  });
  const candidateCount =
    readNumber(result.result, "candidateCount") ?? arrayCount(result, "candidates");
  const projection = createWeixinRuntimeLearningProjectionFromResult({
    config: input.config,
    peerId: input.peerId,
    source: "url",
    query: input.url,
    result,
  });
  return renderWeixinLearningProjectionReply({ ...projection, candidateCount });
}

function createWeixinRuntimeLearningProjectionFromResult(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly source: ConversationRuntimeLearningArtifactProjectionInput["source"];
  readonly query?: string;
  readonly result: Record<string, unknown>;
}): ConversationRuntimeLearningArtifactProjectionInput {
  const candidates = extractWeixinCurrentRunCandidateSnapshots(input.result).slice(0, 12);
  const failures = extractWeixinLearningFailureSnapshots(input.result);
  const candidateCount =
    readNumber(input.result.result, "candidateCount") ??
    (arrayCount(input.result, "candidates") || candidates.length);
  const failureCount =
    readNumber(input.result.result, "quarantineCount") ??
    (arrayCount(input.result, "quarantines") || failures.length);
  const sourceEvidenceRefs = extractWeixinSourceEvidenceRefs(input.result);
  const memoryEvidenceRecords = extractWeixinMemoryEvidenceRecords(input.result);
  const projection: ConversationRuntimeLearningArtifactProjectionInput = {
    source: input.source,
    ...(input.query === undefined ? {} : { query: input.query }),
    candidateCount,
    candidates,
    failureCount,
    failures,
    sourceEvidenceRefs,
    memoryEvidenceRecords,
  };
  createPendingLearningArtifactFromResult({
    store: createWeixinLearningArtifactStore(input.config),
    sessionKey: createWeixinRuntimeSessionKey(input.config, input.peerId),
    turnRunId:
      readNestedString(input.result, ["urlRead", "turnId"]) ?? `weixin-learning-${Date.now()}`,
    sourceSurface: "weixin",
    sourceKind: input.source === "url" ? "url" : "tool-result",
    sourceRef: input.query ?? input.source,
    observedAtMs: Date.now(),
    result: input.result,
  });
  return projection;
}

async function runWeixinUrlLearningReadAndAdmit(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId?: string;
  readonly sourceId: string;
  readonly url: string;
  readonly nowMs: number;
  readonly userText?: string;
  readonly messageId?: string;
  readonly browserProfile?: "angel" | "user" | "electron" | (string & {});
  readonly skipWebExtract?: boolean;
}): Promise<Record<string, unknown>> {
  const workspaceRoot = configWorkspaceRoot(input.config);
  const runRegistry = createWeixinConversationRunRegistry(input.config);
  const learningArtifactStore = createWeixinLearningArtifactStore(input.config);
  const sessionKey = createWeixinRuntimeSessionKey(input.config, input.peerId);
  const messageId = input.messageId ?? input.sourceId;
  const turnRun = runRegistry.start({
    turnId: input.sourceId,
    input: {
      surface: "weixin",
      channel: "weixin",
      messageId,
      sessionKey,
      text: input.userText ?? `/学习 ${input.url}`,
      accountId: input.config.account.normalizedAccountId,
      sender: { id: input.peerId ?? "user", role: "user" },
      trustedContext: {
        workspaceRoot,
        dataDir: resolve(workspaceRoot, ".hotflow"),
        metadata: {
          source: "weixin-url-learning",
          sourceId: input.sourceId,
          url: input.url,
        },
      },
    },
    status: "tool_calling",
    sourceRefs: [input.url],
    metadata: {
      kind: "weixin-url-learning-read-admit",
      sourceId: input.sourceId,
      url: input.url,
      ...(input.browserProfile === undefined ? {} : { browserProfile: input.browserProfile }),
      ...(input.skipWebExtract === undefined ? {} : { skipWebExtract: input.skipWebExtract }),
    },
  });
  const webExtractArtifacts = createWeixinWebExtractArtifactAccess(workspaceRoot);
  const runtimeFetch = createWeixinRuntimeFetch(input.config.fetchFn);
  const webExecutor = createBuiltinWebToolExecutors({
    storeExtractArtifact: webExtractArtifacts.storeExtractArtifact,
    readExtractArtifact: webExtractArtifacts.readExtractArtifact,
    ...(runtimeFetch === undefined ? {} : { fetchImpl: runtimeFetch }),
  });
  const browserExecutor = createBuiltinBrowserToolExecutors(
    createWeixinSharedDesktopBrowserProvider(input.config),
  );
  try {
    const read = await orchestrateConversationRuntimeUrlLearningRead({
      url: input.url,
      turnId: input.sourceId,
      sessionKey,
      ...(input.userText === undefined ? {} : { userText: input.userText }),
      ...(input.browserProfile === undefined ? {} : { browserProfile: input.browserProfile }),
      ...(input.skipWebExtract === undefined ? {} : { skipWebExtract: input.skipWebExtract }),
      executeTool: async (toolInput) => {
        runRegistry.appendEvent(turnRun.turnRunId, {
          kind: "runtime.tool_call",
          summary: `读取链接：${toolInput.call.name}`,
          metadata: {
            toolName: toolInput.call.name,
            toolCallId: toolInput.call.id,
            url: input.url,
          },
        });
        const hostSharedToolResult = await executeWeixinHostSharedTool({
          config: input.config,
          call: toolInput.call,
          sourceId: input.sourceId,
          ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
        });
        if (hostSharedToolResult !== null) {
          runRegistry.appendEvent(turnRun.turnRunId, {
            kind: "runtime.tool_result",
            summary: hostSharedToolResult.ok
              ? `读取完成：${toolInput.call.name}`
              : `读取失败：${toolInput.call.name}`,
            metadata: {
              toolName: hostSharedToolResult.toolName,
              toolCallId: hostSharedToolResult.callId,
              ok: hostSharedToolResult.ok,
              ...(hostSharedToolResult.error === undefined
                ? {}
                : { error: hostSharedToolResult.error }),
            },
          });
          return hostSharedToolResult;
        }
        const executor =
          browserExecutor.get(toolInput.call.name) ?? webExecutor.get(toolInput.call.name);
        if (executor === undefined) {
          const missing = {
            callId: toolInput.call.id,
            toolName: toolInput.call.name,
            ok: false,
            content:
              "status: error\nsummary: 当前微信通道没有这个读取工具。\nnext_actions: 换桌面端重试。",
            output: {
              status: "error",
              summary: "当前微信通道没有这个读取工具。",
              failures: ["tool executor unavailable"],
              candidate_count: 0,
              next_actions: ["换桌面端重试"],
            },
            error: "tool executor unavailable",
          };
          runRegistry.appendEvent(turnRun.turnRunId, {
            kind: "runtime.tool_result",
            summary: `读取工具不可用：${toolInput.call.name}`,
            metadata: {
              toolName: toolInput.call.name,
              toolCallId: toolInput.call.id,
              ok: false,
              error: missing.error,
            },
          });
          return missing;
        }
        const result = await executor(toolInput);
        runRegistry.appendEvent(turnRun.turnRunId, {
          kind: "runtime.tool_result",
          summary: result.ok
            ? `读取完成：${toolInput.call.name}`
            : `读取失败：${toolInput.call.name}`,
          metadata: {
            toolName: result.toolName,
            toolCallId: result.callId,
            ok: result.ok,
            ...(result.error === undefined ? {} : { error: result.error }),
          },
        });
        return result;
      },
    });
    if (read.status === "trusted" && read.source !== undefined) {
      const result = await learnDirectorFromText(input.config.director, {
        sourceId: input.sourceId,
        title: read.source.title,
        content: read.source.body,
        sourceRef: read.source.url,
        nowMs: input.nowMs,
      });
      const output = {
        ...result,
        schemaId: "director.weixin.learning-url.v1",
        urlRead: read,
      };
      runRegistry.finalize(turnRun.turnRunId, {
        status: "completed",
        userVisibleSummary: "已读取可信正文并进入学习准入。",
        sourceRefs: [input.url],
        memoryEvidenceRefs: extractWeixinMemoryEvidenceRecords(output)
          .map((record) => record.id)
          .filter((id): id is string => id !== undefined),
      });
      return output;
    }
    const output = createWeixinUrlLearningBlockedResult({
      sourceId: input.sourceId,
      url: input.url,
      nowMs: input.nowMs,
      read,
    });
    runRegistry.finalize(turnRun.turnRunId, {
      status: "completed",
      userVisibleSummary: "没有读到可信正文，已隔离，未生成经验候选。",
      sourceRefs: [input.url],
      memoryEvidenceRefs: extractWeixinMemoryEvidenceRecords(output)
        .map((record) => record.id)
        .filter((id): id is string => id !== undefined),
      failureTaxonomy: ["source-access-limited"],
    });
    return output;
  } catch (error) {
    runRegistry.finalize(turnRun.turnRunId, {
      status: "failed",
      userVisibleSummary: "链接学习没有完成。",
      internalFailure: error instanceof Error ? error.message : String(error),
      sourceRefs: [input.url],
      failureTaxonomy: ["url-learning-runtime-error"],
    });
    throw error;
  }
}

function createWeixinUrlLearningBlockedResult(input: {
  readonly sourceId: string;
  readonly url: string;
  readonly nowMs: number;
  readonly read: Awaited<ReturnType<typeof orchestrateConversationRuntimeUrlLearningRead>>;
}): Record<string, unknown> {
  const failures = input.read.failures;
  const failure = failures[0] ?? "没有读到可信正文。";
  const quarantineId = `weixin_url_blocked_${shortHash(`${input.sourceId}:${input.url}`)}`;
  const artifactId = `weixin_url_source_${shortHash(`${input.sourceId}:${input.url}`)}`;
  return {
    apiVersion: "director.weixin.learning-url.v1",
    schemaId: "director.weixin.learning-url.v1",
    result: {
      status: "degraded",
      candidateCount: 0,
      artifactCount: 0,
      quarantineCount: 1,
      candidateIds: [],
      artifactIds: [],
      quarantineIds: [quarantineId],
      nextCursors: {},
      adapterReports: [
        {
          adapterId: `weixin_url_learning_read_${shortHash(input.sourceId)}`,
          sourceKind: "web-page",
          cursor: "",
          artifactCount: 0,
          storedArtifactCount: 0,
          candidateCount: 0,
          storedCount: 0,
          candidateIds: [],
          quarantineCount: 1,
          storedQuarantineCount: 0,
          artifactIds: [],
          quarantineIds: [quarantineId],
          notes: failures,
        },
      ],
      notes: failures,
    },
    candidates: [],
    artifacts: [],
    sourceEvidenceRefs: [
      {
        id: `source-evidence-${artifactId}`,
        sourceKind: "url",
        sourceRef: input.url,
        sourceSnapshotId: artifactId,
        sourceAccessStatus: "source_access_limited",
        sourceAccessError: failure,
        publishable: false,
      },
    ],
    memoryEvidenceRecords: [
      {
        id: `memory-evidence-${artifactId}`,
        sourceKind: "url",
        sourceRef: input.url,
        sourceSnapshotId: artifactId,
        sourceAccessStatus: "source_access_limited",
        sourceAccessError: failure,
        confidence: "low",
        publishable: false,
        evidenceRefs: [`source-evidence-${artifactId}`, artifactId],
      },
    ],
    quarantines: [
      {
        quarantineId,
        reason: failure,
        artifact: {
          artifactId,
          sourceKind: "web-page",
          sourceRef: input.url,
          title: input.url,
          textPreview: "",
          capturedAtMs: input.nowMs,
          quality: {
            score: 0,
            verdict: "quarantine",
            reasons: failures,
          },
        },
        notes: input.read.nextActions,
      },
    ],
    urlRead: input.read,
  };
}

function extractWeixinSourceEvidenceRefs(
  result: Record<string, unknown>,
): readonly ConversationRuntimeLearningProjectionEvidence[] {
  const refs = result.sourceEvidenceRefs;
  if (!Array.isArray(refs)) {
    return [];
  }
  return refs.flatMap((item): ConversationRuntimeLearningProjectionEvidence[] => {
    if (!isObject(item)) {
      return [];
    }
    const id = readNestedString(item, ["id"]);
    if (id === undefined) {
      return [];
    }
    const sourceKind = readNestedString(item, ["sourceKind"]);
    const sourceRef = readNestedString(item, ["sourceRef"]);
    const sourceSnapshotId = readNestedString(item, ["sourceSnapshotId"]);
    const sourceAccessStatus = readNestedString(item, ["sourceAccessStatus"]);
    const sourceAccessError = readNestedString(item, ["sourceAccessError"]);
    const publishable = typeof item.publishable === "boolean" ? item.publishable : undefined;
    const metadata = isObject(item.metadata) ? item.metadata : {};
    const evidenceDisclosureSnapshot = readWeixinEvidenceObject(
      item.evidenceDisclosureSnapshot,
      item.evidence_disclosure,
      metadata.evidenceDisclosureSnapshot,
      metadata.evidence_disclosure,
    );
    const externalContentSnapshot = readWeixinEvidenceObject(
      item.externalContentSnapshot,
      item.external_content,
      metadata.externalContentSnapshot,
      metadata.external_content,
    );
    const contentRef = readWeixinEvidenceObject(
      item.contentRef,
      item.content_ref,
      metadata.contentRef,
      metadata.content_ref,
    );
    return [
      {
        id,
        ...(sourceKind === undefined ? {} : { sourceKind }),
        ...(sourceRef === undefined ? {} : { sourceRef }),
        ...(sourceSnapshotId === undefined ? {} : { sourceSnapshotId }),
        ...(sourceAccessStatus === undefined ? {} : { sourceAccessStatus }),
        ...(sourceAccessError === undefined ? {} : { sourceAccessError }),
        ...(publishable === undefined ? {} : { publishable }),
        ...(evidenceDisclosureSnapshot === undefined ? {} : { evidenceDisclosureSnapshot }),
        ...(externalContentSnapshot === undefined ? {} : { externalContentSnapshot }),
        ...(contentRef === undefined ? {} : { contentRef }),
      },
    ];
  });
}

function extractWeixinMemoryEvidenceRecords(
  result: Record<string, unknown>,
): readonly ConversationRuntimeLearningProjectionEvidence[] {
  const records = result.memoryEvidenceRecords;
  if (!Array.isArray(records)) {
    return [];
  }
  return records.flatMap((item): ConversationRuntimeLearningProjectionEvidence[] => {
    if (!isObject(item)) {
      return [];
    }
    const id = readNestedString(item, ["id"]);
    if (id === undefined) {
      return [];
    }
    const sourceKind = readNestedString(item, ["sourceKind"]);
    const sourceRef = readNestedString(item, ["sourceRef"]);
    const sourceSnapshotId = readNestedString(item, ["sourceSnapshotId"]);
    const sourceAccessStatus = readNestedString(item, ["sourceAccessStatus"]);
    const sourceAccessError = readNestedString(item, ["sourceAccessError"]);
    const confidence = readNestedString(item, ["confidence"]);
    const publishable = typeof item.publishable === "boolean" ? item.publishable : undefined;
    const metadata = isObject(item.metadata) ? item.metadata : {};
    const evidenceDisclosureSnapshot = readWeixinEvidenceObject(
      item.evidenceDisclosureSnapshot,
      item.evidence_disclosure,
      metadata.evidenceDisclosureSnapshot,
      metadata.evidence_disclosure,
    );
    const externalContentSnapshot = readWeixinEvidenceObject(
      item.externalContentSnapshot,
      item.external_content,
      metadata.externalContentSnapshot,
      metadata.external_content,
    );
    const contentRef = readWeixinEvidenceObject(
      item.contentRef,
      item.content_ref,
      metadata.contentRef,
      metadata.content_ref,
    );
    return [
      {
        id,
        ...(sourceKind === undefined ? {} : { sourceKind }),
        ...(sourceRef === undefined ? {} : { sourceRef }),
        ...(sourceSnapshotId === undefined ? {} : { sourceSnapshotId }),
        ...(sourceAccessStatus === undefined ? {} : { sourceAccessStatus }),
        ...(sourceAccessError === undefined ? {} : { sourceAccessError }),
        ...(confidence === undefined ? {} : { confidence }),
        ...(publishable === undefined ? {} : { publishable }),
        evidenceRefs: readStringArray(item, "evidenceRefs"),
        ...(evidenceDisclosureSnapshot === undefined ? {} : { evidenceDisclosureSnapshot }),
        ...(externalContentSnapshot === undefined ? {} : { externalContentSnapshot }),
        ...(contentRef === undefined ? {} : { contentRef }),
      },
    ];
  });
}

function extractWeixinCurrentRunCandidateSnapshots(
  result: Record<string, unknown>,
): readonly ConversationRuntimeLearningProjectionCandidate[] {
  const candidates = extractWeixinCandidateSnapshots(result.candidates);
  const currentIds = readStringArray(result.result, "candidateIds");
  if (currentIds.length === 0) {
    return candidates;
  }
  const allowed = new Set(currentIds);
  return candidates.filter(
    (candidate) => candidate.candidateId !== undefined && allowed.has(candidate.candidateId),
  );
}

function extractWeixinLearningFailureSnapshots(
  result: Record<string, unknown>,
): readonly ConversationRuntimeLearningProjectionFailure[] {
  const failures: ConversationRuntimeLearningProjectionFailure[] = [];
  const quarantines = result.quarantines;
  if (Array.isArray(quarantines)) {
    for (const item of quarantines) {
      if (!isObject(item)) {
        continue;
      }
      const artifact = isObject(item.artifact) ? item.artifact : {};
      const sourceRef = readNestedString(artifact, ["sourceRef"]);
      const title = readNestedString(artifact, ["title"]) ?? sourceRef;
      const reason =
        readNestedString(item, ["reason"]) ??
        readNestedString(artifact, ["quality", "reasons", "0"]) ??
        "source was quarantined";
      const detail =
        readNestedString(artifact, ["textPreview"]) ??
        readNestedString(item, ["notes", "0"]) ??
        reason;
      failures.push({
        ...(sourceRef === undefined ? {} : { sourceRef }),
        ...(title === undefined ? {} : { title }),
        reason,
        detail: truncateForWeixin(detail, 220),
      });
    }
  }
  const adapterReports = readNestedArray(result, ["result", "adapterReports"]);
  for (const report of adapterReports) {
    if (!isObject(report)) {
      continue;
    }
    const notes = Array.isArray(report.notes)
      ? report.notes.filter((note): note is string => typeof note === "string")
      : [];
    for (const note of notes) {
      if (!/fail|failed|error|HTTP|403|quarantine|Skipped|抓取|失败|隔离/iu.test(note)) {
        continue;
      }
      failures.push({
        reason: "learning adapter reported a fetch or quality failure",
        detail: truncateForWeixin(note, 220),
      });
    }
  }
  return dedupeWeixinLearningFailures(failures).slice(0, 12);
}

function dedupeWeixinLearningFailures(
  failures: readonly ConversationRuntimeLearningProjectionFailure[],
): readonly ConversationRuntimeLearningProjectionFailure[] {
  const byKey = new Map<string, ConversationRuntimeLearningProjectionFailure>();
  for (const failure of failures) {
    const key = [failure.sourceRef, failure.reason, failure.detail].join("\n");
    if (!byKey.has(key)) {
      byKey.set(key, failure);
    }
  }
  return [...byKey.values()];
}

function extractWeixinCandidateSnapshots(
  value: unknown,
): readonly ConversationRuntimeLearningProjectionCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): ConversationRuntimeLearningProjectionCandidate[] => {
    if (!isObject(item)) {
      return [];
    }
    const candidateId =
      readNestedString(item, ["candidateId"]) ??
      readNestedString(item, ["id"]) ??
      readNestedString(item, ["metadata", "id"]);
    const title =
      readNestedString(item, ["title"]) ??
      readNestedString(item, ["metadata", "title"]) ??
      candidateId;
    const summary =
      readNestedString(item, ["summary"]) ??
      readNestedString(item, ["applicability"]) ??
      readNestedString(item, ["evidencePreview"]) ??
      readNestedString(item, ["metadata", "summary"]);
    const metadata = isObject(item.metadata) ? item.metadata : {};
    const evidenceIds = [
      ...readStringArray(item, "evidenceIds"),
      ...readStringArray(metadata, "evidenceIds"),
    ];
    const rawEvidenceSnapshots = Array.isArray(item.evidenceSnapshots)
      ? item.evidenceSnapshots
      : Array.isArray(metadata.evidenceSnapshots)
        ? metadata.evidenceSnapshots
        : [];
    const evidenceSnapshots = rawEvidenceSnapshots.filter(isObject);
    return [
      {
        ...(candidateId === undefined ? {} : { candidateId }),
        ...(title === undefined ? {} : { title }),
        ...(summary === undefined ? {} : { summary: truncateForWeixin(summary, 180) }),
        ...(evidenceIds.length === 0 ? {} : { evidenceIds }),
        ...(evidenceSnapshots.length === 0 ? {} : { evidenceSnapshots }),
      },
    ];
  });
}

function renderWeixinLearningProjectionReply(
  projection: ConversationRuntimeLearningArtifactProjectionInput,
): string {
  return projectWeixinLearningForUser(projection).userText;
}

function projectWeixinLearningForUser(
  projection: ConversationRuntimeLearningArtifactProjectionInput,
): ConversationRuntimeUserFacingProjection {
  return createConversationRuntimeLearningArtifactProjection({
    source: projection.source,
    ...(projection.query === undefined ? {} : { query: projection.query }),
    ...(projection.candidateCount === undefined
      ? {}
      : { candidateCount: projection.candidateCount }),
    candidates: projection.candidates ?? [],
    ...(projection.failureCount === undefined ? {} : { failureCount: projection.failureCount }),
    failures: projection.failures ?? [],
    sourceEvidenceRefs: projection.sourceEvidenceRefs ?? [],
    memoryEvidenceRecords: projection.memoryEvidenceRecords ?? [],
  });
}

async function persistWeixinLearningConfirmation(input: {
  readonly config: WeixinGatewayConfig;
  readonly payload: {
    readonly input: { readonly sessionKey: string };
    readonly turnId: string;
    readonly decision: {
      readonly decisionText: string;
      readonly candidateIds?: readonly string[];
    };
    readonly artifact: {
      readonly artifactId: string;
      readonly sourceRef: string;
      readonly privacy?: string;
      readonly roleScope?: {
        readonly roleName?: string;
        readonly domain?: string;
      };
      readonly classification?: {
        readonly topic?: string;
        readonly useCases?: readonly string[];
        readonly tags?: readonly string[];
      };
      readonly qualityGates?: readonly string[];
      readonly evidenceRefs?: readonly string[];
      readonly mediaEvidenceRefs?: readonly { readonly id: string }[];
    };
    readonly confirmation: {
      readonly confirmationId: string;
    };
  };
  readonly peerId?: string;
}): Promise<{
  readonly status: string;
  readonly candidateIds: readonly string[];
  readonly auditId: string;
  readonly message: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}> {
  const artifact = input.payload.artifact;
  const existingCandidateIds = Array.isArray(input.payload.decision?.candidateIds)
    ? input.payload.decision.candidateIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  if (existingCandidateIds.length > 0) {
    // Natural Weixin confirmations must only resolve the shared runtime confirmation.
    // Explicit review commands remain the path for Host API candidate accept/promote actions.
    return {
      status: "candidate-accepted",
      candidateIds: existingCandidateIds,
      auditId: `weixin-learning-confirm-accept-${String(input.payload.confirmation.confirmationId).replace(/[^a-z0-9._-]/giu, "-")}`,
      message: `已确认 ${existingCandidateIds.length} 条经验候选，后续会按岗位经验召回。`,
      metadata: {
        artifactId: artifact.artifactId,
        confirmationId: input.payload.confirmation.confirmationId,
        acceptedIn: "conversation-runtime",
      },
    };
  }
  const sourceId = `weixin-learning-confirm-${String(artifact.artifactId ?? input.payload.turnId).replace(/[^a-z0-9._-]/giu, "-")}`;
  const result = await learnDirectorFromText(
    {
      ...input.config.director,
      ...(input.config.fetchFn === undefined ? {} : { fetchFn: input.config.fetchFn }),
    },
    {
      sourceId,
      title: artifact.classification?.topic ?? artifact.sourceRef ?? "微信确认经验",
      content: createWeixinLearningConfirmationBody(input.payload),
      sourceRef: artifact.sourceRef,
      nowMs: Date.now(),
    },
  );
  const candidates = extractWeixinCandidateSnapshots(result);
  const candidateIds = candidates
    .map((candidate) => candidate.candidateId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  // The shared conversation-runtime learning artifact store is the confirmation fact source.
  // Keep the peer cache read-only for legacy follow-up projection instead of mirroring saves here.
  return {
    status: candidateIds.length > 0 ? "candidate-created" : "review-required",
    candidateIds,
    auditId: sourceId,
    message:
      candidateIds.length > 0
        ? "已进入经验候选，后续会按岗位经验召回。"
        : "已记录确认，但这条内容还没有形成可用经验候选。",
    metadata: {
      result,
      artifactId: artifact.artifactId,
      confirmationId: input.payload.confirmation.confirmationId,
    },
  };
}

function createWeixinLearningConfirmationNote(input: {
  readonly decision: { readonly decisionText: string };
  readonly artifact: { readonly sourceRef: string };
  readonly confirmation: { readonly confirmationId: string };
}): string {
  return [
    "用户在当前微信会话确认保存这条学习候选。",
    `确认文本：${input.decision.decisionText}`,
    `来源：${input.artifact.sourceRef}`,
    `确认对象：${input.confirmation.confirmationId}`,
  ].join("\n");
}

function createWeixinLearningConfirmationBody(input: {
  readonly decision: { readonly decisionText: string };
  readonly artifact: {
    readonly sourceRef: string;
    readonly roleScope?: { readonly roleName?: string; readonly domain?: string };
    readonly classification?: {
      readonly topic?: string;
      readonly useCases?: readonly string[];
      readonly tags?: readonly string[];
    };
    readonly qualityGates?: readonly string[];
    readonly evidenceRefs?: readonly string[];
    readonly mediaEvidenceRefs?: readonly { readonly id: string }[];
  };
}): string {
  const artifact = input.artifact;
  return [
    `来源：${artifact.sourceRef}`,
    `岗位：${artifact.roleScope?.roleName ?? "Director Angel"}`,
    `领域：${artifact.roleScope?.domain ?? "影视制作"}`,
    `确认文本：${input.decision.decisionText}`,
    artifact.classification?.topic === undefined ? "" : `主题：${artifact.classification.topic}`,
    (artifact.classification?.useCases ?? []).length === 0
      ? ""
      : `用途：${artifact.classification?.useCases?.join("、")}`,
    (artifact.classification?.tags ?? []).length === 0
      ? ""
      : `标签：${artifact.classification?.tags?.join("、")}`,
    (artifact.qualityGates ?? []).length === 0
      ? "质量门：通过"
      : `质量门：${artifact.qualityGates?.join("、")}`,
    `证据：${[
      ...(artifact.evidenceRefs ?? []),
      ...(artifact.mediaEvidenceRefs ?? []).map((evidence) => evidence.id),
    ].join("、")}`,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function renderWeixinLearningProjectionToolContent(
  learning: ConversationRuntimeLearningArtifactProjectionInput,
): string {
  const projection = projectWeixinLearningForUser(learning);
  const candidateCount = learning.candidateCount ?? learning.candidates?.length ?? 0;
  return [
    projection.userText,
    candidateCount > 0
      ? "给用户回复时直接总结学到的内容；候选审核只作为轻量尾注，不要讲内部字段。"
      : "给用户回复时直接说明没有读到可信正文和下一步，不要说已经学会。",
  ].join("\n");
}

function renderWeixinExperienceCandidatesToolContent(input: {
  readonly result: Record<string, unknown>;
  readonly maxItems: number;
}): string {
  const listed = extractWeixinCandidateSnapshots(input.result.experienceCandidates);
  const candidates = listed;
  const count = arrayCount(input.result, "experienceCandidates") || candidates.length;
  if (count === 0 || candidates.length === 0) {
    return "没有可展示的待审经验候选。";
  }
  return candidates
    .slice(0, input.maxItems)
    .map((candidate, index) => {
      const title = candidate.title ?? candidate.candidateId ?? `候选 ${index + 1}`;
      const id = candidate.candidateId === undefined ? "" : `（${candidate.candidateId}）`;
      const summary =
        candidate.summary === undefined || candidate.summary.trim().length === 0
          ? ""
          : `\n摘要：${truncateForWeixin(candidate.summary, 220)}`;
      return `${index + 1}. ${title}${id}${summary}`;
    })
    .join("\n");
}

async function selectWeixinRuntimeToolsForTurn(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId?: string;
  readonly text: string;
}): Promise<readonly ConversationRuntimeModelToolDefinition[]> {
  const tools = createDirectorConversationRuntimeTools();
  const selected = tools;
  const localTools = await resolveEffectiveModelTools({
    tools: selected,
    check: createWeixinEffectiveModelToolChecks(input.config),
  });
  const hostEffective = await readWeixinHostEffectiveToolIds({
    config: input.config,
    ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
  });
  if (hostEffective === null) {
    return localTools;
  }
  return selected.filter((tool) => hostEffective.has(tool.name));
}

async function createWeixinConversationRuntimeMcpContext(input: {
  readonly config: WeixinGatewayConfig;
  readonly runtimeTools: readonly ConversationRuntimeModelToolDefinition[];
}): Promise<{
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly mcpClient: ReturnType<typeof createConversationRuntimeMcpClient> | null;
}> {
  const workspaceRoot = configWorkspaceRoot(input.config);
  const mcpConfig = loadWeixinMcpConfig(workspaceRoot);
  if (Object.keys(mcpConfig.servers).length === 0) {
    return {
      tools: input.runtimeTools,
      mcpClient: null,
    };
  }
  const mcpClient = createConversationRuntimeMcpClient({
    servers: mcpConfig.servers,
    clientName: "director-angel-weixin",
    clientVersion: "0.1.0",
    cwd: workspaceRoot,
    stderrLogPath: join(workspaceRoot, ".director-angel", "runtime", "logs", "mcp-stderr.log"),
  });
  const registry = createAsyncConversationRuntimeToolRegistry({
    directorTools: input.runtimeTools,
    mcpToolProvider: mcpClient,
    effectiveToolChecks: createWeixinEffectiveModelToolChecks(input.config),
  });
  return {
    tools: await registry.listModelTools(),
    mcpClient,
  };
}

async function readWeixinHostEffectiveToolIds(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId?: string;
}): Promise<ReadonlySet<string> | null> {
  if (input.config.useHostToolControlPlane !== true) {
    return null;
  }
  try {
    const result = await readDirectorToolsEffective(input.config.director, {
      agentId: input.config.director.agentId,
      sessionKey: createWeixinRuntimeSessionKey(input.config, input.peerId),
      profile: "weixin",
      includeUnavailable: true,
    });
    return new Set(
      result.tools
        .filter((tool) => tool.canInvoke === true)
        .flatMap((tool) => collectWeixinHostEffectiveModelToolNames(tool)),
    );
  } catch (error) {
    input.config.log?.(
      `weixin host tools/effective unavailable; falling back to local checks: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function collectWeixinHostEffectiveModelToolNames(tool: {
  readonly id?: string;
  readonly toolName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly capabilities?: readonly { readonly metadata?: Readonly<Record<string, unknown>> }[];
}): string[] {
  const names = new Set<string>();
  appendWeixinHostEffectiveModelToolName(names, tool.id);
  appendWeixinHostEffectiveModelToolName(names, tool.toolName);
  appendWeixinHostEffectiveModelToolName(names, readRecordString(tool.metadata, "modelToolName"));
  const modelToolNames = tool.metadata?.modelToolNames;
  if (Array.isArray(modelToolNames)) {
    for (const item of modelToolNames) {
      appendWeixinHostEffectiveModelToolName(names, item);
    }
  }
  for (const capability of tool.capabilities ?? []) {
    appendWeixinHostEffectiveModelToolName(
      names,
      readRecordString(capability.metadata, "modelToolName"),
    );
    appendWeixinHostEffectiveModelToolName(
      names,
      readRecordString(capability.metadata, "toolName"),
    );
  }
  return [...names];
}

function appendWeixinHostEffectiveModelToolName(names: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim().length > 0) {
    names.add(value.trim());
  }
}

function mapWeixinHostSharedToolRequest(call: {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}): {
  readonly toolId: string;
  readonly operationId?: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly command?: string;
} {
  if (call.name === "director.opencli.list") {
    return {
      toolId: "opencli.local",
      operationId: "opencli.list",
      args: call.args,
    };
  }
  if (call.name === "director.opencli.invoke") {
    const operationId = readRecordString(call.args, "operationId");
    const nestedArgs = call.args.args;
    return {
      toolId: "opencli.local",
      ...(operationId === undefined ? {} : { operationId }),
      args: isObject(nestedArgs) ? nestedArgs : {},
    };
  }
  return {
    toolId: call.name,
    args: call.args,
  };
}

function createWeixinRuntimeSessionKey(config: WeixinGatewayConfig, peerId?: string): string {
  return `weixin:${config.account.normalizedAccountId}:${peerId ?? "unknown"}`;
}

const weixinConversationRunRegistries = new Map<
  string,
  ReturnType<typeof createConversationRunRegistry>
>();
const weixinLearningArtifactStores = new Map<
  string,
  ReturnType<typeof createFileLearningArtifactStore>
>();
const weixinToolEvidenceStores = new Map<
  string,
  ReturnType<typeof createFileConversationRuntimeToolEvidenceStore>
>();

function createWeixinConversationRunRegistry(config: WeixinGatewayConfig) {
  const path = resolveWeixinConversationRunRegistryPath(config);
  const existing = weixinConversationRunRegistries.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const registry = createConversationRunRegistry({
    store: createFileConversationRunRegistryStore({ path }),
  });
  weixinConversationRunRegistries.set(path, registry);
  return registry;
}

function resolveWeixinConversationRunRegistryPath(config: WeixinGatewayConfig): string {
  return join(
    config.home,
    "runtime",
    "conversation-runs",
    `${config.account.normalizedAccountId}.json`,
  );
}

function createWeixinLearningArtifactStore(config: WeixinGatewayConfig) {
  const path = resolveWeixinLearningArtifactStorePath(config);
  const existing = weixinLearningArtifactStores.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const store = createFileLearningArtifactStore({ path });
  weixinLearningArtifactStores.set(path, store);
  return store;
}

function createWeixinToolEvidenceStore(config: WeixinGatewayConfig) {
  const rootPath = resolveWeixinToolEvidenceStorePath(config);
  const existing = weixinToolEvidenceStores.get(rootPath);
  if (existing !== undefined) {
    return existing;
  }
  const store = createFileConversationRuntimeToolEvidenceStore({ rootPath });
  weixinToolEvidenceStores.set(rootPath, store);
  return store;
}

function resolveWeixinToolEvidenceStorePath(config: WeixinGatewayConfig): string {
  return resolve(configWorkspaceRoot(config), ".hotflow", "conversation-runtime", "tool-evidence");
}

function resolveWeixinLearningArtifactStorePath(config: WeixinGatewayConfig): string {
  return resolve(
    configWorkspaceRoot(config),
    ".hotflow",
    "conversation-runtime",
    "learning-artifacts.json",
  );
}

function stopWeixinConversationRuntimeRuns(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly reason: string;
}): { readonly stopped: number; readonly turnRunIds: readonly string[] } {
  const sessionKey = createWeixinRuntimeSessionKey(input.config, input.peerId);
  const runRegistry = createWeixinConversationRunRegistry(input.config);
  const activeRuns = runRegistry
    .list({ sessionKey })
    .filter((run) => isActiveConversationRunRegistryStatus(run.status));
  const stoppedRunIds: string[] = [];
  for (const run of activeRuns) {
    try {
      runRegistry.stop(run.turnRunId, {
        requestedBy: "user",
        reason: input.reason,
      });
      stoppedRunIds.push(run.turnRunId);
    } catch (_error) {
      // The run may finalize between intent parsing and stop dispatch.
    }
  }
  return { stopped: stoppedRunIds.length, turnRunIds: stoppedRunIds };
}

function isActiveConversationRunRegistryStatus(status: string): boolean {
  return isActiveConversationTurnRunStatus(status);
}

function readWeixinRuntimeAckText(runtimeResult: ConversationRuntimeResult): string | null {
  const ack = runtimeResult.events.find(
    (event): event is ConversationRuntimeEvent<"runtime.ack"> => event.kind === "runtime.ack",
  );
  return typeof ack?.payload.message === "string" && ack.payload.message.trim().length > 0
    ? ack.payload.message.trim()
    : null;
}

function readRecordString(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const nested = value?.[key];
  return typeof nested === "string" && nested.trim().length > 0 ? nested.trim() : undefined;
}

function readRecordNumber(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const nested = value?.[key];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : undefined;
}

function readRecordArray(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly Record<string, unknown>[] {
  const nested = value?.[key];
  return Array.isArray(nested) ? nested.filter(isObject) : [];
}

function createWeixinEffectiveModelToolChecks(
  config: WeixinGatewayConfig,
): ReadonlyMap<string, ExternalToolCheckFunction> {
  const workspaceRoot = configWorkspaceRoot(config);
  const checks = new Map<string, ExternalToolCheckFunction>();
  checks.set("web_search", () => ({
    status: "ready",
    summary: "web_search is available through the Weixin conversation runtime.",
  }));
  checks.set("web_extract", () => ({
    status: typeof fetch === "function" ? "ready" : "unreachable",
    summary:
      typeof fetch === "function"
        ? "web_extract is available through the Weixin conversation runtime."
        : "No fetch implementation is available for web_extract.",
  }));
  checks.set("web_extract_artifact_read", () => ({
    status: "ready",
    summary:
      "web_extract_artifact_read can read saved web_extract artifacts from the Weixin runtime store.",
  }));
  checks.set("x_search", () => {
    const registry = createExternalProviderAuthRegistry({
      manifests: createBuiltinExternalProviderManifests(),
      config: loadWeixinExternalProviderAuthConfig(workspaceRoot),
      env: process.env,
    });
    const status = registry.getStatus("x-twitter");
    return {
      status: status.status === "ready" ? "ready" : status.status,
      summary: status.summary,
      nextActions: status.nextActions,
      metadata: {
        providerId: "x-twitter",
        configuredSecret: status.configuredSecret,
        activeSurface: status.activeSurface,
      },
    };
  });
  checks.set("browser_status", () =>
    mapWeixinBrowserEndpointToModelToolDoctor(workspaceRoot, { allowDisconnected: true }),
  );
  checks.set("browser_connect", () =>
    mapWeixinBrowserEndpointToModelToolDoctor(workspaceRoot, { allowDisconnected: true }),
  );
  for (const toolName of [
    "browser_scroll",
    "browser_back",
    "browser_press",
    "browser_console",
    "browser_disconnect",
    "browser_cleanup",
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_get_images",
  ]) {
    checks.set(toolName, () => mapWeixinBrowserEndpointToModelToolDoctor(workspaceRoot));
  }
  return checks;
}

function loadWeixinExternalProviderAuthConfig(
  workspaceRoot: string,
): WeixinExternalProviderAuthConfig {
  const path = resolve(workspaceRoot, ".director-angel", "external-tools", "providers.json");
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const providers = normalizeWeixinExternalProviderStoredConfigs(
      (parsed as { readonly providers?: unknown }).providers,
    );
    const secrets = (parsed as { readonly secrets?: unknown }).secrets;
    return {
      ...(providers === undefined ? {} : { providers }),
      ...(typeof secrets === "object" && secrets !== null ? { secrets } : {}),
    };
  } catch {
    return {};
  }
}

function normalizeWeixinExternalProviderStoredConfigs(
  value: unknown,
): Readonly<Record<string, ExternalProviderStoredConfig>> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const providers: Record<string, ExternalProviderStoredConfig> = {};
  for (const [providerId, rawProvider] of Object.entries(value)) {
    if (typeof rawProvider !== "object" || rawProvider === null) {
      continue;
    }
    const record = rawProvider as {
      readonly enabled?: unknown;
      readonly values?: unknown;
    };
    providers[providerId] = {
      ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
      ...(typeof record.values === "object" && record.values !== null
        ? { values: record.values as Record<string, string | boolean | number | null> }
        : {}),
    };
  }
  return providers;
}

function mapWeixinBrowserEndpointToModelToolDoctor(
  workspaceRoot: string,
  options: { readonly allowDisconnected?: boolean } = {},
): ReturnType<ExternalToolCheckFunction> {
  const endpoint = resolveWeixinBrowserToolEndpoint(workspaceRoot);
  if (endpoint === null) {
    return {
      status: options.allowDisconnected === true ? "ready" : "disabled",
      summary:
        "Weixin has no shared desktop browser endpoint. Start the desktop app or refresh runtime/gateway-service/weixin-gateway.json before browser actions can run.",
      nextActions: [
        "启动桌面端共享 browser provider",
        "刷新 runtime/gateway-service/weixin-gateway.json 中的 browserToolUrl",
      ],
      details: {
        workspaceRoot,
        env: "DIRECTOR_BROWSER_TOOL_URL",
      },
    };
  }
  return {
    status: "ready",
    summary: `Weixin browser tools are routed to ${endpoint.toString()}.`,
    nextActions: ["模型可通过共享桌面 browser provider 执行浏览器动作"],
    details: {
      endpoint: endpoint.toString(),
      workspaceRoot,
    },
  };
}

function loadWeixinMcpConfig(workspaceRoot: string): {
  readonly path: string;
  readonly source: ReturnType<typeof loadConversationRuntimeMergedMcpConfig>["source"];
  readonly servers: ReturnType<typeof loadConversationRuntimeMergedMcpConfig>["servers"];
  readonly serverSources: ReturnType<
    typeof loadConversationRuntimeMergedMcpConfig
  >["serverSources"];
} {
  return loadConversationRuntimeMergedMcpConfig(workspaceRoot);
}

async function writeWeixinMcpConfig(
  workspaceRoot: string,
  servers: Readonly<Record<string, ConversationRuntimeMcpServerConfig>>,
): Promise<ReturnType<typeof loadWeixinMcpConfig>> {
  const configPath = join(workspaceRoot, ".mcp.json");
  await writeConversationRuntimeMcpJsonConfig(configPath, {
    mcpServers: createConversationRuntimeWritableMergedMcpServers(workspaceRoot, servers),
  });
  return loadWeixinMcpConfig(workspaceRoot);
}

function splitIdAndNote(value: string): { readonly id: string; readonly note?: string } | null {
  const [id, ...noteParts] = value.trim().split(/\s+/u);
  if (id === undefined || id.length === 0) {
    return null;
  }
  const note = noteParts.join(" ").trim();
  return {
    id,
    ...(note.length === 0 ? {} : { note }),
  };
}

function arrayCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return Array.isArray(value) ? value.length : 0;
}

function readNestedString(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

function readNestedBoolean(value: unknown, path: readonly string[]): boolean | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "boolean" ? current : undefined;
}

function readNestedNumber(value: unknown, path: readonly string[]): number | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

function readNestedArray(value: unknown, path: readonly string[]): readonly unknown[] {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return [];
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return Array.isArray(current) ? current : [];
}

function readStringArray(value: unknown, key: string): readonly string[] {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) {
    return [];
  }
  const nested = (value as Record<string, unknown>)[key];
  return Array.isArray(nested)
    ? nested.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function readWeixinEvidenceObject(
  ...values: readonly unknown[]
): Readonly<Record<string, unknown>> | undefined {
  return values.find((value): value is Readonly<Record<string, unknown>> => isObject(value));
}

function firstItemTitle(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const first = value[0];
  return (
    readNestedString(first, ["title"]) ??
    readNestedString(first, ["metadata", "title"]) ??
    readNestedString(first, ["candidateId"]) ??
    readNestedString(first, ["id"])
  );
}

function formatListReply(input: {
  readonly label: string;
  readonly count: number;
  readonly firstTitle?: string;
}): string {
  return input.count === 0
    ? `${input.label} 0 条。`
    : `${input.label} ${input.count} 条。${input.firstTitle === undefined ? "" : `\n最新：${input.firstTitle}`}`;
}

function createListReply(input: {
  readonly label: string;
  readonly count: number;
  readonly firstTitle: string | undefined;
}): string {
  return formatListReply({
    label: input.label,
    count: input.count,
    ...(input.firstTitle === undefined ? {} : { firstTitle: input.firstTitle }),
  });
}

function renderWeixinCapabilityCommandStatusReply(input: {
  readonly status: string;
  readonly reason: string;
  readonly detail?: string;
  readonly nextAction?: string;
}): string {
  return renderConversationRuntimeStructuredStatusText({
    title: "Weixin capability command:",
    status: input.status,
    reason: input.reason,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.nextAction === undefined ? {} : { nextAction: input.nextAction }),
  });
}

function renderWeixinCapabilityOverviewReply(input: {
  readonly runtimeToolCount: number;
  readonly hostReadyToolCount?: number;
}): string {
  return renderChannelCapabilityOverviewProjection({
    surfaceLabel: "微信端",
    runtimeToolCount: input.runtimeToolCount,
    ...(input.hostReadyToolCount === undefined
      ? {}
      : { hostReadyToolCount: input.hostReadyToolCount }),
  });
}

async function renderWeixinWorkspaceStatusReply(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
}): Promise<string> {
  const workspaceRoot = configWorkspaceRoot(input.config);
  const providers = loadDirectorApiProviderConfig(
    resolve(workspaceRoot, ".director-angel", "providers"),
  ).document.providers;
  const providerSummary =
    providers.length === 0
      ? "未配置"
      : providers
          .map((provider) => {
            const models = Object.values(provider.defaultModels ?? {})
              .filter((model): model is string => typeof model === "string" && model.length > 0)
              .join("/");
            return `${provider.id}${models.length === 0 ? "" : `(${models})`}`;
          })
          .join("、");
  const activeSession = loadPeerSession(
    input.config.home,
    input.config.account.normalizedAccountId,
    input.peerId,
  );
  let toolProviders: {
    readonly providerId: string;
    readonly status: string;
    readonly lastKnownGood?: boolean;
  }[] = [];
  let toolProviderReadError = false;
  if (input.config.useHostToolControlPlane === true) {
    try {
      const effective = await readDirectorToolsEffective(input.config.director, {
        agentId: input.config.director.agentId,
        sessionKey: createWeixinRuntimeSessionKey(input.config, input.peerId),
        profile: "weixin",
        includeUnavailable: true,
      });
      const providerMatrix = isObject(effective.providerMatrix) ? effective.providerMatrix : {};
      const providersMatrix = readRecordArray(providerMatrix, "providers");
      toolProviders = providersMatrix.map((provider) => ({
        providerId: readRecordString(provider, "providerId") ?? "unknown",
        status: translateWeixinProviderStatus(readRecordString(provider, "status")),
        ...(isObject(provider.lastKnownGood) ? { lastKnownGood: true } : {}),
      }));
    } catch {
      toolProviderReadError = true;
    }
  }
  return renderChannelWorkspaceStatusProjection({
    title: "微信网关",
    hostApiUrl: input.config.director.hostApiUrl,
    desktopBrowserBridgeConfigured: Boolean(process.env.DIRECTOR_BROWSER_TOOL_URL?.trim()),
    modelProviderSummary: providerSummary,
    ...(activeSession?.runId === undefined
      ? {}
      : {
          activeRun: {
            label: activeSession.lastObjective ?? "有活跃任务",
            pendingApprovalCount: activeSession.pendingApprovalAssignmentIds?.length ?? 0,
          },
        }),
    ...(toolProviders.length === 0 ? {} : { toolProviders }),
    ...(toolProviderReadError ? { toolProviderReadError: true } : {}),
  });
}

function createWeixinLearningStatusProjectionText(input: {
  readonly config: WeixinGatewayConfig;
}): string {
  const artifacts = createWeixinLearningArtifactStore(input.config).listArtifacts();
  const latest = artifacts.at(-1);
  if (latest === undefined) {
    return renderChannelLearningStatusProjection({
      title: "学习状态",
      backgroundSummary: "后台学习：共享运行时已接管；只生成候选，不自动发布。",
    });
  }
  const metadata = isObject(latest.metadata) ? latest.metadata : {};
  const candidates = Array.isArray(metadata.candidates) ? metadata.candidates : [];
  const evidenceSnapshots = Array.isArray(metadata.evidenceSnapshots)
    ? metadata.evidenceSnapshots
    : [];
  const firstEvidenceId =
    latest.evidenceRefs[0] ??
    latest.mediaEvidenceRefs[0]?.id ??
    readRecordString(evidenceSnapshots[0], "id");
  return renderChannelLearningStatusProjection({
    title: "学习状态",
    latest: {
      sourceKind: latest.sourceKind,
      sourceRef: latest.sourceRef,
      candidateCount: readRecordNumber(metadata, "candidateCount") ?? candidates.length,
      evidenceCount:
        latest.evidenceRefs.length + latest.mediaEvidenceRefs.length || evidenceSnapshots.length,
      ...(firstEvidenceId === undefined ? {} : { firstEvidenceId }),
      readable: latest.publishable,
      status: latest.status,
    },
    backgroundSummary: "后台学习：共享运行时已接管；只生成候选，不自动发布。",
  });
}

function translateWeixinProviderStatus(status: string | undefined): string {
  if (status === "ready") return "可用";
  if (status === "needs-auth") return "需授权";
  if (status === "missing") return "未配置";
  return status ?? "未知";
}

function renderWeixinRuntimeToolApprovalStatusReply(input: {
  readonly status: string;
  readonly reason: string;
  readonly detail?: string;
  readonly nextAction?: string;
  readonly actorKind?: "requester" | "trusted-operator";
}): string {
  return renderConversationRuntimeApprovalDecisionText({
    title: "微信工具确认",
    status: input.status,
    reason: input.reason,
    includeMachineStatus: false,
    userFacing: true,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.nextAction === undefined ? {} : { nextAction: input.nextAction }),
    ...(input.actorKind === undefined ? {} : { actorKind: input.actorKind }),
  });
}

function isExplicitWeixinRuntimeToolApprovalDecisionText(text: string): boolean {
  const normalized = text.trim().replace(/\s+/gu, "");
  return (
    /(?:工具|能力|操作|审批|确认)/u.test(normalized) && !/^(确认|执行|继续)$/u.test(normalized)
  );
}

async function runWeixinCapabilityCommand(input: {
  readonly config: WeixinGatewayConfig;
  readonly command: ChannelSlashCommandEnvelope;
  readonly message: WeixinMessage;
  readonly peerId: string;
}): Promise<WeixinCapabilityCommandResult | null> {
  const args = input.command.args.trim();
  switch (input.command.commandId) {
    case "tools.capabilities": {
      let hostReadyToolCount: number | undefined;
      if (input.config.useHostToolControlPlane === true) {
        try {
          const effective = await readDirectorToolsEffective(input.config.director, {
            agentId: input.config.director.agentId,
            sessionKey: createWeixinRuntimeSessionKey(input.config, input.peerId),
            profile: "weixin",
            includeUnavailable: true,
          });
          hostReadyToolCount = effective.tools.filter((tool) => tool.canInvoke === true).length;
        } catch {
          hostReadyToolCount = undefined;
        }
      }
      return {
        reply: renderWeixinCapabilityOverviewReply({
          runtimeToolCount: createDirectorConversationRuntimeTools().length,
          ...(hostReadyToolCount === undefined ? {} : { hostReadyToolCount }),
        }),
      };
    }
    case "workspace.status": {
      return {
        reply: await renderWeixinWorkspaceStatusReply({
          config: input.config,
          peerId: input.peerId,
        }),
      };
    }
    case "heartbeat.status": {
      return { reply: createWeixinLearningStatusProjectionText({ config: input.config }) };
    }
    case "learning.admit":
    case "learning.url": {
      const url = extractFirstUrl(args);
      if (url === null) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "url source is required",
            nextAction: "send /学习链接 <url>",
          }),
        };
      }
      const userText = extractWeixinText(input.message.item_list ?? []);
      const result = await runWeixinUrlLearningReadAndAdmit({
        config: input.config,
        peerId: input.peerId,
        sourceId: createWeixinSourceId("weixin-url", input.message),
        url,
        nowMs: timestampValue(input.message.create_time_ms),
        messageId: resolveMessageId(input.message),
        ...(userText.length === 0 ? {} : { userText }),
      });
      const candidateCount =
        readNumber(result.result, "candidateCount") ?? arrayCount(result, "candidates");
      const projection = createWeixinRuntimeLearningProjectionFromResult({
        config: input.config,
        peerId: input.peerId,
        source: "url",
        query: url,
        result,
      });
      return { reply: renderWeixinLearningProjectionReply({ ...projection, candidateCount }) };
    }
    case "learning.query": {
      if (args.length === 0) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "learning query is required",
            nextAction: "send /学习 搜索 <topic>",
          }),
        };
      }
      const result = await learnDirectorFromQuery(input.config.director, {
        sourceId: createWeixinSourceId("weixin-query", input.message),
        queries: [args],
        nowMs: timestampValue(input.message.create_time_ms),
      });
      const candidateCount =
        readNumber(result.result, "candidateCount") ?? arrayCount(result, "candidates");
      const projection = createWeixinRuntimeLearningProjectionFromResult({
        config: input.config,
        peerId: input.peerId,
        source: "query",
        query: args,
        result,
      });
      return { reply: renderWeixinLearningProjectionReply({ ...projection, candidateCount }) };
    }
    case "learning.directory": {
      const directory = extractFirstPath(args) ?? args;
      if (directory.trim().length === 0) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "local directory source is required",
            nextAction: "send /学习目录 <path>",
          }),
        };
      }
      const result = await learnDirectorFromDirectory(input.config.director, {
        sourceId: createWeixinSourceId("weixin-directory", input.message),
        directory: directory.trim(),
        nowMs: timestampValue(input.message.create_time_ms),
      });
      const candidateCount =
        readNumber(result.result, "candidateCount") ?? arrayCount(result, "candidates");
      const projection = createWeixinRuntimeLearningProjectionFromResult({
        config: input.config,
        peerId: input.peerId,
        source: "directory",
        query: directory.trim(),
        result,
      });
      return { reply: renderWeixinLearningProjectionReply({ ...projection, candidateCount }) };
    }
    case "experience.list": {
      const result = await listDirectorExperienceCandidates(input.config.director);
      return {
        reply: createListReply({
          label: "经验候选",
          count: arrayCount(result, "experienceCandidates"),
          firstTitle: firstItemTitle(result.experienceCandidates),
        }),
      };
    }
    case "experience.accept":
    case "experience.reject":
    case "experience.promote": {
      const parsed = splitIdAndNote(args);
      if (parsed === null) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "experience candidate id is required",
            nextAction: "send /经验 <action> <candidate-id>",
          }),
        };
      }
      const action = input.command.commandId.replace("experience.", "") as
        | "accept"
        | "reject"
        | "promote";
      const result = await actOnDirectorExperienceCandidate(input.config.director, {
        candidateId: parsed.id,
        action,
        actor: "director-weixin-gateway",
        ...(parsed.note === undefined ? {} : { note: parsed.note }),
      });
      if (action === "promote") {
        const packId =
          readNestedString(result, ["knowledgeCandidate", "metadata", "id"]) ?? parsed.id;
        return { reply: `已提炼为知识候选：${packId}\n下一步：/知识 候选` };
      }
      return {
        reply: `${action === "accept" ? "已通过经验" : "已拒绝经验"}：${parsed.id}`,
      };
    }
    case "knowledge.candidates": {
      const result = await listDirectorKnowledgeCandidates(input.config.director);
      return {
        reply: createListReply({
          label: "知识候选",
          count: arrayCount(result, "knowledgeCandidates"),
          firstTitle: firstItemTitle(result.knowledgeCandidates),
        }),
      };
    }
    case "knowledge.accept":
    case "knowledge.reject":
    case "knowledge.publish": {
      const parsed = splitIdAndNote(args);
      if (parsed === null) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "knowledge candidate id is required",
            nextAction: "send /知识 <action> <pack-id>",
          }),
        };
      }
      const action = input.command.commandId.replace("knowledge.", "") as DirectorKnowledgeAction;
      await actOnDirectorKnowledgeCandidate(input.config.director, {
        packId: parsed.id,
        action,
        actor: "director-weixin-gateway",
        ...(parsed.note === undefined ? {} : { note: parsed.note }),
      });
      const label =
        action === "publish" ? "已发布知识" : action === "accept" ? "已通过知识" : "已拒绝知识";
      return { reply: `${label}：${parsed.id}` };
    }
    case "knowledge.recallPreview": {
      const result = await previewDirectorKnowledgeRecall(
        input.config.director,
        createWeixinKnowledgeRecallInput(args),
      );
      return { reply: formatWeixinKnowledgeRecallReply(result) };
    }
    case "memory.status": {
      const governance = parseWeixinMemoryGovernanceArgs(args);
      if (governance !== null) {
        const result = await governDirectorMemoryPublication(input.config.director, {
          recordId: governance.recordId,
          action: governance.action,
          actor: "director-weixin-gateway",
          ...(governance.note === undefined ? {} : { note: governance.note }),
        });
        return { reply: formatWeixinMemoryGovernanceReply(result) };
      }
      const result = await readDirectorMemoryStatus(input.config.director);
      return { reply: formatWeixinMemoryStatusReply(result) };
    }
    case "memory.recallPreview": {
      const recallInput = createWeixinMemoryRecallInput(input.config, input.message, args);
      const result = await previewDirectorMemoryRecall(input.config.director, recallInput);
      return { reply: formatWeixinMemoryRecallReply(result) };
    }
    case "maintenance.preview": {
      const result = await previewDirectorMaintenance(
        input.config.director,
        createWeixinMaintenanceInput(args),
      );
      return { reply: formatWeixinMaintenanceReply(result) };
    }
    case "maintenance.apply": {
      const result = await applyDirectorMaintenanceFromGateway(
        input.config.director,
        createWeixinMaintenanceInput(args),
      );
      return { reply: formatWeixinMaintenanceReply(result) };
    }
    case "media.comfyui.run": {
      if (isComfyUiOpenRequest(args)) {
        const config = loadDirectorComfyUiConfig(
          resolve(configWorkspaceRoot(input.config), ".director-angel", "external-tools"),
        );
        return { reply: formatWeixinComfyUiOpenReply(config.document.adapter.baseUrl) };
      }
      const createWorkflow = parseComfyUiCreateWorkflowArgs(args);
      if (createWorkflow !== null) {
        if (createWorkflow.objective.length === 0) {
          return {
            reply: renderWeixinCapabilityCommandStatusReply({
              status: "missing-argument",
              reason: "ComfyUI workflow objective is required",
              nextAction: "send /ComfyUI 脚本+图片+视频 <objective>",
            }),
          };
        }
        const draft = await createWeixinComfyUiWorkflowDraft(input.config, createWorkflow, {
          ...(input.config.apiProviderFetch === undefined
            ? {}
            : { fetchImpl: input.config.apiProviderFetch }),
        });
        return { reply: formatWeixinComfyUiWorkflowDraftReply(draft) };
      }
      if (args.length === 0) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "ComfyUI prompt is required",
            nextAction: "send /ComfyUI <prompt>",
          }),
        };
      }
      const fetchImpl =
        input.config.apiProviderFetch === undefined
          ? undefined
          : async (
              url: string,
              init: {
                readonly method: "GET" | "POST";
                readonly headers: Record<string, string>;
                readonly body?: string;
                readonly signal?: AbortSignal;
              },
            ) => {
              const response = await input.config.apiProviderFetch?.(url, init);
              if (response === undefined) {
                throw new Error("ComfyUI fetch adapter returned no response.");
              }
              return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText ?? "",
                text: response.text.bind(response),
                ...("arrayBuffer" in response && typeof response.arrayBuffer === "function"
                  ? { arrayBuffer: response.arrayBuffer.bind(response) }
                  : {}),
              };
            };
      const result = await runDirectorComfyUiWorkflow(
        resolve(configWorkspaceRoot(input.config), ".director-angel", "external-tools"),
        {
          prompt: args,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
        },
      );
      return { reply: formatWeixinComfyUiRunReply(result) };
    }
    case "skills.proposeFromExperience": {
      const parsed = splitIdAndNote(args);
      if (parsed === null) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "experience candidate id is required",
            nextAction: "send /技能 从经验 <candidate-id>",
          }),
        };
      }
      const result = await proposeDirectorSkillFromExperience(input.config.director, {
        candidateId: parsed.id,
        author: "director-weixin-gateway",
        nowMs: timestampValue(input.message.create_time_ms),
      });
      const proposalId = readNestedString(result, ["proposal", "id"]) ?? parsed.id;
      return { reply: `已生成 Skill 候选：${proposalId}\n下一步：/技能 接受 ${proposalId}` };
    }
    case "skills.list": {
      const [skills, proposals] = await Promise.all([
        listDirectorSkills(input.config.director),
        listDirectorSkillProposals(input.config.director),
      ]);
      return {
        reply: `Skill ${arrayCount(skills, "skills")} 个。\n待审 Skill 候选 ${arrayCount(
          proposals,
          "proposals",
        )} 个。`,
      };
    }
    case "skills.accept":
    case "skills.reject":
    case "skills.apply": {
      const parsed = splitIdAndNote(args);
      if (parsed === null) {
        return {
          reply: renderWeixinCapabilityCommandStatusReply({
            status: "missing-argument",
            reason: "Skill proposal id is required",
            nextAction: "send /技能 <action> <proposal-id>",
          }),
        };
      }
      const action = input.command.commandId.replace("skills.", "") as DirectorSkillProposalAction;
      await actOnDirectorSkillProposal(input.config.director, {
        proposalId: parsed.id,
        action,
        actor: "director-weixin-gateway",
        ...(parsed.note === undefined ? {} : { note: parsed.note }),
      });
      const label =
        action === "apply"
          ? "已安装 Skill"
          : action === "accept"
            ? "已接受 Skill 候选"
            : "已拒绝 Skill 候选";
      return { reply: `${label}：${parsed.id}` };
    }
    default:
      return null;
  }
}

function createWeixinKnowledgeRecallInput(args: string): {
  readonly tags?: readonly string[];
  readonly projectId?: string;
  readonly groupId?: string;
  readonly includeGlobalExperience: boolean;
  readonly maxHits: number;
} {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return {
      includeGlobalExperience: true,
      maxHits: 3,
    };
  }
  const keyValues = parseSimpleKeyValueArgs(trimmed);
  const tags = keyValues.get("tag") ?? keyValues.get("tags") ?? trimmed;
  const input: {
    tags?: readonly string[];
    projectId?: string;
    groupId?: string;
    includeGlobalExperience: boolean;
    maxHits: number;
  } = {
    tags: tags
      .split(/[,\s，、]+/u)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
    includeGlobalExperience: true,
    maxHits: 3,
  };
  const projectId = keyValues.get("project") ?? keyValues.get("projectId");
  const groupId = keyValues.get("group") ?? keyValues.get("groupId");
  if (projectId !== undefined) {
    input.projectId = projectId;
  }
  if (groupId !== undefined) {
    input.groupId = groupId;
  }
  return input;
}

function createWeixinMemoryRecallInput(
  config: WeixinGatewayConfig,
  message: WeixinMessage,
  args: string,
): {
  readonly projectId: string;
  readonly groupId?: string;
  readonly anchorIds?: readonly string[];
  readonly selectedAdapters?: readonly string[];
  readonly knowledgeSignalTags?: readonly string[];
  readonly maxHits: number;
} {
  const keyValues = parseSimpleKeyValueArgs(args.trim());
  const peerId = resolvePeerId(message);
  const defaultScopeId = `${config.director.hostId}:${config.director.channel}:${peerId}`;
  const projectId =
    keyValues.get("project") ?? keyValues.get("projectId") ?? `project-${defaultScopeId}`;
  const groupId = keyValues.get("group") ?? keyValues.get("groupId") ?? `group-${defaultScopeId}`;
  const tags = keyValues.get("tag") ?? keyValues.get("tags");
  const anchor = keyValues.get("anchor") ?? keyValues.get("anchorId");
  const adapter = keyValues.get("adapter") ?? keyValues.get("adapterId");
  const maxHits = Number.parseInt(keyValues.get("max") ?? keyValues.get("maxHits") ?? "3", 10);

  return {
    projectId,
    ...(groupId.length === 0 ? {} : { groupId }),
    ...(anchor === undefined
      ? {}
      : {
          anchorIds: anchor
            .split(/[,\s，、]+/u)
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        }),
    ...(adapter === undefined
      ? {}
      : {
          selectedAdapters: adapter
            .split(/[,\s，、]+/u)
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        }),
    ...(tags === undefined
      ? {}
      : {
          knowledgeSignalTags: tags
            .split(/[,\s，、]+/u)
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        }),
    maxHits: Number.isFinite(maxHits) && maxHits > 0 ? maxHits : 3,
  };
}

function createWeixinMaintenanceInput(args: string): {
  readonly logRetentionDays?: number;
  readonly logMaxBytes?: number;
  readonly archivePromotedExperienceAfterDays?: number;
  readonly archiveRejectedExperienceAfterDays?: number;
  readonly archiveQuarantineAfterDays?: number;
  readonly archiveUnreferencedArtifactsAfterDays?: number;
  readonly staleUnreviewedExperienceDays?: number;
  readonly staleUnreviewedMinimumScore?: number;
  readonly archiveRejectedKnowledgeAfterDays?: number;
  readonly staleUnreviewedKnowledgeDays?: number;
  readonly archiveOrphanKnowledgeReviewsAfterDays?: number;
  readonly knowledgeHistoryRetentionVersions?: number;
  readonly archiveKnowledgeRollbackAfterDays?: number;
} {
  const normalized = args.trim();
  const keyValues = parseSimpleKeyValueArgs(normalized);
  const input: {
    logRetentionDays?: number;
    logMaxBytes?: number;
    archivePromotedExperienceAfterDays?: number;
    archiveRejectedExperienceAfterDays?: number;
    archiveQuarantineAfterDays?: number;
    archiveUnreferencedArtifactsAfterDays?: number;
    staleUnreviewedExperienceDays?: number;
    staleUnreviewedMinimumScore?: number;
    archiveRejectedKnowledgeAfterDays?: number;
    staleUnreviewedKnowledgeDays?: number;
    archiveOrphanKnowledgeReviewsAfterDays?: number;
    knowledgeHistoryRetentionVersions?: number;
    archiveKnowledgeRollbackAfterDays?: number;
  } = {};
  setOptionalMaintenanceNumber(input, "logRetentionDays", [
    keyValues.get("logRetentionDays"),
    keyValues.get("日志保留"),
    matchNumber(normalized, /日志保留(?:天数)?\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "logMaxBytes", [
    keyValues.get("logMaxBytes"),
    keyValues.get("日志大小"),
    matchNumber(normalized, /日志(?:最大)?(?:大小|字节)\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "archivePromotedExperienceAfterDays", [
    keyValues.get("archivePromotedExperienceAfterDays"),
    keyValues.get("已晋升保留"),
    matchNumber(normalized, /已晋升保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "archiveRejectedExperienceAfterDays", [
    keyValues.get("archiveRejectedExperienceAfterDays"),
    keyValues.get("已拒绝保留"),
    matchNumber(normalized, /已拒绝保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "archiveQuarantineAfterDays", [
    keyValues.get("archiveQuarantineAfterDays"),
    keyValues.get("隔离保留"),
    matchNumber(normalized, /隔离保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "archiveUnreferencedArtifactsAfterDays", [
    keyValues.get("archiveUnreferencedArtifactsAfterDays"),
    keyValues.get("源材料保留"),
    matchNumber(normalized, /源材料保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "staleUnreviewedExperienceDays", [
    keyValues.get("staleUnreviewedExperienceDays"),
    keyValues.get("未审保留"),
    matchNumber(normalized, /未审保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "staleUnreviewedMinimumScore", [
    keyValues.get("staleUnreviewedMinimumScore"),
    keyValues.get("最低分"),
    matchNumber(normalized, /最低分\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "archiveRejectedKnowledgeAfterDays", [
    keyValues.get("archiveRejectedKnowledgeAfterDays"),
    keyValues.get("知识拒绝保留"),
    matchNumber(normalized, /知识拒绝保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "staleUnreviewedKnowledgeDays", [
    keyValues.get("staleUnreviewedKnowledgeDays"),
    keyValues.get("知识未审保留"),
    matchNumber(normalized, /知识未审保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "archiveOrphanKnowledgeReviewsAfterDays", [
    keyValues.get("archiveOrphanKnowledgeReviewsAfterDays"),
    keyValues.get("知识审查保留"),
    matchNumber(normalized, /知识审查保留\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "knowledgeHistoryRetentionVersions", [
    keyValues.get("knowledgeHistoryRetentionVersions"),
    keyValues.get("知识历史版本"),
    matchNumber(normalized, /知识历史版本\s*(\d+)/u),
  ]);
  setOptionalMaintenanceNumber(input, "archiveKnowledgeRollbackAfterDays", [
    keyValues.get("archiveKnowledgeRollbackAfterDays"),
    keyValues.get("知识回滚保留"),
    matchNumber(normalized, /知识回滚保留\s*(\d+)/u),
  ]);
  return input;
}

function setOptionalMaintenanceNumber<T extends Record<string, number | undefined>>(
  input: T,
  key: keyof T,
  values: readonly (string | undefined)[],
): void {
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      input[key] = parsed as T[keyof T];
      return;
    }
  }
}

function matchNumber(value: string, pattern: RegExp): string | undefined {
  return pattern.exec(value)?.[1];
}

function parseSimpleKeyValueArgs(value: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const token of value.split(/\s+/u)) {
    const match = /^([^=：:]+)[=：:](.+)$/u.exec(token);
    if (match === null) {
      continue;
    }
    const key = match[1]?.trim();
    const entryValue = match[2]?.trim();
    if (key !== undefined && key.length > 0 && entryValue !== undefined && entryValue.length > 0) {
      entries.set(key, entryValue);
    }
  }
  return entries;
}

function formatWeixinKnowledgeRecallReply(result: Record<string, unknown>): string {
  const recall = isObject(result.recall) ? result.recall : {};
  const hits = Array.isArray(recall.hits) ? recall.hits : [];
  if (hits.length === 0) {
    return "知识召回未命中。你可以先 /学习链接 或 /经验 提炼 后再发布。";
  }
  const first = isObject(hits[0]) ? hits[0] : {};
  const title = typeof first.title === "string" && first.title.trim().length > 0 ? first.title : "";
  return title.length > 0
    ? `知识召回命中 ${hits.length} 条。\n首条：${title}`
    : `知识召回命中 ${hits.length} 条。`;
}

function formatWeixinMemoryStatusReply(result: Record<string, unknown>): string {
  const runtimeMemory = isObject(result.runtimeMemory) ? result.runtimeMemory : {};
  const longTerm = isObject(result.longTerm) ? result.longTerm : {};
  const recordCount =
    typeof runtimeMemory.recordCount === "number" && Number.isFinite(runtimeMemory.recordCount)
      ? runtimeMemory.recordCount
      : 0;
  const longTermSignals = Array.isArray(longTerm.signals) ? longTerm.signals.length : 0;
  return [
    `运行记忆：${runtimeMemory.storeStatus ?? result.status ?? "unknown"}，${recordCount} 条。`,
    `长期记忆：${longTerm.status ?? "unknown"}，信号 ${longTermSignals} 条。`,
    result.enabled === true ? "已参与后续制作召回。" : "当前未启用记忆召回。",
  ].join("\n");
}

function parseWeixinMemoryGovernanceArgs(args: string): {
  readonly action: "retract" | "demote" | "quarantine" | "restore";
  readonly recordId: string;
  readonly note?: string;
} | null {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const [actionText, recordId, ...noteParts] = trimmed.split(/\s+/u);
  const action = normalizeWeixinMemoryGovernanceAction(actionText ?? "");
  if (action === null || recordId === undefined || recordId.trim().length === 0) {
    return null;
  }
  const note = noteParts.join(" ").trim();
  return {
    action,
    recordId: recordId.trim(),
    ...(note.length === 0 ? {} : { note }),
  };
}

function normalizeWeixinMemoryGovernanceAction(
  value: string,
): "retract" | "demote" | "quarantine" | "restore" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "撤回" || normalized === "retract" || normalized === "下架") {
    return "retract";
  }
  if (normalized === "降权" || normalized === "demote") {
    return "demote";
  }
  if (normalized === "隔离" || normalized === "quarantine") {
    return "quarantine";
  }
  if (normalized === "恢复" || normalized === "restore") {
    return "restore";
  }
  return null;
}

function formatWeixinMemoryGovernanceReply(result: Record<string, unknown>): string {
  const text = typeof result.text === "string" && result.text.trim().length > 0 ? result.text : "";
  if (text.length > 0) {
    return text;
  }
  const action = typeof result.action === "string" ? result.action : "治理";
  const recordId = typeof result.recordId === "string" ? result.recordId : "unknown";
  const governanceResult = isObject(result.result) ? result.result : {};
  const status = governanceResult.governanceStatus ?? governanceResult.status ?? "unknown";
  return `记忆${action}已提交：${recordId}，当前状态：${status}`;
}

function formatWeixinMemoryRecallReply(result: Record<string, unknown>): string {
  const packet = isObject(result.packet) ? result.packet : {};
  const hits = Array.isArray(packet.hits) ? packet.hits : [];
  if (hits.length === 0) {
    return result.enabled === true
      ? "运行记忆召回未命中。完成并复盘制作后，记忆会逐步积累。"
      : "运行记忆召回未启用。可以先在设置里打开运行记忆。";
  }
  const first = isObject(hits[0]) ? hits[0] : {};
  const summary =
    typeof first.summary === "string" && first.summary.trim().length > 0
      ? first.summary.trim()
      : undefined;
  const recordId =
    typeof first.recordId === "string" && first.recordId.trim().length > 0
      ? first.recordId.trim()
      : "unknown";
  return summary === undefined
    ? `运行记忆召回命中 ${hits.length} 条。\n首条：${recordId}`
    : `运行记忆召回命中 ${hits.length} 条。\n首条：${recordId}\n${summary}`;
}

function formatWeixinMaintenanceReply(result: Record<string, unknown>): string {
  const logSummary = readObjectPath(result, ["logMaintenance", "summary"]);
  const experienceSummary = readObjectPath(result, ["experienceMaintenance", "summary"]);
  const knowledgeSummary = readObjectPath(result, ["knowledgeMaintenance", "summary"]);
  const mode = result.mode === "apply" ? "已执行" : "预览";
  const lines = [
    `维护${mode}完成。`,
    `日志：扫描 ${readNumber(logSummary, "scannedFiles") ?? 0} 个，归档 ${
      readNumber(logSummary, "archiveFiles") ?? 0
    } 个。`,
    `经验：活跃 ${readNumber(experienceSummary, "activeCandidates") ?? 0} 条，候选归档 ${
      readNumber(experienceSummary, "archiveCandidates") ?? 0
    } 条，隔离归档 ${readNumber(experienceSummary, "archiveQuarantines") ?? 0} 条，源材料归档 ${
      readNumber(experienceSummary, "archiveArtifacts") ?? 0
    } 条。`,
    `知识：候选归档 ${readNumber(knowledgeSummary, "archiveCandidates") ?? 0} 条，审查归档 ${
      readNumber(knowledgeSummary, "archiveReviews") ?? 0
    } 条，历史归档 ${readNumber(knowledgeSummary, "archiveHistory") ?? 0} 条。`,
  ];
  if (typeof result.auditPath === "string" && result.auditPath.length > 0) {
    lines.push(`审计：${result.auditPath}`);
  }
  if (result.mode !== "apply") {
    lines.push("确认后发：/维护 执行");
  }
  return lines.join("\n");
}

function readObjectPath(
  value: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  let current: unknown = value;
  for (const key of path) {
    if (!isObject(current)) {
      return {};
    }
    current = current[key];
  }
  return isObject(current) ? current : {};
}

function configWorkspaceRoot(config: WeixinGatewayConfig): string {
  return config.workspaceRoot ?? process.cwd();
}

function createWeixinWebExtractArtifactAccess(workspaceRoot: string): {
  readonly rootDir: string;
  readonly storeExtractArtifact: ReturnType<
    typeof createFileConversationRuntimeWebExtractArtifactStore
  >;
  readonly readExtractArtifact: ReturnType<
    typeof createFileConversationRuntimeWebExtractArtifactReader
  >;
} {
  const rootDir = resolve(
    workspaceRoot,
    ".hotflow",
    "conversation-runtime",
    "web-extract-artifacts",
  );
  return {
    rootDir,
    storeExtractArtifact: createFileConversationRuntimeWebExtractArtifactStore({ rootDir }),
    readExtractArtifact: createFileConversationRuntimeWebExtractArtifactReader({ rootDir }),
  };
}

function createWeixinSharedDesktopBrowserProvider(
  config: WeixinGatewayConfig,
): ConversationRuntimeBrowserToolProvider | undefined {
  const endpoint = resolveWeixinBrowserToolEndpoint(configWorkspaceRoot(config));
  if (endpoint === null) {
    return undefined;
  }
  const callTool = async (
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    base: { readonly turnId: string; readonly sessionKey: string },
  ) => {
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolName,
        turnId: base.turnId,
        sessionKey: base.sessionKey,
        args,
      }),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text.trim().length === 0 ? {} : JSON.parse(text);
    } catch {
      body = {
        success: false,
        error: `Desktop browser provider returned non-JSON response: ${text.slice(0, 200)}`,
      };
    }
    if (!response.ok) {
      return {
        success: false,
        error:
          readBrowserToolBridgeError(body) ?? `Desktop browser provider HTTP ${response.status}.`,
      };
    }
    return body;
  };
  return {
    navigate: (input) =>
      callTool(
        "browser_navigate",
        { url: input.url, ...(input.profile === undefined ? {} : { profile: input.profile }) },
        input,
      ) as ReturnType<NonNullable<ConversationRuntimeBrowserToolProvider["navigate"]>>,
    snapshot: (input) =>
      callTool(
        "browser_snapshot",
        { full: input.full, ...(input.userTask === undefined ? {} : { userTask: input.userTask }) },
        input,
      ) as ReturnType<NonNullable<ConversationRuntimeBrowserToolProvider["snapshot"]>>,
    click: (input) =>
      callTool("browser_click", { ref: input.ref }, input) as ReturnType<
        NonNullable<ConversationRuntimeBrowserToolProvider["click"]>
      >,
    type: (input) =>
      callTool("browser_type", { ref: input.ref, text: input.text }, input) as ReturnType<
        NonNullable<ConversationRuntimeBrowserToolProvider["type"]>
      >,
    scroll: (input) =>
      callTool(
        "browser_scroll",
        { direction: input.direction, pages: input.pages },
        input,
      ) as ReturnType<NonNullable<ConversationRuntimeBrowserToolProvider["scroll"]>>,
    back: (input) =>
      callTool("browser_back", {}, input) as ReturnType<
        NonNullable<ConversationRuntimeBrowserToolProvider["back"]>
      >,
    press: (input) =>
      callTool("browser_press", { key: input.key }, input) as ReturnType<
        NonNullable<ConversationRuntimeBrowserToolProvider["press"]>
      >,
    getImages: (input) =>
      callTool("browser_get_images", {}, input) as ReturnType<
        NonNullable<ConversationRuntimeBrowserToolProvider["getImages"]>
      >,
    console: (input) =>
      callTool(
        "browser_console",
        {
          clear: input.clear,
          ...(input.expression === undefined ? {} : { expression: input.expression }),
        },
        input,
      ) as ReturnType<NonNullable<ConversationRuntimeBrowserToolProvider["console"]>>,
  };
}

function resolveWeixinBrowserToolEndpoint(workspaceRoot?: string): URL | null {
  for (const raw of [
    process.env.DIRECTOR_BROWSER_TOOL_URL,
    readWeixinGatewayServiceBrowserToolUrl(workspaceRoot),
  ]) {
    const url = parseWeixinBrowserToolEndpoint(raw);
    if (url !== null) {
      return url;
    }
  }
  return null;
}

function parseWeixinBrowserToolEndpoint(raw: string | undefined): URL | null {
  const value = normalizeWeixinConfiguredUrl(raw);
  if (value === "") {
    return null;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "http:" ||
      (hostname !== "127.0.0.1" &&
        hostname !== "localhost" &&
        hostname !== "::1" &&
        hostname !== "[::1]")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function normalizeWeixinConfiguredUrl(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  return value === "undefined" || value === "null" ? "" : value;
}

function readWeixinGatewayServiceBrowserToolUrl(workspaceRoot?: string): string {
  if (workspaceRoot === undefined || workspaceRoot.trim().length === 0) {
    return "";
  }
  const configPath = join(
    workspaceRoot,
    ".director-angel",
    "runtime",
    "gateway-service",
    "weixin-gateway.json",
  );
  try {
    if (!existsSync(configPath)) {
      return "";
    }
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      readonly browserToolUrl?: unknown;
    };
    return typeof raw.browserToolUrl === "string" ? raw.browserToolUrl.trim() : "";
  } catch {
    return "";
  }
}

function readBrowserToolBridgeError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as { readonly message?: unknown; readonly error?: unknown };
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message.trim();
  }
  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return record.error.trim();
  }
  return undefined;
}

function isComfyUiOpenRequest(args: string): boolean {
  return /^(打开|打开界面|界面|前端|控制台|open|ui|web|browser)(?:\s|$)/iu.test(args.trim());
}

interface ComfyUiWorkflowDraftIntent {
  readonly workflowKind: "script" | "copywriting" | "image" | "video";
  readonly workflowModes: readonly ComfyUiWorkflowMode[];
  readonly objective: string;
}

type ComfyUiWorkflowMode = "script" | "image" | "video";

interface ComfyUiWorkflowDraftResult extends ComfyUiWorkflowDraftIntent {
  readonly ok: true;
  readonly id: string;
  readonly path: string;
  readonly url: string;
  readonly pageUrl: string;
  readonly comfyUiPath: string;
  readonly uploadedToComfyUi: boolean;
  readonly uploadMessage: string;
  readonly uploadStatus?: number;
  readonly directOpenReady: boolean;
  readonly templateMessage: string;
  readonly executable: false;
  readonly angelOutput: string;
  readonly angelSource: string;
  readonly recallStatus: string;
  readonly skillStatus: string;
  readonly visibleSummary: string;
}

interface WeixinComfyUiToolParameter {
  readonly name: string;
  readonly label: string;
  readonly value: string | number | boolean;
  readonly description?: string;
}

interface WeixinComfyUiAngelDraft {
  readonly output: string;
  readonly source: string;
  readonly providerId: string | null;
  readonly model: string | null;
  readonly message: string | null;
  readonly recallStatus: string;
  readonly skillStatus: string;
  readonly visibleSummary: string;
  readonly knowledgeHits: readonly { readonly id: string; readonly title?: string }[];
  readonly skillHits: readonly { readonly id: string; readonly title?: string }[];
  readonly recallTrace: readonly unknown[];
  readonly capabilityPlan: readonly unknown[];
  readonly toolParameters: readonly WeixinComfyUiToolParameter[];
  readonly handoffNotes: readonly string[];
}

interface WeixinComfyUiRecallContext {
  readonly lines: readonly string[];
  readonly hiddenPromptBlock: string;
  readonly visibleSummary: string;
  readonly recallStatus: "hit" | "miss" | "degraded";
  readonly skillStatus: "hit" | "miss" | "degraded";
  readonly knowledgeHits: readonly { readonly id: string; readonly title?: string }[];
  readonly skillHits: readonly { readonly id: string; readonly title?: string }[];
  readonly recallTrace: readonly unknown[];
  readonly capabilityPlan: readonly unknown[];
}

function parseComfyUiCreateWorkflowArgs(args: string): ComfyUiWorkflowDraftIntent | null {
  return parseDirectorComfyUiWorkflowDraftIntent(args);
}

async function createWeixinComfyUiWorkflowDraft(
  config: WeixinGatewayConfig,
  intent: ComfyUiWorkflowDraftIntent,
  options: { readonly fetchImpl?: FetchLike | undefined } = {},
): Promise<ComfyUiWorkflowDraftResult> {
  const createdAt = new Date().toISOString();
  const id = `comfyui-${intent.workflowModes.join("-")}-${Date.parse(createdAt)}-${sanitizeWorkflowSlug(
    intent.objective,
  )}`;
  const angelDraft = await createWeixinComfyUiAngelDraft(config, intent);
  const workflowRoot = resolve(
    configWorkspaceRoot(config),
    ".director-angel",
    "external-tools",
    "comfyui-workflows",
  );
  const path = join(workflowRoot, `${id}.json`);
  const draft = {
    schemaVersion: 1,
    id,
    kind: intent.workflowKind,
    workflowModes: intent.workflowModes,
    objective: intent.objective,
    status: "draft",
    executable: false as const,
    createdAt,
    author: "director-weixin-gateway",
    requires: [
      "Angel output review",
      "ComfyUI node parameter mapping",
      "operator review before execution",
    ],
    boundary:
      "Director Angel generates content and parameters first. ComfyUI is the external canvas/executor and should receive mapped workflow data.",
    workflowPlan: createWeixinComfyUiWorkflowPlan(intent, angelDraft),
    angelOutput: angelDraft.output,
    angelSource: angelDraft.source,
    knowledgeHits: angelDraft.knowledgeHits,
    skillHits: angelDraft.skillHits,
    recallTrace: angelDraft.recallTrace,
    capabilityPlan: angelDraft.capabilityPlan,
    toolParameters: angelDraft.toolParameters,
    handoffNotes: angelDraft.handoffNotes,
    angel: {
      output: angelDraft.output,
      source: angelDraft.source,
      providerId: angelDraft.providerId,
      model: angelDraft.model,
      message: angelDraft.message,
      recallStatus: angelDraft.recallStatus,
      skillStatus: angelDraft.skillStatus,
      visibleSummary: angelDraft.visibleSummary,
      knowledgeHits: angelDraft.knowledgeHits,
      skillHits: angelDraft.skillHits,
      recallTrace: angelDraft.recallTrace,
      capabilityPlan: angelDraft.capabilityPlan,
    },
    apiWorkflow: null,
  };
  const comfyUiConfig = loadDirectorComfyUiConfig(
    resolve(configWorkspaceRoot(config), ".director-angel", "external-tools"),
  );
  const adapter = comfyUiConfig.document.adapter;
  const visibleWorkflow = createDirectorComfyUiVisibleWorkflowDraft(draft);
  const comfyUiPath = `workflows/DirectorAngel/${id}.json`;

  await mkdir(workflowRoot, { recursive: true });
  await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  const upload = await uploadWeixinComfyUiWorkflowToUserData({
    baseUrl: adapter.baseUrl,
    mode: adapter.mode,
    userDataPath: comfyUiPath,
    workflow: visibleWorkflow,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  const templateBridge = await publishDirectorComfyUiTemplateBridge({
    baseUrl: adapter.baseUrl,
    mode: adapter.mode,
    templateName: id,
    workflow: visibleWorkflow,
    localInstallPath: adapter.localInstallPath,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });

  return {
    ok: true,
    id,
    workflowKind: intent.workflowKind,
    workflowModes: intent.workflowModes,
    objective: intent.objective,
    path,
    url: adapter.baseUrl,
    pageUrl: templateBridge.directOpenReady ? templateBridge.openUrl : adapter.baseUrl,
    comfyUiPath,
    uploadedToComfyUi: upload.ok,
    uploadMessage: upload.message,
    ...(upload.status === undefined ? {} : { uploadStatus: upload.status }),
    directOpenReady: templateBridge.directOpenReady,
    templateMessage: templateBridge.message,
    executable: false,
    angelOutput: angelDraft.output,
    angelSource: angelDraft.source,
    recallStatus: angelDraft.recallStatus,
    skillStatus: angelDraft.skillStatus,
    visibleSummary: angelDraft.visibleSummary,
  };
}

async function uploadWeixinComfyUiWorkflowToUserData(input: {
  readonly baseUrl: string;
  readonly mode: string;
  readonly userDataPath: string;
  readonly workflow: object;
  readonly fetchImpl?: FetchLike | undefined;
}): Promise<{ readonly ok: boolean; readonly status?: number; readonly message: string }> {
  const endpoint = buildWeixinComfyUiUserDataEndpoint(
    input.baseUrl,
    input.mode,
    input.userDataPath,
  );
  const fetcher = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return {
      ok: false,
      message: "当前运行环境没有 fetch，无法写入 ComfyUI 工作流列表。",
    };
  }
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.workflow, null, 2),
    });
    await response.text();
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok
        ? `ComfyUI 已保存 ${input.userDataPath}。`
        : `ComfyUI 保存失败：HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `ComfyUI 保存失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildWeixinComfyUiUserDataEndpoint(
  baseUrl: string,
  mode: string,
  userDataPath: string,
): string {
  const normalized = baseUrl.replace(/\/+$/u, "");
  const prefix = mode === "cloud" ? "/api/userdata" : "/userdata";
  return `${normalized}${prefix}/${encodeURIComponent(userDataPath)}?overwrite=true&full_info=true`;
}

async function createWeixinComfyUiAngelDraft(
  config: WeixinGatewayConfig,
  intent: ComfyUiWorkflowDraftIntent,
): Promise<WeixinComfyUiAngelDraft> {
  const providersRoot = resolve(configWorkspaceRoot(config), ".director-angel", "providers");
  const recallContext = await buildWeixinComfyUiRecallContext(config, intent);
  try {
    const fetchImpl = createWeixinApiProviderFetchAdapter(config.apiProviderFetch);
    const result = await runDirectorApiProviderTextCompletion(providersRoot, {
      prompt: createWeixinComfyUiToolDraftPrompt(intent, recallContext),
      systemPrompt: createWeixinComfyUiToolDraftSystemPrompt(),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
    if (
      result.ok !== true ||
      typeof result.output !== "string" ||
      result.output.trim().length === 0
    ) {
      throw new Error(result.message);
    }
    const output = humanizeProductionResultText(truncateForWeixin(result.output.trim(), 12_000));
    return {
      output,
      source: "api-provider",
      providerId: result.providerId ?? null,
      model: result.model ?? null,
      message: result.message ?? null,
      recallStatus: recallContext.recallStatus,
      skillStatus: recallContext.skillStatus,
      visibleSummary: recallContext.visibleSummary,
      knowledgeHits: recallContext.knowledgeHits,
      skillHits: recallContext.skillHits,
      recallTrace: recallContext.recallTrace,
      capabilityPlan: recallContext.capabilityPlan,
      toolParameters: createWeixinComfyUiToolParameters(intent, output),
      handoffNotes: createWeixinComfyUiHandoffNotes(intent),
    };
  } catch (error) {
    throw new Error(
      `模型不可用：无法生成 ComfyUI 内容和参数，已停止创建工作流。${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function createWeixinComfyUiToolDraftSystemPrompt(): string {
  return [
    "你是 Director Angel 的微信外部工具编排器。",
    "Angel 负责生成内容和参数；ComfyUI 是外部 workflow 画布或媒体执行器。",
    "直接输出可用结果和参数，不要要求用户去 ComfyUI 里再用 LLM 写脚本。",
    "输出中文 Markdown，清楚分成：最终内容、ComfyUI 参数、节点映射建议、执行边界。",
  ].join("\n");
}

function createWeixinComfyUiToolDraftPrompt(
  intent: ComfyUiWorkflowDraftIntent,
  recallContext: WeixinComfyUiRecallContext,
): string {
  const lines = [
    "外部工具：ComfyUI",
    `工作流类型：${formatWeixinComfyUiWorkflowKind(intent.workflowKind)}`,
    `工作流组合：${formatWeixinComfyUiWorkflowModes(intent.workflowModes)}`,
    `用户目标：${intent.objective}`,
    `输出要求：${createWeixinComfyUiToolDraftInstruction(intent)}`,
    "边界：脚本、文案、提示词、参数由 Angel 生成；ComfyUI 负责承载 workflow、显示画布、执行已配置的媒体节点。",
  ];
  if (recallContext.hiddenPromptBlock.length > 0) {
    lines.push("", recallContext.hiddenPromptBlock);
  }
  return lines.join("\n");
}

function createWeixinComfyUiToolDraftInstruction(intent: ComfyUiWorkflowDraftIntent): string {
  const kind = intent.workflowKind;
  const modes = intent.workflowModes;
  if (modes.includes("script") && modes.includes("image") && modes.includes("video")) {
    return "输出完整脚本，并按场景拆分。每个场景必须独立包含：场景N脚本、图片提示词、视频提示词、时长/比例/seed建议。图片提示词只描述当前场景首帧；视频提示词只描述当前场景动作。不要把全部场景塞进任意单个场景提示词。脚本+图片+视频工作流会按“本场景图片 -> 本场景图生视频”连接。";
  }
  if (modes.includes("script") && modes.includes("image")) {
    return "输出脚本并按场景拆分。每个场景必须独立包含：场景N脚本、图片提示词、构图/光影/尺寸/seed建议。图片提示词只描述当前场景首帧，不要混入其他场景。";
  }
  if (modes.includes("script") && modes.includes("video")) {
    return "输出脚本并按场景拆分。每个场景必须独立包含：场景N脚本、视频提示词、运动方式、时长、比例、fps、seed建议。没有图片分支时走文生视频；视频提示词只描述当前场景动作。";
  }
  if (kind === "image") {
    return "输出图片生成参数包：主题、正向提示词、负向提示词、构图、光影、风格、尺寸、steps、CFG、seed、模型/LoRA建议、输出节点建议。";
  }
  if (kind === "video") {
    return "输出视频生成参数包：时长、比例、fps、镜头段落、每段视觉提示词、运动方式、采样/denoise/seed建议、输出节点建议。";
  }
  if (kind === "copywriting") {
    return "输出文案正文和可注入参数：标题、开头钩子、口播正文、字幕/画面建议、平台语气、CTA、文本节点映射建议。";
  }
  return "输出完整脚本和可注入参数：片名、梗概、角色、分场脚本、对白、镜头提示、音效、后续图片/视频节点的提示词拆分建议。";
}

async function buildWeixinComfyUiRecallContext(
  config: WeixinGatewayConfig,
  intent: ComfyUiWorkflowDraftIntent,
): Promise<WeixinComfyUiRecallContext> {
  const workspaceRoot = configWorkspaceRoot(config);
  const userText = [
    intent.objective,
    intent.workflowKind,
    ...intent.workflowModes,
    "comfyui script image video workflow",
  ].join(" ");

  const packet = await resolveDirectorWorkspaceCapabilityContext({
    workspaceRoot,
    dataDir: resolve(workspaceRoot, ".hotflow"),
    surface: "comfyui-workflow",
    userText,
    knowledgeQuery: {
      tags: deriveWeixinComfyUiRecallTags(intent),
      includeGlobalExperience: true,
    },
  });

  return {
    lines: [...packet.lines],
    hiddenPromptBlock: packet.hiddenPromptBlock,
    visibleSummary: packet.visibleSummary,
    recallStatus: packet.recallStatus,
    skillStatus: packet.skillStatus,
    knowledgeHits: [...packet.knowledgeHits],
    skillHits: [...packet.skillHits],
    recallTrace: [...packet.recallTrace],
    capabilityPlan: [...packet.capabilityPlan],
  };
}

async function createWeixinDynamicChatReply(input: {
  readonly config: WeixinGatewayConfig;
  readonly text: string;
  readonly surface: "weixin-chat" | "desktop-chat";
  readonly fallback: string;
  readonly peerId?: string;
  readonly messageId?: string;
  readonly attachments?: readonly ConversationRuntimeAttachment[];
  readonly conversationTurn?: ReturnType<typeof orchestrateConversationTurn>;
}): Promise<WeixinDynamicChatReply> {
  const workspaceRoot = configWorkspaceRoot(input.config);
  const providersRoot = resolve(workspaceRoot, ".director-angel", "providers");
  const runtimeTools = await selectWeixinRuntimeToolsForTurn({
    config: input.config,
    ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
    text: input.fallback,
  });
  const mcpContext = await createWeixinConversationRuntimeMcpContext({
    config: input.config,
    runtimeTools,
  });
  const resolveRuntimeCapabilityContext = async () =>
    resolveDirectorWorkspaceCapabilityContext({
      workspaceRoot,
      dataDir: resolve(workspaceRoot, ".hotflow"),
      surface: input.surface,
      userText: input.text,
      ...(await createWeixinWorkingMemoryRecallInput({
        config: input.config,
        workspaceRoot,
        userText: input.text,
        ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
      })),
      knowledgeQuery: {
        tags: deriveTextRecallTags(input.text),
        includeGlobalExperience: true,
      },
    });
  const runRegistry = createWeixinConversationRunRegistry(input.config);
  const learningArtifactStore = createWeixinLearningArtifactStore(input.config);
  const toolEvidenceStore = createWeixinToolEvidenceStore(input.config);
  const turnToolCache: WeixinRuntimeToolTurnCache = {
    experienceCandidates: new Map(),
  };
  try {
    const runtimeResult = await runConversationRuntimeTurn(
      {
        surface: "weixin",
        channel: "weixin",
        messageId: input.messageId ?? `weixin-chat-${Date.now()}`,
        sessionKey: `weixin:${input.config.account.normalizedAccountId}:${input.peerId ?? "unknown"}`,
        text: input.text,
        accountId: input.config.account.normalizedAccountId,
        sender: { id: input.peerId ?? "user", role: "user" },
        ...(input.attachments === undefined || input.attachments.length === 0
          ? {}
          : { attachments: input.attachments }),
        ...(input.peerId === undefined
          ? {}
          : { history: loadWeixinRuntimeHistory(input.config, input.peerId) }),
        trustedContext: {
          workspaceRoot,
          dataDir: resolve(workspaceRoot, ".hotflow"),
          accountId: input.config.account.normalizedAccountId,
        },
      },
      {
        turnIdFactory: () => `weixin-chat-turn-${input.messageId ?? Date.now()}`,
        runRegistry,
        toolEvidenceStore,
        learningArtifactStore,
        persistLearningConfirmation: (payload) =>
          persistWeixinLearningConfirmation({
            config: input.config,
            payload,
            ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
          }),
        orchestrate: () =>
          input.conversationTurn === undefined
            ? {
                intent: { kind: "chat" },
                responsePolicy: "result-first",
                audience: "user",
                userText: input.fallback,
                memoryDecision: {
                  action: "never-store",
                  reason: "微信普通对话不直接写入长期记忆。",
                },
                shouldInvokeRecall: true,
                shouldCreateRun: false,
                shouldAttachToActiveSession: false,
              }
            : {
                intent: {
                  kind: input.conversationTurn.intent.kind,
                  ...(input.conversationTurn.intent.objective === undefined
                    ? {}
                    : { objective: input.conversationTurn.intent.objective }),
                  ...(input.conversationTurn.intent.supplement === undefined
                    ? {}
                    : { supplement: input.conversationTurn.intent.supplement }),
                  ...(input.conversationTurn.intent.command === undefined
                    ? {}
                    : {
                        command: {
                          name: input.conversationTurn.intent.command.commandId,
                          raw: input.conversationTurn.intent.command.matchedName,
                          args: input.conversationTurn.intent.command.args,
                          metadata: {
                            canonicalName: input.conversationTurn.intent.command.canonicalName,
                          },
                        },
                      }),
                  ...(input.conversationTurn.intent.safety === undefined
                    ? {}
                    : { safety: input.conversationTurn.intent.safety }),
                },
                responsePolicy: input.conversationTurn.responsePolicy,
                audience: "user",
                userText: input.conversationTurn.userText,
                trace: input.conversationTurn.operatorTrace.map((item) => ({
                  source: "orchestrator" as const,
                  stage: item.stage,
                  detail: item.detail,
                  ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
                })),
                memoryDecision: input.conversationTurn.memoryDecision,
                ...(input.conversationTurn.capabilityRoute === undefined
                  ? {}
                  : { capabilityRoute: input.conversationTurn.capabilityRoute }),
                shouldInvokeRecall: input.conversationTurn.shouldInvokeRecall,
                shouldCreateRun: input.conversationTurn.shouldCreateRun,
                shouldAttachToActiveSession: input.conversationTurn.shouldAttachToActiveSession,
              },
        resolveCapabilityContext: async () =>
          enrichWeixinRuntimeCapabilityPacketWithLearningArtifact({
            config: input.config,
            ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
            packet: mapWeixinRuntimeCapabilityPacket(await resolveRuntimeCapabilityContext()),
          }),
        tools: mcpContext.tools,
        toolHooks: createDefaultConversationRuntimeToolHooks(),
        authorizeToolCall: ({ defaultDecision, call }) =>
          authorizeWeixinConversationRuntimeToolCall({
            config: input.config,
            defaultDecision,
            call,
            ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
          }),
        preflightToolSandbox: ({ call, tool }) =>
          createWeixinConversationRuntimeSandboxPreflight({
            config: input.config,
            call,
            ...(tool === undefined ? {} : { tool }),
          }),
        callModel: async ({ messages, tools, signal, metadata }) => {
          const capabilityRoute = readWeixinApiProviderCapabilityRoute(metadata?.capabilityRoute);
          const fetchImpl = createWeixinApiProviderFetchAdapter(input.config.apiProviderFetch);
          const result = await runDirectorApiProviderTextCompletion(providersRoot, {
            prompt: input.text,
            messages: messages.map(mapRuntimeMessageToDirectorApiProviderMessage),
            tools: tools.map(mapRuntimeToolToDirectorApiProviderTool),
            ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
            maxAttempts: 2,
            ...(signal === undefined ? {} : { signal }),
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
          });
          if (result.toolCalls !== undefined && result.toolCalls.length > 0) {
            return {
              ...(result.output === undefined || result.output.trim().length === 0
                ? {}
                : {
                    assistantMessage: { role: "assistant" as const, content: result.output.trim() },
                  }),
              toolCalls: result.toolCalls.map((call) => ({
                id: call.id,
                name: call.name,
                args: call.args,
              })),
              metadata: {
                providerId: result.providerId,
                model: result.model,
                message: result.message,
              },
            };
          }
          if (
            result.ok === true &&
            typeof result.output === "string" &&
            result.output.trim().length > 0
          ) {
            return {
              finalText: humanizeProductionResultText(
                truncateForWeixin(result.output.trim(), 2600),
              ),
              metadata: {
                providerId: result.providerId,
                model: result.model,
                message: result.message,
              },
            };
          }
          throw new Error(result.message);
        },
        executeTool: async ({ call, signal }) =>
          executeWeixinConversationRuntimeTool({
            config: input.config,
            call,
            sourceId: `weixin-tool-${input.messageId ?? Date.now()}-${call.id}`,
            ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
            mcpClient: mcpContext.mcpClient,
            tools: mcpContext.tools,
            turnCache: turnToolCache,
            ...(signal === undefined ? {} : { signal }),
          }),
        maxModelToolLoopTurns: 5,
      },
    );
    persistWeixinRuntimeToolApprovalsFromResult({
      config: input.config,
      ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      runtimeResult,
    });
    persistWeixinRuntimeSourceAccessLearningArtifact({
      store: learningArtifactStore,
      runtimeResult,
    });
    const projectedRuntimeReply = projectConversationRuntimeClientReply({
      surface: "wechat.text",
      result: runtimeResult,
      evidenceDisclosure: readWeixinRuntimeEvidenceDisclosure(runtimeResult),
    });
    if (runtimeResult.finalText?.trim() || runtimeResult.userFacingProjection?.userText.trim()) {
      return {
        reply: projectedRuntimeReply.text,
        source: "conversation-runtime",
        replySource: runtimeResult.replySource,
        providerId: readRuntimeProviderMetadata(runtimeResult, "providerId"),
        model: readRuntimeProviderMetadata(runtimeResult, "model"),
        message: readRuntimeProviderMetadata(runtimeResult, "message"),
        runtimeResult,
      };
    }
    if (runtimeResult.replySource === "local-command") {
      const ackText = readWeixinRuntimeAckText(runtimeResult) ?? "已停止当前微信会话。";
      return {
        reply: ackText,
        source: "conversation-runtime",
        replySource: runtimeResult.replySource,
        providerId: readRuntimeProviderMetadata(runtimeResult, "providerId"),
        model: readRuntimeProviderMetadata(runtimeResult, "model"),
        message: readRuntimeProviderMetadata(runtimeResult, "message"),
        runtimeResult,
      };
    }
    const approvalReply = renderConversationRuntimeApprovalText(runtimeResult, {
      trustedOperatorApproveText: "确认",
      trustedOperatorRejectText: "拒绝",
      desktopFallback: false,
      compact: true,
    });
    if (approvalReply !== null) {
      return {
        reply: approvalReply,
        source: "conversation-runtime",
        replySource: runtimeResult.replySource,
        providerId: readRuntimeProviderMetadata(runtimeResult, "providerId"),
        model: readRuntimeProviderMetadata(runtimeResult, "model"),
        message: readRuntimeProviderMetadata(runtimeResult, "message"),
        runtimeResult,
      };
    }
    throw new Error("Conversation runtime produced no final text or approval event.");
  } catch (error) {
    const rendered = renderConversationRuntimeStructuredReply({
      turnId: `weixin-chat-turn-${input.messageId ?? Date.now()}`,
      sessionKey: `weixin:${input.config.account.normalizedAccountId}:${input.peerId ?? "unknown"}`,
      occurredAtMs: Date.now(),
      turn:
        input.conversationTurn === undefined
          ? {
              intent: { kind: "chat" },
              responsePolicy: "result-first",
              audience: "user",
              userText: input.fallback,
              memoryDecision: {
                action: "never-store",
                reason: "微信普通对话不直接写入长期记忆。",
              },
              shouldInvokeRecall: true,
              shouldCreateRun: false,
              shouldAttachToActiveSession: false,
            }
          : mapWeixinConversationTurnToRuntimeDecision(input.conversationTurn),
      code: "model-unavailable",
      detail: `对话运行时无法完成这条微信消息。${error instanceof Error ? error.message : String(error)}`,
    });
    return {
      reply:
        rendered.finalText ??
        renderConversationRuntimeStructuredStatusText({
          title: "Weixin conversation runtime:",
          status: "degraded",
          reason: "model-unavailable",
          detail: error instanceof Error ? error.message : String(error),
        }),
      source: "conversation-runtime",
      replySource: rendered.replySource,
      providerId: null,
      model: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function mapWeixinConversationTurnToRuntimeDecision(
  conversationTurn: ReturnType<typeof orchestrateConversationTurn>,
): ConversationRuntimeTurnDecision {
  return {
    intent: {
      kind: conversationTurn.intent.kind,
      ...(conversationTurn.intent.objective === undefined
        ? {}
        : { objective: conversationTurn.intent.objective }),
      ...(conversationTurn.intent.supplement === undefined
        ? {}
        : { supplement: conversationTurn.intent.supplement }),
      ...(conversationTurn.intent.command === undefined
        ? {}
        : {
            command: {
              name: conversationTurn.intent.command.commandId,
              raw: conversationTurn.intent.command.matchedName,
              args: conversationTurn.intent.command.args,
              metadata: {
                canonicalName: conversationTurn.intent.command.canonicalName,
              },
            },
          }),
      ...(conversationTurn.intent.safety === undefined
        ? {}
        : { safety: conversationTurn.intent.safety }),
    },
    responsePolicy: conversationTurn.responsePolicy,
    audience: "user",
    userText: conversationTurn.userText,
    trace: conversationTurn.operatorTrace.map((item) => ({
      source: "orchestrator" as const,
      stage: item.stage,
      detail: item.detail,
      ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
    })),
    memoryDecision: conversationTurn.memoryDecision,
    ...(conversationTurn.capabilityRoute === undefined
      ? {}
      : { capabilityRoute: conversationTurn.capabilityRoute }),
    shouldInvokeRecall: conversationTurn.shouldInvokeRecall,
    shouldCreateRun: conversationTurn.shouldCreateRun,
    shouldAttachToActiveSession: conversationTurn.shouldAttachToActiveSession,
  };
}

async function createWeixinWorkingMemoryRecallInput(input: {
  readonly config: WeixinGatewayConfig;
  readonly workspaceRoot: string;
  readonly userText: string;
  readonly peerId?: string;
}): Promise<{
  readonly workingMemoryRecall?: DirectorWorkingMemoryRecallBlockLike;
}> {
  if (!isWeixinMemoryFeatureEnabled(input.workspaceRoot)) {
    return {};
  }
  const query = input.userText.trim();
  if (query.length === 0) {
    return {};
  }
  const runtimeMemory = createDefaultRuntimeMemory({
    env: process.env,
  });
  const blockId = "weixin-capability-working-memory";
  const scope = {
    agentId: "director-angel",
    sessionId: `weixin:${input.config.account.normalizedAccountId}:${input.peerId ?? "unknown"}`,
    namespace: resolve(input.workspaceRoot, ".hotflow"),
  };
  const registry = createConversationRuntimeMemoryRetrievalProviderRegistry();
  const providerKind = resolveWeixinWorkingMemoryProviderKind(runtimeMemory);
  const registration = registry.register({
    manifest: {
      id: "weixin-working-memory",
      kind: providerKind,
      label: "Weixin working memory",
      capabilities: ["working-memory", "local-fallback", providerKind],
    },
    recall: () => {
      const block = runtimeMemory.recallWorkingMemory({
        blockId,
        scope,
        query,
        limit: 2,
      });
      return {
        status: block.degraded !== undefined ? "degraded" : block.items.length > 0 ? "hit" : "miss",
        hits: block.items.map((item) => ({
          id: item.id,
          source: readWeixinWorkingMemoryItemSource(item, block.source),
          content: item.content,
          score: item.score,
          metadata: {
            ...(isObject(item.metadata) ? item.metadata : {}),
            layer: item.layer,
            content: item.content,
            updatedAt: item.updatedAt,
          },
        })),
        ...(block.degraded === undefined
          ? {}
          : { degradedReason: renderWeixinWorkingMemoryDegradedReason(block.degraded) }),
      };
    },
  });
  if (!registration.registered) {
    return {
      workingMemoryRecall: {
        blockId,
        source: "working-memory",
        scope,
        query,
        items: [],
        degraded: {
          reason: "working-memory-provider-blocked",
          message: registration.plan.issues.map((issue) => issue.message).join(" | "),
        },
      },
    };
  }
  const result = await registry.recall({
    query,
    maxHits: 2,
    maxChars: 500,
    domains: ["memory"],
    scope: {
      ...scope,
      blockId,
    },
  });
  return {
    workingMemoryRecall: {
      blockId,
      source: "working-memory",
      scope,
      query,
      items: result.hits.map((hit) => mapWeixinMemoryRetrievalHitToWorkingMemoryItem(hit)),
      ...(result.degradedReason === undefined
        ? {}
        : {
            degraded: {
              reason:
                result.status === "degraded"
                  ? "working-memory-provider-degraded"
                  : "working-memory-provider-miss",
              message: result.degradedReason,
            },
          }),
    },
  };
}

function resolveWeixinWorkingMemoryProviderKind(
  runtimeMemory: ReturnType<typeof createDefaultRuntimeMemory>,
) {
  return isObject(runtimeMemory) && isObject(runtimeMemory.mempalaceConfig)
    ? "mempalace"
    : "hybrid";
}

function readWeixinWorkingMemoryItemSource(
  item: ReturnType<
    ReturnType<typeof createDefaultRuntimeMemory>["recallWorkingMemory"]
  >["items"][number],
  fallback: string,
): string {
  const source = item.metadata?.source;
  return typeof source === "string" && source.trim().length > 0 ? source : fallback;
}

function mapWeixinMemoryRetrievalHitToWorkingMemoryItem(hit: {
  readonly id: string;
  readonly summary?: string;
  readonly score?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): DirectorWorkingMemoryRecallBlockLike["items"][number] {
  const metadata = isObject(hit.metadata) ? hit.metadata : {};
  return {
    id: hit.id,
    layer: readWeixinWorkingMemoryLayer(metadata.layer),
    content: readWeixinWorkingMemoryContent(hit, metadata),
    score: readWeixinWorkingMemoryScore(hit.score),
    updatedAt: readWeixinWorkingMemoryUpdatedAt(metadata.updatedAt),
    metadata,
  };
}

function readWeixinWorkingMemoryLayer(
  value: unknown,
): DirectorWorkingMemoryRecallBlockLike["items"][number]["layer"] {
  return typeof value === "string" && value.trim().length > 0 ? value : "layer1";
}

function readWeixinWorkingMemoryContent(
  hit: { readonly summary?: string },
  metadata: Readonly<Record<string, unknown>>,
): string {
  if (typeof metadata.content === "string" && metadata.content.trim().length > 0) {
    return metadata.content;
  }
  if (typeof hit.summary === "string" && hit.summary.trim().length > 0) {
    return hit.summary;
  }
  return "";
}

function readWeixinWorkingMemoryScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readWeixinWorkingMemoryUpdatedAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function renderWeixinWorkingMemoryDegradedReason(degraded: {
  readonly reason: string;
  readonly message?: string;
}): string {
  return degraded.message === undefined
    ? degraded.reason
    : `${degraded.reason}: ${degraded.message}`;
}

function toDirectorWorkingMemoryRecallBlock(
  block: ReturnType<ReturnType<typeof createDefaultRuntimeMemory>["recallWorkingMemory"]>,
): DirectorWorkingMemoryRecallBlockLike {
  return {
    blockId: block.blockId,
    source: block.source,
    scope: {
      ...(block.scope.agentId === undefined ? {} : { agentId: block.scope.agentId }),
      ...(block.scope.sessionId === undefined ? {} : { sessionId: block.scope.sessionId }),
      ...(block.scope.threadId === undefined ? {} : { threadId: block.scope.threadId }),
      ...(block.scope.namespace === undefined ? {} : { namespace: block.scope.namespace }),
    },
    ...(block.query === undefined ? {} : { query: block.query }),
    items: block.items.map((item) => ({
      id: item.id,
      layer: item.layer,
      content: item.content,
      score: item.score,
      updatedAt: item.updatedAt,
    })),
    ...(block.degraded === undefined
      ? {}
      : {
          degraded: {
            reason: block.degraded.reason,
            ...(block.degraded.message === undefined ? {} : { message: block.degraded.message }),
          },
        }),
  };
}

function isWeixinMemoryFeatureEnabled(workspaceRoot: string): boolean {
  const switchPath = join(workspaceRoot, ".director-angel", "runtime", "switches.json");
  return loadDirectorSwitchState(switchPath).features["memory.enabled"] === true;
}

function mapWeixinRuntimeCapabilityPacket(packet: {
  readonly visibleSummary: string;
  readonly hiddenPromptBlock: string;
  readonly recallStatus: "hit" | "miss" | "degraded" | "skipped";
  readonly skillStatus: "hit" | "miss" | "degraded" | "skipped";
  readonly knowledgeHits: readonly { readonly id?: string; readonly title?: string }[];
  readonly skillHits: readonly { readonly id?: string; readonly title?: string }[];
  readonly recallTrace: readonly {
    readonly source: string;
    readonly status: string;
    readonly id?: string;
    readonly reason?: string;
    readonly score?: number;
    readonly retrieval?: Readonly<Record<string, unknown>>;
  }[];
}): ConversationRuntimeCapabilityPacket {
  const status: "hit" | "miss" | "degraded" | "skipped" =
    packet.recallStatus === "hit" || packet.skillStatus === "hit"
      ? "hit"
      : packet.recallStatus === "degraded" || packet.skillStatus === "degraded"
        ? "degraded"
        : packet.recallStatus === "skipped" && packet.skillStatus === "skipped"
          ? "skipped"
          : "miss";
  return {
    status,
    visibleSummary: packet.visibleSummary,
    hiddenPromptBlock: packet.hiddenPromptBlock,
    hits: [
      ...packet.knowledgeHits.map((hit) => ({
        id: `knowledge:${hit.id ?? hit.title ?? "unknown"}`,
        source: "knowledge" as const,
        status: "hit" as const,
        ...(hit.title === undefined ? {} : { title: hit.title }),
      })),
      ...packet.skillHits.map((hit) => ({
        id: `skill:${hit.id ?? hit.title ?? "unknown"}`,
        source: "skill" as const,
        status: "hit" as const,
        ...(hit.title === undefined ? {} : { title: hit.title }),
      })),
      ...packet.recallTrace
        .filter((trace) => trace.status === "hit")
        .map((trace) => ({
          id: `${trace.source}:${trace.id ?? trace.reason ?? "unknown"}`,
          source: trace.source,
          status: "hit" as const,
          ...(trace.reason === undefined ? {} : { summary: trace.reason }),
          ...(trace.score === undefined ? {} : { score: trace.score }),
          ...(trace.retrieval === undefined
            ? {}
            : { metadata: { ...trace.retrieval, retrieval: trace.retrieval } }),
        })),
    ],
  };
}

function enrichWeixinRuntimeCapabilityPacketWithLearningArtifact(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId?: string;
  readonly packet: ConversationRuntimeCapabilityPacket;
}): ConversationRuntimeCapabilityPacket {
  void input.config;
  void input.peerId;
  return input.packet;
}

function mapRuntimeMessageToDirectorApiProviderMessage(message: {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }[];
}) {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
    ...(message.toolCalls === undefined || message.toolCalls.length === 0
      ? {}
      : {
          toolCalls: message.toolCalls.map((call) => ({
            id: call.id,
            name: call.name,
            args: call.args,
            ...(call.metadata === undefined ? {} : { metadata: call.metadata }),
          })),
        }),
  };
}

function mapRuntimeToolToDirectorApiProviderTool(tool: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
}) {
  return {
    name: tool.name,
    description: tool.description,
    ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
  };
}

async function authorizeWeixinConversationRuntimeToolCall(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId?: string;
  readonly defaultDecision: {
    readonly status: "allow" | "ask" | "deny";
    readonly reason?: string;
    readonly title?: string;
    readonly summary?: string;
    readonly actionLabels?: readonly string[];
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly call: {
    readonly name: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
}) {
  if (input.defaultDecision.status === "allow") {
    return input.defaultDecision;
  }
  const trustedOperator = isTrustedOperator(input.config, input.peerId);
  const requesterCanApprove = typeof input.peerId === "string" && input.peerId.trim().length > 0;
  if (input.call.name === "director.mcp.server.upsert") {
    const processLedger = await readWeixinRuntimeProcessCapabilityLedger(input.config);
    return {
      ...input.defaultDecision,
      status: "ask" as const,
      reason: "MCP config changes need a short explicit confirmation on Weixin",
      metadata: {
        ...(input.defaultDecision.metadata ?? {}),
        channel: "weixin",
        trustedOperator,
        requesterCanApprove,
        peerId: input.peerId ?? null,
        toolName: input.call.name,
        capability: input.call.metadata?.capability,
        risk: input.call.metadata?.risk,
        ...(processLedger === null ? {} : { agentOsProcessCapabilityLedger: processLedger }),
      },
    };
  }
  if (trustedOperator) {
    return {
      status: "allow" as const,
      reason: "trusted Weixin operator",
      metadata: {
        channel: "weixin",
        trustedOperator: true,
        peerId: input.peerId ?? null,
        defaultStatus: input.defaultDecision.status,
        toolName: input.call.name,
        capability: input.call.metadata?.capability,
        risk: input.call.metadata?.risk,
      },
    };
  }
  const processLedger = await readWeixinRuntimeProcessCapabilityLedger(input.config);
  return {
    status: "ask" as const,
    title: "需要确认",
    summary: `${input.call.name} 会修改系统能力或调用受控外部能力。已在执行前停住，发起人可直接在微信回复确认或拒绝。`,
    reason: "requester confirmation is required for approval-gated Weixin tools",
    actionLabels: ["确认", "拒绝"],
    metadata: {
      channel: "weixin",
      trustedOperator: false,
      requesterCanApprove,
      peerId: input.peerId ?? null,
      defaultStatus: input.defaultDecision.status,
      toolName: input.call.name,
      capability: input.call.metadata?.capability,
      risk: input.call.metadata?.risk,
      ...(processLedger === null ? {} : { agentOsProcessCapabilityLedger: processLedger }),
    },
  };
}

async function readWeixinRuntimeProcessCapabilityLedger(
  config: WeixinGatewayConfig,
): Promise<unknown | null> {
  if (config.useHostToolControlPlane !== true) {
    return null;
  }
  try {
    const snapshot = await readDirectorRuntimeCapabilitySnapshot(config.director);
    return snapshot.agentOsProcessCapabilityLedger ?? null;
  } catch (error) {
    config.log?.(
      `weixin runtime process ledger snapshot unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function createWeixinConversationRuntimeSandboxPreflight(input: {
  readonly config: WeixinGatewayConfig;
  readonly call: {
    readonly name: string;
    readonly readOnly?: boolean;
  };
  readonly tool?: {
    readonly readOnly: boolean;
  };
}) {
  if ((input.call.readOnly ?? input.tool?.readOnly) === true) {
    return {
      verdict: "allow" as const,
      sandboxMode: "readonly" as const,
      checkedAt: new Date().toISOString(),
      providerId: "weixin-conversation-runtime",
      reason: "Read-only Weixin runtime tool may execute with readonly sandbox preflight.",
    };
  }
  const workspaceRoot = configWorkspaceRoot(input.config);
  const sandboxPolicy = createWeixinHostSharedToolSandboxRequest({
    workspaceRoot,
    toolId: input.call.name,
  }).sandboxPolicy;
  return {
    verdict: "allow" as const,
    sandboxMode: sandboxPolicy.defaultMutatingSandboxMode,
    checkedAt: new Date().toISOString(),
    providerId: "weixin-conversation-runtime",
    reason: `Trusted Weixin runtime tool is scoped to ${workspaceRoot}.`,
  };
}

async function executeWeixinConversationRuntimeTool(input: {
  readonly config: WeixinGatewayConfig;
  readonly call: {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  };
  readonly sourceId: string;
  readonly peerId?: string;
  readonly signal?: AbortSignal;
  readonly mcpClient?: ReturnType<typeof createConversationRuntimeMcpClient> | null;
  readonly tools?: readonly ConversationRuntimeModelToolDefinition[];
  readonly turnCache?: WeixinRuntimeToolTurnCache;
  readonly runtimeApproval?: {
    readonly status: "approved";
    readonly decidedByPeerId: string;
    readonly kind: "requester" | "trusted-operator";
  };
}) {
  try {
    if (input.call.name === "tool.search") {
      return await createToolSearchExecutor({
        tools: input.tools ?? createDirectorConversationRuntimeTools(),
      })({
        turnId: input.sourceId,
        sessionKey: input.peerId ?? "weixin",
        call: input.call,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        metadata: {
          channel: "weixin",
          workspaceRoot: configWorkspaceRoot(input.config),
        },
      });
    }
    if (input.call.name === "agent.delegate" || input.call.name === "spawn_subagent") {
      const toolLabel = input.call.name === "spawn_subagent" ? "spawn_subagent" : "agent.delegate";
      return createWeixinToolResult(
        input.call,
        false,
        [
          "status: blocked",
          `summary: ${toolLabel} 需要本地桌面/Host API 绑定 Run task-plane；微信远程通道不能直接创建子代理任务；微信远程通道不能直接创建后台子代理任务，后台委托只能在本机控制面发起。`,
          "next_actions: 回到桌面 Run/Review 面板或 Host API 本机控制面发起委托；本次未启动 runner。",
        ].join("\n"),
        {
          source: "agent-os",
          agentTool: true,
          taskBacked: true,
          ...(input.call.name === "spawn_subagent" ? { asyncSubagent: true } : {}),
          blocked: true,
          reason:
            input.call.name === "spawn_subagent"
              ? "remote-channel-spawn-subagent-fail-closed"
              : "remote-channel-agent-delegate-fail-closed",
        },
      );
    }
    const hostSharedToolResult = await executeWeixinHostSharedTool(input);
    if (hostSharedToolResult !== null) {
      return hostSharedToolResult;
    }
    const builtinBrowserExecutor = createBuiltinBrowserToolExecutors(
      createWeixinSharedDesktopBrowserProvider(input.config),
    ).get(input.call.name);
    if (builtinBrowserExecutor !== undefined) {
      return await builtinBrowserExecutor({
        turnId: input.sourceId,
        sessionKey: input.peerId ?? "weixin",
        call: input.call,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        metadata: {
          channel: "weixin",
        },
      });
    }
    const workspaceRoot = configWorkspaceRoot(input.config);
    const webExtractArtifacts = createWeixinWebExtractArtifactAccess(workspaceRoot);
    const runtimeFetch = createWeixinRuntimeFetch(input.config.fetchFn);
    const builtinWebExecutor = createBuiltinWebToolExecutors({
      storeExtractArtifact: webExtractArtifacts.storeExtractArtifact,
      readExtractArtifact: webExtractArtifacts.readExtractArtifact,
      ...(runtimeFetch === undefined ? {} : { fetchImpl: runtimeFetch }),
    }).get(input.call.name);
    if (builtinWebExecutor !== undefined) {
      return await builtinWebExecutor({
        turnId: input.sourceId,
        sessionKey: input.peerId ?? "weixin",
        call: input.call,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    }
    const builtinXExecutor = createBuiltinXToolExecutors().get(input.call.name);
    if (builtinXExecutor !== undefined) {
      return await builtinXExecutor({
        turnId: input.sourceId,
        sessionKey: input.peerId ?? "weixin",
        call: input.call,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    }
    if (input.call.name.startsWith("mcp__")) {
      const mcpExecutor = createMcpToolExecutor(
        input.mcpClient === undefined || input.mcpClient === null
          ? undefined
          : input.mcpClient.callTool,
      );
      return await mcpExecutor({
        turnId: input.sourceId,
        sessionKey: input.peerId ?? "weixin",
        call: input.call,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        metadata: {
          channel: "weixin",
          workspaceRoot: configWorkspaceRoot(input.config),
        },
      });
    }
    if (
      input.call.name === "director.mcp.servers.list" ||
      input.call.name === "director.mcp.refresh"
    ) {
      const result = await inspectWeixinMcpRuntime(configWorkspaceRoot(input.config));
      return createWeixinToolResult(
        input.call,
        true,
        formatWeixinMcpRuntimeToolContent(result),
        result,
      );
    }
    if (input.call.name === "director.mcp.server.upsert") {
      if (
        !isTrustedOperator(input.config, input.peerId) &&
        input.runtimeApproval?.status !== "approved"
      ) {
        return createWeixinToolResult(
          input.call,
          false,
          [
            "status: approval_required",
            "summary: 当前联系人没有权限，不能安装或更新 MCP。",
            "next_actions: 到桌面端 MCP 设置操作，或先把该微信联系人加入允许确认的人。",
          ].join("\n"),
          {
            trustedOperator: false,
            peerId: input.peerId ?? null,
          },
        );
      }
      const result = await upsertWeixinMcpServer(
        configWorkspaceRoot(input.config),
        input.call.args,
      );
      const test = await testWeixinMcpServerBestEffort(
        configWorkspaceRoot(input.config),
        result.serverName,
      );
      return createWeixinToolResult(
        input.call,
        true,
        formatWeixinMcpUpsertToolContent(result, test),
        {
          ...result,
          test,
        },
      );
    }
    if (input.call.name === "director.mcp.server.test") {
      const serverName = readToolString(input.call.args, "serverName");
      if (serverName === null) {
        return createWeixinToolResult(
          input.call,
          false,
          "status: error\nsummary: 缺少 serverName，无法测试 MCP。",
        );
      }
      const result = await testWeixinMcpServerBestEffort(
        configWorkspaceRoot(input.config),
        serverName,
      );
      return createWeixinToolResult(
        input.call,
        result.ok,
        formatWeixinMcpTestToolContent(result),
        result,
      );
    }
    if (input.call.name === "director.capabilities.inspect") {
      const workspaceRoot = configWorkspaceRoot(input.config);
      const packet = await resolveDirectorWorkspaceCapabilityContext({
        workspaceRoot,
        dataDir: resolve(workspaceRoot, ".hotflow"),
        surface: "weixin-chat",
        userText: "当前 Director Angel 可用能力",
        knowledgeQuery: {
          tags: ["experience", "skill", "memory", "comfyui"],
          includeGlobalExperience: true,
          maxHits: 3,
        },
      });
      return createWeixinToolResult(
        input.call,
        true,
        [
          "status: success",
          `summary: ${packet.visibleSummary || "已读取当前能力上下文。"}`,
          `knowledge_status: ${packet.recallStatus}`,
          `skill_status: ${packet.skillStatus}`,
          `tool_count: ${createDirectorConversationRuntimeTools().length}`,
          `available_tools: ${createDirectorConversationRuntimeTools()
            .map((tool) => tool.name)
            .join(", ")}`,
          "next_actions: 用户给出制作、学习、召回、Skill 或 ComfyUI 需求时，优先调用对应工具。",
        ].join("\n"),
        {
          visibleSummary: packet.visibleSummary,
          recallStatus: packet.recallStatus,
          skillStatus: packet.skillStatus,
          knowledgeHits: packet.knowledgeHits,
          skillHits: packet.skillHits,
        },
      );
    }
    if (input.call.name === "director.learning.query") {
      const query = readToolString(input.call.args, "query");
      if (query === null) {
        return createWeixinToolResult(input.call, false, "缺少 query，无法发起学习搜索。");
      }
      const result = await learnDirectorFromQuery(input.config.director, {
        sourceId: input.sourceId,
        queries: [query],
        nowMs: Date.now(),
      });
      const projection: ConversationRuntimeLearningArtifactProjectionInput =
        input.peerId === undefined
          ? {
              source: "runtime-tool",
              query,
              candidateCount:
                readNumber(result.result, "candidateCount") ?? arrayCount(result, "candidates"),
              candidates: extractWeixinCandidateSnapshots(result.candidates),
              failureCount:
                readNumber(result.result, "quarantineCount") ?? arrayCount(result, "quarantines"),
              failures: extractWeixinLearningFailureSnapshots(result),
            }
          : createWeixinRuntimeLearningProjectionFromResult({
              config: input.config,
              peerId: input.peerId,
              source: "runtime-tool",
              query,
              result,
            });
      return createWeixinToolResult(
        input.call,
        true,
        renderWeixinLearningProjectionToolContent(projection),
        {
          candidateCount: projection.candidateCount,
          failureCount: projection.failureCount ?? projection.failures?.length ?? 0,
          candidates: Array.isArray(result.candidates) ? result.candidates : [],
          failures: projection.failures ?? [],
        },
      );
    }
    if (input.call.name === "director.learning.url") {
      const url = readToolString(input.call.args, "url");
      if (url === null) {
        return createWeixinToolResult(input.call, false, "缺少 url，无法学习链接。");
      }
      const result = await runWeixinUrlLearningReadAndAdmit({
        config: input.config,
        sourceId: input.sourceId,
        url,
        nowMs: Date.now(),
        ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
      });
      const projection: ConversationRuntimeLearningArtifactProjectionInput =
        input.peerId === undefined
          ? {
              source: "runtime-tool",
              query: url,
              candidateCount:
                readNumber(result.result, "candidateCount") ?? arrayCount(result, "candidates"),
              candidates: extractWeixinCandidateSnapshots(result.candidates),
              failureCount:
                readNumber(result.result, "quarantineCount") ?? arrayCount(result, "quarantines"),
              failures: extractWeixinLearningFailureSnapshots(result),
            }
          : createWeixinRuntimeLearningProjectionFromResult({
              config: input.config,
              peerId: input.peerId,
              source: "runtime-tool",
              query: url,
              result,
            });
      return createWeixinToolResult(
        input.call,
        true,
        renderWeixinLearningProjectionToolContent(projection),
        {
          candidateCount: projection.candidateCount,
          failureCount: projection.failureCount ?? projection.failures?.length ?? 0,
          candidates: Array.isArray(result.candidates) ? result.candidates : [],
          failures: projection.failures ?? [],
        },
      );
    }
    if (input.call.name === "director.learning.admit") {
      const sources = readLearningAdmitSources(input.call.args);
      if (sources.length === 0) {
        return createWeixinToolResult(
          input.call,
          false,
          "status: error\nsummary: director.learning.admit 需要至少一个带 body/content 的 source snapshot。\nnext_actions: 先调用 web_extract 或 browser_snapshot 取得正文，再 admit。",
        );
      }
      const blockedSource = findBlockedLearningAdmitSource(sources);
      if (blockedSource !== null) {
        return createWeixinLearningAdmitQualityBlockedToolResult(input.call, blockedSource);
      }
      const sourceId =
        readToolString(input.call.args, "source_id") ??
        input.sourceId.replace(/[^a-z0-9._-]/giu, "-");
      const result = await learnDirectorFromText(input.config.director, {
        sourceId,
        title: sources[0]?.title ?? sources[0]?.sourceRef ?? "web extracted source",
        content: sources
          .map((source, index) =>
            [
              `# Source ${index + 1}: ${source.title ?? source.sourceRef ?? "untitled"}`,
              `sourceRef: ${source.sourceRef ?? "unknown"}`,
              source.body,
            ].join("\n"),
          )
          .join("\n\n"),
        ...(sources[0]?.sourceRef === undefined ? {} : { sourceRef: sources[0].sourceRef }),
        nowMs: Date.now(),
      });
      const projection: ConversationRuntimeLearningArtifactProjectionInput =
        input.peerId === undefined
          ? {
              source: "runtime-tool",
              query: sources[0]?.sourceRef ?? sourceId,
              candidateCount:
                readNumber(result.result, "candidateCount") ?? arrayCount(result, "candidates"),
              candidates: extractWeixinCandidateSnapshots(result.candidates),
              failureCount:
                readNumber(result.result, "quarantineCount") ?? arrayCount(result, "quarantines"),
              failures: extractWeixinLearningFailureSnapshots(result),
            }
          : createWeixinRuntimeLearningProjectionFromResult({
              config: input.config,
              peerId: input.peerId,
              source: "runtime-tool",
              query: sources[0]?.sourceRef ?? sourceId,
              result,
            });
      return createWeixinToolResult(
        input.call,
        true,
        renderWeixinLearningProjectionToolContent(projection),
        {
          candidateCount: projection.candidateCount,
          failureCount: projection.failureCount ?? projection.failures?.length ?? 0,
          candidates: Array.isArray(result.candidates) ? result.candidates : [],
          failures: projection.failures ?? [],
        },
      );
    }
    if (input.call.name === "director.experience.candidates.list") {
      const cacheKey = "director.experience.candidates.list";
      const cached = input.turnCache?.experienceCandidates.get(cacheKey);
      const result = cached ?? (await listDirectorExperienceCandidates(input.config.director));
      input.turnCache?.experienceCandidates.set(cacheKey, result);
      const maxItems = readBoundedToolInteger(input.call.args.maxItems, 1, 12) ?? 5;
      return createWeixinToolResult(
        input.call,
        true,
        [
          renderWeixinExperienceCandidatesToolContent({ result, maxItems }),
          "给用户回复时直接展示候选内容；用户可以自然说“收录第1条”“拒绝第2条”“继续找”。",
        ].join("\n"),
        {
          result,
        },
      );
    }
    if (input.call.name === "director.knowledge.recall") {
      const query = readToolString(input.call.args, "query");
      const tags = readToolStringList(input.call.args, "tags");
      const projectId = readToolString(input.call.args, "projectId");
      const groupId = readToolString(input.call.args, "groupId");
      const result = await previewDirectorKnowledgeRecall(input.config.director, {
        ...(tags.length > 0 ? { tags } : { tags: deriveTextRecallTags(query ?? "") }),
        ...(projectId === null ? {} : { projectId }),
        ...(groupId === null ? {} : { groupId }),
        includeGlobalExperience: true,
        maxHits: readBoundedToolInteger(input.call.args.maxHits, 1, 10) ?? 3,
      });
      const recall = isObject(result.recall) ? result.recall : {};
      const hits = Array.isArray(recall.hits) ? recall.hits : [];
      return createWeixinToolResult(
        input.call,
        true,
        [
          "status: success",
          `summary: 已发布知识召回 ${hits.length > 0 ? `命中 ${hits.length} 条` : "未命中"}。`,
          `recall_status: ${recall.status ?? "miss"}`,
          `hits: ${formatWeixinRecallHits(hits)}`,
          "next_actions: 如果未命中，可先学习资料并审核发布；如果命中，后续回答和制作应使用这些经验。",
        ].join("\n"),
        { result, hitCount: hits.length },
      );
    }
    if (input.call.name === "director.memory.status") {
      const result = await readDirectorMemoryStatus(input.config.director);
      return createWeixinToolResult(
        input.call,
        true,
        `status: success\nsummary: 已读取记忆状态。\n${formatWeixinMemoryStatusToolLines(result)}\nnext_actions: 只有稳定偏好、长期事实和复盘后的高价值模式应进入长期记忆。`,
        { result },
      );
    }
    if (input.call.name === "director.memory.recall") {
      const query = readToolString(input.call.args, "query") ?? "当前对话";
      const groupId = readToolString(input.call.args, "groupId");
      const result = await previewDirectorMemoryRecall(input.config.director, {
        projectId: readToolString(input.call.args, "projectId") ?? "director-angel",
        ...(groupId === null ? {} : { groupId }),
        knowledgeSignalTags: readToolStringList(input.call.args, "tags"),
        maxHits: readBoundedToolInteger(input.call.args.maxHits, 1, 10) ?? 3,
      });
      const packet = isObject(result.packet) ? result.packet : {};
      const hits = Array.isArray(packet.hits) ? packet.hits : [];
      return createWeixinToolResult(
        input.call,
        true,
        [
          "status: success",
          `summary: 运行记忆召回 ${hits.length > 0 ? `命中 ${hits.length} 条` : "未命中"}。`,
          `query: ${query}`,
          `hits: ${formatWeixinRecallHits(hits)}`,
          "next_actions: 命中的历史只能作为上下文参考，不应自动变成经验。",
        ].join("\n"),
        { result, hitCount: hits.length },
      );
    }
    if (input.call.name === "director.skills.list") {
      const query = readToolString(input.call.args, "query");
      const limit = readToolInteger(input.call.args, "limit") ?? 8;
      const includeDisabled = readToolBoolean(input.call.args, "includeDisabled") === true;
      const [skills, proposals] = await Promise.all([
        listDirectorSkills(input.config.director, {
          ...(query === null ? {} : { query }),
          limit,
          includeDisabled,
        }),
        listDirectorSkillProposals(input.config.director),
      ]);
      const skillItems = Array.isArray(skills.skills) ? skills.skills : [];
      const skillIdsFromHostIndex = readWeixinSkillIdsFromHostIndex(skills);
      const indexedSkillItems =
        skillIdsFromHostIndex.length === 0
          ? skillItems
          : skillIdsFromHostIndex
              .map((skillId) =>
                skillItems.find((item) => formatWeixinSkillIndexId(item) === skillId),
              )
              .filter((item): item is unknown => item !== undefined);
      const proposalItems = Array.isArray(proposals.proposals) ? proposals.proposals : [];
      return createWeixinToolResult(
        input.call,
        true,
        [
          "status: success",
          `summary: 当前 Skill ${skillItems.length} 个，待审 ${proposalItems.length} 个；本次索引命中 ${indexedSkillItems.length} 个。`,
          `skills: ${
            indexedSkillItems
              .map((item) =>
                isObject(item)
                  ? String(item.id ?? item.skillId ?? item.title ?? "unknown")
                  : String(item),
              )
              .join(", ") || "[]"
          }`,
          `skill_ids: ${indexedSkillItems.map(formatWeixinSkillIndexId).join(", ") || "[]"}`,
          "next_actions: 这里只是 Skill 索引；需要具体步骤、参数或流程时必须继续调用 director.skills.view。后续制作和普通任务应优先参考已启用、已批准 Skill；危险外部工具仍需审批。",
        ].join("\n"),
        {
          skills,
          proposals,
          query: query ?? "",
          limit,
          includeDisabled,
          skill_ids: indexedSkillItems.map(formatWeixinSkillIndexId),
        },
      );
    }
    if (input.call.name === "director.skills.view") {
      const skillId = readToolString(input.call.args, "skillId");
      if (skillId === null) {
        return createWeixinToolResult(input.call, false, "缺少 skillId，无法读取 Skill。");
      }
      const reason = readToolString(input.call.args, "reason") ?? "director.skills.view";
      const result = await viewDirectorSkill(input.config.director, {
        skillId,
        actor: `weixin:${input.peerId}`,
        reason,
        nowMs: Date.now(),
      });
      const skill = isObject(result.skill) ? result.skill : {};
      const content = typeof skill.content === "string" ? skill.content.trim() : "";
      const runtimeStatus = formatWeixinSkillRuntimeStatus(result, skill);
      const enabled = runtimeStatus === "success";
      return createWeixinToolResult(
        input.call,
        enabled,
        [
          `status: ${runtimeStatus}`,
          `summary: ${
            enabled
              ? `已读取 Skill：${String(skill.title ?? skill.id ?? skillId)}。`
              : formatWeixinUnavailableSkillSummary(skill, skillId, "加载全文")
          }`,
          `skill_id: ${String(skill.id ?? skillId)}`,
          `enabled: ${String(enabled)}`,
          `configured_enabled: ${String(skill.configuredEnabled ?? enabled)}`,
          `model_visible: ${String(enabled)}`,
          `missing_tools: ${formatWeixinSkillList(skill.missingToolNames)}`,
          `tags: ${Array.isArray(skill.tags) ? skill.tags.join(", ") : ""}`,
          `preferred_tools: ${Array.isArray(skill.toolNames) ? skill.toolNames.join(", ") : ""}`,
          ...formatWeixinSkillRuntimeContractLines(skill),
          ...formatWeixinSkillExplanationLines(skill),
          ...(enabled ? [`content:\n${truncateForWeixin(content, 1800)}`] : []),
          enabled
            ? "next_actions: 基于 Skill 内容自然回答；如需执行外部工具，继续调用对应工具并遵守审批/安全边界。"
            : formatWeixinUnavailableSkillNextActions(skill, "读取"),
        ].join("\n"),
        { result, skill },
      );
    }
    if (input.call.name === "director.skills.use") {
      const skillId = readToolString(input.call.args, "skillId");
      if (skillId === null) {
        return createWeixinToolResult(input.call, false, "缺少 skillId，无法应用 Skill。");
      }
      const reason = readToolString(input.call.args, "reason") ?? "director.skills.use";
      const result = await useDirectorSkill(input.config.director, {
        skillId,
        actor: `weixin:${input.peerId}`,
        reason,
        nowMs: Date.now(),
      });
      const skill = isObject(result.skill) ? result.skill : {};
      const content = typeof skill.content === "string" ? skill.content.trim() : "";
      const runtimeStatus = formatWeixinSkillRuntimeStatus(result, skill);
      const enabled = runtimeStatus === "success";
      const objective =
        readToolString(input.call.args, "objective") ??
        readToolString(input.call.args, "reason") ??
        "";
      return createWeixinToolResult(
        input.call,
        enabled,
        [
          `status: ${runtimeStatus}`,
          `summary: ${
            enabled
              ? `已应用 Skill：${String(skill.title ?? skill.id ?? skillId)}。`
              : formatWeixinUnavailableSkillSummary(skill, skillId, "应用")
          }`,
          `skill_id: ${String(skill.id ?? skillId)}`,
          `enabled: ${String(enabled)}`,
          `configured_enabled: ${String(skill.configuredEnabled ?? enabled)}`,
          `model_visible: ${String(enabled)}`,
          `missing_tools: ${formatWeixinSkillList(skill.missingToolNames)}`,
          `objective: ${objective}`,
          ...formatWeixinSkillRuntimeContractLines(skill),
          ...formatWeixinSkillExplanationLines(skill),
          ...(enabled ? [`skill_instructions:\n${truncateForWeixin(content, 1800)}`] : []),
          enabled
            ? "next_actions: 按 Skill 指令回答或规划；若需要外部工具，继续调用对应工具，不要把 Skill 应用等同于工具已执行。"
            : formatWeixinUnavailableSkillNextActions(skill, "应用"),
        ].join("\n"),
        { result, skill, action: "use", objective },
      );
    }
    if (input.call.name === "director.skills.set_enabled") {
      const skillId = readToolString(input.call.args, "skillId");
      if (skillId === null) {
        return createWeixinToolResult(input.call, false, "缺少 skillId，无法修改 Skill 启用状态。");
      }
      const enabled = readToolBoolean(input.call.args, "enabled");
      if (enabled === null) {
        return createWeixinToolResult(
          input.call,
          false,
          "缺少 enabled，无法判断是开启还是关闭 Skill。",
        );
      }
      if (
        !isTrustedOperator(input.config, input.peerId) &&
        input.runtimeApproval?.status !== "approved"
      ) {
        return createWeixinToolResult(
          input.call,
          false,
          [
            "status: approval_required",
            `summary: 已识别到用户想${enabled ? "开启" : "关闭"} Skill：${skillId}，但当前联系人没有权限，不能直接修改系统能力。`,
            `skill_id: ${skillId}`,
            `enabled_requested: ${String(enabled)}`,
            "next_actions: 请在桌面端 Skills 管理里操作，或把该微信联系人加入允许确认的人后再试；当前轮不要把这个 Skill 当作已经启用或已执行。",
          ].join("\n"),
          {
            skillId,
            enabledRequested: enabled,
            trustedOperator: false,
            peerId: input.peerId ?? null,
          },
        );
      }
      const note =
        readToolString(input.call.args, "reason") ?? "用户在微信对话中要求修改 Skill 启用状态。";
      const result = await setDirectorSkillEnablement(input.config.director, {
        skillId,
        enabled,
        actor: "weixin-conversation-runtime",
        note,
        nowMs: Date.now(),
      });
      const skill = isObject(result.skill) ? result.skill : {};
      return createWeixinToolResult(
        input.call,
        true,
        [
          "status: success",
          `summary: Skill 已${enabled ? "开启" : "关闭"}：${String(skill.title ?? skill.id ?? skillId)}。`,
          `skill_id: ${String(skill.id ?? skillId)}`,
          `enabled: ${String(enabled)}`,
          `snapshot_version: ${String(readNumber(result.management, "updatedAtMs") ?? "")}`,
          "next_actions: 能力快照会在下一轮/下一次任务刷新后生效；当前轮不要把刚开启的 Skill 当作已经执行。",
        ].join("\n"),
        { result, skill },
      );
    }
    if (input.call.name === "director.skills.curator.guard") {
      const action = readSkillCuratorAction(input.call.args);
      if (action === null) {
        return createWeixinToolResult(
          input.call,
          false,
          "status: error\nsummary: 缺少 action，无法检查 Skill curator 写操作边界。",
        );
      }
      const skillId = readToolString(input.call.args, "skillId");
      if (skillId === null) {
        return createWeixinToolResult(
          input.call,
          false,
          "status: error\nsummary: 缺少 skillId，无法检查 Skill curator 写操作边界。",
        );
      }
      const duplicateSkillIds = readToolStringArray(input.call.args, "duplicateSkillIds");
      const canonicalSkillId = readToolString(input.call.args, "canonicalSkillId");
      const result = await checkDirectorSkillCuratorWriteGuard(input.config.director, {
        action,
        skillId,
        actor: "weixin-conversation-runtime",
        reason: readToolString(input.call.args, "reason") ?? "director.skills.curator.guard",
        ...(canonicalSkillId === null ? {} : { canonicalSkillId }),
        ...(duplicateSkillIds.length === 0 ? {} : { duplicateSkillIds }),
        scopes: ["skills.curator.write"],
        nowMs: Date.now(),
      });
      const guard = isObject(result.guard) ? result.guard : result;
      return createWeixinToolResult(
        input.call,
        guard.allowed === true,
        formatWeixinSkillCuratorGuardToolContent(result, guard),
        { result, guard, applied: false },
      );
    }
    if (input.call.name === "director.comfyui.open") {
      const config = loadDirectorComfyUiConfig(
        resolve(configWorkspaceRoot(input.config), ".director-angel", "external-tools"),
      );
      return createWeixinToolResult(
        input.call,
        true,
        `status: success\nsummary: ComfyUI 界面地址已返回。\nurl: ${config.document.adapter.baseUrl}\nnext_actions: 如果要看到画布，继续创建 ComfyUI 工作流。`,
        { url: config.document.adapter.baseUrl },
      );
    }
    if (input.call.name === "director.comfyui.create_workflow") {
      const objective = readToolString(input.call.args, "objective");
      if (objective === null) {
        return createWeixinToolResult(
          input.call,
          false,
          "缺少 objective，无法创建 ComfyUI 工作流。",
        );
      }
      const parsed = parseDirectorComfyUiWorkflowDraftIntent(
        `${readToolStringList(input.call.args, "workflowModes").join("+") || input.call.args.workflowKind || "脚本"} ${objective}`,
      );
      const intent: ComfyUiWorkflowDraftIntent = {
        workflowKind: isComfyUiWorkflowKind(input.call.args.workflowKind)
          ? input.call.args.workflowKind
          : (parsed?.workflowKind ?? "script"),
        workflowModes:
          readToolStringList(input.call.args, "workflowModes").filter(isComfyUiWorkflowMode)
            .length > 0
            ? readToolStringList(input.call.args, "workflowModes").filter(isComfyUiWorkflowMode)
            : (parsed?.workflowModes ?? ["script"]),
        objective,
      };
      const draft = await createWeixinComfyUiWorkflowDraft(input.config, intent, {
        ...(input.config.apiProviderFetch === undefined
          ? {}
          : { fetchImpl: input.config.apiProviderFetch }),
      });
      return createWeixinToolResult(
        input.call,
        true,
        [
          "status: success",
          `summary: 已创建 ComfyUI ${formatWeixinComfyUiWorkflowModes(draft.workflowModes)} 工作流，目标：${draft.objective}。`,
          `canvas_status: ${
            draft.uploadedToComfyUi
              ? draft.directOpenReady
                ? "已尝试直接打开到该工作流画布"
                : "已同步到 ComfyUI，需在 Workflows / DirectorAngel 中打开"
              : "已保存本地草案，尚未同步到 ComfyUI"
          }`,
          `knowledge_status: ${draft.recallStatus}`,
          `skill_status: ${draft.skillStatus}`,
          "next_actions: 面向用户只说明结果和下一步；路径、页面、文件等工程细节放在 metadata.draft，不要默认念出来。",
        ].join("\n"),
        { draft },
      );
    }
    if (input.call.name === "director.comfyui.run") {
      const prompt = readToolString(input.call.args, "prompt");
      if (prompt === null) {
        return createWeixinToolResult(
          input.call,
          false,
          "缺少 prompt，无法执行 ComfyUI workflow。",
        );
      }
      const fetchImpl =
        input.config.apiProviderFetch === undefined
          ? undefined
          : async (
              url: string,
              init: {
                readonly method: "GET" | "POST";
                readonly headers: Record<string, string>;
                readonly body?: string;
                readonly signal?: AbortSignal;
              },
            ) => {
              const response = await input.config.apiProviderFetch?.(url, init);
              if (response === undefined) {
                throw new Error("ComfyUI fetch adapter returned no response.");
              }
              return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText ?? "",
                text: response.text.bind(response),
                ...("arrayBuffer" in response && typeof response.arrayBuffer === "function"
                  ? { arrayBuffer: response.arrayBuffer.bind(response) }
                  : {}),
              };
            };
      const workflowPath = readToolString(input.call.args, "workflowPath");
      const outputDir = readToolString(input.call.args, "outputDir");
      const result = await runDirectorComfyUiWorkflow(
        resolve(configWorkspaceRoot(input.config), ".director-angel", "external-tools"),
        {
          prompt,
          ...(workflowPath === null ? {} : { workflowPath }),
          ...(outputDir === null ? {} : { outputDir }),
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
        },
      );
      return createWeixinToolResult(
        input.call,
        result.ok,
        [
          `status: ${result.ok ? "success" : "error"}`,
          `summary: ${result.ok ? "ComfyUI 已执行" : "ComfyUI 没有完成生成"}。`,
          `readiness: ${result.readiness ?? "unknown"}`,
          `prompt_applied: ${result.promptApplied === false ? "false" : "true"}`,
          `artifacts: ${
            result.artifacts
              .map((artifact) => artifact.localPath ?? artifact.url ?? artifact.filename)
              .join(", ") || "[]"
          }`,
          `next_actions: ${
            result.promptApplied === false
              ? "当前 workflow 没有可注入提示词节点，不能算真实生成；需要先创建或配置可执行 workflow。"
              : "检查产物并进入后续审查。"
          }`,
        ].join("\n"),
        { result },
      );
    }
    return createWeixinToolResult(input.call, false, `未知工具：${input.call.name}`, {
      error: "unknown_tool",
    });
  } catch (error) {
    return createWeixinToolResult(
      input.call,
      false,
      `status: error\nsummary: 工具执行失败：${error instanceof Error ? error.message : String(error)}\nnext_actions: 检查 Host API、网络或学习入口开关后重试。`,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function executeWeixinHostSharedTool(input: {
  readonly config: WeixinGatewayConfig;
  readonly call: {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  };
  readonly sourceId: string;
  readonly peerId?: string;
  readonly signal?: AbortSignal;
}) {
  if (
    input.config.useHostToolControlPlane !== true ||
    !isWeixinHostSharedToolName(input.call.name)
  ) {
    return null;
  }
  try {
    const toolRequest = mapWeixinHostSharedToolRequest(input.call);
    const result = await invokeDirectorTool(input.config.director, {
      toolId: toolRequest.toolId,
      ...(toolRequest.operationId === undefined ? {} : { operationId: toolRequest.operationId }),
      args: toolRequest.args,
      ...(toolRequest.command === undefined ? {} : { command: toolRequest.command }),
      cwd: configWorkspaceRoot(input.config),
      turnId: input.sourceId,
      sessionKey: createWeixinRuntimeSessionKey(input.config, input.peerId),
      idempotencyKey: input.call.id,
      ...createWeixinHostSharedToolSandboxRequest({
        workspaceRoot: configWorkspaceRoot(input.config),
        toolId: toolRequest.toolId,
      }),
      approval: {
        status: "approved",
        operatorId: input.peerId ?? "weixin-runtime",
        metadata: {
          channel: "weixin",
          reason: "approved-by-weixin-runtime-tool-policy",
        },
      },
      metadata: {
        channel: "weixin",
        peerId: input.peerId ?? null,
        source: "weixin-host-tool-control-plane",
        stopSignalPresent: input.signal !== undefined,
      },
    });
    return {
      callId: input.call.id,
      toolName: input.call.name,
      ok: result.ok,
      content: result.content,
      ...(result.output === undefined ? {} : { output: result.output }),
      ...(result.error === undefined ? {} : { error: result.error.message }),
      metadata: {
        source: "host-tool-control-plane",
        externalToolStatus: result.status,
        toolId: result.toolId,
        modelToolName: input.call.name,
        ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
        ...(isObject(result.metadata) ? result.metadata : {}),
      },
    };
  } catch (error) {
    input.config.log?.(
      `weixin host tools/invoke shared-tool fallback for ${input.call.name}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function createWeixinHostSharedToolSandboxRequest(input: {
  readonly workspaceRoot: string;
  readonly toolId: string;
}) {
  const networkAccess: "limited" | "none" =
    input.toolId.startsWith("browser_") ||
    input.toolId === "web_search" ||
    input.toolId === "web_extract" ||
    input.toolId === "web_extract_artifact_read" ||
    input.toolId === "x_search"
      ? "limited"
      : "none";
  const defaultMutatingSandboxMode: "network-limited" | "workspace-write" =
    networkAccess === "limited" ? "network-limited" : "workspace-write";
  return {
    sandboxPolicy: {
      defaultMutatingSandboxMode,
      filesystemScope: [input.workspaceRoot],
      networkAccess,
    },
    requestedNetworkPolicy: networkAccess,
  };
}

function isWeixinHostSharedToolName(name: string): boolean {
  return (
    name.startsWith("browser_") ||
    name === "web_search" ||
    name === "web_extract" ||
    name === "web_extract_artifact_read" ||
    name === "x_search" ||
    name === "director.opencli.list" ||
    name === "director.opencli.invoke"
  );
}

function createWeixinToolResult(
  call: { readonly id: string; readonly name: string },
  ok: boolean,
  content: string,
  output?: unknown,
) {
  return {
    callId: call.id,
    toolName: call.name,
    ok,
    content,
    ...(output === undefined ? {} : { output }),
    ...(ok ? {} : { error: content }),
  };
}

function formatWeixinSkillRuntimeStatus(
  result: Readonly<Record<string, unknown>>,
  skill: Readonly<Record<string, unknown>>,
):
  | "disabled"
  | "error"
  | "missing_skill"
  | "model_invocation_disabled"
  | "needs_setup"
  | "success" {
  const status = readToolStatusString(result.status) ?? readToolStatusString(skill.runtimeStatus);
  if (status === "missing_skill" || status === "missing-skill") {
    return "missing_skill";
  }
  if (status === "needs_setup" || status === "needs-setup") {
    return "needs_setup";
  }
  if (status === "model_invocation_disabled" || status === "model-invocation-disabled") {
    return "model_invocation_disabled";
  }
  if (status === "blocked") {
    return "disabled";
  }
  if (status === "error") {
    return "error";
  }
  return skill.enabled === false || skill.eligible === false ? "disabled" : "success";
}

function formatWeixinUnavailableSkillSummary(
  skill: Readonly<Record<string, unknown>>,
  skillId: string,
  actionLabel: string,
): string {
  const title = String(skill.title ?? skill.id ?? skillId);
  const doctorSummary = readToolStatusString(skill.doctorSummary);
  if (
    skill.doctorStatus === "missing-skill" ||
    skill.runtimeStatus === "missing-skill" ||
    skill.runtimeStatus === "missing_skill"
  ) {
    return `Skill 不存在或已从当前已批准快照移除：${title}。这次不会${actionLabel}，也不会自动执行。`;
  }
  if (skill.doctorStatus === "needs-setup" || skill.runtimeStatus === "needs-setup") {
    return `Skill 依赖未就绪：${title}。${doctorSummary ?? ""}这次不会${actionLabel}，也不会自动执行。`;
  }
  if (skill.modelInvocable === false) {
    return `Skill 不能由模型直接调用：${title}。这次不会${actionLabel}，也不会自动执行。`;
  }
  return `Skill 已关闭：${title}。这次不会${actionLabel}，也不会自动执行。`;
}

function formatWeixinUnavailableSkillNextActions(
  skill: Readonly<Record<string, unknown>>,
  actionLabel: string,
): string {
  if (isObject(skill.explanationSurface)) {
    const nextActions = formatWeixinSkillList(skill.explanationSurface.nextActions);
    if (nextActions.length > 0) {
      return `next_actions: ${nextActions}`;
    }
  }
  const nextActions = formatWeixinSkillList(skill.nextActions);
  if (
    skill.doctorStatus === "missing-skill" ||
    skill.runtimeStatus === "missing-skill" ||
    skill.runtimeStatus === "missing_skill"
  ) {
    return `next_actions: ${nextActions || "重新调用 director.skills.list 刷新 Skill 索引；当前轮不要假装已经读取、应用或执行。"}`;
  }
  if (skill.doctorStatus === "needs-setup" || skill.runtimeStatus === "needs-setup") {
    return `next_actions: 先完成 Skill 依赖工具配置；${nextActions || "当前轮不要假装已经读取或执行。"}`;
  }
  if (skill.modelInvocable === false) {
    return "next_actions: 需要操作员在 Skills 管理里调整模型调用权限后再用；当前轮不要假装已经读取或执行。";
  }
  return `next_actions: 如用户要使用它，先请求启用该 Skill；当前轮不要假装已经${actionLabel}或执行。`;
}

function formatWeixinSkillExplanationLines(
  skill: Readonly<Record<string, unknown>>,
): readonly string[] {
  return formatSkillExplanationSurfaceForToolObservation(
    isObject(skill.explanationSurface) ? skill.explanationSurface : null,
  );
}

function formatWeixinSkillRuntimeContractLines(
  skill: Readonly<Record<string, unknown>>,
): readonly string[] {
  const contract = isObject(skill.runtimeContract) ? skill.runtimeContract : null;
  if (contract === null) {
    return [];
  }
  const setupOnLoad = isObject(contract.setupOnLoad) ? contract.setupOnLoad : {};
  const fallback = isObject(contract.fallback) ? contract.fallback : {};
  const guard = isObject(contract.guard) ? contract.guard : {};
  return [
    `runtime_contract_schema: ${String(contract.schemaId ?? "")}`,
    `runtime_contract_status: ${String(contract.status ?? "")}`,
    `runtime_contract_loadable: ${String(contract.loadable === true)}`,
    `runtime_contract_reason: ${String(contract.reasonCode ?? "")}`,
    `setup_on_load_required: ${String(setupOnLoad.required === true)}`,
    `fallback_recommended: ${String(fallback.recommended === true)}`,
    `fallback_skill_ids: ${formatWeixinSkillList(fallback.skillIds)}`,
    `skill_guard_allowed: ${String(guard.allowed === true)}`,
    `skill_guard_reason: ${String(guard.reasonCode ?? "")}`,
  ];
}

function formatWeixinSkillCuratorGuardToolContent(
  result: Readonly<Record<string, unknown>>,
  guard: Readonly<Record<string, unknown>>,
): string {
  const requestedAction = isObject(guard.requestedAction) ? guard.requestedAction : {};
  return [
    `status: ${String(guard.status ?? result.status ?? "blocked")}`,
    `summary: ${String(guard.summary ?? "Skill curator write guard checked.")}`,
    `curator_write_allowed: ${String(guard.allowed === true)}`,
    `reason_code: ${String(guard.reasonCode ?? "")}`,
    `operator_surface: ${String(guard.operatorSurface ?? "")}`,
    `skill_id: ${String(requestedAction.skillId ?? "")}`,
    `curator_action: ${String(requestedAction.kind ?? "")}`,
    `required_scopes: ${formatWeixinSkillList(guard.requiredScopes)}`,
    `missing_scopes: ${formatWeixinSkillList(guard.missingScopes)}`,
    `evidence_refs: ${formatWeixinSkillList(guard.evidenceRefs)}`,
    `applied: ${String(result.applied === true)}`,
    `next_actions: ${formatWeixinSkillList(guard.nextActions)}`,
  ].join("\n");
}

function formatWeixinSkillList(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join(", ")
    : "";
}

function readSkillCuratorAction(
  args: Readonly<Record<string, unknown>>,
): "patch" | "archive" | "merge" | null {
  const action = readToolString(args, "action");
  return action === "patch" || action === "archive" || action === "merge" ? action : null;
}

function readToolStringArray(
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = args[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readToolStatusString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readToolString(args: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readLearningAdmitSources(args: Readonly<Record<string, unknown>>): readonly {
  readonly sourceRef?: string;
  readonly title?: string;
  readonly body: string;
  readonly quality?: Readonly<Record<string, unknown>>;
  readonly sourceSnapshot?: Readonly<Record<string, unknown>>;
}[] {
  const value = args.sources;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isObject(item)) {
      return [];
    }
    const body =
      readNestedString(item, ["body"]) ??
      readNestedString(item, ["content"]) ??
      readNestedString(item, ["text"]);
    if (body === undefined || body.trim().length === 0) {
      return [];
    }
    const sourceRef =
      readNestedString(item, ["url"]) ??
      readNestedString(item, ["sourceRef"]) ??
      readNestedString(item, ["source_ref"]);
    const title = readNestedString(item, ["title"]);
    return [
      {
        ...(sourceRef === undefined ? {} : { sourceRef }),
        ...(title === undefined ? {} : { title }),
        ...(isObject(item.quality) ? { quality: item.quality } : {}),
        ...(isObject(item.source_snapshot)
          ? { sourceSnapshot: item.source_snapshot }
          : isObject(item.sourceSnapshot)
            ? { sourceSnapshot: item.sourceSnapshot }
            : {}),
        body: body.trim(),
      },
    ];
  });
}

function findBlockedLearningAdmitSource(
  sources: readonly {
    readonly sourceRef?: string;
    readonly title?: string;
    readonly body: string;
    readonly quality?: Readonly<Record<string, unknown>>;
    readonly sourceSnapshot?: Readonly<Record<string, unknown>>;
  }[],
) {
  for (const source of sources) {
    if (!isLearningAdmitSourcePublishable(source)) {
      return source;
    }
  }
  return null;
}

function isLearningAdmitSourcePublishable(source: {
  readonly title?: string;
  readonly body: string;
  readonly quality?: Readonly<Record<string, unknown>>;
  readonly sourceSnapshot?: Readonly<Record<string, unknown>>;
}): boolean {
  const quality = isObject(source.quality) ? source.quality : {};
  if (quality.status === "blocked" || quality.publishable === false) {
    return false;
  }
  const snapshot = isObject(source.sourceSnapshot) ? source.sourceSnapshot : {};
  const accessStatus =
    typeof snapshot.access_status === "string"
      ? snapshot.access_status
      : typeof snapshot.accessStatus === "string"
        ? snapshot.accessStatus
        : undefined;
  if (accessStatus !== undefined && accessStatus !== "available") {
    return false;
  }
  return !isLowQualityLearningAdmitBody(source.body, source.title ?? "");
}

function isLowQualityLearningAdmitBody(body: string, title: string): boolean {
  const text = `${title}\n${body}`.replace(/\s+/gu, " ").trim();
  if (text.length === 0) {
    return true;
  }
  const highConfidenceResiduePatterns = [
    /环境异常/iu,
    /完成验证后即可继续访问/iu,
    /请输入验证码|验证码/iu,
    /登录后继续访问|请先登录|访问受限|访问过于频繁/iu,
    /轻点两下取消赞|轻点两下取消在看/iu,
    /视频\s+小程序\s+赞/iu,
    /Something went wrong,? but don(?:’|')t fret/iu,
    /Some privacy related extensions may cause issues/iu,
    /_sentryDebugIds|webpackChunk|__NEXT_DATA__/iu,
  ] as const;
  const residueCount = highConfidenceResiduePatterns.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
  const gateTitle = /^(微信公众平台|环境异常|验证码|验证|访问受限|登录|登录后继续访问)$/iu.test(
    title.trim(),
  );
  return residueCount >= 2 || (residueCount >= 1 && gateTitle && text.length < 260);
}

function createWeixinLearningAdmitQualityBlockedToolResult(
  call: { readonly id: string; readonly name: string },
  source: {
    readonly sourceRef?: string;
    readonly quality?: Readonly<Record<string, unknown>>;
    readonly sourceSnapshot?: Readonly<Record<string, unknown>>;
  },
) {
  const sourceRef = source.sourceRef ?? "unknown-source";
  return createWeixinToolResult(
    call,
    false,
    [
      "status: blocked",
      "summary: 没有准入学习：这次只读到了登录墙、验证码、环境异常或网页按钮残渣，不是可信正文。",
      `source: ${sourceRef}`,
      "next_actions: 先用 web_extract 重新读取；如果网页需要登录，改用已授权浏览器快照；拿到正文后再准入学习。",
    ].join("\n"),
    {
      status: "blocked",
      reason: "low-quality-source",
      candidateCount: 0,
      failureCount: 1,
      sourceRef,
      quality: isObject(source.quality) ? source.quality : null,
      sourceSnapshot: isObject(source.sourceSnapshot) ? source.sourceSnapshot : null,
    },
  );
}

function readToolBoolean(args: Readonly<Record<string, unknown>>, key: string): boolean | null {
  const value = args[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (/^(true|1|yes|on|enable|enabled|开启|打开|启用)$/u.test(normalized)) {
    return true;
  }
  if (/^(false|0|no|off|disable|disabled|关闭|停用|禁用)$/u.test(normalized)) {
    return false;
  }
  return null;
}

function readToolInteger(args: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = args[key];
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function readToolStringList(args: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = args[key];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(/[,\s，、+＋/]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

async function inspectWeixinMcpRuntime(workspaceRoot: string) {
  const config = loadWeixinMcpConfig(workspaceRoot);
  const client = createConversationRuntimeMcpClient({
    servers: config.servers,
    clientName: "director-angel-weixin",
    clientVersion: "0.1.0",
    cwd: workspaceRoot,
    stderrLogPath: join(workspaceRoot, ".director-angel", "runtime", "logs", "mcp-stderr.log"),
  });
  try {
    const inspection = await client.inspectServers();
    return {
      configPath: config.path,
      source: config.source,
      inspection,
      servers: inspection.servers.map((server) => ({
        name: server.name,
        status: server.status,
        enabled: server.enabled,
        transport: server.transport,
        toolCount: server.toolCount,
        enabledToolCount: server.enabledToolCount,
        auth: server.auth,
        error: server.error ?? null,
      })),
      issues: inspection.issues,
      notes: inspection.notes,
    };
  } finally {
    await client.close();
  }
}

async function upsertWeixinMcpServer(
  workspaceRoot: string,
  args: Readonly<Record<string, unknown>>,
) {
  const serverName = normalizeWeixinMcpServerName(readToolString(args, "serverName"));
  const current = loadWeixinMcpConfig(workspaceRoot);
  const previous = current.servers[serverName];
  const previousSource = current.serverSources[serverName] ?? null;
  const server = normalizeWeixinMcpServerConfig(args, previous);
  const nextConfig = await writeWeixinMcpConfig(workspaceRoot, {
    ...current.servers,
    [serverName]: server,
  });
  const nextSource = nextConfig.serverSources[serverName] ?? null;
  const restoredInheritedConfig =
    previousSource?.path === current.path &&
    server.enabled !== false &&
    nextSource !== null &&
    nextSource.path !== nextConfig.path;
  return {
    serverName,
    created: previous === undefined,
    configPath: nextConfig.path,
    source: nextConfig.source,
    status: restoredInheritedConfig
      ? "enabled-inherited"
      : previous === undefined
        ? "created"
        : "updated",
    inheritedSourcePath: restoredInheritedConfig ? nextSource.path : null,
    inheritedScope: restoredInheritedConfig ? nextSource.scope : null,
    server: redactWeixinMcpServerConfig(server),
  };
}

async function testWeixinMcpServerBestEffort(workspaceRoot: string, serverName: string) {
  try {
    const normalized = normalizeWeixinMcpServerName(serverName);
    const config = loadWeixinMcpConfig(workspaceRoot);
    const serverConfig = config.servers[normalized];
    if (serverConfig === undefined) {
      throw new Error(`MCP server not found: ${normalized}`);
    }
    const client = createConversationRuntimeMcpClient({
      servers: { [normalized]: serverConfig },
      clientName: "director-angel-weixin",
      clientVersion: "0.1.0",
      cwd: workspaceRoot,
      stderrLogPath: join(workspaceRoot, ".director-angel", "runtime", "logs", "mcp-stderr.log"),
    });
    try {
      const inspection = await client.inspectServers();
      const server = inspection.servers[0];
      if (server === undefined) {
        throw new Error(`MCP server inspection returned no result: ${normalized}`);
      }
      return {
        ok: server.status === "connected",
        status: server.status,
        serverName: normalized,
        toolCount: server.toolCount,
        enabledToolCount: server.enabledToolCount,
        auth: server.auth,
        message:
          server.status === "connected"
            ? `Connected with ${server.enabledToolCount}/${server.toolCount} tools enabled.`
            : (server.error ?? server.status),
      };
    } finally {
      await client.close();
    }
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      serverName: String(serverName ?? ""),
      toolCount: 0,
      enabledToolCount: 0,
      message: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeWeixinMcpServerConfig(
  args: Readonly<Record<string, unknown>>,
  previous: ConversationRuntimeMcpServerConfig | undefined,
): ConversationRuntimeMcpServerConfig {
  const transport = normalizeWeixinMcpTransport(
    readToolString(args, "transport") ?? readToolString(args, "type"),
    args,
  );
  const enabled = readToolBoolean(args, "enabled") ?? previous?.enabled !== false;
  const timeoutMs = readBoundedToolInteger(args.timeoutMs, 1000, 120000) ?? previous?.timeoutMs;
  const auth = normalizeWeixinMcpAuth(readToolString(args, "auth") ?? previous?.auth);
  const base = {
    type: transport,
    enabled,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(auth === undefined ? {} : { auth }),
  };
  if (transport === "stdio") {
    const command = readToolString(args, "command") ?? previous?.command;
    if (command === undefined || command.trim().length === 0) {
      throw new Error("stdio MCP requires command.");
    }
    return {
      ...base,
      command,
      args: normalizeWeixinStringList(args.args ?? previous?.args),
      env: {
        ...(previous?.env ?? {}),
        ...normalizeWeixinStringRecord(args.env),
      },
    };
  }
  const url = readToolString(args, "url") ?? previous?.url;
  if (url === undefined || url.trim().length === 0) {
    throw new Error(`${transport} MCP requires url.`);
  }
  return {
    ...base,
    url,
    headers: {
      ...(previous?.headers ?? {}),
      ...normalizeWeixinStringRecord(args.headers),
    },
  };
}

function normalizeWeixinMcpServerName(value: string | null): string {
  const normalized = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]+$/u.test(normalized)) {
    throw new Error("MCP server name can only contain letters, numbers, hyphens, and underscores.");
  }
  return normalized;
}

function normalizeWeixinMcpTransport(
  value: string | null,
  args: Readonly<Record<string, unknown>>,
): "stdio" | "http" | "sse" {
  const normalized =
    value !== null && value.trim().length > 0
      ? value.trim().toLowerCase()
      : readToolString(args, "url") === null
        ? "stdio"
        : "http";
  if (normalized === "streamable-http") {
    return "http";
  }
  if (normalized === "stdio" || normalized === "http" || normalized === "sse") {
    return normalized;
  }
  throw new Error(`Unsupported MCP transport: ${String(value)}`);
}

function normalizeWeixinMcpAuth(
  value: string | undefined | null,
): "none" | "oauth" | "header" | undefined {
  if (value === undefined || value === null || value.trim().length === 0) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "oauth" || normalized === "header") {
    return normalized;
  }
  throw new Error(`Unsupported MCP auth mode: ${value}`);
}

function normalizeWeixinStringList(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }
  return [];
}

function normalizeWeixinStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, entry]) => [key, entry]),
  );
}

function redactWeixinMcpServerConfig(config: ConversationRuntimeMcpServerConfig) {
  return {
    ...config,
    env: redactWeixinSecretRecord(config.env),
    headers: redactWeixinSecretRecord(config.headers),
  };
}

function redactWeixinSecretRecord(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /key|token|secret|password|authorization|auth/iu.test(key) ? "[REDACTED]" : entry,
    ]),
  );
}

function formatWeixinMcpRuntimeToolContent(
  result: Awaited<ReturnType<typeof inspectWeixinMcpRuntime>>,
): string {
  return [
    "status: success",
    `summary: MCP 已配置 ${result.inspection.serverCount} 个，已连接 ${result.inspection.connectedCount} 个，可用工具 ${result.inspection.toolCount} 个。`,
    `config_path: ${result.configPath}`,
    `servers: ${
      result.servers
        .slice(0, 6)
        .map(
          (server) =>
            `${server.name}:${server.status}:${server.enabledToolCount}/${server.toolCount}`,
        )
        .join(", ") || "[]"
    }`,
    `issues: ${result.issues.join(" | ") || "[]"}`,
    "next_actions: 用户要求安装/更新 MCP 时调用 director.mcp.server.upsert；已连接后下一轮可调用对应 mcp__server__tool。",
  ].join("\n");
}

function formatWeixinMcpUpsertToolContent(
  result: Awaited<ReturnType<typeof upsertWeixinMcpServer>>,
  test: Awaited<ReturnType<typeof testWeixinMcpServerBestEffort>>,
): string {
  const connected = test.status === "connected";
  if (result.status === "enabled-inherited") {
    return [
      `status: ${connected ? "connected" : "saved"}`,
      `summary: MCP 已恢复继承配置：${result.serverName}${connected ? "，连接成功。" : "，本项目 disabled 覆盖已移除；连接测试未通过或需要后续授权。"}`,
      `server: ${result.serverName}`,
      `config_path: ${result.configPath}`,
      `inherited_source: ${result.inheritedSourcePath ?? "unknown"}`,
      `test_status: ${test.status}`,
      `tool_count: ${test.toolCount}`,
      `message: ${test.message}`,
      connected
        ? "next_actions: 下一轮对话可根据模型判断调用这个 MCP 的工具。"
        : "next_actions: 如果是 OAuth/鉴权 MCP，到桌面端 MCP 面板点击登录；如果是 stdio，检查命令、参数和本机依赖。",
    ].join("\n");
  }
  return [
    `status: ${connected ? "connected" : "saved"}`,
    `summary: MCP 已${result.created ? "安装" : "更新"}：${result.serverName}${connected ? "，连接成功。" : "，配置已保存；连接测试未通过或需要后续授权。"}`,
    `server: ${result.serverName}`,
    `config_path: ${result.configPath}`,
    `test_status: ${test.status}`,
    `tool_count: ${test.toolCount}`,
    `message: ${test.message}`,
    connected
      ? "next_actions: 下一轮对话可根据模型判断调用这个 MCP 的工具。"
      : "next_actions: 如果是 OAuth/鉴权 MCP，到桌面端 MCP 面板点击登录；如果是 stdio，检查命令、参数和本机依赖。",
  ].join("\n");
}

function formatWeixinMcpTestToolContent(
  result: Awaited<ReturnType<typeof testWeixinMcpServerBestEffort>>,
): string {
  return [
    `status: ${result.status}`,
    `summary: MCP 测试${result.ok ? "通过" : "未通过"}：${result.serverName}。`,
    `tool_count: ${result.toolCount}`,
    `enabled_tool_count: ${result.enabledToolCount}`,
    `message: ${result.message}`,
    result.ok
      ? "next_actions: 可以在后续对话中按需调用 MCP 工具。"
      : "next_actions: 检查配置、授权和服务日志后重试。",
  ].join("\n");
}

function readBoundedToolInteger(value: unknown, min: number, max: number): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : null;
}

function formatWeixinRecallHits(hits: readonly unknown[]): string {
  if (hits.length === 0) {
    return "[]";
  }
  return hits
    .slice(0, 5)
    .map((hit) => {
      if (!isObject(hit)) {
        return String(hit);
      }
      const id = hit.knowledgePackId ?? hit.recordId ?? hit.id ?? "unknown";
      const title = hit.title ?? hit.summary ?? "";
      return String(title).trim().length > 0 ? `${String(id)}:${String(title).trim()}` : String(id);
    })
    .join(" | ");
}

function readWeixinSkillIdsFromHostIndex(value: unknown): readonly string[] {
  if (!isObject(value) || !isObject(value.skillIndex)) {
    return [];
  }
  const skillIds = value.skillIndex.skillIds;
  return Array.isArray(skillIds)
    ? skillIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function formatWeixinSkillIndexId(item: unknown): string {
  if (!isObject(item)) {
    return String(item);
  }
  return String(item.id ?? item.skillId ?? item.title ?? "unknown");
}

function formatWeixinMemoryStatusToolLines(result: Record<string, unknown>): string {
  const runtimeMemory = isObject(result.runtimeMemory) ? result.runtimeMemory : {};
  const longTerm = isObject(result.longTerm) ? result.longTerm : {};
  return [
    `runtime_memory: ${runtimeMemory.storeStatus ?? result.status ?? "unknown"}`,
    `runtime_record_count: ${readNumber(runtimeMemory, "recordCount") ?? 0}`,
    `long_term_memory: ${longTerm.status ?? "unknown"}`,
    `long_term_signal_count: ${Array.isArray(longTerm.signals) ? longTerm.signals.length : 0}`,
  ].join("\n");
}

function isComfyUiWorkflowKind(
  value: unknown,
): value is ComfyUiWorkflowDraftIntent["workflowKind"] {
  return value === "script" || value === "copywriting" || value === "image" || value === "video";
}

function isComfyUiWorkflowMode(value: unknown): value is ComfyUiWorkflowMode {
  return value === "script" || value === "image" || value === "video";
}

function formatCandidateArtifactIds(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "[]";
  }
  const ids = value
    .map((item) =>
      isObject(item)
        ? (readNestedString(item, ["candidateId"]) ?? readNestedString(item, ["id"]))
        : undefined,
    )
    .filter((id) => typeof id === "string" && id.length > 0)
    .slice(0, 5);
  return ids.length === 0 ? "[]" : ids.join(", ");
}

function readRuntimeProviderMetadata(
  runtimeResult: Awaited<ReturnType<typeof runConversationRuntimeTurn>>,
  key: "providerId" | "model" | "message",
): string | null {
  for (const item of runtimeResult.operatorTrace.items) {
    const value = item.metadata?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function readWeixinRuntimeEvidenceDisclosure(runtimeResult: ConversationRuntimeResult): unknown {
  return (runtimeResult as ConversationRuntimeResult & { readonly evidenceDisclosure?: unknown })
    .evidenceDisclosure;
}

function persistWeixinRuntimeSourceAccessLearningArtifact(input: {
  readonly store: ReturnType<typeof createWeixinLearningArtifactStore>;
  readonly runtimeResult: ConversationRuntimeResult;
}): void {
  createSourceAccessLimitedLearningArtifactFromRuntimeResult({
    store: input.store,
    sessionKey: input.runtimeResult.sessionKey,
    sourceSurface: "weixin",
    sourceKind: "url",
    result: input.runtimeResult,
  });
}

function persistWeixinRuntimeToolApprovalsFromResult(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId?: string;
  readonly messageId?: string;
  readonly runtimeResult: ConversationRuntimeResult;
}): void {
  expireWeixinRuntimeToolApprovals(input.config.home, input.config.account.normalizedAccountId);
  const now = new Date().toISOString();
  for (const event of input.runtimeResult.events ?? []) {
    if (!isConversationRuntimeApprovalEvent(event)) {
      continue;
    }
    const approval = event.payload.approval;
    const toolCall = normalizeWeixinRuntimeApprovalToolCall(approval.metadata?.toolCall);
    if (approval.id.trim().length === 0 || toolCall === null) {
      continue;
    }
    saveWeixinRuntimeToolApproval(input.config.home, input.config.account.normalizedAccountId, {
      schemaVersion: "director.weixin.runtime-tool-approval.v1",
      approvalId: approval.id,
      status: approval.status === "rejected" ? "rejected" : "pending",
      peerId: input.peerId ?? "unknown-peer",
      ...(input.peerId === undefined ? {} : { requestedByPeerId: input.peerId }),
      title: approval.title,
      summary: approval.summary ?? "",
      toolName:
        typeof approval.metadata?.toolName === "string"
          ? approval.metadata.toolName
          : toolCall.name,
      toolCall,
      eventId: event.id,
      turnId: event.turnId,
      sessionKey: event.sessionKey,
      ...(input.messageId === undefined ? {} : { sourceMessageId: input.messageId }),
      createdAt: now,
      updatedAt: now,
      metadata: isObject(approval.metadata) ? approval.metadata : {},
    });
  }
}

function normalizeWeixinRuntimeApprovalToolCall(
  value: unknown,
): WeixinRuntimeToolApprovalRecord["toolCall"] | null {
  if (!isObject(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim().length > 0 ? value.id.trim() : null;
  const name =
    typeof value.name === "string" && value.name.trim().length > 0 ? value.name.trim() : null;
  const args = isObject(value.args) ? value.args : null;
  if (id === null || name === null || args === null) {
    return null;
  }
  return {
    id,
    name,
    args,
    ...(typeof value.readOnly === "boolean" ? { readOnly: value.readOnly } : {}),
    ...(typeof value.requiresApproval === "boolean"
      ? { requiresApproval: value.requiresApproval }
      : {}),
    ...(isObject(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

async function handleWeixinRuntimeToolApprovalDecision(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly message: WeixinMessage;
  readonly decision: "approve" | "reject";
}): Promise<{ readonly status: string; readonly reply: string }> {
  const approval = findPendingWeixinRuntimeToolApproval(
    input.config.home,
    input.config.account.normalizedAccountId,
  );
  if (approval === null) {
    return {
      status: "missing",
      reply: renderWeixinRuntimeToolApprovalStatusReply({
        status: "missing",
        reason: "no pending runtime tool approval was available",
        nextAction: "需要使用工具时，重新发起这件事就行。",
      }),
    };
  }
  const authorization = resolveWeixinRuntimeToolApprovalDecisionAuthorization({
    config: input.config,
    peerId: input.peerId,
    approval,
  });
  if (!authorization.allowed) {
    return {
      status: "untrusted",
      reply: renderWeixinRuntimeToolApprovalStatusReply({
        status: "untrusted",
        reason: "current Weixin peer is not the requester or a trusted operator",
        detail: `tool: ${approval.toolName}`,
        nextAction: "请让发起人回复确认/拒绝，或由可信操作员处理。",
      }),
    };
  }
  const now = new Date().toISOString();
  if (input.decision === "reject") {
    updateWeixinRuntimeToolApproval(
      input.config.home,
      input.config.account.normalizedAccountId,
      approval.approvalId,
      (current) => ({
        ...current,
        status: "rejected",
        updatedAt: now,
        decidedAt: now,
        decidedByPeerId: input.peerId,
      }),
    );
    return {
      status: "rejected",
      reply: renderWeixinRuntimeToolApprovalStatusReply({
        status: "rejected",
        reason:
          authorization.kind === "trusted-operator"
            ? "trusted operator rejected the pending runtime tool call"
            : "requester rejected the pending runtime tool call",
        detail: `tool: ${approval.toolName}`,
        actorKind: authorization.kind,
      }),
    };
  }

  const result = await executeWeixinConversationRuntimeTool({
    config: input.config,
    call: approval.toolCall,
    sourceId: `weixin-tool-approval-${resolveMessageId(input.message)}-${approval.toolCall.id}`,
    peerId: input.peerId,
    runtimeApproval: {
      status: "approved",
      decidedByPeerId: input.peerId,
      kind: authorization.kind,
    },
  });
  updateWeixinRuntimeToolApproval(
    input.config.home,
    input.config.account.normalizedAccountId,
    approval.approvalId,
    (current) => ({
      ...current,
      status: result.ok ? "approved" : "failed",
      updatedAt: now,
      decidedAt: now,
      decidedByPeerId: input.peerId,
      result,
    }),
  );
  return {
    status: result.ok ? "approved" : "failed",
    reply: renderWeixinRuntimeToolApprovalStatusReply({
      status: result.ok ? "approved" : "failed",
      reason: result.ok
        ? authorization.kind === "trusted-operator"
          ? "trusted operator approved and executed the pending runtime tool call"
          : "requester approved and executed the pending runtime tool call"
        : authorization.kind === "trusted-operator"
          ? "trusted operator approved the pending runtime tool call, but execution failed"
          : "requester approved the pending runtime tool call, but execution failed",
      detail: `tool: ${approval.toolName}\nresult: ${truncateForWeixin(result.content, 900)}`,
      ...(result.ok ? {} : { nextAction: "查看工具结果后重试，或换一个更安全的操作方式。" }),
      actorKind: authorization.kind,
    }),
  };
}

function resolveWeixinRuntimeToolApprovalDecisionAuthorization(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly approval: WeixinRuntimeToolApprovalRecord;
}):
  | { readonly allowed: true; readonly kind: "requester" | "trusted-operator" }
  | { readonly allowed: false } {
  if (isTrustedOperator(input.config, input.peerId)) {
    return { allowed: true, kind: "trusted-operator" };
  }
  const normalizedPeerId = normalizeWeixinPeerId(input.peerId);
  const requesterIds = [
    input.approval.requestedByPeerId,
    input.approval.peerId,
    typeof input.approval.metadata?.peerId === "string"
      ? input.approval.metadata.peerId
      : undefined,
  ].flatMap((peerId) =>
    typeof peerId === "string" && peerId.trim().length > 0 ? [normalizeWeixinPeerId(peerId)] : [],
  );
  return requesterIds.includes(normalizedPeerId)
    ? { allowed: true, kind: "requester" }
    : { allowed: false };
}

function isConversationRuntimeApprovalEvent(
  event: ConversationRuntimeEvent,
): event is ConversationRuntimeEvent<"runtime.approval"> {
  return event.kind === "runtime.approval";
}

function deriveWeixinComfyUiRecallTags(intent: ComfyUiWorkflowDraftIntent): readonly string[] {
  return uniqueStrings([
    "experience",
    "self-learning",
    "comfyui",
    intent.workflowKind,
    ...intent.workflowModes,
    ...deriveTextRecallTags(intent.objective),
  ]);
}

function deriveTextRecallTags(text: string): readonly string[] {
  const tags: string[] = [];
  const rules: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    [/脚本|剧本|故事|小猪|小猫|分场|场景/iu, ["script", "story"]],
    [/图片|生图|文生图|图生图|首帧/iu, ["image", "media"]],
    [/视频|图生视频|文生视频|镜头|运镜/iu, ["video", "media"]],
    [/工作流|comfyui|节点|参数/iu, ["workflow", "comfyui"]],
  ];
  for (const [pattern, nextTags] of rules) {
    if (pattern.test(text)) {
      tags.push(...nextTags);
    }
  }
  return tags;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function extractSkillTitleFromPromptSection(content: string): string | undefined {
  const firstLine = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Skill: "));
  return firstLine?.replace(/^Skill:\s*/u, "").trim() || undefined;
}

function createWeixinComfyUiToolParameters(
  intent: ComfyUiWorkflowDraftIntent,
  output: string,
): readonly WeixinComfyUiToolParameter[] {
  const common: WeixinComfyUiToolParameter[] = [
    weixinComfyUiParameter("objective", "目标", intent.objective, "用户原始目标"),
    weixinComfyUiParameter(
      "angel_output",
      "Angel 生成内容",
      truncateForWeixin(output, 1200),
      "写入画布的核心结果",
    ),
    weixinComfyUiParameter(
      "workflow_kind",
      "工作流类型",
      intent.workflowKind,
      "用于选择后续节点映射",
    ),
    weixinComfyUiParameter(
      "workflow_modes",
      "工作流组合",
      intent.workflowModes.join("+"),
      "用于生成脚本、图片、视频分支",
    ),
  ];
  if (
    intent.workflowModes.includes("script") &&
    (intent.workflowModes.includes("image") || intent.workflowModes.includes("video"))
  ) {
    return [
      ...common,
      weixinComfyUiParameter(
        "script_payload",
        "脚本文本",
        truncateForWeixin(output, 1200),
        "映射到脚本文本和预览节点",
      ),
      weixinComfyUiParameter(
        "scene_count",
        "场景数",
        deriveWeixinComfyUiMediaSceneCount(intent.objective, output),
        "脚本/媒体工作流按场景拆分；每个场景独立生成图片/视频提示词",
      ),
      weixinComfyUiParameter(
        "aspect_ratio",
        "画面比例",
        inferWeixinComfyUiAspectRatio(
          intent.objective,
          intent.workflowModes.includes("video") ? "9:16" : "1:1",
        ),
        "图片/视频分支默认比例",
      ),
      ...(intent.workflowModes.includes("image")
        ? [
            weixinComfyUiParameter("steps", "采样步数", 28, "图片分支初始建议值"),
            weixinComfyUiParameter("cfg", "CFG", 6.5, "图片分支初始建议值"),
          ]
        : []),
      ...(intent.workflowModes.includes("video")
        ? [
            weixinComfyUiParameter(
              "duration_seconds",
              "时长",
              inferWeixinComfyUiDuration(intent.objective) ?? 30,
              "视频分支总时长",
            ),
            weixinComfyUiParameter("fps", "帧率", 24, "视频分支初始建议值"),
          ]
        : []),
      weixinComfyUiParameter("seed", "Seed", -1, "随机种子"),
      weixinComfyUiParameter("review_required", "人工审核", true, "进入媒体执行前建议审核"),
    ];
  }
  if (intent.workflowKind === "image") {
    return [
      ...common,
      weixinComfyUiParameter(
        "aspect_ratio",
        "画面比例",
        inferWeixinComfyUiAspectRatio(intent.objective, "1:1"),
        "可改为 9:16、16:9 等",
      ),
      weixinComfyUiParameter("steps", "采样步数", 28, "初始建议值"),
      weixinComfyUiParameter("cfg", "CFG", 6.5, "初始建议值"),
      weixinComfyUiParameter("seed", "Seed", -1, "随机种子"),
    ];
  }
  if (intent.workflowKind === "video") {
    return [
      ...common,
      weixinComfyUiParameter(
        "duration_seconds",
        "时长",
        inferWeixinComfyUiDuration(intent.objective) ?? 30,
        "用户未指定时默认 30 秒",
      ),
      weixinComfyUiParameter(
        "aspect_ratio",
        "视频比例",
        inferWeixinComfyUiAspectRatio(intent.objective, "9:16"),
        "短视频默认竖屏",
      ),
      weixinComfyUiParameter("fps", "帧率", 24, "初始建议值"),
      weixinComfyUiParameter("seed", "Seed", -1, "随机种子"),
    ];
  }
  return [
    ...common,
    weixinComfyUiParameter(
      "text_payload",
      "文本内容",
      truncateForWeixin(output, 1200),
      "可映射到文本、字幕、分镜拆分或媒体提示词节点",
    ),
    weixinComfyUiParameter("review_required", "人工审核", true, "进入媒体执行前建议审核"),
  ];
}

function weixinComfyUiParameter(
  name: string,
  label: string,
  value: string | number | boolean,
  description: string,
): WeixinComfyUiToolParameter {
  return { name, label, value, description };
}

function deriveWeixinComfyUiMediaSceneCount(objective: string, output = ""): number {
  const explicit =
    parseWeixinComfyUiSceneCount(objective) ?? parseWeixinComfyUiTotalSceneCount(output);
  if (explicit !== null) {
    return explicit;
  }
  const duration = inferWeixinComfyUiDuration(objective);
  if (duration !== null) {
    return Math.min(Math.max(Math.ceil(duration / 10), 3), 12);
  }
  return 3;
}

function parseWeixinComfyUiSceneCount(value: string): number | null {
  const numericPattern = /(\d{1,2})\s*(?:个)?\s*(?:场景|镜头|分镜|scene|shot)/giu;
  for (const numericMatch of value.matchAll(numericPattern)) {
    if (isWeixinComfyUiOrdinalSceneReference(value, numericMatch.index ?? 0)) {
      continue;
    }
    const parsed = Number.parseInt(numericMatch[1] ?? "", 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 12) : null;
  }
  const chinesePattern = /([一二三四五六七八九十]{1,3})\s*(?:个)?\s*(?:场景|镜头|分镜)/gu;
  for (const chineseMatch of value.matchAll(chinesePattern)) {
    if (isWeixinComfyUiOrdinalSceneReference(value, chineseMatch.index ?? 0)) {
      continue;
    }
    const parsed = parseWeixinChineseSceneCount(chineseMatch[1] ?? "");
    return parsed === null ? null : Math.min(Math.max(parsed, 1), 12);
  }
  return null;
}

function parseWeixinComfyUiTotalSceneCount(value: string): number | null {
  const match = value.match(/(?:场景数|总场景|总镜头|共|总共)\s*[:：]?\s*(\d{1,2})/iu);
  if (match === null) {
    return null;
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 12) : null;
}

function isWeixinComfyUiOrdinalSceneReference(value: string, matchIndex: number): boolean {
  return /第\s*$/u.test(value.slice(Math.max(0, matchIndex - 4), matchIndex));
}

function parseWeixinChineseSceneCount(value: string): number | null {
  const normalized = value.trim();
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized === "十") {
    return 10;
  }
  if (normalized.startsWith("十")) {
    return 10 + (digits[normalized.slice(1)] ?? 0);
  }
  if (normalized.includes("十")) {
    const [tens, ones] = normalized.split("十");
    return (digits[tens ?? ""] ?? 1) * 10 + (digits[ones ?? ""] ?? 0);
  }
  return digits[normalized] ?? null;
}

function inferWeixinComfyUiDuration(value: string): number | null {
  const match = value.match(/(\d{1,3})\s*(?:秒|s|sec|seconds)/iu);
  if (match === null) {
    return null;
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 600) : null;
}

function inferWeixinComfyUiAspectRatio(value: string, fallback: string): string {
  if (/横屏|16\s*[:：]\s*9|landscape/iu.test(value)) {
    return "16:9";
  }
  if (/竖屏|9\s*[:：]\s*16|portrait|短视频/iu.test(value)) {
    return "9:16";
  }
  if (/方图|1\s*[:：]\s*1|square/iu.test(value)) {
    return "1:1";
  }
  return fallback;
}

function createWeixinComfyUiHandoffNotes(intent: ComfyUiWorkflowDraftIntent): readonly string[] {
  if (
    intent.workflowModes.includes("script") &&
    (intent.workflowModes.includes("image") || intent.workflowModes.includes("video"))
  ) {
    return [
      "Angel 已先生成脚本、提示词和参数，不需要 ComfyUI 自带 LLM 节点来写内容。",
      "ComfyUI 画布包含脚本文本预览链，以及图片/视频真实节点分支。",
      "图片/视频分支会使用本机已安装的 ComfyUI API 节点；执行前需确认节点授权、模型和输出目录可用。",
    ];
  }
  if (intent.workflowKind === "script" || intent.workflowKind === "copywriting") {
    return [
      "Angel 已生成文本结果，不需要 ComfyUI 自带 LLM 节点来写内容。",
      "ComfyUI 画布用于保存、展示、拆分或继续接图片/视频/字幕节点。",
      "如果要自动执行，需要把文本 payload 映射到真实 ComfyUI API workflow。",
    ];
  }
  return [
    "Angel 已生成媒体提示词和参数建议。",
    "ComfyUI 负责执行已配置的图片/视频 workflow，并返回产物。",
    "执行前需要确认本机 workflow、模型、节点和输出目录已经配置可用。",
  ];
}

function createWeixinComfyUiWorkflowPlan(
  intent: ComfyUiWorkflowDraftIntent,
  angelDraft: WeixinComfyUiAngelDraft,
): readonly object[] {
  if (
    intent.workflowModes.includes("script") &&
    (intent.workflowModes.includes("image") || intent.workflowModes.includes("video"))
  ) {
    return [
      {
        id: "input-story-objective",
        role: "input",
        description: "接收故事主题、时长、角色、风格和限制。",
      },
      {
        id: "angel-script-and-parameter-planner",
        role: "angel",
        description: "Angel 先生成脚本，再拆出图片/视频提示词和参数。",
      },
      {
        id: "comfyui-script-preview",
        role: "text",
        requiredNode: "PrimitiveStringMultiline + PreviewAny",
        description: `把 Angel 脚本写入 ComfyUI 文本预览链，携带 ${angelDraft.toolParameters.length} 项参数。`,
      },
      ...(intent.workflowModes.includes("image")
        ? [
            {
              id: "comfyui-image-branch",
              role: "media",
              requiredNode: "WanTextToImageApi + SaveImage",
              description: "把 Angel 图片提示词映射到文生图节点并保存图片。",
            },
          ]
        : []),
      ...(intent.workflowModes.includes("video")
        ? [
            {
              id: "comfyui-video-branch",
              role: "media",
              requiredNode: intent.workflowModes.includes("image")
                ? "Wan2ImageToVideoApi + SaveVideo"
                : "WanTextToVideoApi + SaveVideo",
              description: intent.workflowModes.includes("image")
                ? "把本场景图片输出接入本场景图生视频节点，并只注入当前场景视频提示词。"
                : "把 Angel 视频提示词按场景拆分到文生视频节点并保存片段。",
            },
          ]
        : []),
    ];
  }
  if (intent.workflowKind === "script") {
    return [
      {
        id: "input-story-objective",
        role: "input",
        description: "接收故事主题、时长、角色、风格和限制。",
      },
      {
        id: "angel-script-writer",
        role: "angel",
        description: "Angel 生成脚本、对白、分镜和后续媒体提示词拆分。",
      },
      {
        id: "comfyui-canvas-handoff",
        role: "output",
        description: `写入 ComfyUI 可见画布，携带 ${angelDraft.toolParameters.length} 项参数。`,
      },
    ];
  }
  return [
    {
      id: "input-objective",
      role: "input",
      description: "接收目标和约束。",
    },
    {
      id: "angel-parameter-planner",
      role: "angel",
      description: "Angel 生成内容、提示词和参数。",
    },
    {
      id: "output-review",
      role: "output",
      description: `写入 ComfyUI 可见画布，携带 ${angelDraft.toolParameters.length} 项参数。`,
    },
  ];
}

function sanitizeWorkflowSlug(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return sanitized || "draft";
}

function formatWeixinComfyUiOpenReply(url: string): string {
  return [`ComfyUI 界面地址：${url}`, "这次只返回地址，不会提交 workflow。"].join("\n");
}

function formatWeixinComfyUiWorkflowDraftReply(result: ComfyUiWorkflowDraftResult): string {
  const lines = [
    result.uploadedToComfyUi
      ? `已创建 ComfyUI ${formatWeixinComfyUiWorkflowModes(result.workflowModes)} 工作流。`
      : `已生成 ComfyUI ${formatWeixinComfyUiWorkflowModes(result.workflowModes)} 工作流，但还没同步进 ComfyUI。`,
    `目标：${result.objective}`,
    `类型：${formatWeixinComfyUiWorkflowKind(result.workflowKind)}`,
    result.uploadedToComfyUi
      ? result.directOpenReady
        ? "画布：已尝试直接打开到这条工作流。"
        : "画布：已打开 ComfyUI，请在 Workflows / DirectorAngel 中查看。"
      : "画布：已保存本地草案，等 ComfyUI 恢复后可重新同步。",
    "下一步：检查节点、模型和输出目录，确认后再执行。",
  ];
  if (!result.uploadedToComfyUi) {
    lines.push(`同步状态：${result.uploadMessage}`);
  }
  return lines.join("\n");
}

function formatWeixinComfyUiWorkflowKind(kind: ComfyUiWorkflowDraftIntent["workflowKind"]): string {
  const labels = {
    script: "脚本",
    copywriting: "文案",
    image: "图片",
    video: "视频",
  };
  return labels[kind];
}

function formatWeixinComfyUiWorkflowModes(modes: readonly ComfyUiWorkflowMode[]): string {
  const labels = {
    script: "脚本",
    image: "图片",
    video: "视频",
  } as const;
  return modes.map((mode) => labels[mode]).join("+") || "脚本";
}

function formatWeixinComfyUiRunReply(result: {
  readonly ok: boolean;
  readonly message: string;
  readonly readiness?: string;
  readonly promptApplied?: boolean;
  readonly diagnostics?: readonly string[];
  readonly workflowDiagnostics?: {
    readonly promptNodeCount?: number;
    readonly modelDependencyCount?: number;
    readonly outputNodeCount?: number;
  };
  readonly promptId?: string;
  readonly artifactCount: number;
  readonly artifacts: readonly {
    readonly kind: "image" | "video";
    readonly filename: string;
    readonly localPath?: string;
    readonly url: string;
  }[];
}): string {
  const diagnostics = formatWeixinComfyUiDiagnostics(result);
  if (!result.ok) {
    return ["ComfyUI 没有完成生成。", diagnostics, result.message].filter(Boolean).join("\n");
  }
  const first = result.artifacts[0];
  const location = first?.localPath ?? first?.url;
  if (result.readiness === "connectivity_check" || result.promptApplied === false) {
    return [
      "ComfyUI 已真实执行。",
      "当前 workflow 没有提示词节点，所以这是连通性验证，不是 AI 文生图结果。",
      diagnostics,
      ...(result.promptId === undefined ? [] : [`任务：${shortId(result.promptId)}`]),
      `产物：${result.artifactCount} 个`,
      ...(location === undefined ? [] : [`文件：${location}`]),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "ComfyUI 已生成。",
    diagnostics,
    ...(result.promptId === undefined ? [] : [`任务：${shortId(result.promptId)}`]),
    `产物：${result.artifactCount} 个`,
    ...(location === undefined ? [] : [`文件：${location}`]),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatWeixinComfyUiDiagnostics(result: {
  readonly readiness?: string;
  readonly diagnostics?: readonly string[];
  readonly workflowDiagnostics?: {
    readonly promptNodeCount?: number;
    readonly modelDependencyCount?: number;
    readonly outputNodeCount?: number;
  };
}): string {
  const lines: string[] = [];
  if (result.readiness !== undefined) {
    lines.push(`执行类型：${formatWeixinComfyUiReadiness(result.readiness)}`);
  }
  if (result.workflowDiagnostics !== undefined) {
    lines.push(
      `Workflow：提示词节点 ${result.workflowDiagnostics.promptNodeCount ?? 0}；模型依赖 ${
        result.workflowDiagnostics.modelDependencyCount ?? 0
      }；输出节点 ${result.workflowDiagnostics.outputNodeCount ?? 0}`,
    );
  }
  for (const diagnostic of result.diagnostics ?? []) {
    lines.push(`诊断：${diagnostic}`);
  }
  return lines.join("\n");
}

function formatWeixinComfyUiReadiness(readiness: string): string {
  if (readiness === "generation") {
    return "真实生成";
  }
  if (readiness === "connectivity_check") {
    return "连通性验证";
  }
  return "未就绪";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : undefined;
}

function saveDirectorSessionState(
  config: WeixinGatewayConfig,
  peerId: string,
  state: PeerDirectorSessionState,
): void {
  savePeerSession(config.home, config.account.normalizedAccountId, peerId, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

function savePendingSafeRewrite(
  config: WeixinGatewayConfig,
  peerId: string,
  originalObjective: string,
  safeRewriteObjective: string,
): void {
  saveDirectorSessionState(config, peerId, {
    peerId,
    lastObjective: cleanUserFacingText(originalObjective),
    pendingSafeRewriteObjective: safeRewriteObjective,
    pendingApprovalAssignmentIds: [],
    updatedAt: new Date().toISOString(),
  });
}

function isContentSafetyDeveloperDebugEnabled(config: WeixinGatewayConfig): boolean {
  const workspaceRoot = resolve(config.workspaceRoot ?? config.home);
  const switchPath = join(workspaceRoot, ".director-angel", "runtime", "switches.json");
  return (
    loadDirectorSwitchState(switchPath).features["contentSafety.developerDebug.enabled"] === true
  );
}

function extractWeixinConversationAttachments(
  message: WeixinMessage,
): ConversationRuntimeAttachment[] {
  const attachments: ConversationRuntimeAttachment[] = [];
  for (const [index, item] of (message.item_list ?? []).entries()) {
    if (item.type === 2) {
      attachments.push(createWeixinRuntimeAttachment("image", message, index, item.image_item));
      continue;
    }
    if (item.type === 4) {
      attachments.push(createWeixinRuntimeAttachment("video", message, index, item.video_item));
      continue;
    }
    if (item.type === 5) {
      attachments.push(createWeixinRuntimeAttachment("file", message, index, item.file_item));
    }
  }
  return attachments;
}

function createWeixinRuntimeAttachment(
  kind: ConversationRuntimeAttachment["kind"],
  message: WeixinMessage,
  index: number,
  payload: Record<string, unknown> | undefined,
): ConversationRuntimeAttachment {
  const record = payload ?? {};
  const id = readWeixinAttachmentString(record, ["id", "media_id", "file_id", "aes_key"]);
  const name = readWeixinAttachmentString(record, ["name", "filename", "file_name", "title"]);
  const url = readWeixinAttachmentString(record, ["url", "cdn_url", "download_url"]);
  const mimeType =
    readWeixinAttachmentString(record, ["mime_type", "mimeType", "content_type"]) ??
    (kind === "image" ? "image/*" : kind === "video" ? "video/*" : undefined);
  const sizeBytes = readWeixinAttachmentNumber(record, [
    "size_bytes",
    "sizeBytes",
    "file_size",
    "size",
  ]);
  return {
    id: id ?? `${resolveMessageId(message)}:${kind}:${index}`,
    kind,
    ...(name === undefined ? {} : { name }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(url === undefined ? {} : { url }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    metadata: {
      source: "weixin",
      messageId: resolveMessageId(message),
      itemIndex: index,
    },
  };
}

function readWeixinAttachmentString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readWeixinAttachmentNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function resolveWeixinDefaultTextModelCapabilities(config: WeixinGatewayConfig):
  | {
      readonly model?: string;
      readonly providerId?: string;
      readonly text?: boolean;
      readonly vision?: boolean;
      readonly capabilities?: readonly string[];
      readonly inputModalities?: readonly ("text" | "image" | "video")[];
    }
  | undefined {
  const providersRoot = resolve(configWorkspaceRoot(config), ".director-angel", "providers");
  try {
    const provider = loadDirectorApiProviderConfig(providersRoot).document.providers.find(
      (item) => item.enabled && item.capabilities.includes("text"),
    );
    if (provider === undefined) {
      return undefined;
    }
    const model = provider.defaultModels.text;
    const metadata = provider.modelMetadata.find((item) => item.model === model);
    const capabilities = metadata?.capabilities ?? [];
    const canUseText = capabilities.length === 0 || capabilities.includes("text");
    const canUseVision = capabilities.includes("vision");
    return {
      providerId: provider.id,
      model,
      text: canUseText,
      vision: canUseVision,
      capabilities,
      inputModalities: canUseVision ? ["text", "image", "video"] : ["text"],
    };
  } catch {
    return undefined;
  }
}

function createWeixinSafetyDialogue(
  config: WeixinGatewayConfig,
  objective: string,
): {
  readonly safeRewriteObjective: string;
  readonly reply: string;
} | null {
  const evaluation = evaluateProductionContentSafety(objective, {
    mode: isContentSafetyDeveloperDebugEnabled(config) ? "developer-debug" : "standard",
  });
  if (evaluation.verdict !== "rewrite-required") {
    return null;
  }
  const safeRewriteObjective =
    evaluation.safeRewriteObjective ?? buildSafeRewriteObjective(objective);
  return {
    safeRewriteObjective,
    reply: formatSafetyDialogueReply({
      safeRewriteObjective,
      ...(evaluation.ruleId === undefined ? {} : { ruleId: evaluation.ruleId }),
      ...(evaluation.reason === undefined ? {} : { reason: evaluation.reason }),
      floor: evaluation.floor,
      canOverride: evaluation.canOverride,
      requiresApproval: evaluation.requiresApproval,
      ...(evaluation.auditEvent === undefined ? {} : { auditEvent: evaluation.auditEvent }),
      ...(evaluation.debugNotes === undefined ? {} : { debugNotes: evaluation.debugNotes }),
    }),
  };
}

async function createWeixinProductionModelDraft(input: {
  readonly config: WeixinGatewayConfig;
  readonly objective: string;
  readonly directorResult: DirectorGatewayResult;
  readonly workerResult: WeixinWorkerRunOnceResult | null;
}): Promise<WeixinProductionModelDraft | null> {
  const providersRoot = join(
    resolve(input.config.workspaceRoot ?? input.config.home),
    ".director-angel",
    "providers",
  );
  try {
    const fetchImpl = createWeixinApiProviderFetchAdapter(input.config.apiProviderFetch);
    const result = await runDirectorApiProviderTextCompletion(providersRoot, {
      prompt: createWeixinProductionDraftPrompt(input),
      systemPrompt: createWeixinProductionDraftSystemPrompt(),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
    return {
      ok: result.ok,
      providerId: result.providerId,
      model: result.model,
      message: result.message,
      ...(typeof result.output === "string" && result.output.trim().length > 0
        ? { output: truncateForWeixin(result.output.trim(), 12_000) }
        : {}),
    };
  } catch (error) {
    return {
      ok: false,
      providerId: "api-provider",
      model: "unknown",
      message: `制作草案模型层不可用：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function createWeixinProductionDraftSystemPrompt(): string {
  return createProductionResultSystemPrompt("weixin");
}

function createWeixinProductionDraftPrompt(input: {
  readonly objective: string;
  readonly directorResult: DirectorGatewayResult;
  readonly workerResult: WeixinWorkerRunOnceResult | null;
}): string {
  const snapshot = extractDirectorGatewaySessionSnapshot(input.directorResult);
  const nodes = (input.directorResult.blueprint?.blueprint?.actionGraph?.nodes ?? []).map(
    (node) => ({
      assignmentId: node.assignmentId,
      role: node.role,
      deliverable: node.deliverable,
      status: node.status,
      approvalMode: node.approvalMode,
      selectedAdapter: node.selectedAdapter,
    }),
  );
  const assignmentResults = (input.workerResult?.run.assignments ?? []).map((assignment) => ({
    assignmentId: assignment.assignmentId,
    role: assignment.role,
    status: assignment.status,
    summary: assignment.result?.summary,
  }));
  const safetyBoundary = needsHumanTraffickingBoundary(input.objective)
    ? "安全边界：如果涉及买卖人口、胁迫婚姻或伤害女性，必须按批判、救助、法律后果与受害者主体性处理，不能美化或合理化。"
    : "安全边界：按普通制作任务处理。";

  return [
    `制作目标：${cleanUserFacingText(input.objective)}`,
    safetyBoundary,
    `内部蓝图ID（只供判断，禁止输出）：${snapshot.blueprintId ?? "未创建"}`,
    `内部RunID（只供判断，禁止输出）：${snapshot.runId ?? input.workerResult?.run.runId ?? "未创建"}`,
    `内部状态（只供判断，禁止输出）：${input.workerResult?.run.status ?? input.directorResult.status?.run?.status ?? "unknown"}`,
    `导演摘要：${input.directorResult.status?.report?.operatorSurface?.operatorSummary ?? input.workerResult?.report.operatorSurface?.operatorSummary ?? "无"}`,
    `内部执行报告（只供判断，禁止输出）：${JSON.stringify({
      summary: input.workerResult?.report.summary ?? [],
      flags: input.workerResult?.report.flags ?? [],
      executedAssignments: input.workerResult?.executedAssignments ?? [],
    })}`,
    `内部流程节点（只供判断，禁止输出）：${JSON.stringify(nodes)}`,
    `内部执行结果（只供判断，禁止输出）：${JSON.stringify(assignmentResults)}`,
    "请只输出最终制作结果，不要输出 JSON，不要输出任何内部 ID、系统日志、过程说明或修改建议。",
  ].join("\n");
}

function formatWeixinActiveRunStatusReply(
  session: PeerDirectorSessionState,
  snapshot?: WeixinActiveRunStatusSnapshot | undefined,
): string {
  const objective = cleanUserFacingText(session.lastObjective ?? "上一条制作任务");
  const pendingCount = session.pendingApprovalAssignmentIds.length;
  const runId = snapshot?.run?.runId ?? session.runId;
  const status = snapshot?.run?.status;
  const summary = snapshot?.report?.operatorSurface?.operatorSummary?.trim();
  const runtimeWarningSummary = snapshot?.runtimeWarningSummary?.trim();
  const runLine =
    runId === undefined
      ? "状态：还没有创建运行。"
      : `状态：${shortId(runId)}${status === undefined ? "" : ` · ${translateRunStatus(status)}`} · ${pendingCount > 0 ? `待确认 ${pendingCount} 个环节` : "可继续修改"}`;
  const lines = [
    `上一版：${objective}`,
    runLine,
    ...(summary === undefined || summary.length === 0
      ? []
      : [truncateForWeixin(humanizeWeixinProductionText(summary), 700)]),
    ...(runtimeWarningSummary === undefined || runtimeWarningSummary.length === 0
      ? []
      : [truncateForWeixin(humanizeWeixinProductionText(runtimeWarningSummary), 360)]),
    pendingCount > 0
      ? "继续就回「确认执行」；要改就直接补充一句。"
      : "要改就直接补充一句；要查进度就发「/运行 状态」。",
  ];
  return lines.join("\n");
}

function readWeixinClientRuntimeStatusWarningSummary(
  clientRuntimeTask: unknown,
): string | undefined {
  const explicit = readNestedString(clientRuntimeTask, ["payload", "statusWarningSummary"]);
  if (explicit !== undefined) {
    return explicit.trim();
  }
  return formatWeixinRuntimeEventWarningSummary(
    readNestedArray(clientRuntimeTask, ["payload", "runtimeEventsV1"]),
  );
}

function formatWeixinRuntimeEventWarningSummary(events: readonly unknown[]): string | undefined {
  for (const event of [...events].reverse()) {
    const kind = readNestedString(event, ["kind"]);
    if (kind === "context.compaction.partial_saved") {
      const checkpointId = readNestedString(event, ["payload", "checkpointId"]);
      const reason = readNestedString(event, ["payload", "reason"]);
      const summaryPreview = readNestedString(event, ["payload", "summaryPreview"]);
      return [
        "上下文已保留部分摘要",
        checkpointId === undefined ? undefined : `检查点 ${checkpointId}`,
        reason === undefined ? undefined : `原因 ${reason}`,
        summaryPreview,
      ]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join("；");
    }
    if (kind === "context.compaction.failed") {
      const checkpointId = readNestedString(event, ["payload", "checkpointId"]);
      const reason =
        readNestedString(event, ["payload", "reason"]) ??
        readNestedString(event, ["payload", "message"]);
      const partialAvailable = readNestedBoolean(event, ["payload", "partialSummaryAvailable"]);
      return [
        partialAvailable === true ? "上下文压缩失败，但已保留部分摘要" : "上下文压缩失败",
        checkpointId === undefined ? undefined : `检查点 ${checkpointId}`,
        reason === undefined ? undefined : `原因 ${reason}`,
      ]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join("；");
    }
  }
  return undefined;
}

function selectCommandRunId(
  args: string | undefined,
  session: PeerDirectorSessionState,
): string | undefined {
  const argRunId = args?.trim().split(/\s+/u)[0]?.trim();
  return argRunId && argRunId.length > 0 ? argRunId : session.runId;
}

async function loadWeixinActiveRunStatus(input: {
  readonly config: WeixinGatewayConfig;
  readonly activeSession: PeerDirectorSessionState;
  readonly args?: string | undefined;
}): Promise<WeixinActiveRunStatusSnapshot | undefined> {
  const requestedRunId = selectCommandRunId(input.args, input.activeSession);
  if (requestedRunId !== undefined) {
    try {
      const clientRuntimeTask = await getDirectorClientRuntimeTask(
        input.config.director,
        requestedRunId,
        { clientSurface: "weixin" },
      );
      if (
        clientRuntimeTask.run !== undefined ||
        clientRuntimeTask.clientRuntimeTask !== undefined
      ) {
        const clientRuntimeTaskRecord = clientRuntimeTask.clientRuntimeTask;
        const summary =
          clientRuntimeTaskRecord?.payload?.previewSummary ??
          clientRuntimeTaskRecord?.artifactLabel ??
          clientRuntimeTaskRecord?.label;
        const runtimeWarningSummary =
          readWeixinClientRuntimeStatusWarningSummary(clientRuntimeTaskRecord);
        return {
          ...(clientRuntimeTask.run === undefined ? {} : { run: clientRuntimeTask.run }),
          ...(typeof runtimeWarningSummary === "string" && runtimeWarningSummary.trim().length > 0
            ? { runtimeWarningSummary: runtimeWarningSummary.trim() }
            : {}),
          ...(typeof summary === "string" && summary.trim().length > 0
            ? {
                report: {
                  operatorSurface: {
                    operatorSummary: summary.trim(),
                  },
                },
              }
            : {}),
        };
      }
    } catch (_error) {
      // Older Host API builds do not expose clientRuntime yet; keep the existing status path as fallback.
    }
  }
  if (
    input.activeSession.entrySessionId !== undefined &&
    (requestedRunId === undefined || requestedRunId === input.activeSession.runId)
  ) {
    return getDirectorEntrySessionStatus(input.config.director, input.activeSession.entrySessionId);
  }
  if (requestedRunId !== undefined) {
    return { run: await getDirectorRun(input.config.director, requestedRunId) };
  }
  return undefined;
}

async function deliverWeixinSubagentAnnouncesForRun(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly runId?: string | undefined;
  readonly errorLog?: (message: string) => void;
}): Promise<number> {
  if (input.runId === undefined || input.runId.trim().length === 0) {
    return 0;
  }

  let snapshot: { readonly subagentAnnounces?: readonly WeixinSubagentAnnounce[] };
  try {
    snapshot = await getDirectorRunDelegations(input.config.director, input.runId);
  } catch (error) {
    input.errorLog?.(
      `微信后台子代理完成通知读取失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }

  const deliveredIds = new Set(
    loadDeliveredWeixinSubagentAnnounceIds(
      input.config.home,
      input.config.account.normalizedAccountId,
      input.peerId,
    ),
  );
  const requesterSessionKey = createWeixinRequesterSessionKey(input.config, input.peerId);
  const pending = (snapshot.subagentAnnounces ?? []).filter((announce) =>
    shouldDeliverWeixinSubagentAnnounce(announce, {
      requesterSessionKey,
      peerId: input.peerId,
      deliveredIds,
    }),
  );
  let deliveredCount = 0;
  const deliveredNow: string[] = [];

  for (const announce of pending) {
    const text = announce.userFacingText?.trim();
    const announceId = announce.announceId?.trim();
    if (
      text === undefined ||
      text.length === 0 ||
      announceId === undefined ||
      announceId.length === 0
    ) {
      continue;
    }
    const delivered = await trySendReply(input.config, input.peerId, text, {
      ...(input.errorLog === undefined ? {} : { errorLog: input.errorLog }),
    });
    if (delivered) {
      deliveredNow.push(announceId);
      deliveredCount += 1;
    }
  }

  if (deliveredNow.length > 0) {
    markWeixinSubagentAnnouncesDelivered(
      input.config.home,
      input.config.account.normalizedAccountId,
      input.peerId,
      deliveredNow,
    );
  }

  return deliveredCount;
}

function createWeixinRequesterSessionKey(config: WeixinGatewayConfig, peerId: string): string {
  return `weixin:${config.account.normalizedAccountId}:${peerId}`;
}

function shouldDeliverWeixinSubagentAnnounce(
  announce: WeixinSubagentAnnounce,
  context: {
    readonly requesterSessionKey: string;
    readonly peerId: string;
    readonly deliveredIds: ReadonlySet<string>;
  },
): boolean {
  const announceId = announce.announceId?.trim();
  if (announceId === undefined || announceId.length === 0 || context.deliveredIds.has(announceId)) {
    return false;
  }
  if (announce.requesterOrigin !== "weixin") {
    return false;
  }
  if (announce.requesterSessionKey !== context.requesterSessionKey) {
    return false;
  }
  const deliveryTarget = announce.deliveryTarget?.trim();
  if (
    deliveryTarget !== undefined &&
    deliveryTarget.length > 0 &&
    deliveryTarget !== context.peerId
  ) {
    return false;
  }
  return typeof announce.userFacingText === "string" && announce.userFacingText.trim().length > 0;
}

async function controlWeixinActiveRun(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly activeSession: PeerDirectorSessionState;
  readonly args?: string | undefined;
  readonly action: DirectorRunControlAction;
}): Promise<void> {
  const runtimeStop =
    input.action === "abort" || input.action === "pause"
      ? stopWeixinConversationRuntimeRuns({
          config: input.config,
          peerId: input.peerId,
          reason: input.action === "abort" ? "weixin-run-abort" : "weixin-run-pause",
        })
      : { stopped: 0, turnRunIds: [] };
  const runId = selectCommandRunId(input.args, input.activeSession);
  if (runId === undefined) {
    await sendReply(
      input.config,
      input.peerId,
      runtimeStop.stopped > 0
        ? "已请求停止当前微信会话；但没有找到可中止的制作运行。"
        : "没有找到正在运行的微信任务，未执行任何停止操作。你可以发「/运行 状态」查看上一条制作运行。",
    );
    return;
  }

  try {
    const result =
      input.action === "abort"
        ? await stopDirectorClientRuntimeTask(input.config.director, {
            taskId: runId,
            reason: "weixin-run-abort",
            clientSurface: "weixin",
          })
        : await controlDirectorRun(input.config.director, {
            runId,
            action: input.action,
          });
    const status = result.run?.status ?? (input.action === "abort" ? "aborted" : "paused");
    const actionLabel =
      input.action === "abort" ? "已中止" : input.action === "resume" ? "已恢复" : "已暂停";
    const runtimeText =
      runtimeStop.stopped > 0 ? `；同时已停止 ${runtimeStop.stopped} 个微信对话回合` : "";
    await sendReply(
      input.config,
      input.peerId,
      `${actionLabel}：${shortId(runId)} · ${translateRunStatus(status)}${runtimeText}`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendReply(
      input.config,
      input.peerId,
      runtimeStop.stopped > 0
        ? `已请求停止当前微信会话，但制作运行没有确认中止：${detail}。可用「/运行 状态」核对。`
        : `没有确认已停止，所以我不会假装已经停止。制作运行控制失败：${detail}。可用「/运行 状态」核对。`,
    );
  }
}

async function followupWeixinActiveRun(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly activeSession: PeerDirectorSessionState;
  readonly args?: string | undefined;
  readonly instruction?: string | undefined;
}): Promise<void> {
  const runId = selectCommandRunId(input.args, input.activeSession);
  if (runId === undefined) {
    await sendReply(
      input.config,
      input.peerId,
      "没有找到可继续的微信任务。你可以发「/运行 状态」查看上一条制作运行。",
    );
    return;
  }

  try {
    const result = await followupDirectorClientRuntimeTask(input.config.director, {
      taskId: runId,
      reason: "weixin-run-followup",
      ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
      ...(input.activeSession.entrySessionId === undefined
        ? {}
        : { entrySessionId: input.activeSession.entrySessionId }),
      clientSurface: "weixin",
    });
    saveDirectorSessionState(input.config, input.peerId, {
      ...input.activeSession,
      pendingApprovalAssignmentIds: [],
      updatedAt: new Date().toISOString(),
    });
    const followup = result.clientRuntimeFollowup;
    const status = result.run?.status ?? followup?.status ?? "running";
    if (followup?.accepted === false || followup?.continued === 0) {
      await sendReply(
        input.config,
        input.peerId,
        `没有继续推进：${shortId(runId)} · ${followup?.reason ?? "当前运行不可继续"}。`,
      );
      return;
    }
    const approvedCount = followup?.approvedAssignmentIds?.length ?? 0;
    await sendReply(
      input.config,
      input.peerId,
      `已继续：${shortId(runId)} · ${translateRunStatus(status)}${approvedCount > 0 ? ` · 已确认 ${approvedCount} 个待审环节` : ""}`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendReply(
      input.config,
      input.peerId,
      `没有确认已继续，所以我不会假装已经继续。运行继续失败：${detail}。可用「/运行 状态」核对。`,
    );
  }
}

async function continueWeixinActiveSessionWithSupplement(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly message: WeixinMessage;
  readonly activeSession: PeerDirectorSessionState;
  readonly supplement: string;
}): Promise<void> {
  const supplementSafety = createWeixinSafetyDialogue(input.config, input.supplement);
  if (supplementSafety !== null) {
    const originalObjective = cleanUserFacingText(
      input.activeSession.lastObjective ?? "上一条制作任务",
    );
    const combinedSafety =
      createWeixinSafetyDialogue(input.config, `${originalObjective}，${input.supplement}`) ??
      supplementSafety;
    savePendingSafeRewrite(
      input.config,
      input.peerId,
      originalObjective,
      combinedSafety.safeRewriteObjective,
    );
    await sendReply(input.config, input.peerId, combinedSafety.reply);
    return;
  }

  const userFacingObjective = cleanUserFacingText(
    input.activeSession.lastObjective ?? "上一条制作任务",
  );
  await createAndAutoExecuteProductionTurn({
    config: input.config,
    peerId: input.peerId,
    message: input.message,
    directorText: buildRefinedDirectorText(input.activeSession, input.supplement),
    userFacingObjective,
    supplement: input.supplement,
  });
}

async function confirmWeixinActiveSession(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly activeSession: PeerDirectorSessionState | undefined;
  readonly message: WeixinMessage;
  readonly supplement?: string | undefined;
}): Promise<void> {
  if (input.activeSession?.runId === undefined) {
    await sendReply(
      input.config,
      input.peerId,
      "没有可继续的上一版。直接发你要的结果就行，例如：做一个小猫旅游记。",
    );
    return;
  }

  const activeSafety = createWeixinSafetyDialogue(
    input.config,
    input.activeSession.lastObjective ?? "",
  );
  if (activeSafety !== null) {
    const originalObjective = cleanUserFacingText(
      input.activeSession.lastObjective ?? "上一条制作任务",
    );
    savePendingSafeRewrite(
      input.config,
      input.peerId,
      originalObjective,
      activeSafety.safeRewriteObjective,
    );
    await sendReply(input.config, input.peerId, activeSafety.reply);
    return;
  }

  if (input.supplement !== undefined) {
    await continueWeixinActiveSessionWithSupplement({
      config: input.config,
      peerId: input.peerId,
      message: input.message,
      activeSession: input.activeSession,
      supplement: input.supplement,
    });
    return;
  }

  await followupWeixinActiveRun({
    config: input.config,
    peerId: input.peerId,
    activeSession: input.activeSession,
  });
}

async function createAndAutoExecuteProductionTurn(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly message: WeixinMessage;
  readonly directorText: string;
  readonly userFacingObjective: string;
  readonly supplement?: string | undefined;
  readonly safeRewrite?: boolean | undefined;
}): Promise<void> {
  const activeSession = loadPeerSession(
    input.config.home,
    input.config.account.normalizedAccountId,
    input.peerId,
  );
  const runRegistry = createWeixinConversationRunRegistry(input.config);
  const channelResult = await runConversationRuntimeChannelTurn(input, {
    adapter: createWeixinProductionChannelAdapter(input, activeSession),
    runtime: {
      turnIdFactory: () => `weixin-turn-${resolveMessageId(input.message)}`,
      runRegistry,
      orchestrate: () => ({
        intent: {
          kind: input.supplement === undefined ? "production-start" : "production-supplement",
          objective: input.userFacingObjective,
          ...(input.supplement === undefined ? {} : { supplement: input.supplement }),
          command: {
            name: "production.start",
            raw: "/制作",
            args: input.userFacingObjective,
          },
        },
        responsePolicy: "result-first",
        audience: "user",
        userText: "",
        memoryDecision: {
          action: "store-result-only",
          reason: "微信制作任务只把最终可用结果纳入后续候选。",
        },
        shouldInvokeRecall: true,
        shouldCreateRun: input.supplement === undefined,
        shouldAttachToActiveSession: input.supplement !== undefined,
      }),
      resolveCapabilityContext: () => createWeixinRuntimeCapabilityPacket(input),
      startProduction: async (request) => runWeixinProductionPort(input, request.mode),
    },
  });
  const runtimeResult = channelResult.runtimeResult;
  if (runtimeResult === undefined) {
    await sendReply(
      input.config,
      input.peerId,
      renderConversationRuntimeStructuredStatusText({
        title: "Director production runtime:",
        status: "not-started",
        reason: "conversation runtime did not return a production result",
        nextAction: "retry after the production runtime is available",
      }),
    );
    return;
  }
  input.config.log?.(
    `weixin channel adapter ${channelResult.adapterId} dispatched stages=${channelResult.log
      .map((event) => `${event.stage}:${event.event}`)
      .join(",")}`,
  );
  const finalText = runtimeResult.finalText?.trim();
  await sendReply(
    input.config,
    input.peerId,
    finalText === undefined || finalText.length === 0
      ? renderConversationRuntimeStructuredStatusText({
          title: "Director production result:",
          status: "degraded",
          reason: "production runtime returned no final text",
          ...(runtimeResult.runId === undefined ? {} : { runId: runtimeResult.runId }),
        })
      : (runtimeResult.finalText ?? finalText),
  );
}

function createWeixinProductionChannelAdapter(
  input: {
    readonly config: WeixinGatewayConfig;
    readonly peerId: string;
    readonly message: WeixinMessage;
    readonly directorText: string;
    readonly userFacingObjective: string;
    readonly supplement?: string | undefined;
  },
  activeSession: PeerDirectorSessionState | null,
) {
  return {
    id: "director-weixin-gateway",
    channel: "weixin",
    ingest: () => ({
      surface: "weixin" as const,
      channel: "weixin",
      accountId: input.config.account.normalizedAccountId,
      message: {
        id: resolveMessageId(input.message),
        rawBody: input.directorText,
        bodyForAgent: input.directorText,
        timestampMs: timestampValue(input.message.create_time_ms),
      },
      sender: {
        id: input.peerId,
        roles: ["user"],
      },
      conversation: {
        kind: isGroupMessage(input.message) ? "group" : "direct",
        nativeChannelId: input.peerId,
      },
      route: {
        sessionKey: `weixin:${input.config.account.normalizedAccountId}:${input.peerId}`,
        accountId: input.config.account.normalizedAccountId,
        routeKind: isGroupMessage(input.message) ? "group" : "direct",
      },
      reply: {
        to: input.peerId,
        replyToId: resolveMessageId(input.message),
      },
      access: {
        commandAuthorized: true,
      },
      metadata: {
        objective: input.userFacingObjective,
        hasSupplement: input.supplement !== undefined,
        source: "weixin-production",
      },
    }),
    classifyTransportEvent: () => ({
      kind: "command" as const,
      canStartAgentTurn: true,
      reason: "weixin production intent",
    }),
    buildRuntimeInput: () => ({
      surface: "weixin" as const,
      channel: "weixin",
      messageId: resolveMessageId(input.message),
      sessionKey: `weixin:${input.config.account.normalizedAccountId}:${input.peerId}`,
      text: input.directorText,
      accountId: input.config.account.normalizedAccountId,
      sender: {
        id: input.peerId,
        role: "user",
      },
      trustedContext: {
        ...(activeSession?.runId === undefined ? {} : { activeRunId: activeSession.runId }),
        metadata: {
          objective: input.userFacingObjective,
          source: "weixin-production",
        },
      },
    }),
  };
}

async function runWeixinProductionPort(
  input: {
    readonly config: WeixinGatewayConfig;
    readonly peerId: string;
    readonly message: WeixinMessage;
    readonly directorText: string;
    readonly userFacingObjective: string;
    readonly supplement?: string | undefined;
    readonly safeRewrite?: boolean | undefined;
  },
  mode: "start" | "confirm" | "supplement",
) {
  const directorResult = await sendMessageToDirector(input.config.director, {
    peerId: input.peerId,
    messageId: resolveMessageId(input.message),
    receivedAtMs: timestampValue(input.message.create_time_ms),
    text: buildInitialDirectorText(input.directorText),
  });
  const session = saveDirectorSessionFromResult(
    input.config,
    input.peerId,
    directorResult,
    input.supplement,
    input.userFacingObjective,
  );

  if (session.runId === undefined) {
    return {
      ok: false,
      status: "blocked",
      replySource: "degraded-error" as const,
      metadata: {
        mode,
        message:
          "Host API intake did not produce a run or model-generated production final. The Weixin adapter must not render intake templates as final output.",
      },
    };
  }

  const confirmationResult = await confirmDirectorRun(input.config.director, {
    runId: session.runId,
    ...(session.entrySessionId === undefined ? {} : { entrySessionId: session.entrySessionId }),
    preferredAssignmentIds: session.pendingApprovalAssignmentIds,
  });
  const workerResult = await runWorkerForConfirmedRun(input.config, session.runId);
  saveDirectorSessionState(input.config, input.peerId, {
    ...session,
    pendingApprovalAssignmentIds: [],
  });
  const modelDraft = await createWeixinProductionModelDraft({
    config: input.config,
    objective:
      input.supplement === undefined
        ? input.userFacingObjective
        : `${input.userFacingObjective}\n补充要求：${input.supplement}`,
    directorResult,
    workerResult,
  });
  const reply = formatWeixinAutoExecutionReply({
    directorResult,
    runId: session.runId,
    objective: input.userFacingObjective,
    supplement: input.supplement,
    approvedCount: confirmationResult.approvedAssignmentIds.length,
    workerResult,
    modelDraft,
    safeRewrite: input.safeRewrite,
  });

  const snapshot = extractDirectorGatewaySessionSnapshot(directorResult);
  return {
    ok: true,
    status: workerResult?.run.status ?? confirmationResult.run?.status ?? "running",
    finalText: reply,
    runId: session.runId,
    ...(session.blueprintId === undefined ? {} : { blueprintId: session.blueprintId }),
    ...(workerResult?.report.reportId === undefined
      ? {}
      : { reportId: workerResult.report.reportId }),
    artifacts: [
      {
        id: session.runId,
        kind: "run" as const,
        title: "微信制作运行",
        metadata: {
          mode,
          objective: input.userFacingObjective,
        },
      },
      ...(snapshot.blueprintId === undefined
        ? []
        : [
            {
              id: snapshot.blueprintId,
              kind: "blueprint" as const,
              title: "微信制作蓝图",
            },
          ]),
    ],
    approvals: confirmationResult.approvedAssignmentIds.map((assignmentId) => ({
      id: assignmentId,
      title: "微信制作审批",
      status: "approved" as const,
    })),
    recallStatus: "miss",
    skillStatus: "miss",
    memoryStatus: "miss",
    metadata: {
      approvedCount: confirmationResult.approvedAssignmentIds.length,
      mode,
    },
  };
}

function createWeixinRuntimeCapabilityPacket(input: {
  readonly userFacingObjective: string;
  readonly supplement?: string | undefined;
}) {
  return {
    status: "miss" as const,
    visibleSummary: "微信制作入口将由 Director 后端读取已发布经验、Skill 和运行记忆。",
    hiddenPromptBlock: "",
    hits: [],
    metadata: {
      objective: input.userFacingObjective,
      hasSupplement: input.supplement !== undefined,
    },
  };
}

async function sendReply(config: WeixinGatewayConfig, peerId: string, text: string): Promise<void> {
  const contextToken = getContextToken(config.home, config.account.normalizedAccountId, peerId);
  await sendWeixinTextMessage(
    {
      baseUrl: config.account.baseUrl,
      token: config.account.token,
      to: peerId,
      text,
      ...(contextToken === undefined ? {} : { contextToken }),
    },
    config.fetchFn,
  );
  recordWeixinAssistantTurn(config, peerId, text);
}

async function sendRuntimeReply(input: {
  readonly config: WeixinGatewayConfig;
  readonly peerId: string;
  readonly text: string;
  readonly runtimeResult?: ConversationRuntimeResult;
}): Promise<void> {
  const contextToken = getContextToken(
    input.config.home,
    input.config.account.normalizedAccountId,
    input.peerId,
  );
  await sendWeixinTextMessage(
    {
      baseUrl: input.config.account.baseUrl,
      token: input.config.account.token,
      to: input.peerId,
      text: input.text,
      ...(contextToken === undefined ? {} : { contextToken }),
    },
    input.config.fetchFn,
  );
  recordWeixinAssistantTurn(
    input.config,
    input.peerId,
    input.text,
    input.runtimeResult?.transcriptMessages,
  );
}

export async function handleWeixinMessage(
  config: WeixinGatewayConfig,
  message: WeixinMessage,
): Promise<"sent" | "ignored"> {
  const log = config.log ?? defaultLog;
  const errLog = config.error ?? defaultError;
  const messageId = resolveMessageId(message);
  if (isSelfMessage(config.account, message)) {
    log(`weixin ignored self message id=${messageId}`);
    return "ignored";
  }
  if (isGroupMessage(message)) {
    log(`weixin ignored group message id=${messageId}`);
    return "ignored";
  }

  const peerId = resolvePeerId(message);
  if (!peerId || !isAllowed(config, peerId)) {
    log(`weixin ignored disallowed message id=${messageId} peer=${peerId || "(missing)"}`);
    return "ignored";
  }

  const contextToken = stringValue(message.context_token);
  if (contextToken) {
    saveContextToken(config.home, config.account.normalizedAccountId, peerId, contextToken);
  }

  const text = extractWeixinText(message.item_list ?? []);
  if (!text.trim()) {
    await sendReply(
      config,
      peerId,
      "我收到了语音，但当前还没有接入语音转文字。请直接发文字，我就能继续处理。",
    );
    log(`weixin replied to unreadable message id=${messageId} peer=${peerId}`);
    return "sent";
  }
  log(`weixin received text message id=${messageId} peer=${peerId} chars=${text.trim().length}`);
  recordWeixinUserTurn(config, peerId, message, text.trim());

  try {
    const attachments = extractWeixinConversationAttachments(message);
    const activeSession = loadPeerSession(config.home, config.account.normalizedAccountId, peerId);
    const textModelCapabilities = resolveWeixinDefaultTextModelCapabilities(config);
    const conversationTurn = orchestrateConversationTurn({
      text,
      surface: "weixin",
      channel: "weixin",
      agentId: "director-angel",
      peerId,
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(textModelCapabilities === undefined ? {} : { textModelCapabilities }),
      activeSession: {
        hasActiveSession: activeSession?.runId !== undefined,
        ...(activeSession?.runId === undefined ? {} : { runId: activeSession.runId }),
        ...(activeSession?.lastObjective === undefined
          ? {}
          : { objective: activeSession.lastObjective }),
      },
      contentSafetyMode: isContentSafetyDeveloperDebugEnabled(config)
        ? "developer-debug"
        : "standard",
    });
    if (
      isSafeRewriteConfirmation(text) &&
      activeSession?.pendingSafeRewriteObjective !== undefined
    ) {
      const objective = activeSession.pendingSafeRewriteObjective;
      await createAndAutoExecuteProductionTurn({
        config,
        peerId,
        message,
        directorText: `/制作 ${objective}`,
        userFacingObjective: objective,
        safeRewrite: true,
      });
      log(`weixin auto-executed safe rewritten production task from ${peerId}`);
      return "sent";
    }

    const runtimeToolApprovalIntent = parseChannelRuntimeToolApprovalIntent(text);
    if (runtimeToolApprovalIntent !== null) {
      const pendingRuntimeToolApproval = findPendingWeixinRuntimeToolApproval(
        config.home,
        config.account.normalizedAccountId,
      );
      if (
        pendingRuntimeToolApproval !== null ||
        isExplicitWeixinRuntimeToolApprovalDecisionText(text)
      ) {
        const approvalResult = await handleWeixinRuntimeToolApprovalDecision({
          config,
          peerId,
          message,
          decision: runtimeToolApprovalIntent.decision,
        });
        await sendReply(config, peerId, approvalResult.reply);
        log(
          `weixin ${runtimeToolApprovalIntent.decision} runtime tool approval from ${peerId}: ${approvalResult.status}`,
        );
        return "sent";
      }
    }

    const slashCommand = conversationTurn.intent.command;
    if (
      conversationTurn.intent.kind === "run-control" &&
      slashCommand?.commandId === "run.abort" &&
      activeSession?.runId === undefined
    ) {
      const runtimeStop = stopWeixinConversationRuntimeRuns({
        config,
        peerId,
        reason: "weixin-stop-command",
      });
      await sendReply(
        config,
        peerId,
        runtimeStop.stopped > 0
          ? "已请求停止当前微信会话，正在运行的模型或工具结果不会继续发送。"
          : "没有找到正在运行的微信任务，未执行任何停止操作。你可以发「/运行 状态」查看上一条制作运行。",
      );
      log(`weixin handled conversation runtime stop from ${peerId}: ${runtimeStop.stopped}`);
      return "sent";
    }
    if (
      slashCommand !== undefined &&
      slashCommand.commandId !== "production.start" &&
      !isRunActiveSessionCommand(slashCommand.commandId)
    ) {
      const capabilityResult = await runWeixinCapabilityCommand({
        config,
        command: slashCommand,
        message,
        peerId,
      });
      if (capabilityResult !== null) {
        await sendReply(config, peerId, capabilityResult.reply);
        log(`weixin handled capability command ${slashCommand.commandId} from ${peerId}`);
        return "sent";
      }
    }

    if (activeSession?.runId !== undefined) {
      const turnCommand = conversationTurn.intent.command;
      if (
        conversationTurn.intent.kind === "run-control" &&
        turnCommand?.commandId === "run.status"
      ) {
        const statusSnapshot = await loadWeixinActiveRunStatus({
          config,
          activeSession,
          args: turnCommand.args,
        });
        await sendReply(
          config,
          peerId,
          formatWeixinActiveRunStatusReply(activeSession, statusSnapshot),
        );
        const announceCount = await deliverWeixinSubagentAnnouncesForRun({
          config,
          peerId,
          runId: statusSnapshot?.run?.runId ?? activeSession.runId,
          errorLog: errLog,
        });
        log(`weixin returned active run status to ${peerId}`);
        if (announceCount > 0) {
          log(`weixin delivered ${announceCount} subagent announce(s) to ${peerId}`);
        }
        return "sent";
      }
      if (
        conversationTurn.intent.kind === "run-control" &&
        (turnCommand?.commandId === "run.abort" || turnCommand?.commandId === "run.pause")
      ) {
        await controlWeixinActiveRun({
          config,
          peerId,
          activeSession,
          args: turnCommand.args,
          action: turnCommand.commandId === "run.abort" ? "abort" : "pause",
        });
        log(`weixin submitted active run control ${turnCommand.commandId} from ${peerId}`);
        return "sent";
      }
      if (
        conversationTurn.intent.kind === "run-control" &&
        turnCommand?.commandId === "run.resume"
      ) {
        await controlWeixinActiveRun({
          config,
          peerId,
          activeSession,
          args: turnCommand.args,
          action: "resume",
        });
        log(`weixin submitted active run resume from ${peerId}`);
        return "sent";
      }
      if (
        conversationTurn.intent.kind === "run-control" &&
        (turnCommand?.commandId === "run.continue" || turnCommand?.commandId === "run.confirm")
      ) {
        await followupWeixinActiveRun({
          config,
          peerId,
          activeSession,
          args: turnCommand.args,
        });
        log(`weixin submitted active run followup from ${peerId}`);
        return "sent";
      }
      if (conversationTurn.intent.kind === "production-supplement") {
        await continueWeixinActiveSessionWithSupplement({
          config,
          peerId,
          message,
          activeSession,
          supplement: conversationTurn.intent.supplement ?? text,
        });
        log(`weixin auto-executed supplemental production turn from ${peerId}`);
        return "sent";
      }
      if (conversationTurn.intent.kind === "production-confirm") {
        await confirmWeixinActiveSession({
          config,
          peerId,
          message,
          activeSession,
          supplement: conversationTurn.intent.supplement,
        });
        log(`weixin confirmed or refined active run from ${peerId}`);
        return "sent";
      }
    }

    const slashProductionObjective =
      conversationTurn.intent.kind === "production-start" &&
      conversationTurn.intent.command?.commandId === "production.start"
        ? (conversationTurn.intent.objective ?? null)
        : null;
    const slashSafety =
      slashProductionObjective === null
        ? null
        : createWeixinSafetyDialogue(config, slashProductionObjective);
    if (slashSafety !== null && slashProductionObjective !== null) {
      savePendingSafeRewrite(
        config,
        peerId,
        slashProductionObjective,
        slashSafety.safeRewriteObjective,
      );
      await sendReply(config, peerId, slashSafety.reply);
      log(`weixin requested safety rewrite confirmation from ${peerId}`);
      return "sent";
    }

    if (slashProductionObjective !== null) {
      await createAndAutoExecuteProductionTurn({
        config,
        peerId,
        message,
        directorText: text,
        userFacingObjective: slashProductionObjective,
      });
      log(`weixin auto-executed production task from ${peerId}`);
      return "sent";
    }

    const learningUrl = readWeixinLearningUrlFromTurn(conversationTurn.intent);
    if (learningUrl !== null) {
      const reply = await runWeixinRuntimeUrlLearning({
        config,
        peerId,
        message,
        url: learningUrl,
      });
      await trySendReply(config, peerId, reply, { errorLog: errLog });
      log(`weixin routed URL learning through shared runtime artifact flow from ${peerId}`);
      return "sent";
    }

    if (looksLikeChannelContextOnlyMessage(text)) {
      await sendReply(
        config,
        peerId,
        renderConversationRuntimeStructuredStatusText({
          title: "Weixin context state:",
          status: "recorded",
          reason: "context-only message stored for future model/tool turns",
          nextAction: "send a production, learning, recall, Skill, or ComfyUI request",
        }),
      );
      log(`weixin kept short-term context from ${peerId}`);
      return "sent";
    }

    if (activeSession?.runId !== undefined && looksLikeProductionSupplement(text)) {
      const supplementSafety = createWeixinSafetyDialogue(config, text);
      if (supplementSafety !== null) {
        const originalObjective = cleanUserFacingText(
          activeSession.lastObjective ?? "上一条制作任务",
        );
        const combinedSafety =
          createWeixinSafetyDialogue(config, `${originalObjective}，${text}`) ?? supplementSafety;
        savePendingSafeRewrite(
          config,
          peerId,
          originalObjective,
          combinedSafety.safeRewriteObjective,
        );
        await sendReply(config, peerId, combinedSafety.reply);
        log(`weixin requested supplement safety rewrite confirmation from ${peerId}`);
        return "sent";
      }

      const userFacingObjective = cleanUserFacingText(
        activeSession.lastObjective ?? "上一条制作任务",
      );
      await createAndAutoExecuteProductionTurn({
        config,
        peerId,
        message,
        directorText: buildRefinedDirectorText(activeSession, text),
        userFacingObjective,
        supplement: text,
      });
      log(`weixin auto-executed supplemental production turn from ${peerId}`);
      return "sent";
    }

    const productionObjective =
      conversationTurn.intent.kind === "production-start" &&
      conversationTurn.intent.command === undefined
        ? (conversationTurn.intent.objective ?? null)
        : null;
    const naturalSafety =
      conversationTurn.intent.safety?.verdict === "rewrite-required" && productionObjective !== null
        ? {
            safeRewriteObjective:
              conversationTurn.intent.safety.safeRewriteObjective ??
              buildSafeRewriteObjective(productionObjective),
            reply: formatSafetyDialogueReply({
              safeRewriteObjective:
                conversationTurn.intent.safety.safeRewriteObjective ??
                buildSafeRewriteObjective(productionObjective),
              ...(conversationTurn.intent.safety.ruleId === undefined
                ? {}
                : { ruleId: conversationTurn.intent.safety.ruleId }),
              ...(conversationTurn.intent.safety.reason === undefined
                ? {}
                : { reason: conversationTurn.intent.safety.reason }),
              floor: "hard",
              canOverride: false,
              requiresApproval: false,
            }),
          }
        : null;
    if (naturalSafety !== null && productionObjective !== null) {
      savePendingSafeRewrite(
        config,
        peerId,
        productionObjective,
        naturalSafety.safeRewriteObjective,
      );
      await sendReply(config, peerId, naturalSafety.reply);
      log(`weixin requested safety rewrite confirmation from ${peerId}`);
      return "sent";
    }

    if (productionObjective !== null) {
      const enrichedText = withRecentWeixinContext({
        config,
        peerId,
        text,
      });
      await createAndAutoExecuteProductionTurn({
        config,
        peerId,
        message,
        directorText: enrichedText,
        userFacingObjective: productionObjective,
      });
      log(`weixin auto-executed production task from ${peerId}`);
      return "sent";
    }

    const confirmation = parseConfirmation(text);
    if (confirmation !== null && activeSession?.runId !== undefined) {
      const activeSafety = createWeixinSafetyDialogue(config, activeSession.lastObjective ?? "");
      if (activeSafety !== null) {
        const originalObjective = cleanUserFacingText(
          activeSession.lastObjective ?? "上一条制作任务",
        );
        savePendingSafeRewrite(
          config,
          peerId,
          originalObjective,
          activeSafety.safeRewriteObjective,
        );
        await sendReply(config, peerId, activeSafety.reply);
        log(`weixin blocked unsafe confirmation and requested safe rewrite from ${peerId}`);
        return "sent";
      }

      if (confirmation.supplement !== undefined) {
        const confirmationSafety = createWeixinSafetyDialogue(config, confirmation.supplement);
        if (confirmationSafety !== null) {
          const originalObjective = cleanUserFacingText(
            activeSession.lastObjective ?? "上一条制作任务",
          );
          const combinedSafety =
            createWeixinSafetyDialogue(
              config,
              `${originalObjective}，${confirmation.supplement}`,
            ) ?? confirmationSafety;
          savePendingSafeRewrite(
            config,
            peerId,
            originalObjective,
            combinedSafety.safeRewriteObjective,
          );
          await sendReply(config, peerId, combinedSafety.reply);
          log(`weixin requested refined safety rewrite confirmation from ${peerId}`);
          return "sent";
        }

        const userFacingObjective = cleanUserFacingText(
          activeSession.lastObjective ?? "上一条制作任务",
        );
        await createAndAutoExecuteProductionTurn({
          config,
          peerId,
          message,
          directorText: buildRefinedDirectorText(activeSession, confirmation.supplement),
          userFacingObjective,
          supplement: confirmation.supplement,
        });
        log(`weixin auto-executed refined run from ${peerId}`);
        return "sent";
      }

      await followupWeixinActiveRun({
        config,
        peerId,
        activeSession,
      });
      log(`weixin confirmed run from ${peerId}`);
      return "sent";
    }

    if (conversationTurn.intent.kind === "chat") {
      const dynamicReply = await createWeixinDynamicChatReply({
        config,
        text: withRecentWeixinDialogueContext({ config, peerId, text }),
        surface: "weixin-chat",
        fallback: text,
        peerId,
        messageId: resolveMessageId(message),
        ...(attachments.length === 0 ? {} : { attachments }),
        conversationTurn,
      });
      await trySendReply(config, peerId, dynamicReply.reply, {
        errorLog: errLog,
        ...(dynamicReply.runtimeResult === undefined
          ? {}
          : { runtimeResult: dynamicReply.runtimeResult }),
      });
      log(`weixin answered chat via ${dynamicReply.source} from ${peerId}`);
      return "sent";
    }

    if (conversationTurn.intent.kind === "capability-intro") {
      const dynamicReply = await createWeixinDynamicChatReply({
        config,
        text: withRecentWeixinDialogueContext({ config, peerId, text }),
        surface: "weixin-chat",
        fallback: conversationTurn.userText,
        peerId,
        messageId: resolveMessageId(message),
        ...(attachments.length === 0 ? {} : { attachments }),
        conversationTurn,
      });
      await trySendReply(config, peerId, dynamicReply.reply, {
        errorLog: errLog,
        ...(dynamicReply.runtimeResult === undefined
          ? {}
          : { runtimeResult: dynamicReply.runtimeResult }),
      });
      log(`weixin answered capability intro via ${dynamicReply.source} from ${peerId}`);
      return "sent";
    }

    const dynamicReply = await createWeixinDynamicChatReply({
      config,
      text: withRecentWeixinDialogueContext({ config, peerId, text }),
      surface: "weixin-chat",
      fallback: text,
      peerId,
      messageId: resolveMessageId(message),
      ...(attachments.length === 0 ? {} : { attachments }),
      conversationTurn,
    });
    await trySendReply(config, peerId, dynamicReply.reply, {
      errorLog: errLog,
      ...(dynamicReply.runtimeResult === undefined
        ? {}
        : { runtimeResult: dynamicReply.runtimeResult }),
    });
    log(`weixin answered fallback turn via ${dynamicReply.source} from ${peerId}`);
    return "sent";
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    errLog(`weixin director bridge failed for ${peerId}: ${messageText}`);
    if (isWeixinDeliveryFailure(error)) {
      errLog(renderWeixinDeliveryFailureLog(error));
      return "sent";
    }
    await trySendReply(config, peerId, renderWeixinUserFacingFailureReply(error), {
      errorLog: errLog,
    });
    return "sent";
  }
}

export class WeixinGateway {
  private readonly config: WeixinGatewayConfig;
  private readonly seenMessageIds = new Set<string>();

  public constructor(config: WeixinGatewayConfig) {
    this.config = config;
  }

  public async start(
    options: { readonly abortSignal?: AbortSignal; readonly once?: boolean } = {},
  ): Promise<void> {
    const log = this.config.log ?? defaultLog;
    const errLog = this.config.error ?? defaultError;
    try {
      await notifyWeixinStart(this.config.account, this.config.fetchFn);
    } catch (error) {
      errLog(`weixin notifystart failed, continue: ${String(error)}`);
    }

    let syncBuf = loadSyncBuf(this.config.home, this.config.account.normalizedAccountId);
    let timeoutMs = 35_000;
    let failures = 0;
    log(`weixin gateway started: account=${this.config.account.normalizedAccountId}`);

    while (!options.abortSignal?.aborted) {
      try {
        const response = await getWeixinUpdates(
          {
            baseUrl: this.config.account.baseUrl,
            token: this.config.account.token,
            syncBuf,
            timeoutMs,
          },
          this.config.fetchFn,
        );

        if (response.longpolling_timeout_ms !== undefined && response.longpolling_timeout_ms > 0) {
          timeoutMs = response.longpolling_timeout_ms;
        }

        const ret = response.ret ?? 0;
        const errcode = response.errcode ?? 0;
        if (ret !== 0 || errcode !== 0) {
          if (ret === SESSION_EXPIRED_ERRCODE || errcode === SESSION_EXPIRED_ERRCODE) {
            throw new Error("微信登录会话已过期，请重新执行 director-weixin login。");
          }
          failures += 1;
          errLog(
            `weixin getupdates failed ret=${ret} errcode=${errcode} errmsg=${response.errmsg ?? ""}`,
          );
          await sleep(failures >= 3 ? 30_000 : 2_000, options.abortSignal);
          if (failures >= 3) {
            failures = 0;
          }
          continue;
        }

        failures = 0;
        if (response.get_updates_buf !== undefined && response.get_updates_buf.length > 0) {
          syncBuf = response.get_updates_buf;
          saveSyncBuf(this.config.home, this.config.account.normalizedAccountId, syncBuf);
        }

        const messages = response.msgs ?? [];
        if (messages.length > 0) {
          log(
            `weixin received ${messages.length} update message(s): account=${this.config.account.normalizedAccountId}`,
          );
        }

        for (const message of messages) {
          const messageId = resolveMessageId(message);
          if (this.seenMessageIds.has(messageId)) {
            continue;
          }
          this.seenMessageIds.add(messageId);
          const peerId = resolvePeerId(message);
          const claim = claimWeixinMessageForProcessing(
            this.config.home,
            this.config.account.normalizedAccountId,
            {
              messageId,
              ...(peerId.length === 0 ? {} : { peerId }),
              createTimeMs: timestampValue(message.create_time_ms),
            },
          );
          if (!claim.claimed) {
            log(
              `weixin skipped duplicate message id=${messageId} status=${claim.existing?.status ?? "unknown"}`,
            );
            continue;
          }
          try {
            const result = await handleWeixinMessage(this.config, message);
            markWeixinMessageProcessed(this.config.home, this.config.account.normalizedAccountId, {
              messageId,
              result,
            });
          } catch (error) {
            markWeixinMessageProcessingFailed(
              this.config.home,
              this.config.account.normalizedAccountId,
              {
                messageId,
                failure: error instanceof Error ? error.message : String(error),
              },
            );
            throw error;
          }
        }

        if (options.once) {
          return;
        }
      } catch (error) {
        if (options.abortSignal?.aborted) {
          break;
        }
        if (options.once) {
          throw error;
        }
        failures += 1;
        errLog(`weixin gateway loop error: ${String(error)}`);
        await sleep(failures >= 3 ? 30_000 : 2_000, options.abortSignal);
        if (failures >= 3) {
          failures = 0;
        }
      }
    }

    try {
      await notifyWeixinStop(this.config.account, this.config.fetchFn);
    } catch {
      // best effort on shutdown
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

function readWeixinApiProviderCapabilityRoute(
  value: unknown,
): DirectorApiProviderTextCompletionCapabilityRoute | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const route = value as { readonly abilityGroup?: unknown };
  if (
    route.abilityGroup === "text" ||
    route.abilityGroup === "vision" ||
    route.abilityGroup === "image_generation" ||
    route.abilityGroup === "video_generation"
  ) {
    return value as DirectorApiProviderTextCompletionCapabilityRoute;
  }
  return undefined;
}
