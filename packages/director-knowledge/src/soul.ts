import { createHash } from "node:crypto";

import type { DirectorReflectionReport } from "./reflection.js";

export type DirectorSoulCandidateRiskLevel = "low" | "medium" | "high";
export type DirectorSoulCandidateStatus = "pending" | "accepted" | "rejected";
export type DirectorSoulDecisionStatus = "accepted" | "rejected";

export interface DirectorSoulCandidate {
  readonly schemaVersion: "director.soul.candidate.v1";
  readonly candidateId: string;
  readonly sourceReflectionId: string;
  readonly sourceKind: DirectorReflectionReport["sourceKind"];
  readonly sourceId: string;
  readonly patchSummary: string;
  readonly proposedSections: Record<string, string>;
  readonly evidenceRefs: readonly string[];
  readonly riskLevel: DirectorSoulCandidateRiskLevel;
  readonly status: DirectorSoulCandidateStatus;
  readonly createdAt: string;
}

export interface DirectorSoulDecision {
  readonly schemaVersion: "director.soul.decision.v1";
  readonly decisionId: string;
  readonly candidateId: string;
  readonly decision: DirectorSoulDecisionStatus;
  readonly actor?: string;
  readonly note?: string;
  readonly decidedAt: string;
}

export interface DirectorSoulDocument {
  readonly schemaVersion: "director.soul.v1";
  readonly sourceCandidateId: string;
  readonly sourceReflectionId: string;
  readonly sourceId: string;
  readonly updatedAt: string;
  readonly evidenceRefs: readonly string[];
  readonly sections: Record<string, string>;
}

export interface MaterializeDirectorSoulCandidateFromReflectionInput {
  readonly reflection: DirectorReflectionReport;
  readonly nowMs?: number;
}

export interface MaterializeDirectorSoulDecisionInput {
  readonly candidate: DirectorSoulCandidate;
  readonly decision: DirectorSoulDecisionStatus;
  readonly actor?: string;
  readonly note?: string;
  readonly nowMs?: number;
}

export interface MaterializeDirectorSoulDocumentFromCandidateInput {
  readonly candidate: DirectorSoulCandidate;
  readonly decision: DirectorSoulDecision;
  readonly current?: DirectorSoulDocument | null;
  readonly nowMs?: number;
}

export function materializeDirectorSoulCandidateFromReflection(
  input: MaterializeDirectorSoulCandidateFromReflectionInput,
): DirectorSoulCandidate | null {
  const reflection = input.reflection;
  if (reflection.suggestedSoulUpdates.length === 0) {
    return null;
  }

  const createdAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const riskLevel = reflection.outcome === "success" ? "low" : "medium";
  const proposedSections = createSoulCandidateSections(reflection);
  const fingerprint = [
    reflection.reflectionId,
    reflection.sourceId,
    reflection.outcome,
    reflection.suggestedSoulUpdates.join("\n"),
    Object.values(proposedSections).join("\n"),
  ].join("\n");

  return {
    schemaVersion: "director.soul.candidate.v1",
    candidateId: `soul_reflection_${slugify(reflection.sourceId)}_${shortHash(fingerprint)}`,
    sourceReflectionId: reflection.reflectionId,
    sourceKind: reflection.sourceKind,
    sourceId: reflection.sourceId,
    patchSummary: createSoulPatchSummary(reflection),
    proposedSections,
    evidenceRefs: [...reflection.evidenceRefs],
    riskLevel,
    status: "pending",
    createdAt,
  };
}

export function materializeDirectorSoulDecision(
  input: MaterializeDirectorSoulDecisionInput,
): DirectorSoulDecision {
  const decidedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const fingerprint = [
    input.candidate.candidateId,
    input.decision,
    input.actor ?? "",
    input.note ?? "",
    decidedAt,
  ].join("\n");
  return {
    schemaVersion: "director.soul.decision.v1",
    decisionId: `soul_decision_${slugify(input.candidate.candidateId)}_${shortHash(fingerprint)}`,
    candidateId: input.candidate.candidateId,
    decision: input.decision,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.note === undefined ? {} : { note: input.note }),
    decidedAt,
  };
}

export function materializeDirectorSoulDocumentFromCandidate(
  input: MaterializeDirectorSoulDocumentFromCandidateInput,
): DirectorSoulDocument {
  if (input.decision.decision !== "accepted") {
    throw new Error("Director Soul document can only be materialized from an accepted decision.");
  }
  if (input.decision.candidateId !== input.candidate.candidateId) {
    throw new Error("Director Soul decision candidateId does not match the candidate.");
  }

  const currentSections = input.current?.sections ?? {};
  return {
    schemaVersion: "director.soul.v1",
    sourceCandidateId: input.candidate.candidateId,
    sourceReflectionId: input.candidate.sourceReflectionId,
    sourceId: input.candidate.sourceId,
    updatedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    evidenceRefs: uniqueStrings([
      ...(input.current?.evidenceRefs ?? []),
      ...input.candidate.evidenceRefs,
    ]),
    sections: {
      ...currentSections,
      ...input.candidate.proposedSections,
    },
  };
}

export function renderDirectorSoulMarkdown(document: DirectorSoulDocument): string {
  const lines = [
    "# Director Angel Soul",
    "",
    `Updated: ${document.updatedAt}`,
    `Source candidate: ${document.sourceCandidateId}`,
    `Source reflection: ${document.sourceReflectionId}`,
    "",
  ];

  for (const [key, value] of Object.entries(document.sections)) {
    lines.push(`## ${formatSectionTitle(key)}`, "", value.trim() || "(empty)", "");
  }

  if (document.evidenceRefs.length > 0) {
    lines.push("## Evidence", "");
    for (const ref of document.evidenceRefs) {
      lines.push(`- ${ref}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function isDirectorSoulCandidate(value: unknown): value is DirectorSoulCandidate {
  return (
    isRecord(value) &&
    value.schemaVersion === "director.soul.candidate.v1" &&
    typeof value.candidateId === "string" &&
    typeof value.sourceReflectionId === "string" &&
    typeof value.sourceId === "string" &&
    isRecord(value.proposedSections) &&
    Array.isArray(value.evidenceRefs) &&
    (value.status === "pending" || value.status === "accepted" || value.status === "rejected")
  );
}

export function isDirectorSoulDocument(value: unknown): value is DirectorSoulDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === "director.soul.v1" &&
    typeof value.sourceCandidateId === "string" &&
    typeof value.sourceReflectionId === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.updatedAt === "string" &&
    isRecord(value.sections) &&
    Array.isArray(value.evidenceRefs)
  );
}

function createSoulPatchSummary(reflection: DirectorReflectionReport): string {
  if (reflection.outcome === "success") {
    return `建议把“${reflection.goal}”中已验证的制作偏好进入 Soul 候选。`;
  }
  return `建议把“${reflection.goal}”中的失败模式进入 Soul 候选，作为避坑偏好审查。`;
}

function createSoulCandidateSections(reflection: DirectorReflectionReport): Record<string, string> {
  const sections: Record<string, string> = {
    directorPrinciples: [
      "长期偏好和原则只能通过 SoulCandidate 审核进入发布态。",
      "人工审查通过前，候选不得替代经验库、知识库或运行时 policy。",
      ...reflection.suggestedSoulUpdates,
    ].join("\n"),
    userPreferences: [
      `来源目标：${reflection.goal}`,
      ...reflection.suggestedSoulUpdates,
      ...reflection.reusableLessons,
    ].join("\n"),
  };

  if (reflection.failureLessons.length > 0 || reflection.outcome !== "success") {
    sections.userBoundaries = [
      "失败、阻塞或混合结果不能自动写入 Soul。",
      "重复失败模式只能作为用户禁忌或制作避坑偏好候选。",
    ].join("\n");
    sections.failureLessons = reflection.failureLessons.join("\n");
  }

  return sections;
}

function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9_-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatSectionTitle(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
