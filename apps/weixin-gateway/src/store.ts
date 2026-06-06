import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  CHANNEL_RUNTIME_TOOL_APPROVAL_DEFAULT_MAX_AGE_MS,
  type ChannelRuntimeToolApprovalRecord,
  type ChannelRuntimeToolApprovalStatus,
  expireChannelRuntimeToolApprovalRecords,
} from "@hotflow/channels-core";

import type { WeixinAccount, WeixinLoginCredentials } from "./types.js";

export interface ResolveWeixinHomeOptions {
  readonly workspaceRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PeerDirectorSessionState {
  readonly peerId: string;
  readonly entrySessionId?: string;
  readonly blueprintId?: string;
  readonly runId?: string;
  readonly lastObjective?: string;
  readonly lastSupplement?: string;
  readonly pendingSafeRewriteObjective?: string;
  readonly pendingApprovalAssignmentIds: readonly string[];
  readonly updatedAt: string;
}

export interface PeerConversationTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly messageId?: string;
  readonly transcriptMessages?: readonly PeerConversationTranscriptMessage[];
  readonly createdAt: string;
}

export interface PeerConversationTranscriptMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly PeerConversationTranscriptToolCall[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PeerConversationTranscriptToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly readOnly?: boolean;
  readonly requiresApproval?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type WeixinRuntimeToolApprovalRecord = Omit<
  ChannelRuntimeToolApprovalRecord,
  "schemaVersion" | "channel" | "status"
> & {
  readonly schemaVersion: "director.weixin.runtime-tool-approval.v1";
  readonly status: ChannelRuntimeToolApprovalStatus | "failed";
};

type ExpirableWeixinRuntimeToolApprovalRecord = WeixinRuntimeToolApprovalRecord & {
  readonly status: ChannelRuntimeToolApprovalStatus;
};

export interface WeixinGatewayLockHandle {
  readonly lockPath: string;
  readonly pid: number;
  release(): void;
}

export interface WeixinProcessedMessageRecord {
  readonly messageId: string;
  readonly peerId?: string;
  readonly status: "processing" | "sent" | "ignored" | "failed";
  readonly claimedAt: string;
  readonly updatedAt: string;
  readonly createTimeMs?: number;
  readonly result?: "sent" | "ignored";
  readonly failure?: string;
}

export const WEIXIN_RUNTIME_TOOL_APPROVAL_MAX_AGE_MS =
  CHANNEL_RUNTIME_TOOL_APPROVAL_DEFAULT_MAX_AGE_MS;

const WEIXIN_PROCESSED_MESSAGE_MAX_RECORDS = 2_000;
const WEIXIN_STALE_PROCESSING_MESSAGE_MS = 10 * 60 * 1000;

export function resolveWeixinHome(options: ResolveWeixinHomeOptions = {}): string {
  const env = options.env ?? process.env;
  const explicit = env.DIRECTOR_WEIXIN_HOME?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  const workspaceRoot = options.workspaceRoot ?? env.HOTFLOW_WORKSPACE_ROOT ?? process.cwd();
  return resolve(workspaceRoot, ".director-angel", "weixin");
}

export function normalizeWeixinAccountId(accountId: string): string {
  return accountId
    .trim()
    .replace(/@/gu, "-")
    .replace(/[^a-zA-Z0-9._-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function normalizeWeixinPeerId(peerId: string): string {
  const normalized = normalizeWeixinAccountId(peerId);
  return normalized.length > 0 ? normalized : "unknown-peer";
}

function accountsDir(home: string): string {
  return join(home, "accounts");
}

function accountIndexPath(home: string): string {
  return join(accountsDir(home), "accounts.json");
}

function selectedAccountPath(home: string): string {
  return join(accountsDir(home), "selected-account.json");
}

function accountPath(home: string, normalizedAccountId: string): string {
  return join(accountsDir(home), `${normalizedAccountId}.json`);
}

function syncPath(home: string, normalizedAccountId: string): string {
  return join(accountsDir(home), `${normalizedAccountId}.sync.json`);
}

function gatewayLockPath(home: string, normalizedAccountId: string): string {
  return join(accountsDir(home), `${normalizedAccountId}.gateway-lock.json`);
}

function contextTokenPath(home: string, normalizedAccountId: string): string {
  return join(accountsDir(home), `${normalizedAccountId}.context-tokens.json`);
}

function processedMessagesPath(home: string, normalizedAccountId: string): string {
  return join(home, "processed-messages", normalizedAccountId, "messages.json");
}

function peerSessionPath(home: string, normalizedAccountId: string, peerId: string): string {
  return join(home, "sessions", normalizedAccountId, `${normalizeWeixinPeerId(peerId)}.json`);
}

function peerConversationPath(home: string, normalizedAccountId: string, peerId: string): string {
  return join(home, "conversations", normalizedAccountId, `${normalizeWeixinPeerId(peerId)}.json`);
}

function runtimeToolApprovalPath(home: string, normalizedAccountId: string): string {
  return join(home, "runtime-tool-approvals", normalizedAccountId, "approvals.json");
}

function deliveredSubagentAnnouncesPath(
  home: string,
  normalizedAccountId: string,
  peerId: string,
): string {
  return join(
    home,
    "subagent-announces",
    normalizedAccountId,
    `${normalizeWeixinPeerId(peerId)}.json`,
  );
}

function atomicJsonWrite(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { readonly code?: string }).code === "EPERM"
    );
  }
}

export function acquireWeixinGatewayLock(
  home: string,
  accountId: string,
  metadata: { readonly workspaceRoot?: string } = {},
): WeixinGatewayLockHandle {
  const normalizedAccountId = normalizeWeixinAccountId(accountId);
  const path = gatewayLockPath(home, normalizedAccountId);
  mkdirSync(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeFileSync(
          fd,
          `${JSON.stringify(
            {
              schemaVersion: "director.weixin-gateway.lock.v1",
              accountId: normalizedAccountId,
              pid: process.pid,
              startedAt: new Date().toISOString(),
              ...(metadata.workspaceRoot === undefined
                ? {}
                : { workspaceRoot: metadata.workspaceRoot }),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      } finally {
        closeSync(fd);
      }
      let released = false;
      return {
        lockPath: path,
        pid: process.pid,
        release() {
          if (released) {
            return;
          }
          released = true;
          const current = readJson<{ pid?: number }>(path);
          if (current?.pid === process.pid) {
            try {
              unlinkSync(path);
            } catch {
              // best-effort cleanup
            }
          }
        },
      };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: string }).code
          : undefined;
      if (code !== "EEXIST") {
        throw error;
      }
      const existing = readJson<{ pid?: number; startedAt?: string }>(path);
      const existingPid = existing?.pid;
      if (typeof existingPid === "number" && isProcessAlive(existingPid)) {
        throw new Error(
          `Weixin gateway already running for account ${normalizedAccountId} (pid ${existingPid}).`,
        );
      }
      try {
        unlinkSync(path);
      } catch {
        // another process may have removed or replaced the stale lock
      }
    }
  }

  throw new Error(`Unable to acquire Weixin gateway lock for account ${normalizedAccountId}.`);
}

export function listWeixinAccountIds(home: string): string[] {
  const value = readJson<unknown>(accountIndexPath(home));
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function saveWeixinAccount(
  home: string,
  credentials: WeixinLoginCredentials,
): WeixinAccount {
  const normalizedAccountId = normalizeWeixinAccountId(credentials.accountId);
  const account: WeixinAccount = {
    normalizedAccountId,
    accountId: credentials.accountId,
    token: credentials.token,
    baseUrl: credentials.baseUrl,
    savedAt: new Date().toISOString(),
    ...(credentials.userId === undefined || credentials.userId.trim().length === 0
      ? {}
      : { userId: credentials.userId }),
  };
  atomicJsonWrite(accountPath(home, normalizedAccountId), account);
  const existing = listWeixinAccountIds(home);
  atomicJsonWrite(accountIndexPath(home), [
    normalizedAccountId,
    ...existing.filter((id) => id !== normalizedAccountId),
  ]);
  selectWeixinAccount(home, normalizedAccountId);
  return account;
}

export function loadSelectedWeixinAccountId(home: string): string | null {
  const selected = readJson<{ accountId?: string }>(selectedAccountPath(home));
  const normalizedAccountId = selected?.accountId?.trim();
  if (!normalizedAccountId) {
    return null;
  }
  if (!listWeixinAccountIds(home).includes(normalizedAccountId)) {
    return null;
  }
  if (readJson<WeixinAccount>(accountPath(home, normalizedAccountId)) === null) {
    return null;
  }
  return normalizedAccountId;
}

export function selectWeixinAccount(home: string, accountId: string): WeixinAccount {
  const normalizedAccountId = normalizeWeixinAccountId(accountId);
  const account = readJson<WeixinAccount>(accountPath(home, normalizedAccountId));
  if (account === null) {
    throw new Error(`微信账号不存在：${accountId}`);
  }
  atomicJsonWrite(selectedAccountPath(home), {
    accountId: normalizedAccountId,
    selectedAt: new Date().toISOString(),
  });
  return account;
}

export function resolvePreferredWeixinAccountId(home: string, accountId?: string): string | null {
  if (accountId !== undefined && accountId.trim().length > 0) {
    return normalizeWeixinAccountId(accountId);
  }
  const selected = loadSelectedWeixinAccountId(home);
  if (selected !== null) {
    return selected;
  }
  return resolveMostRecentWeixinAccountId(home);
}

export function loadWeixinAccount(home: string, accountId?: string): WeixinAccount | null {
  const normalizedAccountId = resolvePreferredWeixinAccountId(home, accountId);
  if (normalizedAccountId === null) {
    return null;
  }
  const account = readJson<WeixinAccount>(accountPath(home, normalizedAccountId));
  if (account !== null) {
    return account;
  }
  return null;
}

export function loadSyncBuf(home: string, normalizedAccountId: string): string {
  return (
    readJson<{ get_updates_buf?: string }>(syncPath(home, normalizedAccountId))?.get_updates_buf ??
    ""
  );
}

export function saveSyncBuf(
  home: string,
  normalizedAccountId: string,
  getUpdatesBuf: string,
): void {
  atomicJsonWrite(syncPath(home, normalizedAccountId), { get_updates_buf: getUpdatesBuf });
}

export function loadContextTokens(
  home: string,
  normalizedAccountId: string,
): Record<string, string> {
  const tokens = readJson<Record<string, unknown>>(contextTokenPath(home, normalizedAccountId));
  if (tokens === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(tokens).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}

export function saveContextToken(
  home: string,
  normalizedAccountId: string,
  peerId: string,
  contextToken: string,
): void {
  if (!peerId || !contextToken) {
    return;
  }
  const tokens = loadContextTokens(home, normalizedAccountId);
  atomicJsonWrite(contextTokenPath(home, normalizedAccountId), {
    ...tokens,
    [peerId]: contextToken,
  });
}

export function getContextToken(
  home: string,
  normalizedAccountId: string,
  peerId: string,
): string | undefined {
  return loadContextTokens(home, normalizedAccountId)[peerId];
}

export function loadWeixinProcessedMessages(
  home: string,
  normalizedAccountId: string,
): WeixinProcessedMessageRecord[] {
  const raw = readJson<unknown>(processedMessagesPath(home, normalizedAccountId));
  const records =
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as { readonly messages?: unknown }).messages)
      ? (raw as { readonly messages: unknown[] }).messages
      : Array.isArray(raw)
        ? raw
        : [];
  return records.flatMap((item): WeixinProcessedMessageRecord[] => {
    const parsed = parseWeixinProcessedMessageRecord(item);
    return parsed === null ? [] : [parsed];
  });
}

export function claimWeixinMessageForProcessing(
  home: string,
  normalizedAccountId: string,
  input: {
    readonly messageId: string;
    readonly peerId?: string;
    readonly createTimeMs?: number;
    readonly now?: Date;
  },
): { readonly claimed: boolean; readonly existing?: WeixinProcessedMessageRecord } {
  const messageId = input.messageId.trim();
  if (messageId.length === 0) {
    return { claimed: true };
  }
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const current = loadWeixinProcessedMessages(home, normalizedAccountId);
  const existing = current.find((record) => record.messageId === messageId);
  if (existing !== undefined) {
    const claimedAtMs = Date.parse(existing.claimedAt);
    const stale =
      existing.status === "processing" &&
      Number.isFinite(claimedAtMs) &&
      nowMs - claimedAtMs > WEIXIN_STALE_PROCESSING_MESSAGE_MS;
    if (!stale) {
      return { claimed: false, existing };
    }
  }

  const nextRecord: WeixinProcessedMessageRecord = {
    messageId,
    ...(input.peerId === undefined || input.peerId.trim().length === 0
      ? {}
      : { peerId: input.peerId }),
    status: "processing",
    claimedAt: nowIso,
    updatedAt: nowIso,
    ...(input.createTimeMs === undefined ? {} : { createTimeMs: input.createTimeMs }),
  };
  writeWeixinProcessedMessages(home, normalizedAccountId, [
    nextRecord,
    ...current.filter((record) => record.messageId !== messageId),
  ]);
  return { claimed: true };
}

export function markWeixinMessageProcessed(
  home: string,
  normalizedAccountId: string,
  input: {
    readonly messageId: string;
    readonly result: "sent" | "ignored";
    readonly now?: Date;
  },
): void {
  updateWeixinProcessedMessage(home, normalizedAccountId, input.messageId, {
    status: input.result,
    result: input.result,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });
}

export function markWeixinMessageProcessingFailed(
  home: string,
  normalizedAccountId: string,
  input: {
    readonly messageId: string;
    readonly failure: string;
    readonly now?: Date;
  },
): void {
  updateWeixinProcessedMessage(home, normalizedAccountId, input.messageId, {
    status: "failed",
    failure: input.failure,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });
}

export function savePeerSession(
  home: string,
  normalizedAccountId: string,
  peerId: string,
  state: PeerDirectorSessionState,
): void {
  if (!peerId) {
    return;
  }
  atomicJsonWrite(peerSessionPath(home, normalizedAccountId, peerId), {
    peerId,
    ...(state.entrySessionId === undefined ? {} : { entrySessionId: state.entrySessionId }),
    ...(state.blueprintId === undefined ? {} : { blueprintId: state.blueprintId }),
    ...(state.runId === undefined ? {} : { runId: state.runId }),
    ...(state.lastObjective === undefined ? {} : { lastObjective: state.lastObjective }),
    ...(state.lastSupplement === undefined ? {} : { lastSupplement: state.lastSupplement }),
    ...(state.pendingSafeRewriteObjective === undefined
      ? {}
      : { pendingSafeRewriteObjective: state.pendingSafeRewriteObjective }),
    pendingApprovalAssignmentIds: [...state.pendingApprovalAssignmentIds],
    updatedAt: state.updatedAt,
  });
}

export function loadPeerSession(
  home: string,
  normalizedAccountId: string,
  peerId: string,
): PeerDirectorSessionState | null {
  const raw = readJson<Record<string, unknown>>(peerSessionPath(home, normalizedAccountId, peerId));
  if (raw === null) {
    return null;
  }
  const entrySessionId = stringField(raw.entrySessionId);
  const blueprintId = stringField(raw.blueprintId);
  const runId = stringField(raw.runId);
  const lastObjective = stringField(raw.lastObjective);
  const lastSupplement = stringField(raw.lastSupplement);
  const pendingSafeRewriteObjective = stringField(raw.pendingSafeRewriteObjective);
  return {
    peerId: stringField(raw.peerId) ?? peerId,
    ...(entrySessionId === undefined ? {} : { entrySessionId }),
    ...(blueprintId === undefined ? {} : { blueprintId }),
    ...(runId === undefined ? {} : { runId }),
    ...(lastObjective === undefined ? {} : { lastObjective }),
    ...(lastSupplement === undefined ? {} : { lastSupplement }),
    ...(pendingSafeRewriteObjective === undefined ? {} : { pendingSafeRewriteObjective }),
    pendingApprovalAssignmentIds: stringArrayField(raw.pendingApprovalAssignmentIds),
    updatedAt: stringField(raw.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function loadPeerConversationTurns(
  home: string,
  normalizedAccountId: string,
  peerId: string,
): PeerConversationTurn[] {
  const raw = readJson<unknown>(peerConversationPath(home, normalizedAccountId, peerId));
  const turns = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { turns?: unknown }).turns)
      ? (raw as { turns: unknown[] }).turns
      : [];
  return turns.flatMap((item): PeerConversationTurn[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const text = stringField(record.text);
    const createdAt = stringField(record.createdAt);
    if (role === null || text === undefined || createdAt === undefined) {
      return [];
    }
    const messageId = stringField(record.messageId);
    const transcriptMessages = parsePeerConversationTranscriptMessages(record.transcriptMessages);
    return [
      {
        role,
        text,
        ...(messageId === undefined ? {} : { messageId }),
        ...(transcriptMessages.length === 0 ? {} : { transcriptMessages }),
        createdAt,
      },
    ];
  });
}

export function appendPeerConversationTurn(
  home: string,
  normalizedAccountId: string,
  peerId: string,
  turn: PeerConversationTurn,
  maxTurns = 8,
): PeerConversationTurn[] {
  if (!peerId || !turn.text.trim()) {
    return loadPeerConversationTurns(home, normalizedAccountId, peerId);
  }
  const next = [
    ...loadPeerConversationTurns(home, normalizedAccountId, peerId),
    {
      role: turn.role,
      text: turn.text.trim(),
      ...(turn.messageId === undefined ? {} : { messageId: turn.messageId }),
      ...(turn.transcriptMessages === undefined || turn.transcriptMessages.length === 0
        ? {}
        : { transcriptMessages: turn.transcriptMessages }),
      createdAt: turn.createdAt,
    },
  ].slice(-Math.max(1, maxTurns));
  atomicJsonWrite(peerConversationPath(home, normalizedAccountId, peerId), next);
  return next;
}

export function loadDeliveredWeixinSubagentAnnounceIds(
  home: string,
  normalizedAccountId: string,
  peerId: string,
): string[] {
  const raw = readJson<Record<string, unknown>>(
    deliveredSubagentAnnouncesPath(home, normalizedAccountId, peerId),
  );
  return stringArrayField(raw?.announceIds);
}

export function markWeixinSubagentAnnouncesDelivered(
  home: string,
  normalizedAccountId: string,
  peerId: string,
  announceIds: readonly string[],
): string[] {
  const next = [
    ...new Set([
      ...loadDeliveredWeixinSubagentAnnounceIds(home, normalizedAccountId, peerId),
      ...announceIds.filter((announceId) => announceId.trim().length > 0),
    ]),
  ];
  atomicJsonWrite(deliveredSubagentAnnouncesPath(home, normalizedAccountId, peerId), {
    schemaVersion: "director.weixin.subagent-announces.v1",
    peerId,
    updatedAt: new Date().toISOString(),
    announceIds: next,
  });
  return next;
}

function parsePeerConversationTranscriptMessages(
  value: unknown,
): PeerConversationTranscriptMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): PeerConversationTranscriptMessage[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const role =
      record.role === "user" || record.role === "assistant" || record.role === "tool"
        ? record.role
        : null;
    const content = typeof record.content === "string" ? record.content : "";
    const toolCallId = stringField(record.toolCallId);
    const toolCalls = parsePeerConversationTranscriptToolCalls(record.toolCalls);
    if (
      role === null ||
      (content.trim().length === 0 && toolCallId === undefined && toolCalls.length === 0)
    ) {
      return [];
    }
    const metadata =
      typeof record.metadata === "object" && record.metadata !== null
        ? (record.metadata as Record<string, unknown>)
        : undefined;
    return [
      {
        role,
        content,
        ...(toolCallId === undefined ? {} : { toolCallId }),
        ...(toolCalls.length === 0 ? {} : { toolCalls }),
        ...(metadata === undefined ? {} : { metadata }),
      },
    ];
  });
}

function parsePeerConversationTranscriptToolCalls(
  value: unknown,
): PeerConversationTranscriptToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): PeerConversationTranscriptToolCall[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const id = stringField(record.id);
    const name = stringField(record.name);
    if (id === undefined || name === undefined) {
      return [];
    }
    const args =
      typeof record.args === "object" && record.args !== null
        ? (record.args as Record<string, unknown>)
        : {};
    const metadata =
      typeof record.metadata === "object" && record.metadata !== null
        ? (record.metadata as Record<string, unknown>)
        : undefined;
    return [
      {
        id,
        name,
        args,
        ...(record.readOnly === undefined ? {} : { readOnly: record.readOnly === true }),
        ...(record.requiresApproval === undefined
          ? {}
          : { requiresApproval: record.requiresApproval === true }),
        ...(metadata === undefined ? {} : { metadata }),
      },
    ];
  });
}

export function loadWeixinRuntimeToolApprovals(
  home: string,
  normalizedAccountId: string,
): WeixinRuntimeToolApprovalRecord[] {
  const raw = readJson<unknown>(runtimeToolApprovalPath(home, normalizedAccountId));
  const approvals = Array.isArray(raw)
    ? raw
    : typeof raw === "object" &&
        raw !== null &&
        Array.isArray((raw as { readonly approvals?: unknown }).approvals)
      ? (raw as { readonly approvals: unknown[] }).approvals
      : [];
  return approvals.flatMap((item): WeixinRuntimeToolApprovalRecord[] => {
    if (!isRuntimeToolApprovalRecord(item)) {
      return [];
    }
    return [item];
  });
}

export function saveWeixinRuntimeToolApproval(
  home: string,
  normalizedAccountId: string,
  approval: WeixinRuntimeToolApprovalRecord,
): void {
  const current = loadWeixinRuntimeToolApprovals(home, normalizedAccountId);
  const approvalsById = new Map(current.map((item) => [item.approvalId, item]));
  approvalsById.set(approval.approvalId, approval);
  atomicJsonWrite(runtimeToolApprovalPath(home, normalizedAccountId), {
    schemaVersion: "director.weixin.runtime-tool-approvals.v1",
    updatedAt: new Date().toISOString(),
    approvals: [...approvalsById.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  });
}

export function updateWeixinRuntimeToolApproval(
  home: string,
  normalizedAccountId: string,
  approvalId: string,
  updater: (approval: WeixinRuntimeToolApprovalRecord) => WeixinRuntimeToolApprovalRecord | null,
): WeixinRuntimeToolApprovalRecord | null {
  let updated: WeixinRuntimeToolApprovalRecord | null = null;
  const approvals = loadWeixinRuntimeToolApprovals(home, normalizedAccountId).map((approval) => {
    if (approval.approvalId !== approvalId) {
      return approval;
    }
    updated = updater(approval);
    return updated ?? approval;
  });
  if (updated !== null) {
    atomicJsonWrite(runtimeToolApprovalPath(home, normalizedAccountId), {
      schemaVersion: "director.weixin.runtime-tool-approvals.v1",
      updatedAt: new Date().toISOString(),
      approvals,
    });
  }
  return updated;
}

export function expireWeixinRuntimeToolApprovals(
  home: string,
  normalizedAccountId: string,
  options: {
    readonly now?: string | Date;
    readonly maxAgeMs?: number;
  } = {},
): { readonly expiredCount: number; readonly approvals: WeixinRuntimeToolApprovalRecord[] } {
  const approvals = loadWeixinRuntimeToolApprovals(home, normalizedAccountId);
  const nowDate =
    options.now instanceof Date
      ? options.now
      : typeof options.now === "string"
        ? new Date(options.now)
        : new Date();
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) {
    return { expiredCount: 0, approvals };
  }

  let expiredCount = 0;
  const nowIso = nowDate.toISOString();
  const terminalApprovals = approvals.filter((approval) => approval.status === "failed");
  const expirableApprovals = approvals.filter(
    (approval): approval is ExpirableWeixinRuntimeToolApprovalRecord =>
      approval.status !== "failed",
  );
  const result = expireChannelRuntimeToolApprovalRecords(
    expirableApprovals.map((approval) => ({
      ...approval,
      schemaVersion: "director.channel.runtime-tool-approval.v1" as const,
      channel: "personal-weixin",
    })),
    options,
  );
  expiredCount = result.expiredCount;
  const next = result.records.map(
    ({ channel: _channel, schemaVersion: _schemaVersion, ...approval }) => ({
      ...approval,
      schemaVersion: "director.weixin.runtime-tool-approval.v1" as const,
    }),
  );
  const approvalsWithTerminal = [...next, ...terminalApprovals].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  if (expiredCount > 0) {
    atomicJsonWrite(runtimeToolApprovalPath(home, normalizedAccountId), {
      schemaVersion: "director.weixin.runtime-tool-approvals.v1",
      updatedAt: nowIso,
      approvals: approvalsWithTerminal,
    });
  }
  return { expiredCount, approvals: approvalsWithTerminal };
}

export function findPendingWeixinRuntimeToolApproval(
  home: string,
  normalizedAccountId: string,
  peerId?: string,
  options: {
    readonly now?: string | Date;
    readonly maxAgeMs?: number;
  } = {},
): WeixinRuntimeToolApprovalRecord | null {
  expireWeixinRuntimeToolApprovals(home, normalizedAccountId, options);
  const normalizedPeerId =
    peerId === undefined || peerId.trim().length === 0 ? null : normalizeWeixinPeerId(peerId);
  const pending = loadWeixinRuntimeToolApprovals(home, normalizedAccountId).filter(
    (approval) =>
      approval.status === "pending" &&
      (normalizedPeerId === null ||
        normalizeWeixinPeerId(approval.peerId) === normalizedPeerId ||
        (approval.requestedByPeerId !== undefined &&
          normalizeWeixinPeerId(approval.requestedByPeerId) === normalizedPeerId)),
  );
  return pending[0] ?? null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function recordField(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function recordArrayField(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const records: Readonly<Record<string, unknown>>[] = [];
  for (const item of value) {
    const record = recordField(item);
    if (record !== undefined) {
      records.push(record);
    }
  }
  return records;
}

function parseWeixinProcessedMessageRecord(value: unknown): WeixinProcessedMessageRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const messageId = stringField(record.messageId);
  const status = stringField(record.status);
  const claimedAt = stringField(record.claimedAt);
  const updatedAt = stringField(record.updatedAt);
  if (
    messageId === undefined ||
    claimedAt === undefined ||
    updatedAt === undefined ||
    !isWeixinProcessedMessageStatus(status)
  ) {
    return null;
  }
  const peerId = stringField(record.peerId);
  const result =
    record.result === "sent" || record.result === "ignored" ? record.result : undefined;
  const failure = stringField(record.failure);
  const createTimeMs =
    typeof record.createTimeMs === "number" && Number.isFinite(record.createTimeMs)
      ? record.createTimeMs
      : undefined;
  return {
    messageId,
    ...(peerId === undefined ? {} : { peerId }),
    status,
    claimedAt,
    updatedAt,
    ...(createTimeMs === undefined ? {} : { createTimeMs }),
    ...(result === undefined ? {} : { result }),
    ...(failure === undefined ? {} : { failure }),
  };
}

function isWeixinProcessedMessageStatus(
  value: string | undefined,
): value is WeixinProcessedMessageRecord["status"] {
  return value === "processing" || value === "sent" || value === "ignored" || value === "failed";
}

function updateWeixinProcessedMessage(
  home: string,
  normalizedAccountId: string,
  messageId: string,
  patch: Omit<Partial<WeixinProcessedMessageRecord>, "messageId" | "claimedAt">,
): void {
  const trimmed = messageId.trim();
  if (trimmed.length === 0) {
    return;
  }
  const current = loadWeixinProcessedMessages(home, normalizedAccountId);
  const existing = current.find((record) => record.messageId === trimmed);
  const now = new Date().toISOString();
  const nextRecord: WeixinProcessedMessageRecord = {
    messageId: trimmed,
    claimedAt: existing?.claimedAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    status: patch.status ?? existing?.status ?? "processing",
    ...(existing?.peerId === undefined ? {} : { peerId: existing.peerId }),
    ...(existing?.createTimeMs === undefined ? {} : { createTimeMs: existing.createTimeMs }),
    ...(patch.peerId === undefined ? {} : { peerId: patch.peerId }),
    ...(patch.createTimeMs === undefined ? {} : { createTimeMs: patch.createTimeMs }),
    ...(patch.result === undefined ? {} : { result: patch.result }),
    ...(patch.failure === undefined ? {} : { failure: patch.failure }),
  };
  writeWeixinProcessedMessages(home, normalizedAccountId, [
    nextRecord,
    ...current.filter((record) => record.messageId !== trimmed),
  ]);
}

function writeWeixinProcessedMessages(
  home: string,
  normalizedAccountId: string,
  records: readonly WeixinProcessedMessageRecord[],
): void {
  const deduped = new Map<string, WeixinProcessedMessageRecord>();
  for (const record of records) {
    if (!deduped.has(record.messageId)) {
      deduped.set(record.messageId, record);
    }
  }
  const messages = [...deduped.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, WEIXIN_PROCESSED_MESSAGE_MAX_RECORDS);
  atomicJsonWrite(processedMessagesPath(home, normalizedAccountId), {
    schemaVersion: "director.weixin.processed-messages.v1",
    updatedAt: new Date().toISOString(),
    messages,
  });
}

function isRuntimeToolApprovalRecord(value: unknown): value is WeixinRuntimeToolApprovalRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === "director.weixin.runtime-tool-approval.v1" &&
    typeof record.approvalId === "string" &&
    ["pending", "approved", "rejected", "failed", "expired"].includes(String(record.status)) &&
    typeof record.peerId === "string" &&
    typeof record.toolName === "string" &&
    isRuntimeToolCall(record.toolCall) &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

function isRuntimeToolCall(value: unknown): value is WeixinRuntimeToolApprovalRecord["toolCall"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.args === "object" &&
    record.args !== null &&
    !Array.isArray(record.args)
  );
}

export function clearWeixinAccount(home: string, normalizedAccountId: string): void {
  for (const path of [
    accountPath(home, normalizedAccountId),
    syncPath(home, normalizedAccountId),
    contextTokenPath(home, normalizedAccountId),
  ]) {
    try {
      unlinkSync(path);
    } catch {
      // ignore missing files
    }
  }
  const remaining = listWeixinAccountIds(home).filter((id) => id !== normalizedAccountId);
  atomicJsonWrite(accountIndexPath(home), remaining);
  if (loadSelectedWeixinAccountId(home) === null) {
    const next = resolveMostRecentWeixinAccountId(home);
    if (next !== null) {
      selectWeixinAccount(home, next);
    } else {
      try {
        unlinkSync(selectedAccountPath(home));
      } catch {
        // ignore missing files
      }
    }
  }
}

function resolveMostRecentWeixinAccountId(home: string): string | null {
  const accounts = listWeixinAccountIds(home)
    .map((id, index) => {
      const account = readJson<WeixinAccount>(accountPath(home, id));
      const savedAt = Date.parse(account?.savedAt ?? "");
      return {
        id,
        index,
        savedAt: Number.isFinite(savedAt) ? savedAt : 0,
        exists: account !== null,
      };
    })
    .filter((item) => item.exists);
  accounts.sort((a, b) => b.savedAt - a.savedAt || a.index - b.index);
  return accounts[0]?.id ?? null;
}
