import type {
  PolicyDecision,
  PolicyInput,
  PolicyRuntime,
  ToolApprovalContext,
  ToolCapability,
  ToolRiskLevel,
} from "@hotflow/policy-runtime";
import { decision } from "@hotflow/policy-runtime";

import type { ConversationRuntimeMediaUnderstandingBudget } from "./media-understanding-workflow.js";

export type ConversationRuntimePolicyEnvelopeSchemaVersion =
  "conversation-runtime.policy-decision-envelope.v1";

export interface ConversationRuntimePolicyBudget {
  readonly tokenLimit?: number;
  readonly fileCountLimit?: number;
  readonly videoMinuteLimit?: number;
  readonly audioMinuteLimit?: number;
  readonly estimatedCostTier?: string;
  readonly estimatedCostUsd?: number;
}

export interface ConversationRuntimePolicyRisk {
  readonly level: ToolRiskLevel;
  readonly capabilities: readonly ToolCapability[];
}

export interface ConversationRuntimePolicyEvidenceAdmission {
  readonly canAdmitResult: boolean;
  readonly reason: string;
}

export interface ConversationRuntimePolicyEvidence {
  readonly evidenceRefIds: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly admission: ConversationRuntimePolicyEvidenceAdmission;
}

export interface ConversationRuntimePolicyAudit {
  readonly decidedAtMs: number;
  readonly policyInput: PolicyInput;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimePolicyDecisionEnvelope {
  readonly schemaVersion: ConversationRuntimePolicyEnvelopeSchemaVersion;
  readonly action: string;
  readonly resourceRef?: string;
  readonly actor?: string;
  readonly risk: ConversationRuntimePolicyRisk;
  readonly budget: ConversationRuntimePolicyBudget;
  readonly approval?: ToolApprovalContext;
  readonly evidence: ConversationRuntimePolicyEvidence;
  readonly decision: PolicyDecision;
  readonly audit: ConversationRuntimePolicyAudit;
}

export type ConversationRuntimePolicyEnvelopeRefScope =
  | "run"
  | "tool"
  | "evidence"
  | "knowledge-transfer"
  | "media-understanding"
  | (string & {});

export interface ConversationRuntimePolicyEnvelopeRef {
  readonly schemaVersion: "conversation-runtime.policy-envelope-ref.v1";
  readonly id: string;
  readonly scope: ConversationRuntimePolicyEnvelopeRefScope;
  readonly ownerId: string;
  readonly action: string;
  readonly resourceRef?: string;
  readonly verdict: PolicyDecision["verdict"];
  readonly reason: string;
  readonly decidedAtMs: number;
  readonly evidenceRefIds: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly admission: ConversationRuntimePolicyEvidenceAdmission;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimePolicyEnvelopeInput {
  readonly action: string;
  readonly resourceRef?: string;
  readonly actor?: string;
  readonly risk: ConversationRuntimePolicyRisk;
  readonly budget?: ConversationRuntimePolicyBudget;
  readonly approval?: ToolApprovalContext;
  readonly evidenceRefIds?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly nowMs?: () => number;
}

export interface CreateConversationRuntimePolicyEnvelopeRefOptions {
  readonly scope: ConversationRuntimePolicyEnvelopeRefScope;
  readonly ownerId: string;
  readonly id?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateMediaUnderstandingPolicyEnvelopeInput {
  readonly actionId: string;
  readonly resourceRef: string;
  readonly actor?: string;
  readonly mode: "low_cost" | "deep_multimodal" | string;
  readonly toolName: string;
  readonly riskLevel?: ToolRiskLevel;
  readonly budget: ConversationRuntimePolicyBudget | ConversationRuntimeMediaUnderstandingBudget;
  readonly evidenceRefIds?: readonly string[];
  readonly approval?: ToolApprovalContext;
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly nowMs?: () => number;
}

export interface CreateExternalKnowledgeTransferPolicyEnvelopeInput {
  readonly connectorId: string;
  readonly targetKind: "internal_knowledge" | "export_package" | "external_api" | string;
  readonly operation: string;
  readonly resourceRef?: string;
  readonly actor?: string;
  readonly mode?: string;
  readonly evidenceRefIds?: readonly string[];
  readonly approval?: ToolApprovalContext;
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly nowMs?: () => number;
}

const FAIL_CLOSED_DECISION = decision.deny("policy_runtime_not_configured");

export async function createConversationRuntimePolicyEnvelope(
  input: CreateConversationRuntimePolicyEnvelopeInput,
): Promise<ConversationRuntimePolicyDecisionEnvelope> {
  const policyInput = createPolicyInput(input);
  const resolvedDecision =
    input.policyRuntime === undefined
      ? FAIL_CLOSED_DECISION
      : await input.policyRuntime.decide(policyInput);
  return {
    schemaVersion: "conversation-runtime.policy-decision-envelope.v1",
    action: input.action,
    ...(input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef }),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    risk: {
      level: input.risk.level,
      capabilities: uniqueStrings(input.risk.capabilities),
    },
    budget: normalizePolicyBudget(input.budget),
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    evidence: {
      evidenceRefIds: uniqueStrings(input.evidenceRefIds ?? []),
      sourceRefs: uniqueStrings(input.sourceRefs ?? []),
      admission: createPolicyEvidenceAdmission(resolvedDecision),
    },
    decision: resolvedDecision,
    audit: {
      decidedAtMs: input.nowMs?.() ?? Date.now(),
      policyInput,
      metadata: {
        ...(input.metadata ?? {}),
      },
    },
  };
}

export function createConversationRuntimePolicyEnvelopeRef(
  envelope: ConversationRuntimePolicyDecisionEnvelope,
  options: CreateConversationRuntimePolicyEnvelopeRefOptions,
): ConversationRuntimePolicyEnvelopeRef {
  return {
    schemaVersion: "conversation-runtime.policy-envelope-ref.v1",
    id:
      options.id ??
      createPolicyEnvelopeRefId({
        scope: options.scope,
        ownerId: options.ownerId,
        action: envelope.action,
        ...(envelope.resourceRef === undefined ? {} : { resourceRef: envelope.resourceRef }),
      }),
    scope: options.scope,
    ownerId: options.ownerId,
    action: envelope.action,
    ...(envelope.resourceRef === undefined ? {} : { resourceRef: envelope.resourceRef }),
    verdict: envelope.decision.verdict,
    reason: envelope.decision.reason,
    decidedAtMs: envelope.audit.decidedAtMs,
    evidenceRefIds: [...envelope.evidence.evidenceRefIds],
    sourceRefs: [...envelope.evidence.sourceRefs],
    admission: { ...envelope.evidence.admission },
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

export function createMediaUnderstandingPolicyEnvelope(
  input: CreateMediaUnderstandingPolicyEnvelopeInput,
): Promise<ConversationRuntimePolicyDecisionEnvelope> {
  return createConversationRuntimePolicyEnvelope({
    action: input.actionId,
    resourceRef: input.resourceRef,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    risk: {
      level: input.riskLevel ?? (input.mode === "deep_multimodal" ? "critical" : "high"),
      capabilities: ["media.understanding", "media.semantic-extraction"],
    },
    budget: input.budget,
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    ...(input.evidenceRefIds === undefined ? {} : { evidenceRefIds: input.evidenceRefIds }),
    sourceRefs: [input.resourceRef],
    metadata: {
      toolName: input.toolName,
      mediaUnderstandingMode: input.mode,
    },
    ...(input.policyRuntime === undefined ? {} : { policyRuntime: input.policyRuntime }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
}

export function createExternalKnowledgeTransferPolicyEnvelope(
  input: CreateExternalKnowledgeTransferPolicyEnvelopeInput,
): Promise<ConversationRuntimePolicyDecisionEnvelope> {
  const profile = resolveExternalKnowledgeRiskProfile(input);
  return createConversationRuntimePolicyEnvelope({
    action: input.operation,
    ...(input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef }),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    risk: profile,
    budget: {},
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    ...(input.evidenceRefIds === undefined ? {} : { evidenceRefIds: input.evidenceRefIds }),
    sourceRefs: input.resourceRef === undefined ? [] : [input.resourceRef],
    metadata: {
      connectorId: input.connectorId,
      targetKind: input.targetKind,
      ...(input.mode === undefined ? {} : { mode: input.mode }),
    },
    ...(input.policyRuntime === undefined ? {} : { policyRuntime: input.policyRuntime }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
}

function createPolicyInput(input: CreateConversationRuntimePolicyEnvelopeInput): PolicyInput {
  return {
    action: input.action,
    ...(input.resourceRef === undefined ? {} : { resource: input.resourceRef }),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    metadata: {
      ...(input.metadata ?? {}),
      budget: normalizePolicyBudget(input.budget),
      evidenceRefIds: uniqueStrings(input.evidenceRefIds ?? []),
      sourceRefs: uniqueStrings(input.sourceRefs ?? []),
    },
    capabilityProfile: {
      capabilities: uniqueStrings(input.risk.capabilities),
      riskLevel: input.risk.level,
    },
    ...(input.approval === undefined ? {} : { approval: input.approval }),
  };
}

function createPolicyEvidenceAdmission(
  resolvedDecision: PolicyDecision,
): ConversationRuntimePolicyEvidenceAdmission {
  if (resolvedDecision.verdict === "allow") {
    return {
      canAdmitResult: true,
      reason: "policy_decision_allows_admission",
    };
  }
  return {
    canAdmitResult: false,
    reason: "policy_decision_must_be_allow_before_admission",
  };
}

function resolveExternalKnowledgeRiskProfile(
  input: CreateExternalKnowledgeTransferPolicyEnvelopeInput,
): ConversationRuntimePolicyRisk {
  if (input.targetKind === "external_api") {
    return {
      level: "high",
      capabilities: ["external_knowledge.external_api", "network.write"],
    };
  }
  if (input.targetKind === "internal_knowledge") {
    return {
      level: "medium",
      capabilities: ["external_knowledge.internal_write"],
    };
  }
  return {
    level: "low",
    capabilities: ["external_knowledge.export_package"],
  };
}

function normalizePolicyBudget(
  budget: ConversationRuntimePolicyBudget | ConversationRuntimeMediaUnderstandingBudget | undefined,
): ConversationRuntimePolicyBudget {
  if (budget === undefined) {
    return {};
  }
  return {
    ...optionalFiniteNumber("tokenLimit", budget.tokenLimit),
    ...optionalFiniteNumber("fileCountLimit", budget.fileCountLimit),
    ...optionalFiniteNumber("videoMinuteLimit", budget.videoMinuteLimit),
    ...optionalFiniteNumber("audioMinuteLimit", budget.audioMinuteLimit),
    ...(budget.estimatedCostTier === undefined
      ? {}
      : { estimatedCostTier: budget.estimatedCostTier }),
    ...optionalFiniteNumber("estimatedCostUsd", readEstimatedCostUsd(budget)),
  };
}

function createPolicyEnvelopeRefId(input: {
  readonly scope: string;
  readonly ownerId: string;
  readonly action: string;
  readonly resourceRef?: string;
}): string {
  return [
    "policy-ref",
    slugifyPolicyEnvelopeRefPart(input.scope),
    slugifyPolicyEnvelopeRefPart(input.ownerId),
    slugifyPolicyEnvelopeRefPart(input.action),
    ...(input.resourceRef === undefined ? [] : [slugifyPolicyEnvelopeRefPart(input.resourceRef)]),
  ].join("-");
}

function slugifyPolicyEnvelopeRefPart(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return slug.length === 0 ? "unknown" : slug;
}

function readEstimatedCostUsd(
  budget: ConversationRuntimePolicyBudget | ConversationRuntimeMediaUnderstandingBudget,
): number | undefined {
  return "estimatedCostUsd" in budget ? budget.estimatedCostUsd : undefined;
}

function optionalFiniteNumber<K extends keyof ConversationRuntimePolicyBudget>(
  key: K,
  value: number | undefined,
): Pick<ConversationRuntimePolicyBudget, K> | Record<string, never> {
  return value === undefined || !Number.isFinite(value)
    ? {}
    : ({ [key]: value } as Pick<ConversationRuntimePolicyBudget, K>);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}
