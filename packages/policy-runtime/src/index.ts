import {
  AGENT_OS_SANDBOX_MODES,
  type AgentOsSandboxMode,
  type AgentOsSandboxPreflight,
  isAgentOsSandboxPreflight,
} from "@hotflow/agent-os-kernel-contracts";
import {
  type RuntimeDegradeReason,
  type RuntimeDegradeSeverity,
  type RuntimeDegradeSurface,
  createRuntimeDegradeSurface,
} from "@hotflow/contracts";

export type PolicyVerdict = "allow" | "deny" | "ask" | "degrade";
export type ToolCapability = string;
export type ToolRiskLevel = "low" | "medium" | "high" | "critical";
export type ToolApprovalStatus = "approved" | "rejected" | "pending" | "not-required";
export type ExecutionPolicyNetworkAccess = "none" | "limited" | "full";

export interface ToolCapabilityProfile {
  toolName?: string;
  capabilities?: readonly ToolCapability[];
  riskLevel?: ToolRiskLevel;
  requiresApproval?: boolean;
}

export interface ToolApprovalContext {
  status: ToolApprovalStatus;
  approver?: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyInput {
  action: string;
  resource?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
  capabilityProfile?: ToolCapabilityProfile;
  approval?: ToolApprovalContext;
}

export interface ToolPolicyInput {
  toolName: string;
  actor?: string;
  metadata?: Record<string, unknown>;
  capabilityProfile?: ToolCapabilityProfile;
  approval?: ToolApprovalContext;
}

export interface PolicyDecision {
  verdict: PolicyVerdict;
  reason: string;
  ruleId?: string;
  degradedCapabilities?: readonly ToolCapability[];
  degradation?: RuntimeDegradeSurface;
  metadata?: Record<string, unknown>;
}

export type PolicyDecisionOrigin = "default" | "rule" | "execution-policy" | "merged";

export interface PolicyExecutionEligibility {
  canDispatch: boolean;
  requiresApproval: boolean;
  degraded: boolean;
  terminal: boolean;
}

export interface PolicyRule {
  id: string;
  matches: (input: PolicyInput) => boolean;
  evaluate: (input: PolicyInput) => PolicyDecision;
}

export interface ExecutionPolicy {
  approvalRequiredAtOrAbove?: ToolRiskLevel;
  blockedCapabilities?: readonly ToolCapability[];
  degradeCapabilities?: readonly ToolCapability[];
  degradeSeverity?: RuntimeDegradeSeverity;
  degradeReason?: RuntimeDegradeReason;
  denyByDefault?: boolean;
}

export interface AgentOsSandboxPolicy {
  readonly defaultMutatingSandboxMode?: AgentOsSandboxMode;
  readonly commandAllowlist?: readonly string[];
  readonly commandDenylist?: readonly string[];
  readonly dangerousCommandPatterns?: readonly string[];
  readonly filesystemScope?: readonly string[];
  readonly networkAccess?: ExecutionPolicyNetworkAccess;
  readonly explicitPreflight?: AgentOsSandboxPreflight;
}

export interface AgentOsExecutionPolicyPreflightInput {
  readonly toolName: string;
  readonly providerId?: string;
  readonly readOnly: boolean;
  readonly capabilityIds?: readonly ToolCapability[];
  readonly riskLevel?: ToolRiskLevel;
  readonly command?: string;
  readonly sandboxPolicy?: AgentOsSandboxPolicy;
}

export type PolicyAuditEventKind =
  | "policy.decision.started"
  | "policy.decision.completed"
  | "policy.decision.failed"
  | "policy.decision.approval_required";

export interface PolicyAuditEvent {
  kind: PolicyAuditEventKind;
  occurredAtMs: number;
  input: PolicyInput;
  decision?: PolicyDecision;
  error?: string;
}

export type PolicyAuditSink = (event: PolicyAuditEvent) => void | Promise<void>;

export interface PolicyHooks {
  beforeDecision?: (input: PolicyInput) => void | Promise<void>;
  afterDecision?: (input: PolicyInput, decision: PolicyDecision) => void | Promise<void>;
  onError?: (input: PolicyInput, error: unknown) => void | Promise<void>;
}

export interface PolicyRuntimeOptions {
  rules?: PolicyRule[];
  hooks?: PolicyHooks;
  auditSink?: PolicyAuditSink;
  executionPolicy?: ExecutionPolicy;
  defaultDecision?: PolicyDecision;
}

const DENY_DEFAULT_DECISION: PolicyDecision = {
  verdict: "deny",
  reason: "No matching policy rule",
};

const ALLOW_DEFAULT_DECISION: PolicyDecision = {
  verdict: "allow",
  reason: "No matching policy rule, allow by execution policy",
};

const RISK_ORDER: Record<ToolRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const DECISION_ORDER: Record<PolicyVerdict, number> = {
  allow: 0,
  degrade: 1,
  ask: 2,
  deny: 3,
};

const POLICY_RUNTIME_METADATA_KEY = "policyRuntime";
const DEFAULT_DANGEROUS_COMMAND_PATTERNS = [
  "rm -rf /",
  "sudo rm -rf",
  ":(){",
  "mkfs",
  "dd if=",
  "> /dev/sd",
  "| sh",
  "| bash",
  "curl ",
  "wget ",
] as const;

export const decision = {
  allow(reason: string, init: Omit<PolicyDecision, "verdict" | "reason"> = {}): PolicyDecision {
    return { verdict: "allow", reason, ...init };
  },
  deny(reason: string, init: Omit<PolicyDecision, "verdict" | "reason"> = {}): PolicyDecision {
    return { verdict: "deny", reason, ...init };
  },
  ask(reason: string, init: Omit<PolicyDecision, "verdict" | "reason"> = {}): PolicyDecision {
    return { verdict: "ask", reason, ...init };
  },
  degrade(
    reason: string,
    degradedCapabilities: readonly ToolCapability[],
    init: Omit<PolicyDecision, "verdict" | "reason" | "degradedCapabilities" | "degradation"> & {
      degradation?: RuntimeDegradeSurface;
    } = {},
  ): PolicyDecision {
    return {
      verdict: "degrade",
      reason,
      degradedCapabilities,
      ...(init.degradation
        ? { degradation: init.degradation }
        : {
            degradation: createPolicyDegradation(
              reason,
              degradedCapabilities,
              "major",
              "policy-restricted",
            ),
          }),
      ...init,
    };
  },
};

export function staticRule(
  id: string,
  match: (input: PolicyInput) => boolean,
  output: PolicyDecision,
): PolicyRule {
  return {
    id,
    matches: match,
    evaluate: () => output,
  };
}

export function createAgentOsExecutionPolicyPreflight(
  input: AgentOsExecutionPolicyPreflightInput,
): AgentOsSandboxPreflight {
  const providerId = normalizeProviderId(input.providerId, input.toolName);
  const explicitPreflight = input.sandboxPolicy?.explicitPreflight;
  if (explicitPreflight !== undefined) {
    return isAgentOsSandboxPreflight(explicitPreflight)
      ? explicitPreflight
      : createDeniedAgentOsSandboxPreflight({
          providerId,
          reason: "Agent OS sandbox policy returned an invalid explicit preflight",
        });
  }

  const command = input.command?.trim();
  if (command) {
    const denylistMatch = firstMatchingPattern(command, input.sandboxPolicy?.commandDenylist);
    if (denylistMatch !== undefined) {
      return createDeniedAgentOsSandboxPreflight({
        providerId,
        reason: `Command matched sandbox denylist pattern "${denylistMatch}"`,
      });
    }

    const dangerousMatch = firstMatchingPattern(
      command,
      input.sandboxPolicy?.dangerousCommandPatterns ?? DEFAULT_DANGEROUS_COMMAND_PATTERNS,
    );
    if (dangerousMatch !== undefined) {
      return createDeniedAgentOsSandboxPreflight({
        providerId,
        reason: `Command matched built-in dangerous pattern "${dangerousMatch}"`,
      });
    }

    const allowlist = input.sandboxPolicy?.commandAllowlist;
    if (allowlist !== undefined && allowlist.length > 0) {
      const allowlistMatch = firstMatchingCommandPrefix(command, allowlist);
      if (allowlistMatch === undefined) {
        return createDeniedAgentOsSandboxPreflight({
          providerId,
          reason: "Command did not match sandbox allowlist",
        });
      }
    }
  }

  if (input.readOnly) {
    return {
      verdict: "allow",
      sandboxMode: "readonly",
      checkedAt: new Date().toISOString(),
      providerId,
      reason: "Read-only tool capability may execute with readonly sandbox preflight.",
    };
  }

  const sandboxMode = input.sandboxPolicy?.defaultMutatingSandboxMode;
  if (
    sandboxMode === undefined ||
    sandboxMode === "disabled" ||
    !isKnownAgentOsSandboxMode(sandboxMode)
  ) {
    return createDeniedAgentOsSandboxPreflight({
      providerId,
      reason: "Agent OS sandbox preflight is required before executing mutating tools",
    });
  }

  return {
    verdict: "allow",
    sandboxMode,
    checkedAt: new Date().toISOString(),
    providerId,
    reason: createAgentOsSandboxPolicyReason(input, sandboxMode),
  };
}

export interface ToolDispatchPolicyRuntime {
  evaluateToolDispatch(input: ToolPolicyInput): Promise<PolicyDecision>;
}

export class PolicyRuntime implements ToolDispatchPolicyRuntime {
  private readonly rules: PolicyRule[];
  private readonly hooks: PolicyHooks | undefined;
  private readonly defaultDecision: PolicyDecision;
  private readonly auditSink: PolicyAuditSink | undefined;
  private readonly executionPolicy: ExecutionPolicy;

  constructor(options: PolicyRuntimeOptions = {}) {
    this.rules = options.rules ?? [];
    this.hooks = options.hooks;
    this.auditSink = options.auditSink;
    this.executionPolicy = options.executionPolicy ?? {};
    this.defaultDecision =
      options.defaultDecision ??
      (this.executionPolicy.denyByDefault === false
        ? ALLOW_DEFAULT_DECISION
        : DENY_DEFAULT_DECISION);
  }

  async evaluateToolDispatch(input: ToolPolicyInput): Promise<PolicyDecision> {
    return this.decide({
      action: "tool.dispatch",
      resource: input.toolName,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      capabilityProfile: {
        ...input.capabilityProfile,
        toolName: input.capabilityProfile?.toolName ?? input.toolName,
      },
      ...(input.approval !== undefined ? { approval: input.approval } : {}),
    });
  }

  async decide(input: PolicyInput): Promise<PolicyDecision> {
    try {
      await this.hooks?.beforeDecision?.(input);
    } catch (error) {
      await this.reportError(input, error);
      return decision.deny("Policy pre-hook failed", {
        metadata: { error: normalizeError(error) },
      });
    }

    await this.emitAudit({
      kind: "policy.decision.started",
      occurredAtMs: Date.now(),
      input,
    });

    let resolvedDecision: PolicyDecision;
    try {
      const baseDecision = this.evaluateRules(input);
      const policyDecision = this.evaluateExecutionPolicy(input);
      resolvedDecision = withPolicyRuntimeMetadata(
        mergePolicyDecisions(baseDecision, policyDecision),
        policyDecision ? "merged" : readDecisionOrigin(baseDecision),
        input,
      );
    } catch (error) {
      await this.reportError(input, error);
      await this.emitAudit({
        kind: "policy.decision.failed",
        occurredAtMs: Date.now(),
        input,
        error: normalizeError(error),
      });
      return decision.deny("Policy evaluation failed", {
        metadata: { error: normalizeError(error) },
      });
    }

    try {
      await this.hooks?.afterDecision?.(input, resolvedDecision);
    } catch (error) {
      await this.reportError(input, error);
      return decision.deny("Policy post-hook failed", {
        metadata: { error: normalizeError(error) },
      });
    }

    if (resolvedDecision.verdict === "ask") {
      await this.emitAudit({
        kind: "policy.decision.approval_required",
        occurredAtMs: Date.now(),
        input,
        decision: resolvedDecision,
      });
    }

    await this.emitAudit({
      kind: "policy.decision.completed",
      occurredAtMs: Date.now(),
      input,
      decision: resolvedDecision,
    });

    return resolvedDecision;
  }

  private evaluateRules(input: PolicyInput): PolicyDecision {
    const matchedRule = this.rules.find((rule) => rule.matches(input));
    if (!matchedRule) {
      return withPolicyRuntimeMetadata(this.defaultDecision, "default", input);
    }

    const evaluated = matchedRule.evaluate(input);
    const ruleId = evaluated.ruleId ?? matchedRule.id;
    return withPolicyRuntimeMetadata(
      {
        ...evaluated,
        ...(ruleId !== undefined ? { ruleId } : {}),
      },
      "rule",
      input,
    );
  }

  private evaluateExecutionPolicy(input: PolicyInput): PolicyDecision | undefined {
    const capabilities = input.capabilityProfile?.capabilities ?? [];
    const blocked = intersectCapabilities(capabilities, this.executionPolicy.blockedCapabilities);
    if (blocked.length > 0) {
      return withPolicyRuntimeMetadata(
        decision.deny("Execution policy blocked tool capabilities", {
          metadata: { blockedCapabilities: blocked },
        }),
        "execution-policy",
        input,
      );
    }

    if (input.approval?.status === "rejected") {
      return withPolicyRuntimeMetadata(
        decision.deny("Execution approval rejected", {
          metadata: {
            approvalStatus: "rejected",
            ...(input.approval.note ? { note: input.approval.note } : {}),
          },
        }),
        "execution-policy",
        input,
      );
    }

    if (requiresApproval(input, this.executionPolicy)) {
      if (input.approval?.status !== "approved") {
        return withPolicyRuntimeMetadata(
          decision.ask("Tool execution requires approval", {
            metadata: {
              approvalStatus: input.approval?.status ?? "pending",
              riskLevel: normalizedRiskLevel(input.capabilityProfile?.riskLevel),
              requiredAtOrAbove: this.executionPolicy.approvalRequiredAtOrAbove ?? "critical",
            },
          }),
          "execution-policy",
          input,
        );
      }
    }

    const degradedCapabilities = intersectCapabilities(
      capabilities,
      this.executionPolicy.degradeCapabilities,
    );
    if (degradedCapabilities.length > 0) {
      return withPolicyRuntimeMetadata(
        decision.degrade("Execution policy degraded tool capabilities", degradedCapabilities, {
          degradation: createPolicyDegradation(
            "Execution policy degraded tool capabilities",
            degradedCapabilities,
            this.executionPolicy.degradeSeverity ?? "major",
            this.executionPolicy.degradeReason ?? "policy-restricted",
          ),
        }),
        "execution-policy",
        input,
      );
    }

    return undefined;
  }

  private async reportError(input: PolicyInput, error: unknown): Promise<void> {
    try {
      await this.hooks?.onError?.(input, error);
    } catch {
      // Keep deny-by-default behavior even when error hooks fail.
    }
  }

  private async emitAudit(event: PolicyAuditEvent): Promise<void> {
    if (!this.auditSink) {
      return;
    }

    try {
      await this.auditSink(event);
    } catch (error) {
      await this.reportError(event.input, error);
    }
  }
}

function mergePolicyDecisions(
  baseDecision: PolicyDecision,
  policyDecision: PolicyDecision | undefined,
): PolicyDecision {
  if (!policyDecision) {
    return baseDecision;
  }

  if (baseDecision.verdict === "degrade" && policyDecision.verdict === "degrade") {
    const mergedCapabilities = uniqueCapabilities([
      ...(baseDecision.degradedCapabilities ?? []),
      ...(policyDecision.degradedCapabilities ?? []),
    ]);
    const ruleId = policyDecision.ruleId ?? baseDecision.ruleId;

    const metadata = mergeMetadata(baseDecision.metadata, policyDecision.metadata);
    return {
      ...policyDecision,
      ...(ruleId !== undefined ? { ruleId } : {}),
      degradedCapabilities: mergedCapabilities,
      degradation:
        policyDecision.degradation ??
        baseDecision.degradation ??
        createPolicyDegradation(
          policyDecision.reason,
          mergedCapabilities,
          "major",
          "policy-restricted",
        ),
      ...(metadata ? { metadata } : {}),
    };
  }

  if (DECISION_ORDER[policyDecision.verdict] > DECISION_ORDER[baseDecision.verdict]) {
    const ruleId = policyDecision.ruleId ?? baseDecision.ruleId;
    const metadata = mergeMetadata(baseDecision.metadata, policyDecision.metadata);
    return {
      ...policyDecision,
      ...(ruleId !== undefined ? { ruleId } : {}),
      ...(metadata ? { metadata } : {}),
    };
  }

  const metadata = mergeMetadata(baseDecision.metadata, policyDecision.metadata);
  return {
    ...baseDecision,
    ...(metadata ? { metadata } : {}),
  };
}

function mergeMetadata(
  baseMetadata: Record<string, unknown> | undefined,
  nextMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!baseMetadata && !nextMetadata) {
    return undefined;
  }

  return {
    ...(baseMetadata ?? {}),
    ...(nextMetadata ?? {}),
  };
}

function withPolicyRuntimeMetadata(
  resolved: PolicyDecision,
  origin: PolicyDecisionOrigin,
  input: PolicyInput,
): PolicyDecision {
  const existingMetadata = resolved.metadata ?? {};
  const policyRuntimeMetadata = readPolicyRuntimeMetadata(existingMetadata);
  const eligibility = resolveExecutionEligibility(resolved.verdict);

  const nextPolicyRuntimeMetadata = {
    ...(policyRuntimeMetadata ?? {}),
    origin,
    verdict: resolved.verdict,
    eligibility,
    riskLevel: normalizedRiskLevel(input.capabilityProfile?.riskLevel),
    approvalStatus: input.approval?.status ?? "not-required",
    ...(input.capabilityProfile?.toolName ? { toolName: input.capabilityProfile.toolName } : {}),
  };

  return {
    ...resolved,
    metadata: {
      ...existingMetadata,
      [POLICY_RUNTIME_METADATA_KEY]: nextPolicyRuntimeMetadata,
    },
  };
}

function resolveExecutionEligibility(verdict: PolicyVerdict): PolicyExecutionEligibility {
  switch (verdict) {
    case "allow":
      return {
        canDispatch: true,
        requiresApproval: false,
        degraded: false,
        terminal: false,
      };
    case "degrade":
      return {
        canDispatch: true,
        requiresApproval: false,
        degraded: true,
        terminal: false,
      };
    case "ask":
      return {
        canDispatch: false,
        requiresApproval: true,
        degraded: false,
        terminal: true,
      };
    default:
      return {
        canDispatch: false,
        requiresApproval: false,
        degraded: false,
        terminal: true,
      };
  }
}

function readPolicyRuntimeMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const value = metadata[POLICY_RUNTIME_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readDecisionOrigin(decision: PolicyDecision): PolicyDecisionOrigin {
  const metadata = decision.metadata;
  if (!metadata) {
    return "default";
  }
  const policyRuntimeMetadata = readPolicyRuntimeMetadata(metadata);
  const rawOrigin = policyRuntimeMetadata?.origin;
  if (
    rawOrigin === "default" ||
    rawOrigin === "rule" ||
    rawOrigin === "execution-policy" ||
    rawOrigin === "merged"
  ) {
    return rawOrigin;
  }
  return "default";
}

function requiresApproval(input: PolicyInput, executionPolicy: ExecutionPolicy): boolean {
  if (input.capabilityProfile?.requiresApproval) {
    return true;
  }

  const threshold = executionPolicy.approvalRequiredAtOrAbove;
  if (!threshold) {
    return false;
  }

  const riskLevel = normalizedRiskLevel(input.capabilityProfile?.riskLevel);
  return RISK_ORDER[riskLevel] >= RISK_ORDER[threshold];
}

function normalizedRiskLevel(riskLevel: ToolRiskLevel | undefined): ToolRiskLevel {
  return riskLevel ?? "low";
}

function createDeniedAgentOsSandboxPreflight(input: {
  readonly providerId: string;
  readonly reason: string;
}): AgentOsSandboxPreflight {
  return {
    verdict: "deny",
    sandboxMode: "disabled",
    checkedAt: new Date().toISOString(),
    providerId: input.providerId,
    reason: input.reason,
  };
}

function createAgentOsSandboxPolicyReason(
  input: AgentOsExecutionPolicyPreflightInput,
  sandboxMode: AgentOsSandboxMode,
): string {
  const details = [
    `mode=${sandboxMode}`,
    `risk=${normalizedRiskLevel(input.riskLevel)}`,
    ...(input.capabilityIds && input.capabilityIds.length > 0
      ? [`capabilities=${input.capabilityIds.join(",")}`]
      : []),
    ...(input.sandboxPolicy?.networkAccess ? [`network=${input.sandboxPolicy.networkAccess}`] : []),
    ...(input.sandboxPolicy?.filesystemScope && input.sandboxPolicy.filesystemScope.length > 0
      ? [`fs=${input.sandboxPolicy.filesystemScope.join(",")}`]
      : []),
  ];
  return `Agent OS sandbox policy allowed mutating tool execution (${details.join("; ")}).`;
}

function normalizeProviderId(providerId: string | undefined, toolName: string): string {
  const normalizedProviderId = providerId?.trim();
  if (normalizedProviderId && normalizedProviderId.length > 0) {
    return normalizedProviderId;
  }
  const normalizedToolName = toolName.trim();
  return normalizedToolName.length > 0 ? normalizedToolName : "policy-runtime";
}

function firstMatchingPattern(
  value: string,
  patterns: readonly string[] | undefined,
): string | undefined {
  if (patterns === undefined || patterns.length === 0) {
    return undefined;
  }
  const normalizedValue = value.toLowerCase();
  return patterns.find((pattern) => {
    const normalizedPattern = pattern.trim().toLowerCase();
    return normalizedPattern.length > 0 && normalizedValue.includes(normalizedPattern);
  });
}

function firstMatchingCommandPrefix(
  value: string,
  patterns: readonly string[] | undefined,
): string | undefined {
  if (patterns === undefined || patterns.length === 0) {
    return undefined;
  }
  const normalizedValue = normalizePolicyCommand(value);
  return patterns.find((pattern) => {
    const normalizedPattern = normalizePolicyCommand(pattern);
    return (
      normalizedPattern.length > 0 &&
      (normalizedValue === normalizedPattern || normalizedValue.startsWith(`${normalizedPattern} `))
    );
  });
}

function normalizePolicyCommand(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function isKnownAgentOsSandboxMode(value: string): value is AgentOsSandboxMode {
  return AGENT_OS_SANDBOX_MODES.some((mode) => mode === value);
}

function intersectCapabilities(
  requested: readonly ToolCapability[],
  configured: readonly ToolCapability[] | undefined,
): ToolCapability[] {
  if (!configured || configured.length === 0) {
    return [];
  }

  const configuredSet = new Set(configured);
  return requested.filter((capability) => configuredSet.has(capability));
}

function uniqueCapabilities(capabilities: readonly ToolCapability[]): readonly ToolCapability[] {
  return [...new Set(capabilities)];
}

function createPolicyDegradation(
  message: string,
  degradedCapabilities: readonly ToolCapability[],
  severity: RuntimeDegradeSeverity,
  reason: RuntimeDegradeReason,
): RuntimeDegradeSurface {
  return createRuntimeDegradeSurface({
    stage: "policy",
    category: "policy",
    severity,
    reason,
    message,
    recoverable: true,
    metadata: {
      degradedCapabilities: [...degradedCapabilities],
    },
  });
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
