import type {
  ExternalKnowledgeUploadPackagePlan,
  GovernedExternalKnowledgeTransferPlan,
} from "./external-knowledge-connectors.js";
import type { ConversationRuntimeMediaInventory } from "./media-inventory.js";
import type { ConversationRuntimeMediaUnderstandingWorkflow } from "./media-understanding-workflow.js";

export type ConversationRuntimeEvidenceProvenanceOverallAdmission =
  | "none"
  | "text_only"
  | "text_and_media"
  | "text_and_knowledge"
  | "full";

export interface ConversationRuntimeEvidenceProvenanceSource {
  readonly kind: "web_extract" | "media_understanding" | "external_knowledge" | (string & {});
  readonly sourceRef?: string;
  readonly sourceSnapshotId?: string;
  readonly textRead: boolean;
  readonly readableCharacterCount?: number;
  readonly secondPassExtracted?: boolean;
}

export interface ConversationRuntimeEvidenceProvenanceMedia {
  readonly assetCount: number;
  readonly listedOnlyCount: number;
  readonly analyzedCount: number;
  readonly semanticUnderstanding: boolean;
  readonly canUseMediaAsConclusion: boolean;
  readonly disclosure?: string;
}

export interface ConversationRuntimeEvidenceProvenanceKnowledge {
  readonly targetCount: number;
  readonly executableTargetCount: number;
  readonly admittedTargetCount: number;
  readonly mediaContentAdmitted: boolean;
}

export interface ConversationRuntimeEvidenceProvenanceAdmission {
  readonly canAdmitTextEvidence: boolean;
  readonly canAdmitMediaContent: boolean;
  readonly canAdmitKnowledgeTransfer: boolean;
  readonly overall: ConversationRuntimeEvidenceProvenanceOverallAdmission;
  readonly requiredDisclosure?: string;
}

export interface ConversationRuntimeEvidenceProvenanceEnvelope {
  readonly schemaVersion: "conversation-runtime.evidence-provenance.v1";
  readonly source: ConversationRuntimeEvidenceProvenanceSource;
  readonly media: ConversationRuntimeEvidenceProvenanceMedia;
  readonly knowledge: ConversationRuntimeEvidenceProvenanceKnowledge;
  readonly admission: ConversationRuntimeEvidenceProvenanceAdmission;
  readonly evidenceRefIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly observedAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateConversationRuntimeEvidenceProvenanceEnvelopeInput {
  readonly source: ConversationRuntimeEvidenceProvenanceSource;
  readonly mediaInventory?: ConversationRuntimeMediaInventory;
  readonly mediaUnderstandingWorkflow?: ConversationRuntimeMediaUnderstandingWorkflow;
  readonly knowledgeTransferPlan?:
    | GovernedExternalKnowledgeTransferPlan
    | ExternalKnowledgeUploadPackagePlan;
  readonly evidenceRefIds?: readonly string[];
  readonly artifactIds?: readonly string[];
  readonly observedAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const MEDIA_NOT_UNDERSTOOD_DISCLOSURE =
  "文本已读；媒体未理解，不能把媒体内容当成结论；知识同步只包含已授权/已准入的文本证据。";

export function createConversationRuntimeEvidenceProvenanceEnvelope(
  input: CreateConversationRuntimeEvidenceProvenanceEnvelopeInput,
): ConversationRuntimeEvidenceProvenanceEnvelope {
  const media = createEvidenceProvenanceMedia(input);
  const knowledge = createEvidenceProvenanceKnowledge(input.knowledgeTransferPlan);
  const admission = createEvidenceProvenanceAdmission({
    source: input.source,
    media,
    knowledge,
  });
  return {
    schemaVersion: "conversation-runtime.evidence-provenance.v1",
    source: input.source,
    media,
    knowledge,
    admission,
    evidenceRefIds: uniqueStrings([
      ...(input.evidenceRefIds ?? []),
      ...readWorkflowEvidenceRefIds(input.mediaUnderstandingWorkflow),
      ...readKnowledgeEvidenceRefIds(input.knowledgeTransferPlan),
    ]),
    artifactIds: uniqueStrings([
      ...(input.artifactIds ?? []),
      ...readKnowledgeArtifactIds(input.knowledgeTransferPlan),
    ]),
    observedAtMs: input.observedAtMs ?? Date.now(),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function createEvidenceProvenanceMedia(
  input: CreateConversationRuntimeEvidenceProvenanceEnvelopeInput,
): ConversationRuntimeEvidenceProvenanceMedia {
  const assetCount = input.mediaInventory?.assetCount ?? 0;
  const workflow = input.mediaUnderstandingWorkflow;
  const evidenceRefs = workflow?.evidenceBackfill.evidenceRefs ?? [];
  const analyzedCount = evidenceRefs.filter((evidence) => evidence.realVisualUnderstanding).length;
  const semanticUnderstanding =
    analyzedCount > 0 && evidenceRefs.every((evidence) => evidence.realVisualUnderstanding);
  const canUseMediaAsConclusion =
    workflow?.admission.canAdmitMediaContent === true && semanticUnderstanding;
  return {
    assetCount,
    listedOnlyCount: Math.max(0, assetCount - analyzedCount),
    analyzedCount,
    semanticUnderstanding,
    canUseMediaAsConclusion,
    ...(workflow?.unauthorizedDisclosure === undefined
      ? {}
      : { disclosure: workflow.unauthorizedDisclosure }),
  };
}

function createEvidenceProvenanceKnowledge(
  plan: CreateConversationRuntimeEvidenceProvenanceEnvelopeInput["knowledgeTransferPlan"],
): ConversationRuntimeEvidenceProvenanceKnowledge {
  if (plan === undefined) {
    return {
      targetCount: 0,
      executableTargetCount: 0,
      admittedTargetCount: 0,
      mediaContentAdmitted: false,
    };
  }
  if (isGovernedExternalKnowledgeTransferPlan(plan)) {
    return {
      targetCount: plan.targets.length,
      executableTargetCount: plan.targets.filter((target) => target.transferAdmission.canExecute)
        .length,
      admittedTargetCount: plan.targets.filter(
        (target) => target.policyEnvelope.evidence.admission.canAdmitResult,
      ).length,
      mediaContentAdmitted: plan.targets.some(
        (target) => target.uploadPackagePlan?.manifest.mediaContentAdmitted === true,
      ),
    };
  }
  return {
    targetCount: 1,
    executableTargetCount: 0,
    admittedTargetCount: 0,
    mediaContentAdmitted: plan.manifest.mediaContentAdmitted,
  };
}

function createEvidenceProvenanceAdmission(input: {
  readonly source: ConversationRuntimeEvidenceProvenanceSource;
  readonly media: ConversationRuntimeEvidenceProvenanceMedia;
  readonly knowledge: ConversationRuntimeEvidenceProvenanceKnowledge;
}): ConversationRuntimeEvidenceProvenanceAdmission {
  const canAdmitTextEvidence = input.source.textRead;
  const canAdmitMediaContent = input.media.canUseMediaAsConclusion;
  const canAdmitKnowledgeTransfer = input.knowledge.executableTargetCount > 0;
  const overall = resolveOverallAdmission({
    canAdmitTextEvidence,
    canAdmitMediaContent,
    canAdmitKnowledgeTransfer,
  });
  return {
    canAdmitTextEvidence,
    canAdmitMediaContent,
    canAdmitKnowledgeTransfer,
    overall,
    ...(input.media.assetCount > 0 && !canAdmitMediaContent
      ? { requiredDisclosure: MEDIA_NOT_UNDERSTOOD_DISCLOSURE }
      : {}),
  };
}

function resolveOverallAdmission(input: {
  readonly canAdmitTextEvidence: boolean;
  readonly canAdmitMediaContent: boolean;
  readonly canAdmitKnowledgeTransfer: boolean;
}): ConversationRuntimeEvidenceProvenanceOverallAdmission {
  if (input.canAdmitTextEvidence && input.canAdmitMediaContent && input.canAdmitKnowledgeTransfer) {
    return "full";
  }
  if (input.canAdmitTextEvidence && input.canAdmitMediaContent) {
    return "text_and_media";
  }
  if (input.canAdmitTextEvidence && input.canAdmitKnowledgeTransfer) {
    return "text_and_knowledge";
  }
  if (input.canAdmitTextEvidence) {
    return "text_only";
  }
  return "none";
}

function readWorkflowEvidenceRefIds(
  workflow: ConversationRuntimeMediaUnderstandingWorkflow | undefined,
): readonly string[] {
  return workflow?.evidenceBackfill.evidenceRefs.map((evidence) => evidence.id) ?? [];
}

function readKnowledgeEvidenceRefIds(
  plan: CreateConversationRuntimeEvidenceProvenanceEnvelopeInput["knowledgeTransferPlan"],
): readonly string[] {
  if (plan === undefined) {
    return [];
  }
  if (isGovernedExternalKnowledgeTransferPlan(plan)) {
    return uniqueStrings(
      plan.targets.flatMap((target) => target.policyEnvelope.evidence.evidenceRefIds),
    );
  }
  return plan.manifest.evidenceRefIds;
}

function readKnowledgeArtifactIds(
  plan: CreateConversationRuntimeEvidenceProvenanceEnvelopeInput["knowledgeTransferPlan"],
): readonly string[] {
  if (plan === undefined) {
    return [];
  }
  if (isGovernedExternalKnowledgeTransferPlan(plan)) {
    return uniqueStrings(
      plan.targets.flatMap((target) => target.uploadPackagePlan?.manifest.artifactIds ?? []),
    );
  }
  return plan.manifest.artifactIds;
}

function isGovernedExternalKnowledgeTransferPlan(
  plan: CreateConversationRuntimeEvidenceProvenanceEnvelopeInput["knowledgeTransferPlan"],
): plan is GovernedExternalKnowledgeTransferPlan {
  return (
    plan?.schemaVersion === "conversation-runtime.governed-external-knowledge-transfer-plan.v1"
  );
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
