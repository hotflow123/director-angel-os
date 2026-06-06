import { createHash } from "node:crypto";

import type { ExperiencePrivacyClassification } from "@hotflow/contracts";

import {
  type MaterializedRunOutputExperience,
  type RunOutputExperienceIntent,
  type RunOutputExperienceSource,
  materializeRunOutputExperience,
} from "./run-output-experience.js";

export type DirectorReflectionOutcome = "success" | "failure" | "mixed" | "unknown";
export type DirectorReflectionStatus = "draft" | "candidate_generated" | "reviewed";
export type DirectorReflectionExperienceIntent = RunOutputExperienceIntent | "none";

export interface DirectorReflectionToolUseSummary {
  readonly roles: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly anchorIds: readonly string[];
}

export interface DirectorReflectionCostSummary {
  readonly status: "unknown" | "captured";
  readonly notes: readonly string[];
}

export interface DirectorReflectionReport {
  readonly schemaVersion: "director.reflection.report.v1";
  readonly reflectionId: string;
  readonly sourceKind: "run" | "trace-proposal" | "experience" | "session";
  readonly sourceId: string;
  readonly reportId: string;
  readonly goal: string;
  readonly outcome: DirectorReflectionOutcome;
  readonly whatWorked: readonly string[];
  readonly whatFailed: readonly string[];
  readonly reusableLessons: readonly string[];
  readonly failureLessons: readonly string[];
  readonly suggestedExperienceIntent: DirectorReflectionExperienceIntent;
  readonly suggestedSoulUpdates: readonly string[];
  readonly suggestedSkillUpdates: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly flags: readonly string[];
  readonly toolUse: DirectorReflectionToolUseSummary;
  readonly cost: DirectorReflectionCostSummary;
  readonly reviewRequired: boolean;
  readonly nextActions: readonly string[];
  readonly status: DirectorReflectionStatus;
  readonly createdAt: string;
}

export interface MaterializeDirectorReflectionReportInput {
  readonly source: RunOutputExperienceSource;
  readonly nowMs?: number;
}

export interface ReflectionExperienceCandidateRecommendation {
  readonly intent: RunOutputExperienceIntent;
  readonly materialized: MaterializedRunOutputExperience;
}

export interface MaterializedReflectionExperienceCandidates {
  readonly recommended: ReflectionExperienceCandidateRecommendation | null;
  readonly blockedPositive?: MaterializedRunOutputExperience;
}

export interface MaterializeReflectionExperienceCandidatesInput {
  readonly reflection: DirectorReflectionReport;
  readonly source: RunOutputExperienceSource;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly nowMs?: number;
}

const FAILURE_FLAGS = new Set([
  "failed",
  "has-failures",
  "has-blocked-assignments",
  "has-aborted-assignments",
  "external-bridge-failed",
]);

export function materializeDirectorReflectionReport(
  input: MaterializeDirectorReflectionReportInput,
): DirectorReflectionReport {
  const source = normalizeSource(input.source);
  const createdAt = new Date(
    input.nowMs ?? toEpochMs(source.recordedAt) ?? Date.now(),
  ).toISOString();
  const outcome = deriveOutcome(source);
  const suggestedExperienceIntent = deriveSuggestedExperienceIntent(outcome);
  const reflectionText = [
    source.runId,
    source.reportId,
    source.status,
    source.goal,
    source.flags.join(","),
    source.summary.join("\n"),
    source.evidenceText,
  ].join("\n");

  return {
    schemaVersion: "director.reflection.report.v1",
    reflectionId: `reflection_run_${slugify(source.runId)}_${shortHash(reflectionText)}`,
    sourceKind: "run",
    sourceId: source.runId,
    reportId: source.reportId,
    goal: source.goal,
    outcome,
    whatWorked: deriveWhatWorked(source, outcome),
    whatFailed: deriveWhatFailed(source, outcome),
    reusableLessons: deriveReusableLessons(source, outcome),
    failureLessons: deriveFailureLessons(source, outcome),
    suggestedExperienceIntent,
    suggestedSoulUpdates: deriveSoulSuggestions(source, outcome),
    suggestedSkillUpdates: deriveSkillSuggestions(source, outcome),
    evidenceRefs: [`director-run://${source.runId}/report/${source.reportId}`],
    flags: source.flags,
    toolUse: {
      roles: source.roles,
      selectedAdapters: source.selectedAdapters,
      anchorIds: source.anchorIds,
    },
    cost: {
      status: "unknown",
      notes: ["当前 run report source 未捕获 token 或费用指标；后续成本护栏需要补齐。"],
    },
    reviewRequired: true,
    nextActions: deriveNextActions(source, outcome, suggestedExperienceIntent),
    status: "draft",
    createdAt,
  };
}

export function materializeReflectionExperienceCandidates(
  input: MaterializeReflectionExperienceCandidatesInput,
): MaterializedReflectionExperienceCandidates {
  const nowMs = input.nowMs;
  const recommended =
    input.reflection.suggestedExperienceIntent === "none"
      ? null
      : {
          intent: input.reflection.suggestedExperienceIntent,
          materialized: materializeRunOutputExperience({
            source: input.source,
            intent: input.reflection.suggestedExperienceIntent,
            privacy: input.privacy ?? "confidential",
            provenance: "director-knowledge/reflection",
            ...(nowMs === undefined ? {} : { nowMs }),
          }),
        };
  const blockedPositive =
    input.reflection.outcome === "success"
      ? undefined
      : materializeRunOutputExperience({
          source: input.source,
          intent: "positive-experience",
          privacy: input.privacy ?? "confidential",
          provenance: "director-knowledge/reflection-positive-block",
          ...(nowMs === undefined ? {} : { nowMs }),
        });

  return {
    recommended,
    ...(blockedPositive === undefined ? {} : { blockedPositive }),
  };
}

function normalizeSource(source: RunOutputExperienceSource): Required<RunOutputExperienceSource> {
  return {
    runId: source.runId,
    reportId: source.reportId,
    status: source.status,
    goal: source.goal,
    projectId: source.projectId,
    groupId: source.groupId,
    roles: [...(source.roles ?? [])],
    selectedAdapters: [...(source.selectedAdapters ?? [])],
    anchorIds: [...(source.anchorIds ?? [])],
    flags: [...(source.flags ?? [])],
    summary: [...(source.summary ?? [])],
    evidenceText: source.evidenceText.trim(),
    recordedAt: source.recordedAt ?? "",
  };
}

function deriveOutcome(source: Required<RunOutputExperienceSource>): DirectorReflectionOutcome {
  const hasFailureSignal = source.flags.some((flag) => FAILURE_FLAGS.has(flag));
  if (source.status === "failed" || source.status === "aborted") {
    return "failure";
  }
  if (source.status === "completed" && hasFailureSignal) {
    return "mixed";
  }
  if (source.status === "completed") {
    return "success";
  }
  if (hasFailureSignal) {
    return "mixed";
  }
  return "unknown";
}

function deriveSuggestedExperienceIntent(
  outcome: DirectorReflectionOutcome,
): DirectorReflectionExperienceIntent {
  if (outcome === "success") {
    return "positive-experience";
  }
  if (outcome === "failure" || outcome === "mixed") {
    return "failure-lesson";
  }
  return "none";
}

function deriveWhatWorked(
  source: Required<RunOutputExperienceSource>,
  outcome: DirectorReflectionOutcome,
): readonly string[] {
  const worked: string[] = [];
  if (outcome === "success") {
    worked.push("运行已完成，且没有失败标记。");
  }
  if (outcome === "mixed") {
    worked.push("部分步骤完成，但 run report 同时包含失败或阻塞信号。");
  }
  if (source.selectedAdapters.length > 0) {
    worked.push(`已记录 adapter 路由：${source.selectedAdapters.join(", ")}。`);
  }
  if (source.roles.length > 0) {
    worked.push(`已记录参与角色：${source.roles.join(", ")}。`);
  }
  return worked;
}

function deriveWhatFailed(
  source: Required<RunOutputExperienceSource>,
  outcome: DirectorReflectionOutcome,
): readonly string[] {
  if (outcome === "success") {
    return [];
  }
  const failed: string[] = [];
  if (source.status !== "completed") {
    failed.push(`运行状态不是 completed：${source.status}。`);
  }
  const failureFlags = source.flags.filter((flag) => FAILURE_FLAGS.has(flag));
  if (failureFlags.length > 0) {
    failed.push(`失败/阻塞标记：${failureFlags.join(", ")}。`);
  }
  const evidenceFailure = extractFailureEvidence(source.evidenceText);
  if (evidenceFailure.length > 0) {
    failed.push(...evidenceFailure);
  }
  if (failed.length === 0 && outcome === "unknown") {
    failed.push("运行尚未形成可判断的完成或失败证据。");
  }
  return failed;
}

function deriveReusableLessons(
  source: Required<RunOutputExperienceSource>,
  outcome: DirectorReflectionOutcome,
): readonly string[] {
  if (outcome !== "success") {
    return [];
  }
  return [
    ...source.summary.filter((entry) => entry.trim().length > 0),
    "正向经验只能在人工审查后进入 experience -> knowledge -> publish -> recall 链路。",
  ];
}

function deriveFailureLessons(
  source: Required<RunOutputExperienceSource>,
  outcome: DirectorReflectionOutcome,
): readonly string[] {
  if (outcome === "success") {
    return [];
  }
  if (outcome === "unknown") {
    return ["证据不足时不要沉淀为经验；先补充 run report 或人工审查结论。"];
  }
  return [
    `该运行 outcome=${outcome}，不能沉淀为正向经验。`,
    ...(source.flags.length === 0
      ? []
      : [`下次遇到 flags=${source.flags.join(", ")} 时先走失败教训审查。`]),
  ];
}

function deriveSoulSuggestions(
  source: Required<RunOutputExperienceSource>,
  outcome: DirectorReflectionOutcome,
): readonly string[] {
  if (outcome === "success") {
    return [`可考虑把“${source.goal}”的成功偏好提为 SoulCandidate，但必须先由用户审查。`];
  }
  if (outcome === "failure" || outcome === "mixed") {
    return ["可考虑把反复失败模式提为用户禁忌或制作避坑偏好，但不能自动写入 Soul。"];
  }
  return [];
}

function deriveSkillSuggestions(
  source: Required<RunOutputExperienceSource>,
  outcome: DirectorReflectionOutcome,
): readonly string[] {
  if (outcome === "success" && source.roles.length > 0) {
    return [`可为 ${source.roles.join(", ")} 生成待审 Skill 提案，禁止直接安装启用。`];
  }
  if (outcome === "failure" || outcome === "mixed") {
    return ["可生成失败诊断 Skill 提案，但必须附带权限清单和测试结果。"];
  }
  return [];
}

function deriveNextActions(
  source: Required<RunOutputExperienceSource>,
  outcome: DirectorReflectionOutcome,
  intent: DirectorReflectionExperienceIntent,
): readonly string[] {
  const actions = [`查看原始报告：director-run://${source.runId}/report/${source.reportId}`];
  if (intent === "positive-experience") {
    actions.push("生成正向经验候选，等待人工审核。");
  } else if (intent === "failure-lesson") {
    actions.push("生成失败教训候选，等待人工审核。");
  } else {
    actions.push("先补充证据或重新生成 run report，再决定是否沉淀。");
  }
  if (outcome !== "success") {
    actions.push("不要把该 run 作为正向经验发布。");
  }
  return actions;
}

function extractFailureEvidence(evidenceText: string): readonly string[] {
  return evidenceText
    .split(/[。\n]/u)
    .map((entry) => entry.trim())
    .filter((entry) => /failed|failure|blocked|timeout|timed out|失败|阻塞|超时|缺少/iu.test(entry))
    .slice(0, 4)
    .map((entry) => `证据：${entry}。`);
}

function toEpochMs(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : "unknown";
}
