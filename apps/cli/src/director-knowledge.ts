import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  type ExperienceCandidate,
  type ExperiencePrivacyClassification,
  type ExperiencePromotionRecord,
  type ExperienceReviewDecision,
  type ExperienceReviewDecisionStatus,
  createExperienceCandidate,
  createExperienceReviewDecision,
} from "@hotflow/contracts";
import { FileSystemRunStore } from "@hotflow/director-execution";
import type { ExecutionRunReport } from "@hotflow/director-execution-contracts";
import {
  DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS,
  DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS,
  type DirectorDailySelfReflectionInput,
  type DirectorDailySelfReflectionResult,
  type DirectorKnowledgeCandidateDocument,
  DirectorKnowledgeCandidateSyncService,
  type DirectorKnowledgePackDocument,
  type DirectorKnowledgeRecallPacket,
  type DirectorKnowledgeRecallQuery,
  type DirectorKnowledgeReviewDecision,
  type DirectorKnowledgeRollbackRecord,
  type DirectorReflectionReport,
  type DirectorSoulCandidate,
  type DirectorSoulDecision,
  type DirectorSoulDocument,
  type DistillExperienceDraftInput,
  type DistilledExperienceDraft,
  type ExperienceCandidateTaxonomyRecord,
  type ExperienceCategoryRecord,
  type ExperienceDistiller,
  ExperiencePromotionService,
  type ExperienceTagRecord,
  type ExperienceTaxonomySnapshot,
  FileExperienceStore,
  FileExperienceTaxonomyStore,
  FileKnowledgeStore,
  LocalDirectoryExperienceAdapter,
  type MaterializedReflectionExperienceCandidates,
  type MaterializedRunOutputExperience,
  PastedTextExperienceAdapter,
  type PromoteAcceptedExperienceCandidateResult,
  type PublishDirectorKnowledgeCandidateResult,
  type ReviewDirectorKnowledgeCandidateResult,
  type RunDirectorHeartbeatInput,
  type RunDirectorHeartbeatStructuredResult,
  type RunOutputExperienceIntent,
  type RunOutputExperienceSource,
  SelfLearningOrchestrator,
  type WebExperienceFetchText,
  type WebExperienceSearch,
  WebExperienceSourceAdapter,
  WebSearchExperienceAdapter,
  createDirectorKnowledgeLifecycleService,
  describeDirectorHeartbeatStatus,
  formatDirectorDailySelfReflectionReport,
  materializeDirectorReflectionReport,
  materializeDirectorSoulCandidateFromReflection,
  materializeDirectorSoulDecision,
  materializeDirectorSoulDocumentFromCandidate,
  materializeReflectionExperienceCandidates,
  materializeRunOutputExperience,
  recallPublishedKnowledge,
  renderDirectorSoulMarkdown,
  runDirectorDailySelfReflection,
  runDirectorHeartbeat,
  runDirectorHeartbeatStructured,
} from "@hotflow/director-knowledge";
import { FileSystemDirectorProposalStore } from "@hotflow/director-proposals";
import {
  loadDirectorApiProviderConfig,
  loadDirectorSwitchState,
  runDirectorApiProviderTextCompletion,
} from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

export { describeDirectorHeartbeatStatus, runDirectorHeartbeat, runDirectorHeartbeatStructured };
export type { RunDirectorHeartbeatInput, RunDirectorHeartbeatStructuredResult };
export { formatDirectorDailySelfReflectionReport, runDirectorDailySelfReflection };
export type { DirectorDailySelfReflectionInput, DirectorDailySelfReflectionResult };

export interface PublishDirectorKnowledgePackInput {
  readonly proposalId: string;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface SyncDirectorKnowledgeCandidateInput {
  readonly proposalId: string;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface DecideDirectorKnowledgeCandidateInput {
  readonly packId: string;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface DecideDirectorKnowledgeCandidateStructuredInput
  extends DecideDirectorKnowledgeCandidateInput {
  readonly decision: DirectorKnowledgeReviewDecision["decision"];
}

export interface PublishDirectorKnowledgeCandidateInput {
  readonly packId: string;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface RollbackDirectorKnowledgePackInput {
  readonly packId: string;
  readonly version: number;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface PreviewDirectorKnowledgeRecallInput extends DirectorKnowledgeRecallQuery {}

export interface LearnDirectorExperienceInput {
  readonly directories?: readonly string[];
  readonly urls?: readonly string[];
  readonly queries?: readonly string[];
  readonly texts?: readonly LearnDirectorExperienceTextInput[];
  readonly privacy?: ExperiencePrivacyClassification;
  readonly maxDepth?: number;
  readonly maxResultsPerQuery?: number;
  readonly search?: WebExperienceSearch;
  readonly fetchText?: WebExperienceFetchText;
  readonly distillationProviderId?: string;
  readonly distillationModel?: string;
  readonly disableModelDistillation?: boolean;
  readonly apiProviderFetch?: NonNullable<
    Parameters<typeof runDirectorApiProviderTextCompletion>[1]["fetchImpl"]
  >;
}

export interface LearnDirectorExperienceTextInput {
  readonly title?: string;
  readonly content: string;
  readonly sourceRef?: string;
  readonly contentType?: string;
}

export interface DecideDirectorExperienceCandidateInput {
  readonly candidateId: string;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface PromoteDirectorExperienceCandidateInput {
  readonly candidateId: string;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface CreateDirectorExperienceFromRunReportInput {
  readonly runId: string;
  readonly intent?: RunOutputExperienceIntent;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly now?: string;
}

export interface CreateDirectorExperienceFromTraceProposalInput {
  readonly proposalId: string;
  readonly intent?: RunOutputExperienceIntent;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly now?: string;
}

export interface CreateDirectorExperienceFromRunOutputResult {
  readonly materialized: MaterializedRunOutputExperience;
  readonly write: {
    readonly status: "ok" | "degraded";
    readonly notes: readonly string[];
  };
}

export interface CreateDirectorReflectionFromRunReportInput {
  readonly runId: string;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly now?: string;
  readonly writeExperienceCandidate?: boolean;
  readonly writeSoulCandidate?: boolean;
}

export interface CreateDirectorReflectionFromRunReportResult {
  readonly reflection: DirectorReflectionReport;
  readonly reflectionWrite: {
    readonly status: "ok" | "degraded";
    readonly path: string;
    readonly notes: readonly string[];
  };
  readonly experience: MaterializedReflectionExperienceCandidates;
  readonly experienceWrite: {
    readonly status: "ok" | "degraded";
    readonly notes: readonly string[];
  } | null;
  readonly soulCandidate: DirectorSoulCandidate | null;
  readonly soulWrite: {
    readonly status: "ok" | "degraded";
    readonly path: string;
    readonly notes: readonly string[];
  } | null;
}

export interface DecideDirectorSoulCandidateInput {
  readonly candidateId: string;
  readonly author?: string;
  readonly note?: string;
  readonly now?: string;
}

export interface UpsertDirectorExperienceCategoryInput {
  readonly categoryId?: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

export interface UpsertDirectorExperienceTagInput {
  readonly tagId?: string;
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

export interface UpdateDirectorExperienceTaxonomyInput {
  readonly candidateId: string;
  readonly categoryId?: string;
  readonly tagIds?: readonly string[];
  readonly updatedBy?: string;
  readonly nowMs?: number;
}

export interface ClassifyDirectorExperienceCandidateInput {
  readonly candidateId: string;
  readonly categoryId: string;
  readonly tagIds?: readonly string[];
  readonly author?: string;
  readonly nowMs?: number;
}

export interface TagDirectorExperienceCandidateInput {
  readonly candidateId: string;
  readonly tagIds: readonly string[];
  readonly author?: string;
  readonly nowMs?: number;
}

export interface UpdateDirectorExperienceCandidateInput {
  readonly candidateId: string;
  readonly title?: string;
  readonly summary?: string;
  readonly applicability?: string;
  readonly risks?: readonly string[];
  readonly tags?: readonly string[];
  readonly author?: string;
}

export interface UpdateDirectorExperienceCandidateResult {
  readonly previous: ExperienceCandidate;
  readonly updated: ExperienceCandidate;
  readonly write: {
    readonly status: "ok" | "degraded";
    readonly notes: readonly string[];
  };
}

export interface DecideDirectorExperienceCandidateStructuredInput
  extends DecideDirectorExperienceCandidateInput {
  readonly decision: ExperienceReviewDecisionStatus;
}

export interface DecideDirectorExperienceCandidateStructuredResult {
  readonly candidate: ExperienceCandidate;
  readonly review: ExperienceReviewDecision;
  readonly write: {
    readonly status: "ok" | "degraded";
    readonly notes: readonly string[];
  };
}

export type DirectorExperienceCandidateStatus = "pending" | "accepted" | "rejected";

export interface DirectorExperienceCandidateInspection {
  readonly candidate: ExperienceCandidate;
  readonly status: DirectorExperienceCandidateStatus;
  readonly latestReview: ExperienceReviewDecision | null;
  readonly promotions: readonly ExperiencePromotionRecord[];
  readonly latestPromotion: ExperiencePromotionRecord | null;
  readonly promoted: boolean;
  readonly taxonomy: ExperienceCandidateTaxonomyRecord | null;
}

export interface DirectorExperienceCandidatesInspection {
  readonly total: number;
  readonly artifactTotal: number;
  readonly quarantineTotal: number;
  readonly candidates: readonly DirectorExperienceCandidateInspection[];
  readonly artifacts: readonly unknown[];
  readonly quarantined: readonly unknown[];
  readonly taxonomy: ExperienceTaxonomySnapshot;
}

export interface KnowledgeEvolutionSwitchState {
  readonly enabled: boolean;
  readonly autoCandidate: boolean;
  readonly publish: boolean;
}

export interface DirectorKnowledgeLaneInspection {
  readonly enabled: boolean;
  readonly switchSource: string;
  readonly switchPath?: string;
  readonly publishedCount: number;
  readonly candidateCount: number;
  readonly reviewQueueCount: number;
  readonly rollbackCount: number;
  readonly hasCandidate: boolean;
  readonly latestPublishedDocument: DirectorKnowledgePackDocument | null;
  readonly latestRollbackRecord: DirectorKnowledgeRollbackRecord | null;
  readonly knowledgeEvolution: KnowledgeEvolutionSwitchState;
}

export interface DirectorKnowledgeRecallInspection {
  readonly enabled: boolean;
  readonly switchSource: string;
  readonly switchPath?: string;
  readonly packet: DirectorKnowledgeRecallPacket | null;
}

export type DirectorKnowledgeCandidateStatus = "pending" | "accepted" | "rejected" | "stale";

export interface DirectorKnowledgeCandidateInspection {
  readonly candidate: DirectorKnowledgeCandidateDocument;
  readonly status: DirectorKnowledgeCandidateStatus;
  readonly latestReview: DirectorKnowledgeReviewDecision | null;
}

export interface DirectorKnowledgeCandidatesInspection {
  readonly total: number;
  readonly candidates: readonly DirectorKnowledgeCandidateInspection[];
}

export async function describeDirectorKnowledgeStatus(workspaceRoot: string): Promise<string> {
  const inspection = await inspectDirectorKnowledgeLane(workspaceRoot);
  const knowledgeEvolution = formatKnowledgeEvolutionSwitches(inspection.knowledgeEvolution);
  const latestPublishedAt = inspection.latestPublishedDocument?.audit.publishedAt ?? "(none)";
  const latestRollbackAt = inspection.latestRollbackRecord?.rolledBackAt ?? "(none)";
  const latestRollbackVersion = inspection.latestRollbackRecord?.currentVersionAfter ?? "(none)";

  return [
    "Director knowledge lane:",
    `  workspace root: ${workspaceRoot}`,
    `  published packs: ${inspection.publishedCount}`,
    `  candidates: ${inspection.candidateCount}`,
    `  review queue: ${inspection.reviewQueueCount}`,
    `  rollback artifacts: ${inspection.rollbackCount}`,
    `  candidate ready: ${inspection.hasCandidate ? "yes" : "no"}`,
    `  recall enabled: ${inspection.enabled ? "yes" : "no"}`,
    `  latest published at: ${latestPublishedAt}`,
    `  latest rollback at: ${latestRollbackAt}`,
    `  latest rollback version: ${latestRollbackVersion}`,
    `  knowledge evolution switches: ${knowledgeEvolution}`,
  ].join("\n");
}

export async function learnDirectorExperience(
  workspaceRoot: string,
  input: LearnDirectorExperienceInput,
): Promise<string> {
  const directories = input.directories ?? [];
  const queries = input.queries ?? [];
  const texts = input.texts ?? [];
  const skippedQueries = queries.filter(isLowSignalLearningQuery);
  const admittedQueries = queries.filter((query) => !isLowSignalLearningQuery(query));
  const queryUrls = admittedQueries.flatMap(extractHttpUrls);
  const searchQueries = admittedQueries.filter((query) => extractHttpUrls(query).length === 0);
  const urls = [...(input.urls ?? []), ...queryUrls];
  if (directories.length === 0 && urls.length === 0 && queries.length === 0 && texts.length === 0) {
    throw new Error(
      "Director experience learning requires at least one --directory, --url, --query, or text input.",
    );
  }

  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const store = createExperienceStore(workspaceRoot);
  const distiller =
    input.disableModelDistillation === true
      ? undefined
      : createDirectorApiExperienceDistiller(workspaceRoot, input);
  const adapters = [
    ...directories.map(
      (directory) =>
        new LocalDirectoryExperienceAdapter({
          sourceId: createSourceIdFromPath(directory),
          directoryRoot: directory,
          privacy: input.privacy ?? "confidential",
          ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
          ...(distiller === undefined ? {} : { distiller }),
        }),
    ),
    ...urls.map(
      (url) =>
        new WebExperienceSourceAdapter({
          sourceId: createSourceIdFromUrl(url),
          urls: [url],
          privacy: input.privacy ?? "public",
          ...(input.fetchText === undefined ? {} : { fetchText: input.fetchText }),
          ...(distiller === undefined ? {} : { distiller }),
        }),
    ),
    ...(texts.length === 0
      ? []
      : [
          new PastedTextExperienceAdapter({
            sourceId: createSourceIdFromPastedTexts(texts),
            texts,
            privacy: input.privacy ?? "internal",
            ...(distiller === undefined ? {} : { distiller }),
          }),
        ]),
    ...searchQueries.map(
      (query) =>
        new WebSearchExperienceAdapter({
          sourceId: createSourceIdFromQuery(query),
          queries: [query],
          privacy: input.privacy ?? "public",
          ...(input.maxResultsPerQuery === undefined
            ? {}
            : { maxResultsPerQuery: input.maxResultsPerQuery }),
          ...(input.search === undefined ? {} : { search: input.search }),
          ...(input.fetchText === undefined ? {} : { fetchText: input.fetchText }),
          ...(distiller === undefined ? {} : { distiller }),
        }),
    ),
  ];
  const orchestrator = new SelfLearningOrchestrator({
    store,
    adapters,
  });
  const result = await orchestrator.learn();
  const [stored, artifacts, quarantined] = await Promise.all([
    store.listCandidates(),
    listOptionalStoreRecords(store, "listSourceArtifacts"),
    listOptionalStoreRecords(store, "listQuarantineRecords"),
  ]);
  const lines = [
    "Director experience learn:",
    `  workspace root: ${workspaceRoot}`,
    `  experience dir: ${join(workspace.knowledge, "experience")}`,
    `  status: ${result.status}`,
    `  adapters: ${result.adapterReports.length}`,
    `  new candidates: ${result.candidateCount}`,
    `  stored candidates: ${stored.length}`,
    `  stored artifacts: ${artifacts.length}`,
    `  quarantined sources: ${quarantined.length}`,
    `  model distillation: ${distiller === undefined ? "disabled" : "enabled"}`,
    "  runtime injection: disabled",
    "  next step: review/promote selected candidates before using them in runtime guidance.",
  ];

  for (const report of result.adapterReports) {
    const artifactCount = readNumberProperty(report, "artifactCount") ?? 0;
    const storedArtifactCount = readNumberProperty(report, "storedArtifactCount") ?? 0;
    const quarantineCount = readNumberProperty(report, "quarantineCount") ?? 0;
    const storedQuarantineCount = readNumberProperty(report, "storedQuarantineCount") ?? 0;
    lines.push(
      `  - ${report.adapterId} kind=${report.sourceKind} artifacts=${artifactCount} storedArtifacts=${storedArtifactCount} candidates=${report.candidateCount} stored=${report.storedCount} quarantined=${quarantineCount} storedQuarantined=${storedQuarantineCount}`,
    );
    const reportNotes = readStringArrayProperty(report, "notes");
    if (reportNotes.length > 0) {
      lines.push(`    notes: ${reportNotes.join(" | ")}`);
    }
  }
  if (result.notes.length > 0) {
    lines.push(`  notes: ${result.notes.join(" | ")}`);
  }
  if (skippedQueries.length > 0) {
    lines.push(
      `  skipped: ${skippedQueries.map((query) => `Skipped low-signal learning query "${query}"`).join(" | ")}`,
    );
  }

  return lines.join("\n");
}

function isLowSignalLearningQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0 || extractHttpUrls(trimmed).length > 0) {
    return false;
  }
  if (
    /(?:今天天气|天气不错|随便聊聊|随便说说|闲聊|没事|挺开心|hello|hi|just chatting)/iu.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (trimmed.length > 32) {
    return false;
  }
  return !/(学习|经验|知识|资料|链接|文件|目录|制作|生成|短剧|视频|分镜|镜头|脚本|剧本|故事板|导演|工作流|方法|规则|流程|learn|study|research|director|workflow|method|guide|script|video|shot|story)/iu.test(
    trimmed,
  );
}

function createDirectorApiExperienceDistiller(
  workspaceRoot: string,
  input: LearnDirectorExperienceInput,
): ExperienceDistiller | undefined {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const providersRoot = join(workspace.root, "providers");
  const providerConfig = loadDirectorApiProviderConfig(providersRoot);
  const provider =
    input.distillationProviderId === undefined
      ? providerConfig.document.providers.find(
          (entry) => entry.enabled && entry.apiKeyConfigured && entry.capabilities.includes("text"),
        )
      : providerConfig.document.providers.find(
          (entry) => entry.id === input.distillationProviderId,
        );

  if (
    provider === undefined ||
    !provider.enabled ||
    !provider.apiKeyConfigured ||
    !provider.capabilities.includes("text")
  ) {
    return undefined;
  }

  return {
    distillerId: `api-provider-${provider.id}`,
    distill: async (source, context) => {
      const run = await runDirectorApiProviderTextCompletion(providersRoot, {
        providerId: provider.id,
        model: input.distillationModel ?? provider.defaultModels.text,
        systemPrompt: DIRECTOR_EXPERIENCE_DISTILLATION_SYSTEM_PROMPT,
        prompt: buildExperienceDistillationPrompt(source, context.heuristicDraft),
        timeoutMs: 90_000,
        ...(input.apiProviderFetch === undefined ? {} : { fetchImpl: input.apiProviderFetch }),
      });
      if (!run.ok || typeof run.output !== "string" || run.output.trim().length === 0) {
        throw new Error(run.message);
      }
      return parseModelDistillationOutput(run.output, context.heuristicDraft);
    },
  };
}

const DIRECTOR_EXPERIENCE_DISTILLATION_SYSTEM_PROMPT = [
  "你是 Director Angel 的经验提炼器。",
  "你的任务是从原始网页、文件或目录内容中提炼可复用经验候选，不要复述原文。",
  "只输出 JSON，不要 Markdown，不要解释。",
  "经验必须回答：什么时候用、怎么用、风险是什么、证据来自哪里。",
  "原始材料只能作为证据，不能直接成为经验；遇到登录提示、广告、图片占位、脚本/CSS 噪声要排除。",
].join("\n");

function buildExperienceDistillationPrompt(
  source: DistillExperienceDraftInput,
  heuristicDraft: DistilledExperienceDraft,
): string {
  const sourceText = limitPromptText(source.content, 18_000);
  return [
    "请把下面材料提炼成 Director Angel 可审核的经验候选。",
    "",
    "输出 JSON schema:",
    JSON.stringify({
      summary: "一句或两句经验提炼，不要复制标题或原文开头",
      applicability: "什么时候使用这条经验",
      risks: ["风险 1", "风险 2"],
      tags: ["短标签"],
      evidenceSummary: "证据摘要，说明从来源中提取了什么",
      confidence: "high|medium|low",
      selectedClaims: ["支持该经验的关键原文观点，不超过 3 条"],
    }),
    "",
    `来源类型: ${source.sourceKind}`,
    `来源 ID: ${source.sourceId}`,
    `标题: ${source.title}`,
    `隐私级别: ${source.privacy}`,
    "",
    "规则提炼基线，仅作参考，模型可以改写得更清晰:",
    JSON.stringify(heuristicDraft),
    "",
    "原始可读内容:",
    sourceText,
  ].join("\n");
}

function parseModelDistillationOutput(
  output: string,
  fallback: DistilledExperienceDraft,
): DistilledExperienceDraft {
  const parsed = parseJsonObjectFromText(output);
  return {
    summary: readString(parsed, "summary", fallback.summary),
    applicability: readString(parsed, "applicability", fallback.applicability),
    risks: readStringArray(parsed, "risks", fallback.risks),
    tags: readStringArray(parsed, "tags", fallback.tags),
    evidenceSummary: readString(parsed, "evidenceSummary", fallback.evidenceSummary),
    confidence: readConfidence(parsed, fallback.confidence),
    selectedClaims: readStringArray(parsed, "selectedClaims", fallback.selectedClaims),
  };
}

function parseJsonObjectFromText(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  const candidates: unknown[] = [];
  try {
    candidates.push(JSON.parse(trimmed));
  } catch {}

  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed)?.[1]?.trim();
  if (fenced !== undefined) {
    try {
      candidates.push(JSON.parse(fenced));
    } catch {}
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      candidates.push(JSON.parse(trimmed.slice(start, end + 1)));
    } catch {}
  }

  for (const candidate of candidates) {
    const record = coerceModelDistillationRecord(candidate);
    if (record !== null) {
      return record;
    }
  }

  if (candidates.length === 0) {
    throw new Error("Model distillation output was not valid JSON.");
  }
  throw new Error("Model distillation output must be a JSON object.");
}

function coerceModelDistillationRecord(value: unknown): Record<string, unknown> | null {
  if (isModelDistillationRecord(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const record = coerceModelDistillationRecord(entry);
      if (record !== null) {
        return record;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["result", "data", "output", "distillation"]) {
    const record = coerceModelDistillationRecord(value[key]);
    if (record !== null) {
      return record;
    }
  }

  return null;
}

function isModelDistillationRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  return ["summary", "applicability", "risks", "tags", "evidenceSummary", "selectedClaims"].some(
    (key) => value[key] !== undefined,
  );
}

function readString(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
  fallback: readonly string[],
): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const result = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return result.length > 0 ? result : [...fallback];
}

function readConfidence(
  record: Record<string, unknown>,
  fallback: DistilledExperienceDraft["confidence"],
): DistilledExperienceDraft["confidence"] {
  const value = record.confidence;
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

function limitPromptText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3)}...`;
}

export async function listDirectorExperienceCandidates(workspaceRoot: string): Promise<string> {
  const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);
  const lines = [
    "Director experience candidates:",
    `  total: ${inspection.total}`,
    `  artifacts: ${inspection.artifactTotal}`,
    `  quarantined sources: ${inspection.quarantineTotal}`,
  ];

  if (inspection.candidates.length === 0) {
    lines.push("  candidates: (none)");
    return lines.join("\n");
  }

  lines.push("  candidates:");
  for (const entry of inspection.candidates) {
    const candidate = entry.candidate;
    lines.push(
      `  - ${candidate.candidateId} status=${entry.status} promoted=${entry.promoted ? "yes" : "no"} kind=${candidate.sourceAdapter.sourceKind}`,
    );
    lines.push(`    title: ${candidate.title}`);
    lines.push(`    quality: ${formatExperienceQuality(candidate)}`);
    lines.push(`    evidence preview: ${formatExperienceEvidencePreview(candidate)}`);
    lines.push(`    tags: ${candidate.tags.join(", ") || "(none)"}`);
  }

  return lines.join("\n");
}

export async function inspectDirectorExperienceCandidates(
  workspaceRoot: string,
): Promise<DirectorExperienceCandidatesInspection> {
  const store = createExperienceStore(workspaceRoot);
  const taxonomyStore = createExperienceTaxonomyStore(workspaceRoot);
  const [candidates, reviews, promotions, artifacts, quarantined, taxonomy] = await Promise.all([
    store.listCandidates(),
    store.listReviewDecisions(),
    store.listPromotions(),
    listOptionalStoreRecords(store, "listSourceArtifacts"),
    listOptionalStoreRecords(store, "listQuarantineRecords"),
    taxonomyStore.inspectTaxonomy(),
  ]);
  const taxonomyByCandidate = new Map(
    taxonomy.candidates.map((entry) => [entry.candidateId, entry] as const),
  );

  return {
    total: candidates.length,
    artifactTotal: artifacts.length,
    quarantineTotal: quarantined.length,
    candidates: candidates.map((candidate) =>
      inspectExperienceCandidateFromLists(
        candidate,
        reviews,
        promotions,
        taxonomyByCandidate.get(candidate.candidateId) ?? null,
      ),
    ),
    artifacts,
    quarantined,
    taxonomy,
  };
}

export async function inspectDirectorExperienceCandidate(
  workspaceRoot: string,
  candidateId: string,
): Promise<DirectorExperienceCandidateInspection> {
  const store = createExperienceStore(workspaceRoot);
  const candidate = await store.getCandidate(candidateId);
  if (!candidate) {
    throw new Error(`Unknown experience candidate: ${candidateId}`);
  }

  const [reviews, promotions] = await Promise.all([
    store.listReviewDecisions(candidateId),
    store.listPromotions(candidateId),
  ]);
  const taxonomy =
    await createExperienceTaxonomyStore(workspaceRoot).getCandidateTaxonomy(candidateId);
  return inspectExperienceCandidateFromLists(candidate, reviews, promotions, taxonomy);
}

export async function inspectDirectorExperienceTaxonomy(
  workspaceRoot: string,
): Promise<ExperienceTaxonomySnapshot> {
  return createExperienceTaxonomyStore(workspaceRoot).inspectTaxonomy();
}

export async function upsertDirectorExperienceCategoryStructured(
  workspaceRoot: string,
  input: UpsertDirectorExperienceCategoryInput,
) {
  return createExperienceTaxonomyStore(workspaceRoot).upsertCategory(input);
}

export async function upsertDirectorExperienceTagStructured(
  workspaceRoot: string,
  input: UpsertDirectorExperienceTagInput,
) {
  return createExperienceTaxonomyStore(workspaceRoot).upsertTag(input);
}

export async function updateDirectorExperienceTaxonomyStructured(
  workspaceRoot: string,
  input: UpdateDirectorExperienceTaxonomyInput,
) {
  return createExperienceTaxonomyStore(workspaceRoot).updateCandidateTaxonomy(input);
}

export async function classifyDirectorExperienceCandidate(
  workspaceRoot: string,
  input: ClassifyDirectorExperienceCandidateInput,
): Promise<string> {
  const inspection = await inspectDirectorExperienceCandidate(workspaceRoot, input.candidateId);
  const taxonomyStore = createExperienceTaxonomyStore(workspaceRoot);
  const taxonomy = await taxonomyStore.inspectTaxonomy();
  const category = await resolveOrCreateExperienceCategory(
    taxonomyStore,
    taxonomy,
    input.categoryId,
  );
  const tagIds =
    input.tagIds === undefined
      ? (inspection.taxonomy?.tagIds ?? [])
      : await resolveOrCreateExperienceTagIds(taxonomyStore, taxonomy, input.tagIds);
  const binding = await taxonomyStore.updateCandidateTaxonomy({
    candidateId: input.candidateId,
    categoryId: category.categoryId,
    tagIds,
    ...(input.author === undefined ? {} : { updatedBy: input.author }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  return [
    "Director experience classified:",
    `  candidate: ${binding.candidateId}`,
    `  category: ${binding.categoryId ?? "(none)"}`,
    `  tags: ${binding.tagIds.join(", ") || "(none)"}`,
  ].join("\n");
}

export async function tagDirectorExperienceCandidate(
  workspaceRoot: string,
  input: TagDirectorExperienceCandidateInput,
): Promise<string> {
  const inspection = await inspectDirectorExperienceCandidate(workspaceRoot, input.candidateId);
  const taxonomyStore = createExperienceTaxonomyStore(workspaceRoot);
  const taxonomy = await taxonomyStore.inspectTaxonomy();
  const tagIds = await resolveOrCreateExperienceTagIds(taxonomyStore, taxonomy, input.tagIds);
  const binding = await taxonomyStore.updateCandidateTaxonomy({
    candidateId: input.candidateId,
    ...(inspection.taxonomy?.categoryId === undefined
      ? {}
      : { categoryId: inspection.taxonomy.categoryId }),
    tagIds,
    ...(input.author === undefined ? {} : { updatedBy: input.author }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
  return [
    "Director experience tags updated:",
    `  candidate: ${binding.candidateId}`,
    `  category: ${binding.categoryId ?? "(none)"}`,
    `  tags: ${binding.tagIds.join(", ") || "(none)"}`,
  ].join("\n");
}

export async function updateDirectorExperienceCandidateStructured(
  workspaceRoot: string,
  input: UpdateDirectorExperienceCandidateInput,
): Promise<UpdateDirectorExperienceCandidateResult> {
  const store = createExperienceStore(workspaceRoot);
  const candidate = await store.getCandidate(input.candidateId);
  if (!candidate) {
    throw new Error(`Unknown experience candidate: ${input.candidateId}`);
  }

  const [reviews, promotions] = await Promise.all([
    store.listReviewDecisions(input.candidateId),
    store.listPromotions(input.candidateId),
  ]);
  const latestReview = selectLatestExperienceReview(input.candidateId, reviews);
  if (latestReview?.decision === "accepted" || promotions.length > 0) {
    throw new Error(
      `Experience candidate ${input.candidateId} can only be edited before acceptance or promotion.`,
    );
  }

  const updated = createExperienceCandidate({
    candidateId: candidate.candidateId,
    sourceAdapter: candidate.sourceAdapter,
    title: normalizeOptionalText(input.title, candidate.title),
    summary: normalizeRequiredText(input.summary, candidate.summary, "summary"),
    applicability: normalizeOptionalText(input.applicability, candidate.applicability),
    risks: normalizeOptionalList(input.risks, candidate.risks),
    tags: normalizeOptionalList(input.tags, candidate.tags),
    evidence: candidate.evidence,
    ...(candidate.sourceArtifactId === undefined
      ? {}
      : { sourceArtifactId: candidate.sourceArtifactId }),
    ...(candidate.sourceDigest === undefined ? {} : { sourceDigest: candidate.sourceDigest }),
    ...(candidate.evidencePreview === undefined
      ? {}
      : { evidencePreview: candidate.evidencePreview }),
    ...(candidate.quality === undefined ? {} : { quality: candidate.quality }),
    privacy: candidate.privacy,
    provenance:
      input.author === undefined
        ? candidate.provenance
        : `${candidate.provenance}; extracted-experience edited by ${input.author}`,
    createdAtMs: candidate.createdAtMs,
  });
  const write = await store.writeCandidate(updated);
  return {
    previous: candidate,
    updated,
    write,
  };
}

export async function explainDirectorExperienceCandidate(
  workspaceRoot: string,
  candidateId: string,
): Promise<string> {
  const inspection = await inspectDirectorExperienceCandidate(workspaceRoot, candidateId);
  const { candidate, latestReview, promotions } = inspection;
  const lines = [
    "Director experience candidate:",
    `  candidate id: ${candidate.candidateId}`,
    `  status: ${inspection.status}`,
    `  title: ${candidate.title}`,
    `  summary: ${candidate.summary}`,
    `  applicability: ${candidate.applicability}`,
    `  source: ${candidate.sourceAdapter.sourceKind} ${candidate.sourceAdapter.sourceRef}`,
    `  adapter: ${candidate.sourceAdapter.adapterId}`,
    `  privacy: ${candidate.privacy}`,
    `  runtime injection: ${candidate.runtimeInjection}`,
    `  source artifact: ${readStringProperty(candidate, "sourceArtifactId") ?? "(none)"}`,
    `  source digest: ${readStringProperty(candidate, "sourceDigest") ?? "(none)"}`,
    `  quality: ${formatExperienceQuality(candidate)}`,
    `  tags: ${candidate.tags.join(", ") || "(none)"}`,
    `  risks: ${candidate.risks.join(" | ") || "(none)"}`,
    `  evidence: ${formatExperienceEvidence(candidate)}`,
    `  evidence preview: ${formatExperienceEvidencePreview(candidate)}`,
  ];

  if (latestReview) {
    lines.push(
      `  latest review: ${latestReview.decision} at ${formatEpochMs(latestReview.decidedAtMs)}`,
    );
    if (latestReview.note) {
      lines.push(`  latest review note: ${latestReview.note}`);
    }
  }

  if (promotions.length === 0) {
    lines.push("  promotions: (none)");
  } else {
    lines.push("  promotions:");
    for (const promotion of promotions) {
      lines.push(`  - ${promotion.promotionId} to=${promotion.promotedTo}`);
      lines.push(`    ref: ${promotion.promotedRef}`);
    }
  }

  return lines.join("\n");
}

export async function acceptDirectorExperienceCandidate(
  workspaceRoot: string,
  input: DecideDirectorExperienceCandidateInput,
): Promise<string> {
  const result = await decideDirectorExperienceCandidateStructured(workspaceRoot, {
    ...input,
    decision: "accepted",
  });
  return formatDirectorExperienceCandidateDecision(result);
}

export async function rejectDirectorExperienceCandidate(
  workspaceRoot: string,
  input: DecideDirectorExperienceCandidateInput,
): Promise<string> {
  const result = await decideDirectorExperienceCandidateStructured(workspaceRoot, {
    ...input,
    decision: "rejected",
  });
  return formatDirectorExperienceCandidateDecision(result);
}

export async function promoteDirectorExperienceCandidate(
  workspaceRoot: string,
  input: PromoteDirectorExperienceCandidateInput,
): Promise<string> {
  const promoted = await promoteDirectorExperienceCandidateStructured(workspaceRoot, input);

  return [
    "Director experience promote:",
    `  candidate id: ${promoted.experienceCandidate.candidateId}`,
    `  knowledge pack id: ${promoted.knowledgeCandidate.metadata.id}`,
    `  operation: ${promoted.knowledgeCandidate.evolution.operation}`,
    `  base version: ${promoted.currentPublishedVersion ?? "(none)"}`,
    `  candidate version: ${promoted.knowledgeCandidate.metadata.version}`,
    `  promotion ref: ${promoted.promotion?.promotedRef ?? "(not recorded)"}`,
    `  notes: ${promoted.notes.join(" | ")}`,
  ].join("\n");
}

export async function promoteDirectorExperienceCandidateStructured(
  workspaceRoot: string,
  input: PromoteDirectorExperienceCandidateInput,
): Promise<PromoteAcceptedExperienceCandidateResult> {
  const service = new ExperiencePromotionService({
    experienceStore: createExperienceStore(workspaceRoot),
    knowledgeStore: createKnowledgeStore(workspaceRoot),
    taxonomyStore: createExperienceTaxonomyStore(workspaceRoot),
  });
  return service.promoteAcceptedExperienceCandidate({
    candidateId: input.candidateId,
    ...(input.author === undefined ? {} : { actor: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export async function createDirectorExperienceFromRunReportStructured(
  workspaceRoot: string,
  input: CreateDirectorExperienceFromRunReportInput,
): Promise<CreateDirectorExperienceFromRunOutputResult> {
  const report = await loadExecutionRunReport(workspaceRoot, input.runId);
  const materialized = materializeRunOutputExperience({
    source: createRunOutputSourceFromReport(report),
    intent: input.intent ?? "positive-experience",
    privacy: input.privacy ?? "confidential",
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });
  return {
    materialized,
    write: await writeMaterializedRunOutputExperience(workspaceRoot, materialized),
  };
}

export async function createDirectorExperienceFromTraceProposalStructured(
  workspaceRoot: string,
  input: CreateDirectorExperienceFromTraceProposalInput,
): Promise<CreateDirectorExperienceFromRunOutputResult> {
  const proposalStore = createProposalStore(workspaceRoot);
  const proposal = await proposalStore.getProposal(input.proposalId);
  if (!proposal) {
    throw new Error(`Unknown Director trace proposal: ${input.proposalId}`);
  }

  const materialized = materializeRunOutputExperience({
    source: {
      runId: proposal.runId,
      reportId: proposal.reportId,
      status: proposal.sourceRecord.digest.status,
      goal: proposal.sourceRecord.digest.goal || proposal.title,
      projectId: proposal.projectId,
      groupId: proposal.groupId,
      roles: proposal.roles,
      selectedAdapters: proposal.selectedAdapters,
      anchorIds: proposal.sourceRecord.anchorIds,
      flags: proposal.sourceRecord.digest.flags,
      summary: [
        proposal.summary,
        proposal.evidenceSummary,
        proposal.explanation,
        proposal.sourceRecord.digest.previewSummary,
      ],
      evidenceText: [
        proposal.title,
        proposal.summary,
        proposal.trigger,
        proposal.evidenceSummary,
        proposal.explanation,
        `confidence=${proposal.confidence} risk=${proposal.riskLevel}`,
      ].join("\n"),
      recordedAt: proposal.updatedAt,
    },
    intent:
      input.intent ?? (proposal.riskLevel === "high" ? "failure-lesson" : "positive-experience"),
    privacy: input.privacy ?? "confidential",
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });
  return {
    materialized,
    write: await writeMaterializedRunOutputExperience(workspaceRoot, materialized),
  };
}

export async function createDirectorExperienceFromTraceProposal(
  workspaceRoot: string,
  input: CreateDirectorExperienceFromTraceProposalInput,
): Promise<string> {
  const result = await createDirectorExperienceFromTraceProposalStructured(workspaceRoot, input);
  const materialized = result.materialized;
  if (materialized.status === "candidate") {
    return [
      "Director trace experience candidate created:",
      `  candidate: ${materialized.candidate.candidateId}`,
      `  title: ${materialized.candidate.title}`,
      `  source quality: ${materialized.admission.sourceQuality.score}`,
      `  claim quality: ${materialized.admission.claimQuality.score}`,
      `  write: ${result.write.notes.join(" | ")}`,
    ].join("\n");
  }
  return [
    "Director trace experience quarantined:",
    `  quarantine: ${materialized.quarantine.quarantineId}`,
    `  reason: ${materialized.quarantine.reason}`,
    `  source quality: ${materialized.admission.sourceQuality.score}`,
    `  claim quality: ${materialized.admission.claimQuality.score}`,
    `  write: ${result.write.notes.join(" | ")}`,
  ].join("\n");
}

export async function createDirectorReflectionFromRunReportStructured(
  workspaceRoot: string,
  input: CreateDirectorReflectionFromRunReportInput,
): Promise<CreateDirectorReflectionFromRunReportResult> {
  const report = await loadExecutionRunReport(workspaceRoot, input.runId);
  const source = createRunOutputSourceFromReport(report);
  const nowMs = input.now === undefined ? undefined : toEpochMs(input.now);
  const draftReflection = materializeDirectorReflectionReport({
    source,
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  const experience = materializeReflectionExperienceCandidates({
    reflection: draftReflection,
    source,
    privacy: input.privacy ?? "confidential",
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  const shouldWriteExperience = input.writeExperienceCandidate ?? true;
  const experienceWrite =
    shouldWriteExperience && experience.recommended !== null
      ? await writeMaterializedRunOutputExperience(
          workspaceRoot,
          experience.recommended.materialized,
        )
      : null;
  const reflection: DirectorReflectionReport =
    experienceWrite === null
      ? draftReflection
      : { ...draftReflection, status: "candidate_generated" };
  const reflectionWrite = await writeDirectorReflectionReport(workspaceRoot, reflection);
  const soulCandidate = materializeDirectorSoulCandidateFromReflection({
    reflection,
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  const shouldWriteSoul = input.writeSoulCandidate ?? true;
  const soulWrite =
    shouldWriteSoul && soulCandidate !== null
      ? await writeDirectorSoulCandidate(workspaceRoot, soulCandidate)
      : null;

  return {
    reflection,
    reflectionWrite,
    experience,
    experienceWrite,
    soulCandidate,
    soulWrite,
  };
}

export async function createDirectorReflectionFromRunReport(
  workspaceRoot: string,
  input: CreateDirectorReflectionFromRunReportInput,
): Promise<string> {
  const result = await createDirectorReflectionFromRunReportStructured(workspaceRoot, input);
  const recommended = result.experience.recommended;
  const blockedPositive = result.experience.blockedPositive;

  return [
    "Director reflection:",
    `  reflection id: ${result.reflection.reflectionId}`,
    `  run id: ${result.reflection.sourceId}`,
    `  report id: ${result.reflection.reportId}`,
    `  outcome: ${result.reflection.outcome}`,
    `  suggested experience: ${result.reflection.suggestedExperienceIntent}`,
    `  status: ${result.reflection.status}`,
    `  reflection file: ${result.reflectionWrite.path}`,
    `  soul candidate: ${result.soulCandidate?.candidateId ?? "(none)"}`,
    `  recommended candidate: ${
      recommended?.materialized.status === "candidate"
        ? recommended.materialized.candidate.candidateId
        : recommended?.materialized.status === "quarantined"
          ? recommended.materialized.quarantine.quarantineId
          : "(none)"
    }`,
    `  positive blocked: ${
      blockedPositive === undefined
        ? "no"
        : blockedPositive.status === "quarantined"
          ? blockedPositive.quarantine.quarantineId
          : "candidate"
    }`,
    `  what worked: ${result.reflection.whatWorked.join(" | ") || "(none)"}`,
    `  what failed: ${result.reflection.whatFailed.join(" | ") || "(none)"}`,
    `  next actions: ${result.reflection.nextActions.join(" | ")}`,
  ].join("\n");
}

export async function listDirectorSoulCandidates(workspaceRoot: string): Promise<string> {
  const candidates = await listSoulCandidates(workspaceRoot);
  const lines = ["Director Soul candidates:", `  total: ${candidates.length}`];

  if (candidates.length === 0) {
    lines.push("  candidates: (none)");
    return lines.join("\n");
  }

  for (const candidate of candidates) {
    lines.push(
      `  - ${candidate.candidateId} status=${candidate.status} risk=${candidate.riskLevel} source=${candidate.sourceId}`,
    );
    lines.push(`    summary: ${candidate.patchSummary}`);
  }
  return lines.join("\n");
}

export async function explainDirectorSoulCandidate(
  workspaceRoot: string,
  candidateId: string,
): Promise<string> {
  const candidate = await requireSoulCandidate(workspaceRoot, candidateId);
  const lines = [
    "Director Soul candidate:",
    `  candidate id: ${candidate.candidateId}`,
    `  status: ${candidate.status}`,
    `  risk: ${candidate.riskLevel}`,
    `  source reflection: ${candidate.sourceReflectionId}`,
    `  source: ${candidate.sourceKind}/${candidate.sourceId}`,
    `  summary: ${candidate.patchSummary}`,
    "  proposed sections:",
  ];
  for (const [section, body] of Object.entries(candidate.proposedSections)) {
    lines.push(`  - ${section}: ${body.replace(/\s+/gu, " ").trim()}`);
  }
  lines.push(`  evidence: ${candidate.evidenceRefs.join(" | ") || "(none)"}`);
  return lines.join("\n");
}

export async function acceptDirectorSoulCandidate(
  workspaceRoot: string,
  input: DecideDirectorSoulCandidateInput,
): Promise<string> {
  const result = await decideDirectorSoulCandidate(workspaceRoot, {
    ...input,
    decision: "accepted",
  });
  return formatDirectorSoulDecision(result);
}

export async function rejectDirectorSoulCandidate(
  workspaceRoot: string,
  input: DecideDirectorSoulCandidateInput,
): Promise<string> {
  const result = await decideDirectorSoulCandidate(workspaceRoot, {
    ...input,
    decision: "rejected",
  });
  return formatDirectorSoulDecision(result);
}

export async function viewDirectorSoul(workspaceRoot: string): Promise<string> {
  const soul = await readDirectorSoulDocument(workspaceRoot);
  if (soul === null) {
    return "Director Soul:\n  status: empty\n  SOUL.md: (not created)";
  }
  return renderDirectorSoulMarkdown(soul);
}

function formatKnowledgeEvolutionSwitches(state: KnowledgeEvolutionSwitchState): string {
  return `enabled=${state.enabled ? "yes" : "no"} autoCandidate=${state.autoCandidate ? "yes" : "no"} publish=${state.publish ? "yes" : "no"}`;
}

export async function listDirectorKnowledgePacks(workspaceRoot: string): Promise<string> {
  const store = createKnowledgeStore(workspaceRoot);
  const packs = await store.listPublished();
  const lines = ["Director knowledge packs:", `  total: ${packs.length}`];

  if (packs.length === 0) {
    lines.push("  packs: (none)");
    return lines.join("\n");
  }

  lines.push("  packs:");
  for (const pack of packs) {
    lines.push(`  - ${pack.metadata.id} stage=${pack.state} version=${pack.metadata.version}`);
    lines.push(`    title: ${pack.metadata.title}`);
    lines.push(
      `    tags: ${pack.metadata.tags && pack.metadata.tags.length > 0 ? pack.metadata.tags.join(", ") : "(none)"}`,
    );
  }

  return lines.join("\n");
}

export async function explainDirectorKnowledgePack(
  workspaceRoot: string,
  packId: string,
): Promise<string> {
  const store = createKnowledgeStore(workspaceRoot);
  const pack = await store.getPublished(packId);
  if (!pack) {
    throw new Error(`Unknown Director knowledge pack: ${packId}`);
  }

  return [
    "Director knowledge pack:",
    `  pack id: ${pack.metadata.id}`,
    `  stage: ${pack.stage}`,
    `  version: ${pack.metadata.version}`,
    `  title: ${pack.metadata.title}`,
    `  description: ${pack.metadata.description ?? "(none)"}`,
    `  source proposal: ${pack.method.sourceProposalId}`,
    `  source record: ${pack.method.sourceRecordId}`,
    `  source digest: ${pack.method.sourceDigestId}`,
    `  project/group: ${pack.method.projectId}/${pack.method.groupId}`,
    `  goal: ${pack.method.goal}`,
    `  trigger: ${pack.method.trigger}`,
    `  explanation: ${pack.method.explanation}`,
    `  evidence: ${pack.method.evidenceSummary}`,
    `  preferred adapters: ${pack.method.preferredAdapters.join(", ") || "(none)"}`,
    `  roles: ${pack.method.roles.join(", ") || "(none)"}`,
    `  anchors: ${pack.method.anchorIds.join(", ") || "(none)"}`,
    `  published at: ${pack.audit.publishedAt}`,
    `  author: ${pack.audit.author ?? "(unknown)"}`,
    `  note: ${pack.audit.note ?? "(none)"}`,
  ].join("\n");
}

export async function publishDirectorKnowledgePackFromProposal(
  workspaceRoot: string,
  input: PublishDirectorKnowledgePackInput,
): Promise<string> {
  const proposalStore = createProposalStore(workspaceRoot);
  const proposal = await proposalStore.getProposal(input.proposalId);
  if (!proposal) {
    throw new Error(`Unknown Director trace proposal: ${input.proposalId}`);
  }
  if (proposal.status !== "accepted") {
    throw new Error(
      `Director knowledge publish requires an accepted trace proposal. Current status: ${proposal.status}.`,
    );
  }

  throw new Error(
    `Director knowledge publish no longer accepts trace proposal ${proposal.proposalId} directly. Run knowledge sync --proposal-id ${proposal.proposalId}, review/accept the generated knowledge candidate, then publish with --pack-id.`,
  );
}

export async function syncDirectorKnowledgeCandidateFromProposal(
  workspaceRoot: string,
  input: SyncDirectorKnowledgeCandidateInput,
): Promise<string> {
  const proposalStore = createProposalStore(workspaceRoot);
  const proposal = await proposalStore.getProposal(input.proposalId);
  if (!proposal) {
    throw new Error(`Unknown Director trace proposal: ${input.proposalId}`);
  }
  if (proposal.status !== "accepted") {
    throw new Error(
      `Director knowledge candidate sync requires an accepted trace proposal. Current status: ${proposal.status}.`,
    );
  }

  const service = new DirectorKnowledgeCandidateSyncService(createKnowledgeStore(workspaceRoot));
  const synced = await service.syncAcceptedProposal({
    proposal,
    ...(input.author === undefined ? {} : { author: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  return [
    "Director knowledge candidate sync:",
    `  proposal id: ${input.proposalId}`,
    `  pack id: ${synced.packId}`,
    `  operation: ${synced.candidate.evolution.operation}`,
    `  base version: ${synced.currentPublishedVersion ?? "(none)"}`,
    `  candidate version: ${synced.candidate.metadata.version}`,
    `  diff summary: ${synced.candidate.diff.summary}`,
    `  notes: ${synced.notes.join(" | ")}`,
  ].join("\n");
}

export async function listDirectorKnowledgeCandidates(workspaceRoot: string): Promise<string> {
  const inspection = await inspectDirectorKnowledgeCandidates(workspaceRoot);
  const lines = ["Director knowledge candidates:", `  total: ${inspection.total}`];

  if (inspection.candidates.length === 0) {
    lines.push("  candidates: (none)");
    return lines.join("\n");
  }

  lines.push("  candidates:");
  for (const entry of inspection.candidates) {
    const candidate = entry.candidate;
    lines.push(
      `  - ${candidate.metadata.id} status=${entry.status} op=${candidate.evolution.operation} version=${candidate.metadata.version}`,
    );
    lines.push(`    title: ${candidate.metadata.title}`);
    lines.push(`    diff: ${candidate.diff.summary}`);
  }

  return lines.join("\n");
}

export async function inspectDirectorKnowledgeCandidates(
  workspaceRoot: string,
): Promise<DirectorKnowledgeCandidatesInspection> {
  const store = createKnowledgeStore(workspaceRoot);
  const [candidates, decisions] = await Promise.all([
    store.listCandidateDocuments(),
    store.listReviewDecisions(),
  ]);
  const decisionMap = new Map(decisions.map((decision) => [decision.packId, decision]));
  return {
    total: candidates.length,
    candidates: candidates.map((candidate) => ({
      candidate,
      latestReview: decisionMap.get(candidate.metadata.id) ?? null,
      status: resolveCandidateReviewStatus(candidate, decisionMap.get(candidate.metadata.id)),
    })),
  };
}

export async function inspectDirectorKnowledgeCandidate(
  workspaceRoot: string,
  packId: string,
): Promise<DirectorKnowledgeCandidateInspection> {
  const store = createKnowledgeStore(workspaceRoot);
  const candidate = await store.getCandidateDocument(packId);
  if (!candidate) {
    throw new Error(`Unknown Director knowledge candidate: ${packId}`);
  }
  const review = await store.getReviewDecision(packId);
  return {
    candidate,
    latestReview: review,
    status: resolveCandidateReviewStatus(candidate, review),
  };
}

export async function explainDirectorKnowledgeCandidate(
  workspaceRoot: string,
  packId: string,
): Promise<string> {
  const inspection = await inspectDirectorKnowledgeCandidate(workspaceRoot, packId);
  const { candidate, latestReview: review } = inspection;
  const lines = [
    "Director knowledge candidate:",
    `  pack id: ${candidate.metadata.id}`,
    `  status: ${inspection.status}`,
    `  operation: ${candidate.evolution.operation}`,
    `  base version: ${candidate.evolution.baseVersion ?? "(none)"}`,
    `  next version: ${candidate.evolution.nextVersion}`,
    `  title: ${candidate.metadata.title}`,
    `  description: ${candidate.metadata.description ?? "(none)"}`,
    `  tags: ${candidate.metadata.tags?.join(", ") || "(none)"}`,
    `  trigger: ${candidate.method.trigger}`,
    `  explanation: ${candidate.method.explanation}`,
    `  adapters: ${candidate.method.preferredAdapters.join(", ") || "(none)"}`,
    `  anchors: ${candidate.method.anchorIds.join(", ") || "(none)"}`,
    `  diff summary: ${candidate.diff.summary}`,
  ];

  if (candidate.diff.changedFields.length > 0) {
    lines.push("  changed fields:");
    for (const change of candidate.diff.changedFields) {
      lines.push(`  - ${change.field}`);
    }
  }
  if (review) {
    lines.push(`  latest review: ${review.decision} at ${review.decidedAt}`);
    if (review.note) {
      lines.push(`  latest review note: ${review.note}`);
    }
  }

  return lines.join("\n");
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "(none)";
  }
  if (value === null) {
    return "(null)";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatDiffValue(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export async function diffDirectorKnowledgeCandidate(
  workspaceRoot: string,
  packId: string,
): Promise<string> {
  const store = createKnowledgeStore(workspaceRoot);
  const candidate = await store.getCandidateDocument(packId);
  if (!candidate) {
    throw new Error(`Unknown Director knowledge candidate: ${packId}`);
  }
  const review = await store.getReviewDecision(packId);
  const diff = candidate.diff;
  const lines = [
    "Director knowledge candidate diff:",
    `  pack id: ${candidate.metadata.id}`,
    `  operation: ${candidate.evolution.operation}`,
    `  base version: ${candidate.evolution.baseVersion ?? "(none)"}`,
    `  next version: ${candidate.evolution.nextVersion}`,
    `  summary: ${diff.summary}`,
  ];

  if (diff.changedFields.length === 0) {
    lines.push("  changed fields: (none)");
  } else {
    lines.push("  changed fields:");
    for (const change of diff.changedFields) {
      lines.push(
        `  - ${change.field}: before=${formatDiffValue(change.before)} after=${formatDiffValue(
          change.after,
        )}`,
      );
    }
  }

  if (review) {
    lines.push(`  latest review: ${review.decision} at ${review.decidedAt}`);
    if (review.note) {
      lines.push(`  latest review note: ${review.note}`);
    }
  }

  return lines.join("\n");
}

export async function reviewDirectorKnowledgeCandidate(
  workspaceRoot: string,
  packId: string,
): Promise<string> {
  const store = createKnowledgeStore(workspaceRoot);
  const candidate = await store.getCandidateDocument(packId);
  if (!candidate) {
    throw new Error(`Unknown Director knowledge candidate: ${packId}`);
  }
  const review = await store.getReviewDecision(packId);

  return [
    "Director knowledge candidate review:",
    `  pack id: ${candidate.metadata.id}`,
    `  current status: ${resolveCandidateReviewStatus(candidate, review)}`,
    `  operation: ${candidate.evolution.operation}`,
    `  next version: ${candidate.evolution.nextVersion}`,
    `  diff summary: ${candidate.diff.summary}`,
    `  changed fields: ${candidate.diff.changedFields.map((entry) => entry.field).join(", ") || "(none)"}`,
    `  latest review: ${review ? `${review.decision} at ${review.decidedAt}` : "(none)"}`,
  ].join("\n");
}

export async function acceptDirectorKnowledgeCandidate(
  workspaceRoot: string,
  input: DecideDirectorKnowledgeCandidateInput,
): Promise<string> {
  const result = await decideDirectorKnowledgeCandidateStructured(workspaceRoot, {
    ...input,
    decision: "accepted",
  });
  return formatDirectorKnowledgeCandidateDecision(result);
}

export async function rejectDirectorKnowledgeCandidate(
  workspaceRoot: string,
  input: DecideDirectorKnowledgeCandidateInput,
): Promise<string> {
  const result = await decideDirectorKnowledgeCandidateStructured(workspaceRoot, {
    ...input,
    decision: "rejected",
  });
  return formatDirectorKnowledgeCandidateDecision(result);
}

export async function publishDirectorKnowledgeCandidate(
  workspaceRoot: string,
  input: PublishDirectorKnowledgeCandidateInput,
): Promise<string> {
  const published = await publishDirectorKnowledgeCandidateStructured(workspaceRoot, input);

  return [
    "Director knowledge publish:",
    `  pack id: ${published.published.metadata.id}`,
    `  previous version: ${published.previousPublishedVersion ?? "(none)"}`,
    `  published version: ${published.published.metadata.version}`,
    `  title: ${published.published.metadata.title}`,
    `  review decision: ${published.review.decision}`,
    `  notes: ${published.notes.join(" | ")}`,
  ].join("\n");
}

export async function publishDirectorKnowledgeCandidateStructured(
  workspaceRoot: string,
  input: PublishDirectorKnowledgeCandidateInput,
): Promise<PublishDirectorKnowledgeCandidateResult> {
  const service = createDirectorKnowledgeLifecycleService(createKnowledgeStore(workspaceRoot));
  return service.publishReviewedCandidate({
    packId: input.packId,
    ...(input.author === undefined ? {} : { actor: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export async function rollbackDirectorKnowledgePack(
  workspaceRoot: string,
  input: RollbackDirectorKnowledgePackInput,
): Promise<string> {
  const service = createDirectorKnowledgeLifecycleService(createKnowledgeStore(workspaceRoot));
  const rollback = await service.rollbackPublishedKnowledge({
    packId: input.packId,
    restoredFromVersion: input.version,
    ...(input.author === undefined ? {} : { actor: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  return [
    "Director knowledge rollback:",
    `  pack id: ${rollback.rollback.packId}`,
    `  current version before: ${rollback.rollback.currentVersionBefore}`,
    `  restored from version: ${rollback.rollback.restoredFromVersion}`,
    `  current version after: ${rollback.rollback.currentVersionAfter}`,
    `  notes: ${rollback.notes.join(" | ")}`,
  ].join("\n");
}

export async function previewDirectorKnowledgeRecall(
  workspaceRoot: string,
  input: PreviewDirectorKnowledgeRecallInput,
): Promise<string> {
  const inspection = await inspectDirectorKnowledgeRecall(workspaceRoot, input);
  if (!inspection.enabled || inspection.packet === null) {
    return [
      "Director knowledge recall preview:",
      `  workspace root: ${workspaceRoot}`,
      "  enabled: no",
      "  status: disabled",
      "  notes: Director knowledge recall is disabled by runtime switches.",
    ].join("\n");
  }

  const packet = inspection.packet;
  const lines = [
    "Director knowledge recall preview:",
    `  workspace root: ${workspaceRoot}`,
    "  enabled: yes",
    `  status: ${packet.status}`,
    `  hits: ${packet.hits.length}`,
    `  truncated: ${packet.truncated ? "yes" : "no"}`,
    `  max hits: ${packet.query.maxHits}`,
    `  max chars: ${packet.query.maxChars}`,
  ];

  if (packet.query.projectId) {
    lines.push(`  project id: ${packet.query.projectId}`);
  }
  if (packet.query.groupId) {
    lines.push(`  group id: ${packet.query.groupId}`);
  }
  if (packet.notes.length > 0) {
    lines.push(`  notes: ${packet.notes.join(" | ")}`);
  }

  if (packet.hits.length === 0) {
    lines.push("  recalled packs: (none)");
    return lines.join("\n");
  }

  lines.push("  recalled packs:");
  for (const hit of packet.hits) {
    lines.push(`  - ${hit.knowledgePackId} score=${hit.score} version=${hit.version}`);
    lines.push(`    title: ${hit.title}`);
    lines.push(`    summary: ${hit.summary}`);
    lines.push(`    why recalled: ${hit.reasons.join(" | ")}`);
    lines.push(
      `    provenance: proposal=${hit.provenance.sourceProposalId} digest=${hit.provenance.sourceDigestId} publishedAt=${hit.provenance.publishedAt}`,
    );
  }

  return lines.join("\n");
}

export async function inspectDirectorKnowledgeLane(
  workspaceRoot: string,
): Promise<DirectorKnowledgeLaneInspection> {
  const store = createKnowledgeStore(workspaceRoot);
  const switchState = loadKnowledgeSwitchState(workspaceRoot);
  const knowledgeEvolution = await loadKnowledgeEvolutionSwitchState(workspaceRoot);
  const [published, candidateDocuments, reviewDecisions, rollbackRecords, publishedDocuments] =
    await Promise.all([
      store.listPublished(),
      store.listCandidateDocuments(),
      store.listReviewDecisions(),
      store.listRollbackRecords(),
      store.listPublishedDocuments(),
    ]);
  const decisionMap = new Map(reviewDecisions.map((decision) => [decision.packId, decision]));
  const reviewQueueCount = candidateDocuments.filter((candidate) => {
    const decision = decisionMap.get(candidate.metadata.id);
    return resolveCandidateReviewStatus(candidate, decision) === "pending";
  }).length;

  const latestPublishedDocument =
    publishedDocuments.length === 0
      ? null
      : ([...publishedDocuments].sort((left, right) => {
          return (
            right.audit.publishedAt.localeCompare(left.audit.publishedAt) ||
            right.metadata.version - left.metadata.version ||
            left.metadata.id.localeCompare(right.metadata.id)
          );
        })[0] ?? null);
  const latestRollbackRecord = selectLatestRollbackRecord(rollbackRecords);

  return {
    enabled: switchState.features["knowledgeRecall.enabled"],
    switchSource: switchState.source,
    ...(switchState.path === undefined ? {} : { switchPath: switchState.path }),
    publishedCount: published.length,
    candidateCount: candidateDocuments.length,
    reviewQueueCount,
    rollbackCount: rollbackRecords.length,
    hasCandidate: candidateDocuments.length > 0,
    latestPublishedDocument,
    latestRollbackRecord,
    knowledgeEvolution,
  };
}

export async function inspectDirectorKnowledgeRecall(
  workspaceRoot: string,
  input: PreviewDirectorKnowledgeRecallInput,
): Promise<DirectorKnowledgeRecallInspection> {
  const switchState = loadKnowledgeSwitchState(workspaceRoot);
  if (!switchState.features["knowledgeRecall.enabled"]) {
    return {
      enabled: false,
      switchSource: switchState.source,
      ...(switchState.path === undefined ? {} : { switchPath: switchState.path }),
      packet: null,
    };
  }

  const store = createKnowledgeStore(workspaceRoot);
  return {
    enabled: true,
    switchSource: switchState.source,
    ...(switchState.path === undefined ? {} : { switchPath: switchState.path }),
    packet: recallPublishedKnowledge(await store.listPublishedDocuments(), {
      ...input,
      maxHits: input.maxHits ?? DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS,
      maxChars: input.maxChars ?? DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS,
    }),
  };
}

function createKnowledgeStore(workspaceRoot: string): FileKnowledgeStore {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return new FileKnowledgeStore({ knowledgeDir: workspace.knowledge });
}

function createExperienceStore(workspaceRoot: string): FileExperienceStore {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return new FileExperienceStore({
    experienceDir: join(workspace.knowledge, "experience"),
  });
}

function createExperienceTaxonomyStore(workspaceRoot: string): FileExperienceTaxonomyStore {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return new FileExperienceTaxonomyStore({
    experienceDir: join(workspace.knowledge, "experience"),
  });
}

async function resolveOrCreateExperienceCategory(
  store: FileExperienceTaxonomyStore,
  snapshot: ExperienceTaxonomySnapshot,
  value: string,
): Promise<ExperienceCategoryRecord> {
  const normalized = normalizeTaxonomyLookup(value);
  const existing = snapshot.categories.find(
    (category) =>
      normalizeTaxonomyLookup(category.categoryId) === normalized ||
      normalizeTaxonomyLookup(category.name) === normalized,
  );
  if (existing !== undefined) {
    return existing;
  }
  return store.upsertCategory({ name: value });
}

async function resolveOrCreateExperienceTagIds(
  store: FileExperienceTaxonomyStore,
  snapshot: ExperienceTaxonomySnapshot,
  values: readonly string[],
): Promise<readonly string[]> {
  const result: string[] = [];
  const knownTags = new Map<string, ExperienceTagRecord>();
  for (const tag of snapshot.tags) {
    knownTags.set(normalizeTaxonomyLookup(tag.tagId), tag);
    knownTags.set(normalizeTaxonomyLookup(tag.name), tag);
  }
  for (const value of values) {
    const normalized = normalizeTaxonomyLookup(value);
    const existing = knownTags.get(normalized);
    const tag = existing ?? (await store.upsertTag({ name: value }));
    knownTags.set(normalizeTaxonomyLookup(tag.tagId), tag);
    knownTags.set(normalizeTaxonomyLookup(tag.name), tag);
    if (!result.includes(tag.tagId)) {
      result.push(tag.tagId);
    }
  }
  return result;
}

function normalizeTaxonomyLookup(value: string): string {
  return value.trim().toLowerCase();
}

function createExecutionRunStore(workspaceRoot: string): FileSystemRunStore {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return new FileSystemRunStore({
    rootPath: join(workspace.runtime, "execution"),
  });
}

function createProposalStore(workspaceRoot: string): FileSystemDirectorProposalStore {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return new FileSystemDirectorProposalStore({
    rootPath: join(workspace.runtime, "proposals"),
  });
}

async function loadExecutionRunReport(
  workspaceRoot: string,
  runId: string,
): Promise<ExecutionRunReport> {
  const report = await createExecutionRunStore(workspaceRoot).loadReport(runId);
  if (report === null) {
    throw new Error(`Unknown execution run report: ${runId}`);
  }
  return report;
}

async function writeMaterializedRunOutputExperience(
  workspaceRoot: string,
  materialized: MaterializedRunOutputExperience,
): Promise<{ readonly status: "ok" | "degraded"; readonly notes: readonly string[] }> {
  const store = createExperienceStore(workspaceRoot);
  const artifactWrite = await store.writeSourceArtifact(materialized.artifact);
  const secondWrite =
    materialized.status === "candidate"
      ? await store.writeCandidate(materialized.candidate)
      : await store.writeQuarantineRecord(materialized.quarantine);
  return {
    status: artifactWrite.status === "ok" && secondWrite.status === "ok" ? "ok" : "degraded",
    notes: [...artifactWrite.notes, ...secondWrite.notes],
  };
}

async function writeDirectorReflectionReport(
  workspaceRoot: string,
  reflection: DirectorReflectionReport,
): Promise<{
  readonly status: "ok" | "degraded";
  readonly path: string;
  readonly notes: readonly string[];
}> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const reflectionRoot = join(workspace.knowledge, "reflection", "report");
  const path = join(reflectionRoot, `${reflection.reflectionId}.json`);
  await mkdir(reflectionRoot, { recursive: true });
  await writeFile(path, `${JSON.stringify(reflection, null, 2)}\n`, "utf8");
  return {
    status: "ok",
    path,
    notes: [`wrote ${path}`],
  };
}

async function writeDirectorSoulCandidate(
  workspaceRoot: string,
  candidate: DirectorSoulCandidate,
): Promise<{
  readonly status: "ok" | "degraded";
  readonly path: string;
  readonly notes: readonly string[];
}> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const soulCandidateRoot = join(workspace.root, "soul", "candidates");
  const path = join(soulCandidateRoot, `${candidate.candidateId}.json`);
  await mkdir(soulCandidateRoot, { recursive: true });
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  return {
    status: "ok",
    path,
    notes: [`wrote ${path}`],
  };
}

async function decideDirectorSoulCandidate(
  workspaceRoot: string,
  input: DecideDirectorSoulCandidateInput & { readonly decision: "accepted" | "rejected" },
): Promise<{
  readonly candidate: DirectorSoulCandidate;
  readonly decision: DirectorSoulDecision;
  readonly decisionPath: string;
  readonly soul: DirectorSoulDocument | null;
  readonly soulPath: string | null;
  readonly soulMarkdownPath: string | null;
}> {
  const candidate = await requireSoulCandidate(workspaceRoot, input.candidateId);
  if (candidate.status !== "pending") {
    throw new Error(`Director Soul candidate ${input.candidateId} is already ${candidate.status}.`);
  }
  const decision = materializeDirectorSoulDecision({
    candidate,
    decision: input.decision,
    ...(input.author === undefined ? {} : { actor: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });
  const updatedCandidate: DirectorSoulCandidate = {
    ...candidate,
    status: input.decision,
  };
  await writeDirectorSoulCandidate(workspaceRoot, updatedCandidate);
  const decisionPath = await writeDirectorSoulDecision(workspaceRoot, decision);

  if (input.decision === "rejected") {
    return {
      candidate: updatedCandidate,
      decision,
      decisionPath,
      soul: null,
      soulPath: null,
      soulMarkdownPath: null,
    };
  }

  const soul = materializeDirectorSoulDocumentFromCandidate({
    candidate: updatedCandidate,
    decision,
    current: await readDirectorSoulDocument(workspaceRoot),
    ...(input.now === undefined ? {} : { nowMs: toEpochMs(input.now) }),
  });
  const soulWrite = await writeDirectorSoulDocument(workspaceRoot, soul);
  return {
    candidate: updatedCandidate,
    decision,
    decisionPath,
    soul,
    soulPath: soulWrite.soulPath,
    soulMarkdownPath: soulWrite.markdownPath,
  };
}

function formatDirectorSoulDecision(result: {
  readonly candidate: DirectorSoulCandidate;
  readonly decision: DirectorSoulDecision;
  readonly decisionPath: string;
  readonly soulPath: string | null;
  readonly soulMarkdownPath: string | null;
}): string {
  return [
    "Director Soul decision:",
    `  candidate id: ${result.candidate.candidateId}`,
    `  decision: ${result.decision.decision}`,
    `  decision file: ${result.decisionPath}`,
    `  soul.json: ${result.soulPath ?? "(unchanged)"}`,
    `  SOUL.md: ${result.soulMarkdownPath ?? "(unchanged)"}`,
  ].join("\n");
}

async function listSoulCandidates(workspaceRoot: string): Promise<DirectorSoulCandidate[]> {
  const candidateRoot = soulCandidateRoot(workspaceRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(candidateRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const candidates: DirectorSoulCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    candidates.push(await readSoulCandidateFile(join(candidateRoot, entry.name)));
  }
  return candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function requireSoulCandidate(
  workspaceRoot: string,
  candidateId: string,
): Promise<DirectorSoulCandidate> {
  const candidate = await readSoulCandidateFile(
    join(soulCandidateRoot(workspaceRoot), `${candidateId}.json`),
  );
  if (candidate.candidateId !== candidateId) {
    throw new Error(`Director Soul candidate id mismatch: ${candidateId}.`);
  }
  return candidate;
}

async function readSoulCandidateFile(path: string): Promise<DirectorSoulCandidate> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isSoulCandidate(parsed)) {
      throw new Error(`Invalid Director Soul candidate document: ${path}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Unknown Director Soul candidate: ${basename(path, ".json")}`);
    }
    throw error;
  }
}

async function readDirectorSoulDocument(
  workspaceRoot: string,
): Promise<DirectorSoulDocument | null> {
  try {
    const parsed = JSON.parse(await readFile(soulDocumentPath(workspaceRoot), "utf8")) as unknown;
    if (!isSoulDocument(parsed)) {
      throw new Error("Invalid Director Soul document.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeDirectorSoulDecision(
  workspaceRoot: string,
  decision: DirectorSoulDecision,
): Promise<string> {
  const root = soulDecisionRoot(workspaceRoot);
  const path = join(root, `${decision.decisionId}.json`);
  await mkdir(root, { recursive: true });
  await writeFile(path, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
  return path;
}

async function writeDirectorSoulDocument(
  workspaceRoot: string,
  soul: DirectorSoulDocument,
): Promise<{ readonly soulPath: string; readonly markdownPath: string }> {
  const root = soulRoot(workspaceRoot);
  const soulPath = soulDocumentPath(workspaceRoot);
  const markdownPath = join(root, "SOUL.md");
  await mkdir(root, { recursive: true });
  await writeFile(soulPath, `${JSON.stringify(soul, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderDirectorSoulMarkdown(soul), "utf8");
  return { soulPath, markdownPath };
}

function soulRoot(workspaceRoot: string): string {
  return join(resolveDirectorWorkspace({ root: workspaceRoot }).root, "soul");
}

function soulCandidateRoot(workspaceRoot: string): string {
  return join(soulRoot(workspaceRoot), "candidates");
}

function soulDecisionRoot(workspaceRoot: string): string {
  return join(soulRoot(workspaceRoot), "decisions");
}

function soulDocumentPath(workspaceRoot: string): string {
  return join(soulRoot(workspaceRoot), "soul.json");
}

function isSoulCandidate(value: unknown): value is DirectorSoulCandidate {
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

function isSoulDocument(value: unknown): value is DirectorSoulDocument {
  return (
    isRecord(value) &&
    value.schemaVersion === "director.soul.v1" &&
    typeof value.sourceCandidateId === "string" &&
    typeof value.updatedAt === "string" &&
    isRecord(value.sections) &&
    Array.isArray(value.evidenceRefs)
  );
}

function createRunOutputSourceFromReport(report: ExecutionRunReport): RunOutputExperienceSource {
  const run = report.run;
  const operatorSurface = report.operatorSurface;
  const selectedAdapters = [
    ...new Set(
      run.assignments
        .map((assignment) => assignment.selectedAdapter)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  const roles = [...new Set(run.assignments.map((assignment) => assignment.role))];
  return {
    runId: report.runId,
    reportId: report.reportId,
    status: run.status,
    goal: operatorSurface?.directorGoal ?? run.goal,
    projectId: "runtime-production",
    groupId: "director-run",
    roles,
    selectedAdapters,
    anchorIds: [run.snapshotId, run.blueprintId],
    flags: report.flags,
    summary: report.summary,
    evidenceText: buildRunReportEvidenceText(report),
    recordedAt: report.recordedAt,
  };
}

function buildRunReportEvidenceText(report: ExecutionRunReport): string {
  const run = report.run;
  const operatorSurface = report.operatorSurface;
  const assignmentEvidence = run.assignments.flatMap((assignment) => [
    `Assignment ${assignment.assignmentId} role=${assignment.role} status=${assignment.status}`,
    `Objective: ${assignment.objective}`,
    `Deliverable: ${assignment.deliverable}`,
    ...(assignment.blockingReason === undefined
      ? []
      : [`Blocking reason: ${assignment.blockingReason}`]),
    ...(assignment.result?.summary === undefined ? [] : [`Result: ${assignment.result.summary}`]),
    ...(assignment.result?.notes ?? []).map((note) => `Result note: ${note}`),
  ]);
  return [
    `Goal: ${operatorSurface?.directorGoal ?? run.goal}`,
    `Run preview: ${run.previewSummary}`,
    ...(operatorSurface?.operatorSummary === undefined
      ? []
      : [`Operator summary: ${operatorSurface.operatorSummary}`]),
    ...(operatorSurface?.objective === undefined
      ? []
      : [`Objective: ${operatorSurface.objective}`]),
    ...(operatorSurface?.deliverable === undefined
      ? []
      : [`Deliverable: ${operatorSurface.deliverable}`]),
    ...(operatorSurface?.bridgeVerdict === undefined
      ? []
      : [`Bridge verdict: ${operatorSurface.bridgeVerdict}`]),
    ...(operatorSurface?.bridgeFailureReason === undefined
      ? []
      : [`Bridge failure reason: ${operatorSurface.bridgeFailureReason}`]),
    ...(operatorSurface?.nextAction === undefined
      ? []
      : [`Next action: ${operatorSurface.nextAction}`]),
    ...report.summary.map((entry) => `Report summary: ${entry}`),
    ...(report.flags.length === 0 ? [] : [`Report flags: ${report.flags.join(", ")}`]),
    ...assignmentEvidence,
  ].join("\n");
}

function createSourceIdFromPath(path: string): string {
  return slugifySourceId(basename(path) || "local_directory");
}

function createSourceIdFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return slugifySourceId(`${url.hostname}${url.pathname}`);
  } catch {
    return slugifySourceId(value);
  }
}

function createSourceIdFromQuery(value: string): string {
  return slugifySourceId(value);
}

function createSourceIdFromPastedTexts(texts: readonly LearnDirectorExperienceTextInput[]): string {
  if (texts.length === 1) {
    const text = texts[0];
    return slugifySourceId(text?.title ?? text?.sourceRef ?? "pasted_text");
  }
  return `pasted_text_${texts.length}`;
}

function extractHttpUrls(value: string): string[] {
  return [...value.matchAll(/https?:\/\/\S+/giu)]
    .map((match) => stripTrailingUrlPunctuation(match[0] ?? ""))
    .filter(isHttpUrl);
}

function stripTrailingUrlPunctuation(value: string): string {
  return value.replace(/[)\]}>,.;:!?，。；：！？、]+$/u, "");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function slugifySourceId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+/u, "")
    .replace(/_+$/u, "");
  return slug.length === 0 ? "source" : slug;
}

function resolveCandidateReviewStatus(
  candidate: DirectorKnowledgeCandidateDocument,
  review: DirectorKnowledgeReviewDecision | null | undefined,
): "pending" | "accepted" | "rejected" | "stale" {
  if (!review) {
    return "pending";
  }
  if (review.candidateVersion !== candidate.metadata.version) {
    return "stale";
  }
  return review.decision;
}

function selectLatestRollbackRecord(
  records: readonly DirectorKnowledgeRollbackRecord[],
): DirectorKnowledgeRollbackRecord | null {
  if (records.length === 0) {
    return null;
  }

  return (
    [...records].sort((left, right) => {
      return (
        right.rolledBackAt.localeCompare(left.rolledBackAt) ||
        right.currentVersionAfter - left.currentVersionAfter ||
        right.packId.localeCompare(left.packId)
      );
    })[0] ?? null
  );
}

async function loadKnowledgeEvolutionSwitchState(
  workspaceRoot: string,
): Promise<KnowledgeEvolutionSwitchState> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchPath = join(workspace.runtime, "switches.json");
  try {
    const raw = JSON.parse(await readFile(switchPath, "utf8"));
    if (!isRecord(raw)) {
      return defaultKnowledgeEvolutionSwitchState();
    }

    const features = isRecord(raw.features) ? raw.features : {};
    return {
      enabled: Boolean(features["knowledgeEvolution.enabled"]),
      autoCandidate: Boolean(features["knowledgeEvolution.autoCandidate"]),
      publish: Boolean(features["knowledgeEvolution.publish"]),
    };
  } catch {
    return defaultKnowledgeEvolutionSwitchState();
  }
}

function defaultKnowledgeEvolutionSwitchState(): KnowledgeEvolutionSwitchState {
  return {
    enabled: false,
    autoCandidate: false,
    publish: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listOptionalStoreRecords(
  store: FileExperienceStore,
  methodName: "listSourceArtifacts" | "listQuarantineRecords",
): Promise<readonly unknown[]> {
  const method = isRecord(store) ? store[methodName] : undefined;
  if (typeof method !== "function") {
    return [];
  }
  const records = await (method as () => Promise<unknown>).call(store);
  return Array.isArray(records) ? records : [];
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function readNumberProperty(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function readStringArrayProperty(value: unknown, key: string): readonly string[] {
  if (!isRecord(value)) {
    return [];
  }
  const field = value[key];
  return Array.isArray(field) ? field.filter((entry) => typeof entry === "string") : [];
}

function normalizeOptionalText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function normalizeRequiredText(
  value: string | undefined,
  fallback: string,
  fieldName: string,
): string {
  const normalized = value?.trim();
  const result = normalized && normalized.length > 0 ? normalized : fallback.trim();
  if (result.length === 0) {
    throw new Error(`Experience candidate ${fieldName} cannot be empty.`);
  }
  return result;
}

function normalizeOptionalList(
  value: readonly string[] | undefined,
  fallback: readonly string[],
): readonly string[] {
  if (value === undefined) {
    return [...fallback];
  }
  const normalized = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return normalized.length === 0 ? [...fallback] : normalized;
}

export async function decideDirectorKnowledgeCandidateStructured(
  workspaceRoot: string,
  input: DecideDirectorKnowledgeCandidateStructuredInput,
): Promise<ReviewDirectorKnowledgeCandidateResult> {
  const service = createDirectorKnowledgeLifecycleService(createKnowledgeStore(workspaceRoot));
  return service.reviewCandidate({
    packId: input.packId,
    decision: input.decision,
    ...(input.author === undefined ? {} : { actor: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

function formatDirectorKnowledgeCandidateDecision(
  review: ReviewDirectorKnowledgeCandidateResult,
): string {
  return [
    "Director knowledge candidate decision:",
    `  pack id: ${review.candidate.metadata.id}`,
    `  next status: ${review.review.decision}`,
    `  candidate version: ${review.review.candidateVersion}`,
    `  diff summary: ${review.candidate.diff.summary}`,
    `  notes: ${review.notes.join(" | ")}`,
  ].join("\n");
}

export async function decideDirectorExperienceCandidateStructured(
  workspaceRoot: string,
  input: DecideDirectorExperienceCandidateStructuredInput,
): Promise<DecideDirectorExperienceCandidateStructuredResult> {
  const store = createExperienceStore(workspaceRoot);
  const candidate = await store.getCandidate(input.candidateId);
  if (!candidate) {
    throw new Error(`Unknown experience candidate: ${input.candidateId}`);
  }

  const decidedAtMs = toEpochMs(input.now);
  const decision = createExperienceReviewDecision({
    decisionId: `experience_review_${input.decision}_${slugifySourceId(input.candidateId)}_${decidedAtMs}`,
    candidateId: input.candidateId,
    gate: "human",
    decision: input.decision,
    decidedAtMs,
    ...(input.author === undefined ? {} : { reviewerId: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  const written = await store.writeReviewDecision(decision);

  return {
    candidate,
    review: decision,
    write: written,
  };
}

function formatDirectorExperienceCandidateDecision(
  result: DecideDirectorExperienceCandidateStructuredResult,
): string {
  return [
    "Director experience candidate decision:",
    `  candidate id: ${result.candidate.candidateId}`,
    `  next status: ${result.review.decision}`,
    `  title: ${result.candidate.title}`,
    `  decided at: ${formatEpochMs(result.review.decidedAtMs)}`,
    `  notes: ${result.write.notes.join(" | ")}`,
  ].join("\n");
}

function selectLatestExperienceReview(
  candidateId: string,
  decisions: readonly ExperienceReviewDecision[],
): ExperienceReviewDecision | null {
  const matching = decisions.filter((decision) => decision.candidateId === candidateId);
  if (matching.length === 0) {
    return null;
  }
  return (
    [...matching].sort((left, right) => {
      return (
        right.decidedAtMs - left.decidedAtMs || right.decisionId.localeCompare(left.decisionId)
      );
    })[0] ?? null
  );
}

function inspectExperienceCandidateFromLists(
  candidate: ExperienceCandidate,
  reviews: readonly ExperienceReviewDecision[],
  promotions: readonly ExperiencePromotionRecord[],
  taxonomy: ExperienceCandidateTaxonomyRecord | null = null,
): DirectorExperienceCandidateInspection {
  const latestReview = selectLatestExperienceReview(candidate.candidateId, reviews);
  const candidatePromotions = promotions.filter(
    (promotion) => promotion.candidateId === candidate.candidateId,
  );
  const latestPromotion = selectLatestExperiencePromotion(candidatePromotions);
  return {
    candidate,
    status: latestReview?.decision ?? "pending",
    latestReview,
    promotions: candidatePromotions,
    latestPromotion,
    promoted: latestPromotion !== null,
    taxonomy,
  };
}

function selectLatestExperiencePromotion(
  promotions: readonly ExperiencePromotionRecord[],
): ExperiencePromotionRecord | null {
  if (promotions.length === 0) {
    return null;
  }
  return (
    [...promotions].sort((left, right) => {
      return (
        right.promotedAtMs - left.promotedAtMs || right.promotionId.localeCompare(left.promotionId)
      );
    })[0] ?? null
  );
}

function formatExperienceEvidence(candidate: ExperienceCandidate): string {
  if (candidate.evidence.length === 0) {
    return "(none)";
  }
  return candidate.evidence
    .map((entry) => `${entry.evidenceId}:${entry.path ?? entry.sourceRef}`)
    .join(" | ");
}

function formatExperienceQuality(candidate: ExperienceCandidate): string {
  const quality = isRecord(candidate) && isRecord(candidate.quality) ? candidate.quality : null;
  if (quality === null) {
    return "(none)";
  }
  const verdict = typeof quality.verdict === "string" ? quality.verdict : "unknown";
  const score = typeof quality.score === "number" ? quality.score : null;
  const reasons = Array.isArray(quality.reasons)
    ? quality.reasons.filter((reason) => typeof reason === "string")
    : [];
  return `${verdict} score=${score ?? "(none)"} reasons=${reasons.join(" | ") || "(none)"}`;
}

function formatExperienceEvidencePreview(candidate: ExperienceCandidate): string {
  return readStringProperty(candidate, "evidencePreview") ?? "(none)";
}

function formatEpochMs(value: number): string {
  return new Date(value).toISOString();
}

function toEpochMs(value: string | undefined): number {
  if (value === undefined) {
    return Date.now();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function loadKnowledgeSwitchState(workspaceRoot: string) {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return loadDirectorSwitchState(join(workspace.runtime, "switches.json"));
}
