import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONVERSATION_RUNTIME_APPROVAL_LEDGER_RECORD_SCHEMA_VERSION =
  "conversation-runtime.approval-ledger-record.v1" as const;

export const CONVERSATION_RUNTIME_APPROVAL_LEDGER_STORE_SCHEMA_VERSION =
  "conversation-runtime.approval-ledger-store.v1" as const;

export type ConversationRuntimeApprovalDecision = "approved" | "rejected";
export type ConversationRuntimeApprovalScope =
  | "persistent"
  | "session"
  | "single_operation"
  | (string & {});
export type ConversationRuntimeApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "revoked"
  | "failed";

export interface ConversationRuntimeApprovalBinding {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly toolCallId: string;
  readonly argsHash: string;
}

export interface ConversationRuntimeApprovalLedgerRecord
  extends ConversationRuntimeApprovalBinding {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_APPROVAL_LEDGER_RECORD_SCHEMA_VERSION;
  readonly approvalId: string;
  readonly status: ConversationRuntimeApprovalStatus;
  readonly scope: ConversationRuntimeApprovalScope;
  readonly toolId: string;
  readonly operationId: string;
  readonly redactedPayloadHash: string;
  readonly candidateId?: string;
  readonly requestedByChannel: string;
  readonly requestedAtMs: number;
  readonly expiresAtMs: number;
  readonly resolvedByChannel?: string;
  readonly resolvedAtMs?: number;
  readonly automationPolicyId?: string;
  readonly autoResolvedReason?: string;
  readonly failureReason?: string;
}

export interface ConversationRuntimeApprovalLedgerResolveInput {
  readonly approvalId: string;
  readonly decision: ConversationRuntimeApprovalDecision;
  readonly resolvedByChannel: string;
  readonly binding: ConversationRuntimeApprovalBinding;
}

export type ConversationRuntimeApprovalLedgerResolveResult =
  | {
      readonly ok: true;
      readonly approval: ConversationRuntimeApprovalLedgerRecord;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "approval-not-found"
        | "approval-not-pending"
        | "approval-expired"
        | "approval-binding-mismatch";
      readonly approval?: ConversationRuntimeApprovalLedgerRecord;
    };

export interface ConversationRuntimeApprovalLedgerRevokeInput {
  readonly approvalId: string;
  readonly revokedByChannel: string;
  readonly reason?: string;
}

export type ConversationRuntimeApprovalLedgerRevokeResult =
  | {
      readonly ok: true;
      readonly approval: ConversationRuntimeApprovalLedgerRecord;
    }
  | {
      readonly ok: false;
      readonly reason: "approval-not-found" | "approval-not-pending";
      readonly approval?: ConversationRuntimeApprovalLedgerRecord;
    };

export interface ConversationRuntimeApprovalLedgerExpireResult {
  readonly expiredApprovalIds: readonly string[];
}

export interface ConversationRuntimeApprovalLedger {
  readonly listApprovals: () => readonly ConversationRuntimeApprovalLedgerRecord[];
  readonly upsertApproval: (input: {
    readonly approval: ConversationRuntimeApprovalLedgerRecord;
  }) => ConversationRuntimeApprovalLedgerRecord;
  readonly resolveApproval: (
    input: ConversationRuntimeApprovalLedgerResolveInput,
  ) => ConversationRuntimeApprovalLedgerResolveResult;
  readonly revokeApproval: (
    input: ConversationRuntimeApprovalLedgerRevokeInput,
  ) => ConversationRuntimeApprovalLedgerRevokeResult;
  readonly expirePendingApprovals: () => ConversationRuntimeApprovalLedgerExpireResult;
}

export interface FileConversationRuntimeApprovalLedgerOptions {
  readonly rootPath: string;
  readonly nowMs?: () => number;
}

interface ConversationRuntimeApprovalLedgerStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_APPROVAL_LEDGER_STORE_SCHEMA_VERSION;
  readonly updatedAtMs: number;
  readonly approvals: readonly ConversationRuntimeApprovalLedgerRecord[];
}

const APPROVAL_LEDGER_STORE_FILE = "approval-ledger.json";

export function createFileConversationRuntimeApprovalLedger(
  options: FileConversationRuntimeApprovalLedgerOptions,
): ConversationRuntimeApprovalLedger {
  return new FileConversationRuntimeApprovalLedger(options.rootPath, options.nowMs);
}

class FileConversationRuntimeApprovalLedger implements ConversationRuntimeApprovalLedger {
  private readonly nowMs;

  public constructor(
    private readonly rootPath: string,
    nowMs?: () => number,
  ) {
    this.nowMs = nowMs ?? (() => Date.now());
  }

  public listApprovals(): readonly ConversationRuntimeApprovalLedgerRecord[] {
    return this.readDocument().approvals;
  }

  public upsertApproval(input: {
    readonly approval: ConversationRuntimeApprovalLedgerRecord;
  }): ConversationRuntimeApprovalLedgerRecord {
    const document = this.readDocument();
    const approvalsById = new Map(
      document.approvals.map((approval) => [approval.approvalId, approval]),
    );
    approvalsById.set(input.approval.approvalId, input.approval);
    this.writeDocument([...approvalsById.values()]);
    return input.approval;
  }

  public resolveApproval(
    input: ConversationRuntimeApprovalLedgerResolveInput,
  ): ConversationRuntimeApprovalLedgerResolveResult {
    const document = this.readDocument();
    const approval = document.approvals.find((item) => item.approvalId === input.approvalId);
    if (approval === undefined) {
      return { ok: false, reason: "approval-not-found" };
    }
    if (approval.status !== "pending") {
      return { ok: false, reason: "approval-not-pending", approval };
    }
    if (approval.expiresAtMs <= this.nowMs()) {
      return { ok: false, reason: "approval-expired", approval };
    }
    if (!approvalBindingMatches(approval, input.binding)) {
      return { ok: false, reason: "approval-binding-mismatch", approval };
    }
    const resolved: ConversationRuntimeApprovalLedgerRecord = {
      ...approval,
      status: input.decision,
      resolvedByChannel: input.resolvedByChannel,
      resolvedAtMs: this.nowMs(),
    };
    this.upsertApproval({ approval: resolved });
    return { ok: true, approval: resolved };
  }

  public revokeApproval(
    input: ConversationRuntimeApprovalLedgerRevokeInput,
  ): ConversationRuntimeApprovalLedgerRevokeResult {
    const document = this.readDocument();
    const approval = document.approvals.find((item) => item.approvalId === input.approvalId);
    if (approval === undefined) {
      return { ok: false, reason: "approval-not-found" };
    }
    if (approval.status !== "pending") {
      return { ok: false, reason: "approval-not-pending", approval };
    }
    const revoked: ConversationRuntimeApprovalLedgerRecord = {
      ...approval,
      status: "revoked",
      resolvedByChannel: input.revokedByChannel,
      resolvedAtMs: this.nowMs(),
      ...(input.reason === undefined ? {} : { failureReason: input.reason }),
    };
    this.upsertApproval({ approval: revoked });
    return { ok: true, approval: revoked };
  }

  public expirePendingApprovals(): ConversationRuntimeApprovalLedgerExpireResult {
    const document = this.readDocument();
    const nowMs = this.nowMs();
    const expiredApprovalIds: string[] = [];
    const approvals = document.approvals.map((approval) => {
      if (approval.status !== "pending" || approval.expiresAtMs > nowMs) {
        return approval;
      }
      expiredApprovalIds.push(approval.approvalId);
      return {
        ...approval,
        status: "expired" as const,
        resolvedAtMs: nowMs,
      };
    });
    if (expiredApprovalIds.length > 0) {
      this.writeDocument(approvals);
    }
    return { expiredApprovalIds };
  }

  private readDocument(): ConversationRuntimeApprovalLedgerStoreDocument {
    const path = this.storePath();
    if (!existsSync(path)) {
      return this.emptyDocument();
    }
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!isRecord(raw) || !Array.isArray(raw.approvals)) {
        return this.emptyDocument();
      }
      return {
        schemaVersion: CONVERSATION_RUNTIME_APPROVAL_LEDGER_STORE_SCHEMA_VERSION,
        updatedAtMs: readFiniteNumber(raw.updatedAtMs) ?? this.nowMs(),
        approvals: raw.approvals.flatMap((approval) => parseApprovalRecord(approval)),
      };
    } catch {
      return this.emptyDocument();
    }
  }

  private writeDocument(approvals: readonly ConversationRuntimeApprovalLedgerRecord[]): void {
    mkdirSync(this.rootPath, { recursive: true });
    const document: ConversationRuntimeApprovalLedgerStoreDocument = {
      schemaVersion: CONVERSATION_RUNTIME_APPROVAL_LEDGER_STORE_SCHEMA_VERSION,
      updatedAtMs: this.nowMs(),
      approvals: [...approvals].sort((left, right) =>
        left.approvalId.localeCompare(right.approvalId),
      ),
    };
    const target = this.storePath();
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    renameSync(tmp, target);
  }

  private emptyDocument(): ConversationRuntimeApprovalLedgerStoreDocument {
    return {
      schemaVersion: CONVERSATION_RUNTIME_APPROVAL_LEDGER_STORE_SCHEMA_VERSION,
      updatedAtMs: this.nowMs(),
      approvals: [],
    };
  }

  private storePath(): string {
    return join(this.rootPath, APPROVAL_LEDGER_STORE_FILE);
  }
}

function approvalBindingMatches(
  approval: ConversationRuntimeApprovalBinding,
  binding: ConversationRuntimeApprovalBinding,
): boolean {
  return (
    approval.turnId === binding.turnId &&
    approval.sessionKey === binding.sessionKey &&
    approval.toolCallId === binding.toolCallId &&
    approval.argsHash === binding.argsHash
  );
}

function parseApprovalRecord(value: unknown): ConversationRuntimeApprovalLedgerRecord[] {
  if (!isRecord(value)) {
    return [];
  }
  const approvalId = readString(value.approvalId);
  const status = parseApprovalStatus(value.status);
  const turnId = readString(value.turnId);
  const sessionKey = readString(value.sessionKey);
  const toolCallId = readString(value.toolCallId);
  const argsHash = readString(value.argsHash);
  const requestedByChannel = readString(value.requestedByChannel);
  const requestedAtMs = readFiniteNumber(value.requestedAtMs);
  const expiresAtMs = readFiniteNumber(value.expiresAtMs);
  const toolId = readString(value.toolId) ?? inferApprovalToolId(toolCallId) ?? "unknown";
  const operationId =
    readString(value.operationId) ?? inferApprovalOperationId(toolCallId) ?? toolCallId;
  const redactedPayloadHash = readString(value.redactedPayloadHash) ?? argsHash;
  const scope = readString(value.scope) ?? "single_operation";
  if (
    approvalId === undefined ||
    status === undefined ||
    turnId === undefined ||
    sessionKey === undefined ||
    toolCallId === undefined ||
    argsHash === undefined ||
    toolId === undefined ||
    operationId === undefined ||
    redactedPayloadHash === undefined ||
    requestedByChannel === undefined ||
    requestedAtMs === undefined ||
    expiresAtMs === undefined
  ) {
    return [];
  }
  const candidateId = readString(value.candidateId);
  const resolvedByChannel = readString(value.resolvedByChannel);
  const resolvedAtMs = readFiniteNumber(value.resolvedAtMs);
  const automationPolicyId = readString(value.automationPolicyId);
  const autoResolvedReason = readString(value.autoResolvedReason);
  const failureReason = readString(value.failureReason);
  return [
    {
      schemaVersion: CONVERSATION_RUNTIME_APPROVAL_LEDGER_RECORD_SCHEMA_VERSION,
      approvalId,
      status,
      turnId,
      sessionKey,
      toolCallId,
      argsHash,
      scope,
      toolId,
      operationId,
      redactedPayloadHash,
      requestedByChannel,
      requestedAtMs,
      expiresAtMs,
      ...(candidateId === undefined ? {} : { candidateId }),
      ...(resolvedByChannel === undefined ? {} : { resolvedByChannel }),
      ...(resolvedAtMs === undefined ? {} : { resolvedAtMs }),
      ...(automationPolicyId === undefined ? {} : { automationPolicyId }),
      ...(autoResolvedReason === undefined ? {} : { autoResolvedReason }),
      ...(failureReason === undefined ? {} : { failureReason }),
    },
  ];
}

function inferApprovalToolId(toolCallId: string | undefined): string | undefined {
  if (toolCallId === undefined) {
    return undefined;
  }
  const [toolId] = toolCallId.split(":");
  return toolId;
}

function inferApprovalOperationId(toolCallId: string | undefined): string | undefined {
  if (toolCallId === undefined) {
    return undefined;
  }
  const [, ...operationParts] = toolCallId.split(":");
  return operationParts.length > 0 ? operationParts.join(":") : undefined;
}

function parseApprovalStatus(value: unknown): ConversationRuntimeApprovalStatus | undefined {
  return value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "expired" ||
    value === "revoked" ||
    value === "failed"
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
