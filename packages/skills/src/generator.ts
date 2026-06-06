import {
  CONTRACTS_SCHEMA_VERSION,
  type ExperienceCandidate,
  type ProposalCandidate,
  type ProposalQueueInput,
  type ProposalRecord,
  type TrajectoryDigest,
  createProposalCandidate,
} from "@hotflow/contracts";

import { createSkillProposalQueueInput } from "./proposal.js";
import type { SkillSnapshot } from "./repository.js";
import type { SkillUsageRecord } from "./usage.js";

export type SkillProposalRiskLevel = "low" | "medium" | "high";
export type SkillProposalDuplicateRecommendation = "merge" | "skip";

export interface SkillProposalDuplicateMatch {
  readonly skillId: string;
  readonly recommendation: SkillProposalDuplicateRecommendation;
  readonly reason: string;
  readonly score: number;
}

export interface SkillProposalGenerationMetrics {
  readonly totalJournalEvents: number;
  readonly journalEventsSinceCheckpoint: number;
  readonly toolCallCount: number;
  readonly toolResultCount: number;
  readonly assistantOutputCount: number;
}

export interface GenerateSkillProposalFromDigestInput {
  readonly digest: TrajectoryDigest;
  readonly approvedSkills: readonly SkillSnapshot[];
  readonly provenance: string;
  readonly metrics?: SkillProposalGenerationMetrics;
}

export interface GeneratedSkillProposal {
  readonly candidate: ProposalCandidate;
  readonly snapshot: SkillSnapshot;
  readonly trigger: string;
  readonly evidenceSummary: string;
  readonly riskLevel: SkillProposalRiskLevel;
  readonly confidence: number;
  readonly dedupeKey: string;
  readonly explanation: string;
  readonly duplicateMatch?: SkillProposalDuplicateMatch;
}

export interface GenerateSkillProposalFromExperienceCandidateInput {
  readonly candidate: ExperienceCandidate;
  readonly sourceSessionId: string;
  readonly author?: string;
  readonly nowMs?: number;
  readonly provenance?: string;
}

export interface GeneratedExperienceSkillProposal {
  readonly proposal: ProposalQueueInput;
  readonly skillId: string;
  readonly snapshot: SkillSnapshot;
  readonly riskLevel: SkillProposalRiskLevel;
  readonly confidence: number;
  readonly dedupeKey: string;
  readonly evidenceSummary: string;
}

export interface SkillFailurePatchEvidence {
  readonly failureCount: number;
  readonly lastFailedAtMs: number | null;
  readonly failureReasons: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface GenerateSkillFailurePatchProposalInput {
  readonly sourceSkill: SkillSnapshot;
  readonly usage: SkillUsageRecord;
  readonly sourceSessionId: string;
  readonly sourceTurnId?: string;
  readonly author?: string;
  readonly nowMs?: number;
  readonly provenance?: string;
  readonly minimumFailureCount?: number;
}

export interface GeneratedSkillFailurePatchProposal {
  readonly proposal: ProposalQueueInput;
  readonly proposalRecord: ProposalRecord;
  readonly sourceSkill: SkillSnapshot;
  readonly patchProposal: SkillSnapshot;
  readonly failurePatchPayload: Readonly<Record<string, unknown>>;
  readonly failureEvidence: SkillFailurePatchEvidence;
  readonly reviewRequirement: "operator-review-required";
  readonly noPromotionWithoutReview: true;
  readonly riskLevel: SkillProposalRiskLevel;
  readonly confidence: number;
  readonly dedupeKey: string;
  readonly evidenceSummary: string;
}

export function generateSkillProposalFromDigest(
  input: GenerateSkillProposalFromDigestInput,
): GeneratedSkillProposal {
  const trigger =
    normalizeText(input.digest.latestUserText) ||
    `Task resembles trajectory ${input.digest.sourceTurnId}.`;
  const tags = deriveTags(input.digest);
  const dedupeKey = buildDedupeKey({
    trigger,
    toolNames: input.digest.toolNames,
    tags,
  });
  const duplicateMatch = detectDuplicate({
    approvedSkills: input.approvedSkills,
    dedupeKey,
    trigger,
    toolNames: input.digest.toolNames,
    tags,
  });
  const confidence = scoreConfidence(input.digest);
  const riskLevel = resolveRiskLevel({
    digest: input.digest,
    confidence,
    ...(duplicateMatch === undefined ? {} : { duplicateMatch }),
  });
  const evidenceSummary = buildEvidenceSummary(input.digest);
  const explanation = buildExplanation({
    digest: input.digest,
    confidence,
    riskLevel,
    ...(duplicateMatch === undefined ? {} : { duplicateMatch }),
  });

  const candidate = createProposalCandidate({
    candidateId: `candidate_${sanitizeToken(input.digest.sourceSessionId)}_${sanitizeToken(input.digest.sourceTurnId)}`,
    digestId: input.digest.digestId,
    sourceSessionId: input.digest.sourceSessionId,
    sourceTurnId: input.digest.sourceTurnId,
    trajectoryRef: input.digest.trajectoryRef,
    title: `Trajectory Pattern ${input.digest.sourceTurnId}`,
    summary: explanation,
    tags,
    evidenceIds: input.digest.evidence.map((entry) => entry.evidenceId),
    provenance: input.provenance,
  });

  return {
    candidate,
    snapshot: buildSkillSnapshot({
      digest: input.digest,
      candidate,
      tags,
      trigger,
      evidenceSummary,
      riskLevel,
      confidence,
      dedupeKey,
      explanation,
      ...(duplicateMatch === undefined ? {} : { duplicateMatch }),
      ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
    }),
    trigger,
    evidenceSummary,
    riskLevel,
    confidence,
    dedupeKey,
    explanation,
    ...(duplicateMatch === undefined ? {} : { duplicateMatch }),
  };
}

export function generateSkillProposalFromExperienceCandidate(
  input: GenerateSkillProposalFromExperienceCandidateInput,
): GeneratedExperienceSkillProposal {
  const nowMs = input.nowMs ?? Date.now();
  const skillId = `skill.director.${sanitizeSkillTaxonomyId(
    input.candidate.title || input.candidate.candidateId,
  )}`;
  const sourceTurnId = `experience_${sanitizeSkillTaxonomyId(input.candidate.candidateId)}_${nowMs}`;
  const sourceExperienceRef = `experience://${input.candidate.candidateId}`;
  const evidenceSummary = input.candidate.evidencePreview ?? input.candidate.summary;
  const riskLevel = resolveExperienceSkillRiskLevel(input.candidate);
  const confidence = resolveExperienceSkillConfidence(input.candidate, riskLevel);
  const modelInvocationGate = resolveExperienceModelInvocationGate(input.candidate, riskLevel);
  const tags = uniqueStringArray([
    "director-skill",
    "self-evolved",
    "experience-derived",
    ...input.candidate.tags,
    `privacy:${input.candidate.privacy}`,
  ]).slice(0, 12);
  const dedupeKey = `${skillId}:${input.candidate.sourceDigest ?? input.candidate.candidateId}`;
  const snapshot: SkillSnapshot = {
    id: skillId,
    version: "0.1.0",
    title: `Skill：${input.candidate.title}`,
    description:
      input.candidate.applicability || "由已审核经验提炼出的 Director Angel 可复用能力。",
    content: [
      `触发条件：用户目标与“${input.candidate.title}”相关，或制作任务需要复用这条已审核经验。`,
      `证据来源：${sourceExperienceRef}`,
      `经验摘要：${input.candidate.summary}`,
      input.candidate.applicability ? `适用场景：${input.candidate.applicability}` : null,
      input.candidate.risks.length > 0 ? `风险提醒：${input.candidate.risks.join("；")}` : null,
      "执行规则：",
      "1. 先确认用户当前制作目标和这条经验是否匹配。",
      "2. 只抽取可复用的方法，不直接复述来源材料。",
      "3. 输出制作建议时要说明采用了哪条经验，以及它影响了脚本、镜头、提示词或审查哪一部分。",
      "4. 如果当前任务缺少必要上下文，先提出最小补充问题或生成可审查的草案。",
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n"),
    updatedAtMs: nowMs,
    tags,
    ...(modelInvocationGate === "none" ? {} : { disableModelInvocation: true }),
    metadata: {
      sourceExperienceId: input.candidate.candidateId,
      sourceExperienceRef,
      sourceArtifactId: input.candidate.sourceArtifactId ?? "",
      sourceDigest: input.candidate.sourceDigest ?? "",
      sourceRef: input.candidate.sourceAdapter.sourceRef,
      sourceAdapterId: input.candidate.sourceAdapter.adapterId,
      sourceKind: input.candidate.sourceAdapter.sourceKind,
      category: "production",
      skillLifecycle: "proposed",
      auditStatus: "accepted",
      trustStatus: "trusted",
      riskLevel,
      candidateId: input.candidate.candidateId,
      ...(input.author === undefined ? {} : { proposalAuthor: input.author }),
      evidenceSummary,
      evidenceCount: input.candidate.evidence.length,
      privacy: input.candidate.privacy,
      disableModelInvocation: modelInvocationGate !== "none",
      modelInvocationGate,
      dedupeKey,
    },
  };
  const proposal = createSkillProposalQueueInput({
    id: `skill-proposal-${sanitizeSkillTaxonomyId(input.candidate.candidateId)}-${nowMs}`,
    snapshot,
    sourceSessionId: input.sourceSessionId,
    sourceTurnId,
    trajectoryRef: `journal://${input.sourceSessionId}/${sourceTurnId}`,
    provenance: input.provenance ?? "skills/director-experience",
    trigger: input.candidate.title,
    evidenceSummary,
    riskLevel,
    confidence,
    dedupeKey,
    explanation: `Accepted Director experience ${input.candidate.candidateId} can be reused as an operator-reviewed Skill.`,
  });

  return {
    proposal,
    skillId,
    snapshot,
    riskLevel,
    confidence,
    dedupeKey,
    evidenceSummary,
  };
}

export function generateSkillFailurePatchProposal(
  input: GenerateSkillFailurePatchProposalInput,
): GeneratedSkillFailurePatchProposal {
  const nowMs = input.nowMs ?? Date.now();
  const minimumFailureCount = Math.max(1, Math.trunc(input.minimumFailureCount ?? 2));
  if (input.usage.skillId !== input.sourceSkill.id) {
    throw new Error(
      `Skill failure-to-patch eval requires matching usage for ${input.sourceSkill.id}.`,
    );
  }
  if (input.usage.failureCount < minimumFailureCount) {
    throw new Error(
      `Skill failure-to-patch eval requires at least ${minimumFailureCount} failure(s).`,
    );
  }

  const sourceTurnId =
    input.sourceTurnId ??
    `skill_failure_patch_${sanitizeSkillTaxonomyId(input.sourceSkill.id)}_${nowMs}`;
  const failureEvidence = buildFailurePatchEvidence(input.usage);
  const evidenceSummary = buildFailurePatchEvidenceSummary(failureEvidence);
  const dedupeKey = `${input.sourceSkill.id}:failure-to-patch:${failureEvidence.failureCount}:${failureEvidence.lastFailedAtMs ?? "unknown"}`;
  const patchProposal = buildFailurePatchSnapshot({
    sourceSkill: input.sourceSkill,
    usage: input.usage,
    failureEvidence,
    evidenceSummary,
    dedupeKey,
    nowMs,
    ...(input.author === undefined ? {} : { author: input.author }),
  });
  const failurePatchPayload = {
    schemaId: "skills.failure-to-patch-eval.v1",
    sourceSkillId: input.sourceSkill.id,
    patchSkillId: patchProposal.id,
    failureEvidence,
    reviewRequirement: "operator-review-required",
    noPromotionWithoutReview: true,
  } as const;
  const proposal = createSkillProposalQueueInput({
    id: `skill-failure-patch-${sanitizeSkillTaxonomyId(input.sourceSkill.id)}-${nowMs}`,
    snapshot: patchProposal,
    sourceSessionId: input.sourceSessionId,
    sourceTurnId,
    trajectoryRef: `journal://${input.sourceSessionId}/${sourceTurnId}`,
    provenance: input.provenance ?? "skills/failure-to-patch-eval",
    trigger: `Patch repeated failures for ${input.sourceSkill.id}`,
    evidenceSummary,
    riskLevel: "high",
    confidence: 0.58,
    dedupeKey,
    explanation:
      "Repeated Skill failure telemetry can produce a concrete patch proposal, but promotion stays blocked until review accepts it.",
  });

  return {
    proposal,
    proposalRecord: {
      ...proposal,
      status: "pending",
      schemaVersion: CONTRACTS_SCHEMA_VERSION,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    },
    sourceSkill: { ...input.sourceSkill },
    patchProposal,
    failurePatchPayload,
    failureEvidence,
    reviewRequirement: "operator-review-required",
    noPromotionWithoutReview: true,
    riskLevel: "high",
    confidence: 0.58,
    dedupeKey,
    evidenceSummary,
  };
}

function buildSkillSnapshot(input: {
  readonly digest: TrajectoryDigest;
  readonly candidate: ProposalCandidate;
  readonly tags: readonly string[];
  readonly trigger: string;
  readonly evidenceSummary: string;
  readonly riskLevel: SkillProposalRiskLevel;
  readonly confidence: number;
  readonly dedupeKey: string;
  readonly explanation: string;
  readonly duplicateMatch?: SkillProposalDuplicateMatch;
  readonly metrics?: SkillProposalGenerationMetrics;
}): SkillSnapshot {
  const toolHint =
    input.digest.toolNames.length > 0
      ? `Prefer these tools when they reduce uncertainty: ${input.digest.toolNames.join(", ")}.`
      : "Use available tools only when they materially improve accuracy.";

  return {
    id: `skill_${sanitizeToken(input.digest.sourceSessionId)}_${sanitizeToken(input.digest.sourceTurnId)}`,
    version: "0.1.0",
    title: input.candidate.title,
    description: `Worker-derived reusable procedure from ${input.digest.sourceTurnId}.`,
    content: [
      `Trigger: ${input.trigger}`,
      `Evidence: ${input.evidenceSummary}`,
      toolHint,
      "Workflow:",
      "1. Inspect the relevant workspace artifact or prior result before answering.",
      "2. If tools are used, ground the answer in observed tool results.",
      "3. Return a concise, deterministic final response.",
    ].join("\n"),
    updatedAtMs: input.digest.createdAtMs,
    tags: input.tags,
    ...(input.digest.toolNames.length === 0 ? {} : { toolNames: input.digest.toolNames }),
    metadata: {
      sourceTurnId: input.digest.sourceTurnId,
      digestId: input.digest.digestId,
      trajectoryRef: input.digest.trajectoryRef,
      candidateId: input.candidate.candidateId,
      trigger: input.trigger,
      evidenceSummary: input.evidenceSummary,
      confidence: input.confidence,
      riskLevel: input.riskLevel,
      dedupeKey: input.dedupeKey,
      explanation: input.explanation,
      evidenceCount: input.digest.evidence.length,
      ...(input.duplicateMatch === undefined
        ? {}
        : {
            duplicateSkillId: input.duplicateMatch.skillId,
            duplicateRecommendation: input.duplicateMatch.recommendation,
            duplicateScore: input.duplicateMatch.score,
          }),
      ...(input.metrics === undefined
        ? {}
        : {
            totalJournalEvents: input.metrics.totalJournalEvents,
            journalEventsSinceCheckpoint: input.metrics.journalEventsSinceCheckpoint,
            toolCallCount: input.metrics.toolCallCount,
            toolResultCount: input.metrics.toolResultCount,
            assistantOutputCount: input.metrics.assistantOutputCount,
          }),
    },
  };
}

function buildFailurePatchSnapshot(input: {
  readonly sourceSkill: SkillSnapshot;
  readonly usage: SkillUsageRecord;
  readonly failureEvidence: SkillFailurePatchEvidence;
  readonly evidenceSummary: string;
  readonly dedupeKey: string;
  readonly nowMs: number;
  readonly author?: string;
}): SkillSnapshot {
  const priorMetadata = input.sourceSkill.metadata ?? {};
  const failureReasons =
    input.failureEvidence.failureReasons.length > 0
      ? input.failureEvidence.failureReasons.join(" | ")
      : "No structured failure reason was recorded.";
  const sourceContent = input.sourceSkill.content.trim();
  return {
    ...input.sourceSkill,
    version: bumpPatchVersion(input.sourceSkill.version),
    description:
      input.sourceSkill.description ??
      `Failure-to-patch proposal generated from repeated failures for ${input.sourceSkill.id}.`,
    content: [
      sourceContent,
      "",
      "Failure patch:",
      `- Recorded failure count: ${input.failureEvidence.failureCount}.`,
      `- Failure evidence: ${failureReasons}`,
      "- Before using this Skill again, inspect the current task context and verify the failing assumption still holds.",
      "- If the failure reason points to missing setup, credentials, unsafe access, or unavailable tools, stop and surface the required operator action instead of retrying blindly.",
      "- After applying the patch, run the smallest relevant verification and record the result in Skill usage telemetry.",
    ].join("\n"),
    updatedAtMs: input.nowMs,
    tags: uniqueStringArray([
      ...(input.sourceSkill.tags ?? []),
      "failure-derived",
      "operator-review-required",
    ]).slice(0, 16),
    metadata: {
      ...priorMetadata,
      schemaId: "skills.failure-to-patch-eval.v1",
      sourceSkillId: input.sourceSkill.id,
      skillLifecycle: "proposed",
      failurePatchPayload: {
        failureCount: input.failureEvidence.failureCount,
        lastFailedAtMs: input.failureEvidence.lastFailedAtMs,
        failureReasons: [...input.failureEvidence.failureReasons],
        evidenceRefs: [...input.failureEvidence.evidenceRefs],
      },
      failureEvidence: input.evidenceSummary,
      reviewRequirement: "operator-review-required",
      noPromotionWithoutReview: true,
      riskLevel: "high",
      confidence: 0.58,
      dedupeKey: input.dedupeKey,
      ...(input.author === undefined ? {} : { proposalAuthor: input.author }),
    },
  };
}

function buildFailurePatchEvidence(usage: SkillUsageRecord): SkillFailurePatchEvidence {
  const failureEvents = usage.events.filter((event) => event.action === "failure");
  const failureReasons = uniqueStringArray(
    failureEvents
      .map((event) => normalizeText(event.reason ?? ""))
      .filter((reason) => reason.length > 0),
  ).slice(-5);
  const evidenceRefs = failureEvents
    .slice(-5)
    .map((event) =>
      [
        "skills.usage",
        "failure",
        usage.skillId,
        String(event.occurredAtMs),
        normalizeToken(event.actor || "director"),
      ].join("://"),
    );
  return {
    failureCount: usage.failureCount,
    lastFailedAtMs: usage.lastFailedAtMs,
    failureReasons,
    evidenceRefs,
  };
}

function buildFailurePatchEvidenceSummary(evidence: SkillFailurePatchEvidence): string {
  const reasons =
    evidence.failureReasons.length > 0
      ? evidence.failureReasons.join(" | ")
      : "no structured failure reasons";
  return `${evidence.failureCount} recorded failure(s); lastFailedAtMs=${evidence.lastFailedAtMs ?? "unknown"}; reasons=${reasons}`;
}

function bumpPatchVersion(version: string): string {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(.*)$/u);
  if (match === null) {
    return `${version.trim() || "0.0.0"}.failure-patch`;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const suffix = match[4] ?? "";
  return `${major}.${minor}.${patch + 1}${suffix}`;
}

function deriveTags(digest: TrajectoryDigest): readonly string[] {
  const tags = new Set<string>(["worker-generated", "trajectory-analysis"]);
  const text = digest.latestUserText?.toLowerCase() ?? "";

  if (/\breadme\b/iu.test(text) || /\brepo\b/iu.test(text) || /\brepository\b/iu.test(text)) {
    tags.add("repo");
  }
  if (digest.toolNames.some((toolName) => toolName.includes("filesystem"))) {
    tags.add("filesystem");
  }

  return [...tags];
}

function buildEvidenceSummary(digest: TrajectoryDigest): string {
  if (digest.evidence.length === 0) {
    return "No committed evidence beyond checkpoint fallback.";
  }

  return digest.evidence
    .slice(0, 3)
    .map((entry) => entry.summary)
    .join(" | ");
}

function scoreConfidence(digest: TrajectoryDigest): number {
  let confidence = 0.9;

  if (digest.evidence.length < 2) {
    confidence -= 0.3;
  }
  if (digest.counts.toolResultCount === 0) {
    confidence -= 0.25;
  }
  if (digest.latestUserText === null) {
    confidence -= 0.1;
  }

  return Math.max(0.2, Math.min(0.95, Number(confidence.toFixed(2))));
}

function resolveRiskLevel(input: {
  readonly digest: TrajectoryDigest;
  readonly duplicateMatch?: SkillProposalDuplicateMatch;
  readonly confidence: number;
}): SkillProposalRiskLevel {
  if (
    input.digest.counts.toolResultCount === 0 ||
    input.digest.evidence.length < 2 ||
    input.confidence < 0.5
  ) {
    return "high";
  }
  if (input.duplicateMatch !== undefined) {
    return "medium";
  }
  return "low";
}

function buildExplanation(input: {
  readonly digest: TrajectoryDigest;
  readonly duplicateMatch?: SkillProposalDuplicateMatch;
  readonly confidence: number;
  readonly riskLevel: SkillProposalRiskLevel;
}): string {
  const reasons: string[] = [];

  if (input.digest.evidence.length < 2 || input.digest.counts.toolResultCount === 0) {
    reasons.push("Proposal is based on low evidence and should be reviewed carefully.");
  } else {
    reasons.push("Evidence is sufficient for a first-pass proposal.");
  }

  if (input.duplicateMatch) {
    reasons.push(
      `Potential duplicate with ${input.duplicateMatch.skillId}; recommendation=${input.duplicateMatch.recommendation}.`,
    );
  } else {
    reasons.push("No approved duplicate was found with the lightweight detector.");
  }

  reasons.push(`confidence=${input.confidence.toFixed(2)} risk=${input.riskLevel}`);

  return reasons.join(" ");
}

function buildDedupeKey(input: {
  readonly trigger: string;
  readonly toolNames: readonly string[];
  readonly tags: readonly string[];
}): string {
  const normalizedTrigger = normalizeToken(input.trigger);
  const normalizedTools = input.toolNames.map((toolName) => normalizeToken(toolName)).sort();
  const normalizedTags = input.tags
    .filter((tag) => tag !== "worker-generated" && tag !== "filesystem")
    .map((tag) => normalizeToken(tag))
    .sort();

  return [normalizedTrigger, normalizedTools.join("-"), normalizedTags.join("-")]
    .filter((segment) => segment.length > 0)
    .join("__");
}

function detectDuplicate(input: {
  readonly approvedSkills: readonly SkillSnapshot[];
  readonly dedupeKey: string;
  readonly trigger: string;
  readonly toolNames: readonly string[];
  readonly tags: readonly string[];
}): SkillProposalDuplicateMatch | undefined {
  for (const skill of input.approvedSkills) {
    const skillDedupeKey = readMetadataString(skill.metadata, "dedupeKey");
    if (skillDedupeKey && skillDedupeKey === input.dedupeKey) {
      return {
        skillId: skill.id,
        recommendation: "skip",
        reason: "Approved skill already has the same dedupe key.",
        score: 1,
      };
    }
  }

  let bestMatch: SkillProposalDuplicateMatch | undefined;
  for (const skill of input.approvedSkills) {
    const score = scoreApprovedSkillSimilarity({
      trigger: input.trigger,
      toolNames: input.toolNames,
      tags: input.tags,
      skill,
    });
    if (score < 0.6) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        skillId: skill.id,
        recommendation: "merge",
        reason: "Approved skill is materially similar under lightweight overlap rules.",
        score: Number(score.toFixed(2)),
      };
    }
  }

  return bestMatch;
}

function scoreApprovedSkillSimilarity(input: {
  readonly trigger: string;
  readonly toolNames: readonly string[];
  readonly tags: readonly string[];
  readonly skill: SkillSnapshot;
}): number {
  const toolScore = overlapRatio(input.toolNames, input.skill.toolNames ?? []);
  const tagScore = overlapRatio(
    input.tags.filter((tag) => tag !== "worker-generated"),
    input.skill.tags ?? [],
  );
  const textScore = tokenOverlapRatio(
    input.trigger,
    [input.skill.title, input.skill.description ?? "", input.skill.content].join(" "),
  );

  return toolScore * 0.45 + tagScore * 0.25 + textScore * 0.3;
}

function overlapRatio(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const normalizedLeft = new Set(left.map((entry) => normalizeToken(entry)));
  const normalizedRight = new Set(right.map((entry) => normalizeToken(entry)));
  const intersection = [...normalizedLeft].filter((entry) => normalizedRight.has(entry)).length;
  const denominator = Math.max(normalizedLeft.size, normalizedRight.size, 1);
  return intersection / denominator;
}

function tokenOverlapRatio(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((entry) => rightTokens.has(entry)).length;
  const denominator = Math.max(leftTokens.size, rightTokens.size, 1);
  return intersection / denominator;
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalizeToken(value)
      .split("-")
      .filter((entry) => entry.length > 0),
  );
}

function normalizeText(value: string | null): string {
  return value?.trim() ?? "";
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-z0-9_]+/giu, "_");
}

function sanitizeSkillTaxonomyId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (slug.length > 0) {
    return slug;
  }
  return `custom-${fallbackHash(value)}`;
}

function fallbackHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 10);
}

function uniqueStringArray(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveExperienceSkillRiskLevel(candidate: ExperienceCandidate): SkillProposalRiskLevel {
  if (
    candidate.privacy === "restricted" ||
    candidate.quality?.verdict === "quarantine" ||
    candidate.evidence.length === 0
  ) {
    return "high";
  }
  return "medium";
}

function resolveExperienceSkillConfidence(
  candidate: ExperienceCandidate,
  riskLevel: SkillProposalRiskLevel,
): number {
  if (riskLevel === "high") {
    return 0.42;
  }
  if (candidate.privacy === "public" && candidate.evidence.length >= 2) {
    return 0.78;
  }
  return 0.72;
}

function resolveExperienceModelInvocationGate(
  candidate: ExperienceCandidate,
  riskLevel: SkillProposalRiskLevel,
): "none" | "operator-review-required" | "restricted-experience" {
  if (candidate.privacy === "restricted" || riskLevel === "high") {
    return "restricted-experience";
  }
  if (candidate.privacy === "confidential") {
    return "operator-review-required";
  }
  return "none";
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  field: string,
): string | undefined {
  const value = metadata?.[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
