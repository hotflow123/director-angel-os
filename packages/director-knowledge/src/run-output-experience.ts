import { createHash } from "node:crypto";

import {
  type ExperienceCandidate,
  type ExperiencePrivacyClassification,
  type ExperienceQualityAssessment,
  type ExperienceQuarantineRecord,
  type ExperienceSourceArtifact,
  createExperienceCandidate,
  createExperienceQualityAssessment,
  createExperienceQuarantineRecord,
  createExperienceSourceAdapterDeclaration,
  createExperienceSourceArtifact,
} from "@hotflow/contracts";

import { distillExperienceDraft } from "./experience-distillation.js";

export type RunOutputExperienceIntent = "positive-experience" | "failure-lesson";

export interface RunOutputExperienceSource {
  readonly runId: string;
  readonly reportId: string;
  readonly status: string;
  readonly goal: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly roles?: readonly string[];
  readonly selectedAdapters?: readonly string[];
  readonly anchorIds?: readonly string[];
  readonly flags?: readonly string[];
  readonly summary?: readonly string[];
  readonly evidenceText: string;
  readonly recordedAt?: string;
}

export interface MaterializeRunOutputExperienceInput {
  readonly source: RunOutputExperienceSource;
  readonly intent?: RunOutputExperienceIntent;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly provenance?: string;
  readonly nowMs?: number;
}

export interface RunOutputExperienceAdmission {
  readonly status: "admitted" | "quarantined";
  readonly sourceQuality: ExperienceQualityAssessment;
  readonly claimQuality: ExperienceQualityAssessment;
  readonly reasons: readonly string[];
}

export type ExperienceExecutionModule =
  | "moyin"
  | "comfyui"
  | "api-provider"
  | "script"
  | "storyboard"
  | "media-generation"
  | "image-generation"
  | "video-generation"
  | "vision-analysis";

export type ExperienceExecutionImpact =
  | "workflow-execution"
  | "prompt-generation"
  | "model-routing"
  | "quality-gate"
  | "risk-avoidance"
  | "planning";

export type MaterializedRunOutputExperience =
  | {
      readonly status: "candidate";
      readonly artifact: ExperienceSourceArtifact;
      readonly candidate: ExperienceCandidate;
      readonly admission: RunOutputExperienceAdmission;
      readonly quarantine?: undefined;
    }
  | {
      readonly status: "quarantined";
      readonly artifact: ExperienceSourceArtifact;
      readonly quarantine: ExperienceQuarantineRecord;
      readonly admission: RunOutputExperienceAdmission;
      readonly candidate?: undefined;
    };

const BLOCKING_POSITIVE_FLAGS = new Set([
  "has-failures",
  "has-blocked-assignments",
  "has-aborted-assignments",
  "external-bridge-failed",
]);

const FAILURE_FLAGS = new Set([
  "has-failures",
  "has-blocked-assignments",
  "has-aborted-assignments",
  "external-bridge-failed",
]);

const DEFAULT_PRIVACY: ExperiencePrivacyClassification = "confidential";
const DEFAULT_PROVENANCE = "director-knowledge/run-output-experience";
const MAX_PREVIEW_CHARS = 1_200;

export function materializeRunOutputExperience(
  input: MaterializeRunOutputExperienceInput,
): MaterializedRunOutputExperience {
  const intent = input.intent ?? "positive-experience";
  const privacy = input.privacy ?? DEFAULT_PRIVACY;
  const provenance = input.provenance ?? DEFAULT_PROVENANCE;
  const createdAtMs = input.nowMs ?? toEpochMs(input.source.recordedAt) ?? Date.now();
  const source = normalizeSource(input.source);
  const sourceRef = `director-run://${source.runId}/report/${source.reportId}`;
  const rawContent = buildRawRunOutputContent(source);
  const digest = `sha256:${sha256(rawContent)}`;
  const sourceQuality = assessSourceQuality(source, rawContent);
  const executionTargets = inferExecutionTargets(source, rawContent);
  const draft = distillExperienceDraft({
    sourceKind: "session-trajectory",
    sourceId: source.runId,
    title: source.goal,
    content: rawContent,
    privacy,
    fallbackApplicability:
      intent === "failure-lesson"
        ? "Use when Director Angel needs to avoid repeating a failed production pattern."
        : "Use when Director Angel needs reusable production experience from reviewed run output.",
    baseRisks: baseRunOutputRisks(source, intent),
    baseTags: baseRunOutputTags(source, intent),
  });
  const claimQuality = assessClaimQuality(source, intent, draft.confidence);
  const admission = buildAdmission(sourceQuality, claimQuality, source, intent);
  const artifact = createExperienceSourceArtifact({
    artifactId: `artifact_run_${slugify(source.runId)}_${shortHash(digest)}`,
    sourceKind: "session-trajectory",
    sourceRef,
    title: `Run output: ${source.goal}`,
    contentType: "text/plain",
    digest,
    bytes: Buffer.byteLength(rawContent, "utf8"),
    textPreview: limitText(rawContent, MAX_PREVIEW_CHARS),
    rawContent,
    quality: sourceQuality,
    privacy,
    provenance,
    capturedAtMs: createdAtMs,
  });

  if (admission.status === "quarantined") {
    const reason =
      intent === "positive-experience"
        ? "Run output cannot become positive experience until failures and low-quality claims are reviewed."
        : "Run output was quarantined because evidence is not readable enough to support a failure lesson.";
    return {
      status: "quarantined",
      artifact,
      quarantine: createExperienceQuarantineRecord({
        quarantineId: `quarantine_run_${slugify(source.runId)}_${shortHash(`${digest}:${intent}`)}`,
        artifact,
        reason,
        notes: admission.reasons,
        createdAtMs,
      }),
      admission,
    };
  }

  const quality = mergeExperienceQuality(sourceQuality, claimQuality);
  const candidate = createExperienceCandidate({
    candidateId: `experience_run_${slugify(source.runId)}_${shortHash(`${digest}:${intent}`)}`,
    sourceAdapter: createExperienceSourceAdapterDeclaration({
      adapterId: `director_run_output_${slugify(source.runId)}`,
      sourceKind: "session-trajectory",
      sourceRef,
      privacy,
      incremental: {
        fingerprint: digest,
      },
      transformations: [
        {
          transformId: "preserve-run-output",
          kind: "normalize",
          summary: "Preserve the original Director run output as review evidence.",
          privacyImpact: privacy,
        },
        {
          transformId:
            intent === "failure-lesson" ? "extract-failure-lesson" : "extract-reusable-lesson",
          kind: "extract-pattern",
          summary:
            intent === "failure-lesson"
              ? "Extract a negative lesson that must remain review-gated."
              : "Extract a reusable production lesson that must remain review-gated.",
          privacyImpact: privacy,
        },
      ],
    }),
    title:
      intent === "failure-lesson" ? `Failure lesson: ${source.goal}` : `Run lesson: ${source.goal}`,
    summary:
      intent === "failure-lesson"
        ? buildFailureLessonSummary(draft.summary, source)
        : draft.summary,
    applicability:
      intent === "failure-lesson"
        ? `Avoid repeating this pattern when similar production goals, flags, or adapter failures appear. ${draft.applicability}`
        : draft.applicability,
    risks: [...draft.risks, ...admission.reasons.map((reason) => `Admission gate: ${reason}`)],
    tags: [...draft.tags, ...qualityTags(source, intent, claimQuality)],
    evidence: [
      {
        evidenceId: `evidence_run_${slugify(source.runId)}_${shortHash(source.reportId)}`,
        sourceRef,
        summary: draft.evidenceSummary,
        attributes: {
          runId: source.runId,
          reportId: source.reportId,
          projectId: source.projectId,
          groupId: source.groupId,
          status: source.status,
          sourceQualityScore: sourceQuality.score,
          claimQualityScore: claimQuality.score,
          flags: source.flags,
          selectedAdapters: source.selectedAdapters,
          roles: source.roles,
          anchorIds: source.anchorIds,
          executionModules: executionTargets.modules,
          executionImpacts: executionTargets.impacts,
          artifactId: artifact.artifactId,
          digest,
          intent,
        },
      },
    ],
    sourceArtifactId: artifact.artifactId,
    sourceDigest: digest,
    evidencePreview: limitText(source.evidenceText, MAX_PREVIEW_CHARS),
    quality,
    privacy,
    provenance,
    createdAtMs,
  });

  return {
    status: "candidate",
    artifact,
    candidate,
    admission,
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
    evidenceText: normalizeWhitespace(source.evidenceText),
    recordedAt: source.recordedAt ?? "",
  };
}

function buildRawRunOutputContent(source: Required<RunOutputExperienceSource>): string {
  return [
    `Goal: ${source.goal}`,
    `Run: ${source.runId}`,
    `Report: ${source.reportId}`,
    `Status: ${source.status}`,
    `Project/Group: ${source.projectId}/${source.groupId}`,
    `Roles: ${source.roles.join(", ") || "none"}`,
    `Adapters: ${source.selectedAdapters.join(", ") || "none"}`,
    `Flags: ${source.flags.join(", ") || "none"}`,
    ...source.summary.map((entry) => `Summary: ${entry}`),
    "",
    "Evidence:",
    source.evidenceText,
  ].join("\n");
}

function assessSourceQuality(
  source: Required<RunOutputExperienceSource>,
  rawContent: string,
): ExperienceQualityAssessment {
  const reasons: string[] = ["Original run output is preserved as artifact evidence."];
  let score = 100;
  const evidenceLength = source.evidenceText.length;
  if (evidenceLength < 80) {
    score -= 35;
    reasons.push("Evidence text is short; reviewer must confirm it contains enough substance.");
  }
  if (/登录后继续|扫码登录|login required|cookie policy|__webpack/iu.test(rawContent)) {
    score -= 45;
    reasons.push("Evidence contains likely login, policy, or script noise.");
  }
  if (source.summary.length === 0) {
    score -= 10;
    reasons.push("Run summary is missing.");
  }
  const normalizedScore = clampScore(score);
  return createExperienceQualityAssessment({
    score: normalizedScore,
    verdict: normalizedScore >= 55 ? "usable" : "quarantine",
    reasons,
    metrics: {
      evidenceChars: evidenceLength,
      summaryCount: source.summary.length,
      flagCount: source.flags.length,
    },
  });
}

function assessClaimQuality(
  source: Required<RunOutputExperienceSource>,
  intent: RunOutputExperienceIntent,
  confidence: string,
): ExperienceQualityAssessment {
  const reasons: string[] = [];
  let score = confidence === "high" ? 90 : confidence === "medium" ? 76 : 50;
  const blockingFlags = source.flags.filter((flag) => BLOCKING_POSITIVE_FLAGS.has(flag));
  const failureSignals = source.flags.filter((flag) => FAILURE_FLAGS.has(flag));
  const lowSignalCasualRun = isLowSignalCasualRun(source);

  if (intent === "positive-experience") {
    if (source.status !== "completed") {
      score -= 35;
      reasons.push(`Positive experience requires completed run status; observed ${source.status}.`);
    }
    if (blockingFlags.length > 0) {
      score -= 40;
      reasons.push(`Positive experience is blocked by report flags: ${blockingFlags.join(", ")}.`);
    }
    if (source.status === "completed" && blockingFlags.length === 0 && confidence === "low") {
      score = Math.max(score, 66);
      reasons.push(
        "Completed run output can enter human review even when distillation confidence is low.",
      );
    }
    if (isGenericLowValueProductionDraft(source.evidenceText)) {
      score -= 35;
      reasons.push(
        "generic low-value production draft must be quarantined before it can become positive experience.",
      );
    }
    if (lowSignalCasualRun) {
      score -= 55;
      reasons.push("low-signal casual run must not become positive experience.");
    }
    if (source.selectedAdapters.length === 0) {
      score -= 8;
      reasons.push(
        "No selected adapter was captured; reviewer should inspect the source evidence.",
      );
    }
  } else {
    if (lowSignalCasualRun && failureSignals.length === 0) {
      score -= 45;
      reasons.push("low-signal casual run has no failure evidence to become a failure lesson.");
    }
    if (source.status === "completed" && failureSignals.length === 0) {
      score -= 20;
      reasons.push("Failure lesson has no failure status or failure flags.");
    } else {
      score = Math.max(score + 12, 74);
      reasons.push("Failure signals were preserved as an explicit negative lesson.");
    }
  }

  if (confidence === "low") {
    reasons.push("Distilled claim confidence is low.");
  } else {
    reasons.push(`Distilled claim confidence is ${confidence}.`);
  }

  const normalizedScore = clampScore(score);
  return createExperienceQualityAssessment({
    score: normalizedScore,
    verdict: normalizedScore >= 65 ? "usable" : "quarantine",
    reasons,
    metrics: {
      distillationConfidence: confidence,
      blockingFlags,
      failureSignals,
      selectedAdapterCount: source.selectedAdapters.length,
    },
  });
}

function isLowSignalCasualRun(source: Required<RunOutputExperienceSource>): boolean {
  if (
    /(?:今天天气|天气不错|随便聊聊|随便说说|闲聊|没事|挺开心|hello|hi|just chatting)/iu.test(
      source.goal,
    ) &&
    !/(短剧|视频|分镜|镜头|脚本|制作|生成|学习|经验|知识|资料|链接|文件|目录|brief|story|script|video|shot)/iu.test(
      source.goal,
    )
  ) {
    return true;
  }
  const text = `${source.goal}\n${source.evidenceText}\n${source.summary.join("\n")}`;
  if (
    /(短剧|视频|分镜|镜头|脚本|制作|生成|学习|经验|知识|资料|链接|文件|目录|review|gate|brief|story|script|video|shot)/iu.test(
      text,
    )
  ) {
    return false;
  }
  return /(?:今天天气|天气不错|随便聊聊|随便说说|闲聊|没事|挺开心|心情|日常|流水账|hello|hi|just chatting)/iu.test(
    text,
  );
}

function isGenericLowValueProductionDraft(value: string): boolean {
  const text = value.toLowerCase();
  const hasLowValueMarker =
    /(无经验|无\s*skill|通用初稿|通用情境|基础性初稿|缺乏相关经验|缺少经验|后续需要补充学习|内容为通用|空泛脚本)/iu.test(
      text,
    ) ||
    /(no experience|no skill|generic draft|generic scenario|lacks concrete|needs further learning)/iu.test(
      text,
    );
  if (!hasLowValueMarker) {
    return false;
  }
  const hasConcreteProductionEvidence =
    /(镜头\d+|时长|景别|机位|运镜|动作|音效|角色|场景|冲突|转折|质量标准)/u.test(value) &&
    !/(后续需要补充学习|缺乏相关经验|内容为通用)/u.test(value);
  return !hasConcreteProductionEvidence;
}

function buildAdmission(
  sourceQuality: ExperienceQualityAssessment,
  claimQuality: ExperienceQualityAssessment,
  source: Required<RunOutputExperienceSource>,
  intent: RunOutputExperienceIntent,
): RunOutputExperienceAdmission {
  const reasons = [...sourceQuality.reasons, ...claimQuality.reasons];
  const positiveBlocked =
    intent === "positive-experience" &&
    (source.status !== "completed" ||
      source.flags.some((flag) => BLOCKING_POSITIVE_FLAGS.has(flag)));
  const status =
    sourceQuality.verdict === "usable" && claimQuality.verdict === "usable" && !positiveBlocked
      ? "admitted"
      : "quarantined";
  return {
    status,
    sourceQuality,
    claimQuality,
    reasons,
  };
}

function mergeExperienceQuality(
  sourceQuality: ExperienceQualityAssessment,
  claimQuality: ExperienceQualityAssessment,
): ExperienceQualityAssessment {
  const score = clampScore(Math.round(sourceQuality.score * 0.4 + claimQuality.score * 0.6));
  return createExperienceQualityAssessment({
    score,
    verdict:
      sourceQuality.verdict === "usable" && claimQuality.verdict === "usable"
        ? "usable"
        : "quarantine",
    reasons: [
      "Run output candidate passed source-quality and claim-quality gates.",
      ...sourceQuality.reasons.map((reason) => `sourceQuality: ${reason}`),
      ...claimQuality.reasons.map((reason) => `claimQuality: ${reason}`),
    ],
    metrics: {
      sourceQualityScore: sourceQuality.score,
      claimQualityScore: claimQuality.score,
    },
  });
}

function baseRunOutputRisks(
  source: Required<RunOutputExperienceSource>,
  intent: RunOutputExperienceIntent,
): readonly string[] {
  return [
    "AI-generated production output must stay review-gated and evidence-backed before promotion.",
    `Run status: ${source.status}.`,
    ...(source.flags.length === 0 ? [] : [`Run flags: ${source.flags.join(", ")}.`]),
    ...(intent === "failure-lesson"
      ? ["Failure lessons must be recalled as avoid-patterns, not as positive operating methods."]
      : []),
  ];
}

function baseRunOutputTags(
  source: Required<RunOutputExperienceSource>,
  intent: RunOutputExperienceIntent,
): readonly string[] {
  return [
    "source:director-run",
    "run-output",
    `status:${slugify(source.status)}`,
    `project:${slugify(source.projectId)}`,
    `group:${slugify(source.groupId)}`,
    ...(intent === "failure-lesson" ? ["failure-lesson", "negative-experience"] : []),
    ...source.roles.map((role) => `role:${slugify(role)}`),
    ...source.selectedAdapters.map((adapter) => `adapter:${slugify(adapter)}`),
  ];
}

function qualityTags(
  source: Required<RunOutputExperienceSource>,
  intent: RunOutputExperienceIntent,
  claimQuality: ExperienceQualityAssessment,
): readonly string[] {
  const executionTargets = inferExecutionTargets(source, buildRawRunOutputContent(source));
  return [
    ...baseRunOutputTags(source, intent),
    claimQuality.verdict === "usable" ? "quality:claim-usable" : "quality:claim-quarantine",
    ...executionTargets.modules.map((module) => `execution-module:${module}`),
    ...executionTargets.impacts.map((impact) => `execution-impact:${impact}`),
  ];
}

function inferExecutionTargets(
  source: Required<RunOutputExperienceSource>,
  rawContent: string,
): {
  readonly modules: readonly ExperienceExecutionModule[];
  readonly impacts: readonly ExperienceExecutionImpact[];
} {
  const text = [
    source.goal,
    source.projectId,
    source.groupId,
    source.roles.join(" "),
    source.selectedAdapters.join(" "),
    rawContent,
  ]
    .join("\n")
    .toLowerCase();
  const modules = new Set<ExperienceExecutionModule>();
  const impacts = new Set<ExperienceExecutionImpact>();

  if (/(moyin|魔因)/iu.test(text)) {
    modules.add("moyin");
    modules.add("media-generation");
    impacts.add("workflow-execution");
  }
  if (/(comfyui|comfy|workflow|工作流)/iu.test(text)) {
    modules.add("comfyui");
    modules.add("media-generation");
    impacts.add("workflow-execution");
  }
  if (
    /(api-provider|provider|模型路由|模型映射|文本模型|视觉模型|图片模型|视频模型)/iu.test(text)
  ) {
    modules.add("api-provider");
    impacts.add("model-routing");
  }
  if (/(script|脚本|剧本|文案|prompt|提示词)/iu.test(text)) {
    modules.add("script");
    impacts.add("prompt-generation");
  }
  if (/(storyboard|分镜|镜头|shot|镜头级|镜头语言)/iu.test(text)) {
    modules.add("storyboard");
    impacts.add("planning");
  }
  if (/(image|图片|首帧|文生图|图生图)/iu.test(text)) {
    modules.add("image-generation");
    modules.add("media-generation");
  }
  if (/(video|视频|图生视频|文生视频|seedance|sora|可灵)/iu.test(text)) {
    modules.add("video-generation");
    modules.add("media-generation");
  }
  if (/(vision|视觉|看图|识别|ocr|图片识别|视频识别)/iu.test(text)) {
    modules.add("vision-analysis");
    impacts.add("quality-gate");
  }
  if (/(避免|不要|风险|失败|过审|质量|门禁|检查|审核)/iu.test(text)) {
    impacts.add("risk-avoidance");
    impacts.add("quality-gate");
  }

  if (modules.size === 0 && /(制作|生成|短剧|导演|媒体)/iu.test(text)) {
    modules.add("script");
    modules.add("storyboard");
    impacts.add("planning");
  }

  return {
    modules: sortStrings([...modules]) as readonly ExperienceExecutionModule[],
    impacts: sortStrings([...impacts]) as readonly ExperienceExecutionImpact[],
  };
}

function buildFailureLessonSummary(
  distilledSummary: string,
  source: Required<RunOutputExperienceSource>,
): string {
  const flags = source.flags.length === 0 ? "no explicit flags" : source.flags.join(", ");
  return limitText(`失败教训：${distilledSummary}；状态=${source.status}；flags=${flags}`, 360);
}

function toEpochMs(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function limitText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return sha256(value).slice(0, 12);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : "unknown";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function sortStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
