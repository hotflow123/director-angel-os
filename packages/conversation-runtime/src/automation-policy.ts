import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONVERSATION_RUNTIME_AUTOMATION_POLICY_SCHEMA_VERSION =
  "conversation-runtime.automation-policy.v1" as const;

export const CONVERSATION_RUNTIME_AUTOMATION_POLICY_STORE_SCHEMA_VERSION =
  "conversation-runtime.automation-policy-store.v1" as const;

export type ConversationRuntimeAutomationMode = "cautious" | "assisted" | "autopilot";
export type ConversationRuntimeAutomationRiskLevel = "low" | "medium" | "high" | "critical";
export type ConversationRuntimeAutomationDecisionStatus = "allowed" | "requires_approval";

export interface ConversationRuntimeAutomationPolicyScope {
  readonly roles?: readonly string[];
  readonly sourceDomains?: readonly string[];
  readonly toolNames?: readonly string[];
  readonly mediaTypes?: readonly string[];
  readonly memoryKinds?: readonly string[];
  readonly candidateTags?: readonly string[];
  readonly actionKinds?: readonly string[];
}

export interface ConversationRuntimeAutomationPolicyBudget {
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
  readonly maxOperations?: number;
}

export interface ConversationRuntimeAutomationPolicy {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_AUTOMATION_POLICY_SCHEMA_VERSION;
  readonly policyId: string;
  readonly mode: ConversationRuntimeAutomationMode;
  readonly enabled: boolean;
  readonly scope?: ConversationRuntimeAutomationPolicyScope;
  readonly budget?: ConversationRuntimeAutomationPolicyBudget;
  readonly riskLevelAllowed?: ConversationRuntimeAutomationRiskLevel;
  readonly expiresAtMs?: number;
  readonly requiresAudit?: boolean;
  readonly rollbackPolicy?: "manual" | "automatic" | "none" | (string & {});
  readonly revokedAtMs?: number;
}

export interface ConversationRuntimeAutomationAction {
  readonly kind: string;
  readonly riskLevel: ConversationRuntimeAutomationRiskLevel;
  readonly role?: string;
  readonly sourceUrl?: string;
  readonly toolName?: string;
  readonly mediaType?: string;
  readonly memoryKind?: string;
  readonly candidateTags?: readonly string[];
  readonly estimatedTokens?: number;
  readonly estimatedCostUsd?: number;
  readonly operationCount?: number;
}

export interface ConversationRuntimeAutomationPolicyEvaluationInput {
  readonly nowMs: number;
  readonly action: ConversationRuntimeAutomationAction;
  readonly policies: readonly ConversationRuntimeAutomationPolicy[];
}

export interface ConversationRuntimeAutomationPolicyDecision {
  readonly status: ConversationRuntimeAutomationDecisionStatus;
  readonly reason: string;
  readonly policyId?: string;
  readonly mode?: ConversationRuntimeAutomationMode;
  readonly requiresAudit?: boolean;
  readonly riskLevelAllowed?: ConversationRuntimeAutomationRiskLevel;
}

export interface ConversationRuntimeAutomationPolicyStore {
  readonly listPolicies: () => readonly ConversationRuntimeAutomationPolicy[];
  readonly upsertPolicy: (input: {
    readonly policy: ConversationRuntimeAutomationPolicy;
  }) => ConversationRuntimeAutomationPolicy;
  readonly revokePolicy: (policyId: string) => ConversationRuntimeAutomationPolicy | undefined;
}

export interface FileConversationRuntimeAutomationPolicyStoreOptions {
  readonly rootPath: string;
  readonly nowMs?: () => number;
}

interface ConversationRuntimeAutomationPolicyStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_AUTOMATION_POLICY_STORE_SCHEMA_VERSION;
  readonly updatedAtMs: number;
  readonly policies: readonly ConversationRuntimeAutomationPolicy[];
}

const AUTOMATION_POLICY_STORE_FILE = "automation-policies.json";
const RISK_LEVEL_ORDER: Readonly<Record<ConversationRuntimeAutomationRiskLevel, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function evaluateConversationRuntimeAutomationPolicy(
  input: ConversationRuntimeAutomationPolicyEvaluationInput,
): ConversationRuntimeAutomationPolicyDecision {
  const activePolicies = input.policies.filter((policy) =>
    isAutomationPolicyActive(policy, input.nowMs),
  );
  if (activePolicies.length === 0) {
    return { status: "requires_approval", reason: "automation-policy-not-configured" };
  }

  for (const policy of activePolicies) {
    if (!automationPolicyScopeMatches(policy.scope, input.action)) {
      continue;
    }
    if (policy.mode === "cautious") {
      return createRequiresApprovalDecision(policy, "automation-policy-cautious-mode");
    }
    if (!automationRiskAllowed(policy, input.action.riskLevel)) {
      return createRequiresApprovalDecision(policy, "automation-policy-risk-exceeded");
    }
    if (!automationBudgetAllowed(policy.budget, input.action)) {
      return createRequiresApprovalDecision(policy, "automation-policy-budget-exceeded");
    }
    return {
      status: "allowed",
      reason: "automation-policy-matched",
      policyId: policy.policyId,
      mode: policy.mode,
      requiresAudit: policy.requiresAudit === true,
      riskLevelAllowed: policy.riskLevelAllowed ?? defaultRiskLevelForMode(policy.mode),
    };
  }

  return { status: "requires_approval", reason: "automation-policy-scope-not-matched" };
}

export function createFileConversationRuntimeAutomationPolicyStore(
  options: FileConversationRuntimeAutomationPolicyStoreOptions,
): ConversationRuntimeAutomationPolicyStore {
  return new FileConversationRuntimeAutomationPolicyStore(options.rootPath, options.nowMs);
}

class FileConversationRuntimeAutomationPolicyStore
  implements ConversationRuntimeAutomationPolicyStore
{
  private readonly nowMs;

  public constructor(
    private readonly rootPath: string,
    nowMs?: () => number,
  ) {
    this.nowMs = nowMs ?? (() => Date.now());
  }

  public listPolicies(): readonly ConversationRuntimeAutomationPolicy[] {
    return this.readDocument().policies;
  }

  public upsertPolicy(input: {
    readonly policy: ConversationRuntimeAutomationPolicy;
  }): ConversationRuntimeAutomationPolicy {
    const document = this.readDocument();
    const policiesById = new Map(document.policies.map((policy) => [policy.policyId, policy]));
    policiesById.set(input.policy.policyId, input.policy);
    this.writeDocument([...policiesById.values()]);
    return input.policy;
  }

  public revokePolicy(policyId: string): ConversationRuntimeAutomationPolicy | undefined {
    const document = this.readDocument();
    let revoked: ConversationRuntimeAutomationPolicy | undefined;
    const policies = document.policies.map((policy) => {
      if (policy.policyId !== policyId) {
        return policy;
      }
      revoked = {
        ...policy,
        enabled: false,
        revokedAtMs: this.nowMs(),
      };
      return revoked;
    });
    if (revoked === undefined) {
      return undefined;
    }
    this.writeDocument(policies);
    return revoked;
  }

  private readDocument(): ConversationRuntimeAutomationPolicyStoreDocument {
    const path = this.storePath();
    if (!existsSync(path)) {
      return this.emptyDocument();
    }
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!isRecord(raw) || !Array.isArray(raw.policies)) {
        return this.emptyDocument();
      }
      return {
        schemaVersion: CONVERSATION_RUNTIME_AUTOMATION_POLICY_STORE_SCHEMA_VERSION,
        updatedAtMs: readFiniteNumber(raw.updatedAtMs) ?? this.nowMs(),
        policies: raw.policies.flatMap((policy) => parseAutomationPolicy(policy)),
      };
    } catch {
      return this.emptyDocument();
    }
  }

  private writeDocument(policies: readonly ConversationRuntimeAutomationPolicy[]): void {
    mkdirSync(this.rootPath, { recursive: true });
    const document: ConversationRuntimeAutomationPolicyStoreDocument = {
      schemaVersion: CONVERSATION_RUNTIME_AUTOMATION_POLICY_STORE_SCHEMA_VERSION,
      updatedAtMs: this.nowMs(),
      policies: [...policies].sort((left, right) => left.policyId.localeCompare(right.policyId)),
    };
    const target = this.storePath();
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    renameSync(tmp, target);
  }

  private emptyDocument(): ConversationRuntimeAutomationPolicyStoreDocument {
    return {
      schemaVersion: CONVERSATION_RUNTIME_AUTOMATION_POLICY_STORE_SCHEMA_VERSION,
      updatedAtMs: this.nowMs(),
      policies: [],
    };
  }

  private storePath(): string {
    return join(this.rootPath, AUTOMATION_POLICY_STORE_FILE);
  }
}

function isAutomationPolicyActive(
  policy: ConversationRuntimeAutomationPolicy,
  nowMs: number,
): boolean {
  return (
    policy.enabled === true &&
    policy.revokedAtMs === undefined &&
    (policy.expiresAtMs === undefined || policy.expiresAtMs > nowMs)
  );
}

function automationRiskAllowed(
  policy: ConversationRuntimeAutomationPolicy,
  riskLevel: ConversationRuntimeAutomationRiskLevel,
): boolean {
  const allowed = policy.riskLevelAllowed ?? defaultRiskLevelForMode(policy.mode);
  return RISK_LEVEL_ORDER[riskLevel] <= RISK_LEVEL_ORDER[allowed];
}

function defaultRiskLevelForMode(
  mode: ConversationRuntimeAutomationMode,
): ConversationRuntimeAutomationRiskLevel {
  if (mode === "autopilot") {
    return "medium";
  }
  return "low";
}

function automationBudgetAllowed(
  budget: ConversationRuntimeAutomationPolicyBudget | undefined,
  action: ConversationRuntimeAutomationAction,
): boolean {
  if (budget === undefined) {
    return true;
  }
  if (
    budget.maxTokens !== undefined &&
    (action.estimatedTokens ?? 0) > Math.max(0, budget.maxTokens)
  ) {
    return false;
  }
  if (
    budget.maxCostUsd !== undefined &&
    (action.estimatedCostUsd ?? 0) > Math.max(0, budget.maxCostUsd)
  ) {
    return false;
  }
  if (
    budget.maxOperations !== undefined &&
    (action.operationCount ?? 1) > Math.max(0, budget.maxOperations)
  ) {
    return false;
  }
  return true;
}

function automationPolicyScopeMatches(
  scope: ConversationRuntimeAutomationPolicyScope | undefined,
  action: ConversationRuntimeAutomationAction,
): boolean {
  if (scope === undefined) {
    return true;
  }
  return (
    matchesOptionalString(scope.actionKinds, action.kind) &&
    matchesOptionalString(scope.roles, action.role) &&
    matchesOptionalDomain(scope.sourceDomains, action.sourceUrl) &&
    matchesOptionalString(scope.toolNames, action.toolName) &&
    matchesOptionalString(scope.mediaTypes, action.mediaType) &&
    matchesOptionalString(scope.memoryKinds, action.memoryKind) &&
    matchesOptionalIntersection(scope.candidateTags, action.candidateTags)
  );
}

function matchesOptionalString(
  expected: readonly string[] | undefined,
  actual: string | undefined,
): boolean {
  if (expected === undefined || expected.length === 0) {
    return true;
  }
  if (actual === undefined) {
    return false;
  }
  const normalizedActual = normalizeToken(actual);
  return expected.some((item) => normalizeToken(item) === normalizedActual);
}

function matchesOptionalIntersection(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
): boolean {
  if (expected === undefined || expected.length === 0) {
    return true;
  }
  if (actual === undefined || actual.length === 0) {
    return false;
  }
  const actualTokens = new Set(actual.map(normalizeToken));
  return expected.some((item) => actualTokens.has(normalizeToken(item)));
}

function matchesOptionalDomain(
  expected: readonly string[] | undefined,
  sourceUrl: string | undefined,
): boolean {
  if (expected === undefined || expected.length === 0) {
    return true;
  }
  const hostname = readHostname(sourceUrl);
  if (hostname === undefined) {
    return false;
  }
  return expected.some((domain) => {
    const normalized = normalizeHostname(domain);
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function createRequiresApprovalDecision(
  policy: ConversationRuntimeAutomationPolicy,
  reason: string,
): ConversationRuntimeAutomationPolicyDecision {
  return {
    status: "requires_approval",
    reason,
    policyId: policy.policyId,
    mode: policy.mode,
    requiresAudit: policy.requiresAudit === true,
    riskLevelAllowed: policy.riskLevelAllowed ?? defaultRiskLevelForMode(policy.mode),
  };
}

function parseAutomationPolicy(value: unknown): ConversationRuntimeAutomationPolicy[] {
  if (!isRecord(value)) {
    return [];
  }
  const policyId = readString(value.policyId);
  const mode = parseAutomationMode(value.mode);
  if (policyId === undefined || mode === undefined) {
    return [];
  }
  const scope = parseAutomationPolicyScope(value.scope);
  const budget = parseAutomationPolicyBudget(value.budget);
  const riskLevelAllowed = parseAutomationRiskLevel(value.riskLevelAllowed);
  const expiresAtMs = readFiniteNumber(value.expiresAtMs);
  const rollbackPolicy = readString(value.rollbackPolicy) as
    | ConversationRuntimeAutomationPolicy["rollbackPolicy"]
    | undefined;
  const revokedAtMs = readFiniteNumber(value.revokedAtMs);
  const policy: ConversationRuntimeAutomationPolicy = {
    schemaVersion: CONVERSATION_RUNTIME_AUTOMATION_POLICY_SCHEMA_VERSION,
    policyId,
    mode,
    enabled: value.enabled === true,
    ...(scope === undefined ? {} : { scope }),
    ...(budget === undefined ? {} : { budget }),
    ...(riskLevelAllowed === undefined ? {} : { riskLevelAllowed }),
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
    ...(typeof value.requiresAudit === "boolean" ? { requiresAudit: value.requiresAudit } : {}),
    ...(rollbackPolicy === undefined ? {} : { rollbackPolicy }),
    ...(revokedAtMs === undefined ? {} : { revokedAtMs }),
  };
  return [policy];
}

function parseAutomationPolicyScope(
  value: unknown,
): ConversationRuntimeAutomationPolicyScope | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const roles = readStringArray(value.roles);
  const sourceDomains = readStringArray(value.sourceDomains);
  const toolNames = readStringArray(value.toolNames);
  const mediaTypes = readStringArray(value.mediaTypes);
  const memoryKinds = readStringArray(value.memoryKinds);
  const candidateTags = readStringArray(value.candidateTags);
  const actionKinds = readStringArray(value.actionKinds);
  return {
    ...(roles === undefined ? {} : { roles }),
    ...(sourceDomains === undefined ? {} : { sourceDomains }),
    ...(toolNames === undefined ? {} : { toolNames }),
    ...(mediaTypes === undefined ? {} : { mediaTypes }),
    ...(memoryKinds === undefined ? {} : { memoryKinds }),
    ...(candidateTags === undefined ? {} : { candidateTags }),
    ...(actionKinds === undefined ? {} : { actionKinds }),
  };
}

function parseAutomationPolicyBudget(
  value: unknown,
): ConversationRuntimeAutomationPolicyBudget | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const maxTokens = readFiniteNumber(value.maxTokens);
  const maxCostUsd = readFiniteNumber(value.maxCostUsd);
  const maxOperations = readFiniteNumber(value.maxOperations);
  return {
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    ...(maxOperations === undefined ? {} : { maxOperations }),
  };
}

function parseAutomationMode(value: unknown): ConversationRuntimeAutomationMode | undefined {
  return value === "cautious" || value === "assisted" || value === "autopilot" ? value : undefined;
}

function parseAutomationRiskLevel(
  value: unknown,
): ConversationRuntimeAutomationRiskLevel | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.flatMap((item): string[] => {
    const text = readString(item);
    return text === undefined ? [] : [text];
  });
  return items.length === 0 ? undefined : items;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readHostname(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return normalizeHostname(new URL(value).hostname);
  } catch {
    return undefined;
  }
}

function normalizeHostname(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^\./u, "");
}

function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
