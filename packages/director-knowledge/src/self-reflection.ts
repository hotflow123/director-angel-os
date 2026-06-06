import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  ExperienceCandidate,
  ExperiencePromotionRecord,
  ExperienceQuarantineRecord,
  ExperienceReviewDecision,
} from "@hotflow/contracts";
import type { DirectorSwitchState } from "@hotflow/director-runtime";
import { loadDirectorSwitchState } from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

import type {
  DirectorKnowledgeCandidateDocument,
  DirectorKnowledgeReviewDecision,
} from "./evolution.js";
import { FileExperienceStore } from "./experience-store.js";
import { runDirectorHeartbeatStructured } from "./heartbeat.js";
import { inspectDirectorMaintenance } from "./maintenance.js";
import type { DirectorReflectionReport } from "./reflection.js";
import type { DirectorSoulCandidate } from "./soul.js";
import { isDirectorSoulCandidate } from "./soul.js";
import { FileKnowledgeStore } from "./store.js";

export type DirectorDailySelfReflectionStatus = "healthy" | "attention" | "blocked";

export interface DirectorDailySelfReflectionInput {
  readonly date?: string;
  readonly now?: string;
  readonly dataDir?: string;
}

export interface DirectorDailySelfReflectionWindow {
  readonly date: string;
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface DirectorDailySelfReflectionRunSummary {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly aborted: number;
  readonly running: number;
  readonly previewOnly: number;
  readonly reflected: number;
  readonly reflectionDue: number;
  readonly bridgeAttempted: number;
  readonly bridgeFailed: number;
  readonly knowledgeHit: number;
  readonly knowledgeMiss: number;
  readonly skillHit: number;
  readonly skillMiss: number;
  readonly memoryHit: number;
  readonly memoryMiss: number;
  readonly sampleGoals: readonly string[];
}

export interface DirectorDailySelfReflectionReviewSummary {
  readonly experiencePending: number;
  readonly experienceAccepted: number;
  readonly experienceRejected: number;
  readonly experiencePromoted: number;
  readonly experienceQuarantined: number;
  readonly knowledgePending: number;
  readonly knowledgeAccepted: number;
  readonly knowledgeRejected: number;
  readonly knowledgePublished: number;
  readonly soulPending: number;
  readonly memoryIngestOk: number;
  readonly memoryIngestIssue: number;
  readonly logArchiveDue: number;
  readonly experienceArchiveDue: number;
  readonly knowledgeArchiveDue: number;
}

export interface DirectorDailySelfReflectionCapabilitySummary {
  readonly heartbeatEnabled: boolean;
  readonly memoryEnabled: boolean;
  readonly knowledgeRecallEnabled: boolean;
  readonly learningEnabled: boolean;
  readonly soulEnabled: boolean;
  readonly careEnabled: boolean;
  readonly selfReflectionEnabled: boolean;
  readonly heartbeatEventCount: number;
  readonly heartbeatHighestSeverity: string;
}

export type DirectorDailySelfReflectionProposalKind =
  | "memory-candidate"
  | "experience-candidate"
  | "skill-improvement"
  | "test-smoke-improvement"
  | "ui-copy-improvement"
  | "maintenance-action";

export interface DirectorDailySelfReflectionProposal {
  readonly proposalId: string;
  readonly kind: DirectorDailySelfReflectionProposalKind;
  readonly title: string;
  readonly summary: string;
  readonly suggestedAction: string;
  readonly actionRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly reviewRequired: true;
}

export interface DirectorDailySelfReflectionReport {
  readonly schemaVersion: "director.self-reflection.daily-report.v1";
  readonly reportId: string;
  readonly status: DirectorDailySelfReflectionStatus;
  readonly createdAt: string;
  readonly window: DirectorDailySelfReflectionWindow;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly feedbackSignals: readonly string[];
  readonly whatWorked: readonly string[];
  readonly whatFailed: readonly string[];
  readonly efficiencyFindings: readonly string[];
  readonly selfCorrectionActions: readonly string[];
  readonly proposals: readonly DirectorDailySelfReflectionProposal[];
  readonly reviewRequired: boolean;
  readonly guardrails: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface DirectorDailySelfReflectionResult {
  readonly report: DirectorDailySelfReflectionReport;
  readonly reportPath: string;
  readonly markdownPath: string;
  readonly text: string;
}

interface JsonFile<T> {
  readonly path: string;
  readonly value: T;
}

interface RunReportLike {
  readonly reportId?: string;
  readonly runId?: string;
  readonly recordedAt?: string;
  readonly summary?: readonly string[];
  readonly flags?: readonly string[];
  readonly run?: {
    readonly runId?: string;
    readonly goal?: string;
    readonly status?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
    readonly completedAt?: string;
    readonly sideEffectsAllowed?: boolean;
    readonly assignments?: readonly AssignmentLike[];
  };
}

interface AssignmentLike {
  readonly role?: string;
  readonly status?: string;
  readonly selectedAdapter?: string;
  readonly result?: {
    readonly summary?: string;
    readonly adapterId?: string;
    readonly bridgeExecution?: unknown;
  };
}

interface EntrySessionLike {
  readonly entrySessionId?: string;
  readonly channel?: string;
  readonly turns?: readonly EntryTurnLike[];
}

interface EntryTurnLike {
  readonly summary?: string;
  readonly receivedAt?: string;
  readonly state?: string;
}

const SELF_REFLECTION_SCHEMA_VERSION = "director.self-reflection.daily-report.v1" as const;

export async function runDirectorDailySelfReflection(
  workspaceRoot: string,
  input: DirectorDailySelfReflectionInput = {},
): Promise<DirectorDailySelfReflectionResult> {
  const nowMs = toEpochMs(input.now) ?? Date.now();
  const date = normalizeDate(input.date, nowMs);
  const window = createDailyWindow(date);
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchState = loadDirectorSwitchState(join(workspace.runtime, "switches.json"));

  const [heartbeat, maintenance, runReports, reflections, experience, knowledge, soulCandidates] =
    await Promise.all([
      runDirectorHeartbeatStructured(workspaceRoot, {
        dataDir: input.dataDir ?? workspaceRoot,
        now: new Date(nowMs).toISOString(),
      }),
      inspectDirectorMaintenance({
        runtimeRoot: workspace.runtime,
        experienceDir: join(workspace.knowledge, "experience"),
        knowledgeDir: workspace.knowledge,
        nowMs,
      }),
      listRunReports(join(workspace.runtime, "execution", "runs")),
      listJsonDocuments<DirectorReflectionReport>(
        join(workspace.knowledge, "reflection", "report"),
        isReflectionReport,
      ),
      inspectExperience(workspace.knowledge),
      inspectKnowledge(workspace.knowledge),
      listJsonDocuments<DirectorSoulCandidate>(
        join(workspace.knowledge, "soul", "candidate"),
        isDirectorSoulCandidate,
      ),
    ]);

  const windowRunReports = runReports.filter((entry) =>
    isInWindow(resolveRunReportTime(entry.value), window),
  );
  const feedbackSignals = await collectFeedbackSignals(workspace.runtime, window);
  const reflectedRunIds = new Set(reflections.map((entry) => entry.value.sourceId));
  const runs = summarizeRuns(windowRunReports, reflectedRunIds);
  const reviews = summarizeReviews({
    experience,
    knowledge,
    soulCandidates,
    maintenance,
    runtimeRoot: workspace.runtime,
  });
  const capability = summarizeCapabilities(switchState, heartbeat.snapshot);
  const whatWorked = deriveDailyWhatWorked({ runs, reviews, capability, feedbackSignals });
  const whatFailed = deriveDailyWhatFailed({ runs, reviews, capability, feedbackSignals });
  const efficiencyFindings = deriveDailyEfficiencyFindings({ runs, reviews, capability });
  const selfCorrectionActions = deriveDailySelfCorrectionActions({
    runs,
    reviews,
    capability,
    heartbeatEventKinds: heartbeat.snapshot.events.map((event) => event.kind),
  });
  const evidenceRefs = [
    `path://${join(workspace.runtime, "execution", "runs")}`,
    `path://${join(workspace.knowledge, "experience")}`,
    `path://${workspace.knowledge}`,
    `heartbeat://${heartbeat.snapshot.snapshotId}`,
    `maintenance://${maintenance.generatedAt}`,
  ];
  const proposals = deriveDailySelfReflectionProposals({
    date,
    runs,
    reviews,
    capability,
    feedbackSignals,
    heartbeatEvents: heartbeat.snapshot.events,
    evidenceRefs,
  });
  const status = deriveDailyStatus({ runs, reviews, capability });
  const report = materializeDailySelfReflectionReport({
    date,
    nowMs,
    status,
    window,
    capability,
    runs,
    reviews,
    feedbackSignals,
    whatWorked,
    whatFailed,
    efficiencyFindings,
    selfCorrectionActions,
    proposals,
    evidenceRefs,
  });
  const paths = await writeDailySelfReflectionReport(workspaceRoot, report);
  const text = formatDirectorDailySelfReflectionReport(report, paths.reportPath);
  await writeFile(paths.markdownPath, renderDirectorDailySelfReflectionMarkdown(report), "utf8");
  return {
    report,
    reportPath: paths.reportPath,
    markdownPath: paths.markdownPath,
    text,
  };
}

export function formatDirectorDailySelfReflectionReport(
  report: DirectorDailySelfReflectionReport,
  reportPath?: string,
): string {
  return [
    "Director daily self-reflection:",
    `  date: ${report.window.date}`,
    `  status: ${report.status}`,
    `  runs: total=${report.runs.total} completed=${report.runs.completed} failed=${report.runs.failed} blocked=${report.runs.blocked} reflectionDue=${report.runs.reflectionDue}`,
    `  recall: knowledge hit/miss=${report.runs.knowledgeHit}/${report.runs.knowledgeMiss} skill hit/miss=${report.runs.skillHit}/${report.runs.skillMiss} memory hit/miss=${report.runs.memoryHit}/${report.runs.memoryMiss}`,
    `  review backlog: experience=${report.reviews.experiencePending} knowledge=${report.reviews.knowledgePending} soul=${report.reviews.soulPending}`,
    `  maintenance due: logs=${report.reviews.logArchiveDue} experience=${report.reviews.experienceArchiveDue} knowledge=${report.reviews.knowledgeArchiveDue}`,
    `  feedback signals: ${report.feedbackSignals.length}`,
    "  what worked:",
    ...formatBullets(report.whatWorked, "    - "),
    "  what failed:",
    ...formatBullets(report.whatFailed, "    - "),
    "  next correction actions:",
    ...formatBullets(report.selfCorrectionActions, "    - "),
    `  review proposals: ${report.proposals.length}`,
    ...formatBullets(
      report.proposals.map((proposal) => `${proposal.kind}: ${proposal.title}`),
      "    - ",
    ),
    `  guardrail: ${report.guardrails.join(" | ")}`,
    reportPath === undefined ? "" : `  report: ${reportPath}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function renderDirectorDailySelfReflectionMarkdown(
  report: DirectorDailySelfReflectionReport,
): string {
  const lines = [
    "# Director Daily Self-Reflection",
    "",
    `Date: ${report.window.date}`,
    `Status: ${report.status}`,
    `Created: ${report.createdAt}`,
    "",
    "## Snapshot",
    "",
    `- Runs: ${report.runs.total} total, ${report.runs.completed} completed, ${report.runs.failed} failed, ${report.runs.blocked} blocked.`,
    `- Reflection due: ${report.runs.reflectionDue}.`,
    `- Recall: knowledge ${report.runs.knowledgeHit}/${report.runs.knowledgeMiss}, skill ${report.runs.skillHit}/${report.runs.skillMiss}, memory ${report.runs.memoryHit}/${report.runs.memoryMiss}.`,
    `- Pending reviews: experience ${report.reviews.experiencePending}, knowledge ${report.reviews.knowledgePending}, soul ${report.reviews.soulPending}.`,
    "",
    "## What Worked",
    "",
    ...formatBullets(report.whatWorked, "- "),
    "",
    "## What Failed",
    "",
    ...formatBullets(report.whatFailed, "- "),
    "",
    "## Efficiency",
    "",
    ...formatBullets(report.efficiencyFindings, "- "),
    "",
    "## Self-Correction Actions",
    "",
    ...formatBullets(report.selfCorrectionActions, "- "),
    "",
    "## Review-Gated Proposals",
    "",
    ...formatBullets(
      report.proposals.map(
        (proposal) =>
          `${proposal.kind}: ${proposal.title} — ${proposal.suggestedAction} (evidence: ${proposal.evidenceRefs.join(", ")})`,
      ),
      "- ",
    ),
    "",
    "## Guardrails",
    "",
    ...formatBullets(report.guardrails, "- "),
    "",
    "## Evidence",
    "",
    ...formatBullets(report.evidenceRefs, "- "),
    "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function materializeDailySelfReflectionReport(input: {
  readonly date: string;
  readonly nowMs: number;
  readonly status: DirectorDailySelfReflectionStatus;
  readonly window: DirectorDailySelfReflectionWindow;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly feedbackSignals: readonly string[];
  readonly whatWorked: readonly string[];
  readonly whatFailed: readonly string[];
  readonly efficiencyFindings: readonly string[];
  readonly selfCorrectionActions: readonly string[];
  readonly proposals: readonly DirectorDailySelfReflectionProposal[];
  readonly evidenceRefs: readonly string[];
}): DirectorDailySelfReflectionReport {
  const createdAt = new Date(input.nowMs).toISOString();
  const fingerprint = [
    input.date,
    createdAt,
    JSON.stringify(input.runs),
    JSON.stringify(input.reviews),
    JSON.stringify(input.selfCorrectionActions),
    JSON.stringify(input.proposals),
  ].join("\n");
  return {
    schemaVersion: SELF_REFLECTION_SCHEMA_VERSION,
    reportId: `daily_self_reflection_${input.date}_${shortHash(fingerprint)}`,
    status: input.status,
    createdAt,
    window: input.window,
    capability: input.capability,
    runs: input.runs,
    reviews: input.reviews,
    feedbackSignals: [...input.feedbackSignals],
    whatWorked: [...input.whatWorked],
    whatFailed: [...input.whatFailed],
    efficiencyFindings: [...input.efficiencyFindings],
    selfCorrectionActions: [...input.selfCorrectionActions],
    proposals: [...input.proposals],
    reviewRequired: true,
    guardrails: [
      "每日自省只生成报告和建议，不自动发布知识、不自动写入 Soul、不自动安装或启用 Skill。",
      "用户闲聊、临时任务和低信号反馈不能直接变成长期记忆或经验。",
      "失败运行不能沉淀为正向经验；必须先通过人工审查。",
    ],
    evidenceRefs: uniqueStrings(input.evidenceRefs),
  };
}

async function writeDailySelfReflectionReport(
  workspaceRoot: string,
  report: DirectorDailySelfReflectionReport,
): Promise<{ readonly reportPath: string; readonly markdownPath: string }> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const root = join(workspace.knowledge, "reflection", "daily");
  await mkdir(root, { recursive: true });
  const reportPath = join(root, `${report.window.date}.json`);
  const markdownPath = join(root, `${report.window.date}.md`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { reportPath, markdownPath };
}

function summarizeCapabilities(
  switchState: DirectorSwitchState,
  heartbeat: { readonly eventCount: number; readonly highestSeverity: string },
): DirectorDailySelfReflectionCapabilitySummary {
  return {
    heartbeatEnabled: switchState.features["heartbeat.enabled"],
    memoryEnabled: switchState.features["memory.enabled"],
    knowledgeRecallEnabled: switchState.features["knowledgeRecall.enabled"],
    learningEnabled: switchState.features["learning.enabled"],
    soulEnabled: switchState.features["soul.enabled"],
    careEnabled: switchState.features["care.enabled"],
    selfReflectionEnabled: switchState.features["selfReflection.enabled"],
    heartbeatEventCount: heartbeat.eventCount,
    heartbeatHighestSeverity: heartbeat.highestSeverity,
  };
}

function summarizeRuns(
  reports: readonly JsonFile<RunReportLike>[],
  reflectedRunIds: ReadonlySet<string>,
): DirectorDailySelfReflectionRunSummary {
  let completed = 0;
  let failed = 0;
  let blocked = 0;
  let aborted = 0;
  let running = 0;
  let previewOnly = 0;
  let reflected = 0;
  let reflectionDue = 0;
  let bridgeAttempted = 0;
  let bridgeFailed = 0;
  let knowledgeHit = 0;
  let knowledgeMiss = 0;
  let skillHit = 0;
  let skillMiss = 0;
  let memoryHit = 0;
  let memoryMiss = 0;
  const sampleGoals: string[] = [];

  for (const entry of reports) {
    const report = entry.value;
    const status = report.run?.status;
    if (status === "completed") {
      completed += 1;
    } else if (status === "failed") {
      failed += 1;
    } else if (status === "blocked") {
      blocked += 1;
    } else if (status === "aborted") {
      aborted += 1;
    } else if (status === "running" || status === "ready" || status === "created") {
      running += 1;
    }
    if (report.run?.sideEffectsAllowed === false || report.flags?.includes("preview-only")) {
      previewOnly += 1;
    }
    const runId = report.runId ?? report.run?.runId ?? basename(entry.path);
    if (reflectedRunIds.has(runId)) {
      reflected += 1;
    } else if (isReflectableStatus(status)) {
      reflectionDue += 1;
    }
    if (report.flags?.includes("external-bridge-attempted")) {
      bridgeAttempted += 1;
    }
    if (report.flags?.includes("external-bridge-failed")) {
      bridgeFailed += 1;
    }
    const text = JSON.stringify(report).toLowerCase();
    if (
      /knowledge.{0,80}(hit|matched)|published knowledge matched|知识召回[^。]*(命中|hit)/isu.test(
        text,
      )
    ) {
      knowledgeHit += 1;
    } else if (/knowledge.{0,80}(miss|unmatched)|知识召回[^。]*(miss|未命中)/isu.test(text)) {
      knowledgeMiss += 1;
    }
    if (/skill.{0,80}(hit|matched)|skillids|skill 命中/isu.test(text)) {
      skillHit += 1;
    } else if (/skill.{0,80}(miss|unmatched)|skill miss|skill 未命中/isu.test(text)) {
      skillMiss += 1;
    }
    if (/memory.{0,80}(hit|matched)|long-term-memory[^a-z0-9]{0,20}ok/isu.test(text)) {
      memoryHit += 1;
    } else if (
      /memory.{0,80}(miss|missing)|no memory ingest|记忆[^。]*(miss|未命中)/isu.test(text)
    ) {
      memoryMiss += 1;
    }
    const goal = report.run?.goal?.trim();
    if (goal && sampleGoals.length < 5) {
      sampleGoals.push(goal.slice(0, 160));
    }
  }

  return {
    total: reports.length,
    completed,
    failed,
    blocked,
    aborted,
    running,
    previewOnly,
    reflected,
    reflectionDue,
    bridgeAttempted,
    bridgeFailed,
    knowledgeHit,
    knowledgeMiss,
    skillHit,
    skillMiss,
    memoryHit,
    memoryMiss,
    sampleGoals,
  };
}

function summarizeReviews(input: {
  readonly experience: {
    readonly candidates: readonly ExperienceCandidate[];
    readonly reviews: readonly ExperienceReviewDecision[];
    readonly promotions: readonly ExperiencePromotionRecord[];
    readonly quarantines: readonly ExperienceQuarantineRecord[];
  };
  readonly knowledge: {
    readonly candidates: readonly DirectorKnowledgeCandidateDocument[];
    readonly reviews: readonly DirectorKnowledgeReviewDecision[];
    readonly publishedCount: number;
  };
  readonly soulCandidates: readonly JsonFile<DirectorSoulCandidate>[];
  readonly maintenance: {
    readonly logMaintenance: { readonly summary: { readonly archiveFiles: number } };
    readonly experienceMaintenance: {
      readonly summary: {
        readonly archiveCandidates: number;
        readonly archiveQuarantines: number;
        readonly archiveArtifacts: number;
      };
    };
    readonly knowledgeMaintenance: {
      readonly summary: {
        readonly archiveCandidates: number;
        readonly archiveReviews: number;
        readonly archiveHistory: number;
        readonly archiveRollback: number;
      };
    };
  };
  readonly runtimeRoot: string;
}): DirectorDailySelfReflectionReviewSummary {
  const experienceLatest = latestExperienceReviews(input.experience.reviews);
  let experienceAccepted = 0;
  let experienceRejected = 0;
  for (const decision of experienceLatest.values()) {
    if (decision.decision === "accepted") {
      experienceAccepted += 1;
    } else if (decision.decision === "rejected") {
      experienceRejected += 1;
    }
  }
  const promotedIds = new Set(input.experience.promotions.map((entry) => entry.candidateId));
  const experiencePending = input.experience.candidates.filter(
    (candidate) => !experienceLatest.has(candidate.candidateId),
  ).length;
  const knowledgeLatest = latestKnowledgeReviews(input.knowledge.reviews);
  let knowledgeAccepted = 0;
  let knowledgeRejected = 0;
  for (const decision of knowledgeLatest.values()) {
    if (decision.decision === "accepted") {
      knowledgeAccepted += 1;
    } else if (decision.decision === "rejected") {
      knowledgeRejected += 1;
    }
  }
  const knowledgePending = input.knowledge.candidates.filter(
    (candidate) => !knowledgeLatest.has(candidate.metadata.id),
  ).length;
  const memoryIngestCounts = countJsonFiles(join(input.runtimeRoot, "memory", "ingest"), (value) =>
    isRecord(value) && value.status === "ok" ? "ok" : "issue",
  );

  return {
    experiencePending,
    experienceAccepted,
    experienceRejected,
    experiencePromoted: promotedIds.size,
    experienceQuarantined: input.experience.quarantines.length,
    knowledgePending,
    knowledgeAccepted,
    knowledgeRejected,
    knowledgePublished: input.knowledge.publishedCount,
    soulPending: input.soulCandidates.filter((entry) => entry.value.status === "pending").length,
    memoryIngestOk: memoryIngestCounts.ok,
    memoryIngestIssue: memoryIngestCounts.issue,
    logArchiveDue: input.maintenance.logMaintenance.summary.archiveFiles,
    experienceArchiveDue:
      input.maintenance.experienceMaintenance.summary.archiveCandidates +
      input.maintenance.experienceMaintenance.summary.archiveQuarantines +
      input.maintenance.experienceMaintenance.summary.archiveArtifacts,
    knowledgeArchiveDue:
      input.maintenance.knowledgeMaintenance.summary.archiveCandidates +
      input.maintenance.knowledgeMaintenance.summary.archiveReviews +
      input.maintenance.knowledgeMaintenance.summary.archiveHistory +
      input.maintenance.knowledgeMaintenance.summary.archiveRollback,
  };
}

function deriveDailyWhatWorked(input: {
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
  readonly feedbackSignals: readonly string[];
}): readonly string[] {
  const worked: string[] = [];
  if (input.runs.completed > 0) {
    worked.push(`今天有 ${input.runs.completed} 个 run 完成，系统至少具备端到端执行记录。`);
  }
  if (input.runs.knowledgeHit > 0) {
    worked.push(`制作链路出现 ${input.runs.knowledgeHit} 次知识命中，不是完全从零开始。`);
  }
  if (input.runs.skillHit > 0) {
    worked.push(`制作链路出现 ${input.runs.skillHit} 次 Skill 命中，外部/自进化 Skill 已参与。`);
  }
  if (input.reviews.knowledgePublished > 0) {
    worked.push(`已有 ${input.reviews.knowledgePublished} 个已发布知识包，可作为后续召回来源。`);
  }
  if (input.capability.heartbeatEnabled) {
    worked.push("心跳开关已开启，系统可以进行低风险后台扫描。");
  }
  if (input.feedbackSignals.length > 0) {
    worked.push(`捕捉到 ${input.feedbackSignals.length} 条用户反馈信号，可用于人工复盘。`);
  }
  return worked.length > 0 ? worked : ["今天没有足够证据证明某条链路表现稳定。"];
}

function deriveDailyWhatFailed(input: {
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
  readonly feedbackSignals: readonly string[];
}): readonly string[] {
  const failed: string[] = [];
  if (input.runs.failed > 0 || input.runs.blocked > 0 || input.runs.aborted > 0) {
    failed.push(
      `今天有失败/阻塞/中止 run：failed=${input.runs.failed} blocked=${input.runs.blocked} aborted=${input.runs.aborted}。`,
    );
  }
  if (input.runs.reflectionDue > 0) {
    failed.push(`有 ${input.runs.reflectionDue} 个终态 run 尚未复盘，不能贸然沉淀为经验。`);
  }
  if (input.runs.bridgeFailed > 0) {
    failed.push(`外部桥接失败 ${input.runs.bridgeFailed} 次，需要检查 adapter、凭证、超时或路由。`);
  }
  if (input.runs.knowledgeMiss > input.runs.knowledgeHit) {
    failed.push("知识召回 miss 多于 hit，说明已发布经验与当前制作需求的匹配还不够。");
  }
  if (input.runs.skillMiss > input.runs.skillHit) {
    failed.push("Skill miss 多于 hit，说明可调用技能还没有覆盖当前任务类型。");
  }
  if (input.reviews.experiencePending > 0 || input.reviews.knowledgePending > 0) {
    failed.push(
      `审查积压仍存在：经验 ${input.reviews.experiencePending} 条，知识 ${input.reviews.knowledgePending} 条。`,
    );
  }
  if (!input.capability.selfReflectionEnabled) {
    failed.push("每日自省开关未开启；当前只能手动触发，不能算完整自动自省机制。");
  }
  return failed.length > 0 ? failed : ["没有发现明确失败项，但仍需要人工抽查报告质量。"];
}

function deriveDailyEfficiencyFindings(input: {
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
}): readonly string[] {
  const findings: string[] = [];
  if (input.runs.total > 0) {
    const terminal =
      input.runs.completed + input.runs.failed + input.runs.blocked + input.runs.aborted;
    findings.push(
      `今天 run 终态率 ${terminal}/${input.runs.total}；未终态越多，工作台越容易看起来“卡住”。`,
    );
  }
  if (input.runs.previewOnly > 0) {
    findings.push(
      `有 ${input.runs.previewOnly} 个 preview-only run；这适合安全预览，但不等于真实外部执行。`,
    );
  }
  if (input.reviews.logArchiveDue > 0 || input.reviews.experienceArchiveDue > 0) {
    findings.push("维护队列已有可归档项，继续堆积会增加经验库和日志检索噪音。");
  }
  if (!input.capability.careEnabled) {
    findings.push("care.enabled 未开启；已接受但未晋升、已接受但未发布的内容不会被主动提醒。");
  }
  return findings.length > 0
    ? findings
    : ["没有足够效率数据；后续应补 token、耗时、工具调用成本指标。"];
}

function deriveDailySelfCorrectionActions(input: {
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
  readonly heartbeatEventKinds: readonly string[];
}): readonly string[] {
  const actions: string[] = [];
  if (input.runs.reflectionDue > 0) {
    actions.push("先执行 /复盘 <runId> 处理未复盘终态 run，再决定是否沉淀经验。");
  }
  if (input.runs.failed > 0 || input.runs.blocked > 0 || input.runs.bridgeFailed > 0) {
    actions.push("对失败 run 只生成 failure-lesson 候选，不允许进入正向经验发布链路。");
  }
  if (input.reviews.experiencePending > 0) {
    actions.push("打开经验库，批量处理待审经验：通过、拒绝、分类、标签，而不是让候选长期堆积。");
  }
  if (input.reviews.knowledgePending > 0) {
    actions.push("对已接受经验晋升出的知识候选执行审核和发布，否则后续制作无法召回。");
  }
  if (input.reviews.logArchiveDue > 0 || input.reviews.experienceArchiveDue > 0) {
    actions.push("运行 /维护 预览，确认后执行 /维护 执行，清掉旧日志和低信号资料。");
  }
  if (!input.capability.selfReflectionEnabled) {
    actions.push("如需每日自动自省，开启 selfReflection.enabled，并让桌面端心跳定时触发每日报告。");
  }
  if (input.heartbeatEventKinds.includes("skill-proposal-due")) {
    actions.push("把高质量已接受经验转成待审 Skill 提案，但必须先人工审核再应用。");
  }
  return actions.length > 0
    ? actions
    : ["保持现有审查链路；下一轮重点补充更细的成本、耗时和用户满意度指标。"];
}

function deriveDailySelfReflectionProposals(input: {
  readonly date: string;
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
  readonly feedbackSignals: readonly string[];
  readonly heartbeatEvents: readonly {
    readonly kind: string;
    readonly evidenceRefs: readonly string[];
  }[];
  readonly evidenceRefs: readonly string[];
}): readonly DirectorDailySelfReflectionProposal[] {
  const proposals: DirectorDailySelfReflectionProposal[] = [];
  const heartbeatEvidence = input.heartbeatEvents.flatMap((event) => event.evidenceRefs);
  const baseEvidence = uniqueStrings([...input.evidenceRefs, ...heartbeatEvidence]).slice(0, 12);
  if (input.feedbackSignals.length > 0) {
    proposals.push(
      createDailySelfReflectionProposal({
        date: input.date,
        kind: "ui-copy-improvement",
        title: "复核用户反馈中的表达和交互问题",
        summary: `今天捕捉到 ${input.feedbackSignals.length} 条用户反馈，先归纳再改 UI/回复文案。`,
        suggestedAction: "打开每日自省报告，逐条确认反馈是否代表真实问题，再创建 UI/文案修复任务。",
        actionRefs: ["/反省", "/运行 状态"],
        evidenceRefs: [
          ...baseEvidence,
          ...input.feedbackSignals.map((signal) => `feedback://${signal}`),
        ],
      }),
    );
  }
  if (input.runs.reflectionDue > 0) {
    proposals.push(
      createDailySelfReflectionProposal({
        date: input.date,
        kind: "experience-candidate",
        title: "复盘终态 run 后再决定是否沉淀经验",
        summary: `${input.runs.reflectionDue} 个终态 run 尚未复盘，不能直接沉淀为正向经验。`,
        suggestedAction: "先对 run 做复盘；失败输出只允许进入 failure-lesson 候选。",
        actionRefs: ["/复盘 <runId>", "/经验 从运行报告 <runId> failure-lesson"],
        evidenceRefs: baseEvidence,
      }),
    );
  }
  if (input.runs.knowledgeMiss > input.runs.knowledgeHit) {
    proposals.push(
      createDailySelfReflectionProposal({
        date: input.date,
        kind: "experience-candidate",
        title: "补齐制作任务的已发布知识",
        summary: `知识召回 miss=${input.runs.knowledgeMiss} 多于 hit=${input.runs.knowledgeHit}，后续制作仍容易从零开始。`,
        suggestedAction: "优先审核已接受经验并晋升/发布为知识；不要把原文直接塞进运行时。",
        actionRefs: ["/经验", "/知识 候选", "/知识 发布 <packId>"],
        evidenceRefs: baseEvidence,
      }),
    );
  }
  if (input.runs.skillMiss > input.runs.skillHit) {
    proposals.push(
      createDailySelfReflectionProposal({
        date: input.date,
        kind: "skill-improvement",
        title: "把稳定流程提炼成待审 Skill",
        summary: `Skill miss=${input.runs.skillMiss} 多于 hit=${input.runs.skillHit}，说明可调用 Skill 覆盖不足。`,
        suggestedAction: "从已接受经验生成 Skill 提案，再由 operator 审核和应用。",
        actionRefs: [
          "/技能 从经验 <candidateId>",
          "/技能 接受 <proposalId>",
          "/技能 应用 <proposalId>",
        ],
        evidenceRefs: baseEvidence,
      }),
    );
  }
  if (input.runs.failed > 0 || input.runs.blocked > 0 || input.runs.bridgeFailed > 0) {
    proposals.push(
      createDailySelfReflectionProposal({
        date: input.date,
        kind: "test-smoke-improvement",
        title: "为失败链路补 smoke 或回归测试",
        summary: `失败/阻塞/桥接失败共 ${
          input.runs.failed + input.runs.blocked + input.runs.bridgeFailed
        } 个信号。`,
        suggestedAction: "先定位失败来源，再补最小可重复测试；不要直接把失败结果沉淀为正向经验。",
        actionRefs: ["/运行 状态", "/维护 预览"],
        evidenceRefs: baseEvidence,
      }),
    );
  }
  if (input.reviews.logArchiveDue > 0 || input.reviews.experienceArchiveDue > 0) {
    proposals.push(
      createDailySelfReflectionProposal({
        date: input.date,
        kind: "maintenance-action",
        title: "清理日志和低信号学习资料",
        summary: `可归档日志=${input.reviews.logArchiveDue}，经验相关归档=${input.reviews.experienceArchiveDue}。`,
        suggestedAction: "先运行维护预览，确认后再执行维护；维护不发布知识、不启用 Skill。",
        actionRefs: ["/维护 预览", "/维护 执行"],
        evidenceRefs: baseEvidence,
      }),
    );
  }
  if (!input.capability.selfReflectionEnabled) {
    proposals.push(
      createDailySelfReflectionProposal({
        date: input.date,
        kind: "memory-candidate",
        title: "确认是否开启每日自动自省",
        summary: "selfReflection.enabled 当前关闭；系统只能手动生成每日自省报告。",
        suggestedAction:
          "如需长期自我改进，开启 selfReflection.enabled；写入未来行为前仍需人工审核。",
        actionRefs: ["/设置 selfReflection.enabled 开启", "/心跳 启动"],
        evidenceRefs: baseEvidence,
      }),
    );
  }
  return proposals.length > 0
    ? proposals
    : [
        createDailySelfReflectionProposal({
          date: input.date,
          kind: "test-smoke-improvement",
          title: "维持每日健康抽检",
          summary: "今天没有强制修复项；保留一条健康抽检提案，防止自省静默失效。",
          suggestedAction: "抽查一次核心 smoke：桌面、微信、经验召回、Skill 召回、ComfyUI 草案。",
          actionRefs: ["/诊断", "/心跳 状态"],
          evidenceRefs: baseEvidence,
        }),
      ];
}

function createDailySelfReflectionProposal(input: {
  readonly date: string;
  readonly kind: DirectorDailySelfReflectionProposalKind;
  readonly title: string;
  readonly summary: string;
  readonly suggestedAction: string;
  readonly actionRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
}): DirectorDailySelfReflectionProposal {
  const evidenceRefs = uniqueStrings(input.evidenceRefs).slice(0, 20);
  const actionRefs = uniqueStrings(input.actionRefs);
  const fingerprint = [
    input.date,
    input.kind,
    input.title,
    input.summary,
    input.suggestedAction,
    actionRefs.join("\n"),
    evidenceRefs.join("\n"),
  ].join("\n");
  return {
    proposalId: `daily_reflection_${input.kind}_${shortHash(fingerprint)}`,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    suggestedAction: input.suggestedAction,
    actionRefs,
    evidenceRefs,
    reviewRequired: true,
  };
}

function deriveDailyStatus(input: {
  readonly runs: DirectorDailySelfReflectionRunSummary;
  readonly reviews: DirectorDailySelfReflectionReviewSummary;
  readonly capability: DirectorDailySelfReflectionCapabilitySummary;
}): DirectorDailySelfReflectionStatus {
  if (
    input.runs.blocked > 0 ||
    input.runs.failed > 0 ||
    input.capability.heartbeatHighestSeverity === "blocked"
  ) {
    return "blocked";
  }
  if (
    input.runs.reflectionDue > 0 ||
    input.reviews.experiencePending > 0 ||
    input.reviews.knowledgePending > 0 ||
    input.reviews.experienceArchiveDue > 0 ||
    input.reviews.knowledgeArchiveDue > 0 ||
    input.capability.heartbeatEventCount > 0
  ) {
    return "attention";
  }
  return "healthy";
}

async function inspectExperience(knowledgeRoot: string): Promise<{
  readonly candidates: readonly ExperienceCandidate[];
  readonly reviews: readonly ExperienceReviewDecision[];
  readonly promotions: readonly ExperiencePromotionRecord[];
  readonly quarantines: readonly ExperienceQuarantineRecord[];
}> {
  const store = new FileExperienceStore({ experienceDir: join(knowledgeRoot, "experience") });
  const [candidates, reviews, promotions, quarantines] = await Promise.all([
    store.listCandidates(),
    store.listReviewDecisions(),
    store.listPromotions(),
    store.listQuarantines(),
  ]);
  return { candidates, reviews, promotions, quarantines };
}

async function inspectKnowledge(knowledgeRoot: string): Promise<{
  readonly candidates: readonly DirectorKnowledgeCandidateDocument[];
  readonly reviews: readonly DirectorKnowledgeReviewDecision[];
  readonly publishedCount: number;
}> {
  const store = new FileKnowledgeStore({ knowledgeDir: knowledgeRoot });
  const [candidates, reviews, published] = await Promise.all([
    store.listCandidateDocuments(),
    store.listReviewDecisions(),
    store.listPublishedDocuments(),
  ]);
  return { candidates, reviews, publishedCount: published.length };
}

async function listRunReports(root: string): Promise<readonly JsonFile<RunReportLike>[]> {
  const entries = await listDirectoryEntries(root);
  const results: JsonFile<RunReportLike>[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(root, entry.name, "report.json");
    const value = await readJsonDocument(path);
    if (isRunReportLike(value)) {
      results.push({ path, value });
    }
  }
  return results;
}

async function listJsonDocuments<T>(
  root: string,
  guard: (value: unknown) => value is T,
): Promise<readonly JsonFile<T>[]> {
  const entries = await listDirectoryEntries(root);
  const results: JsonFile<T>[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith("._")) {
      continue;
    }
    const path = join(root, entry.name);
    const value = await readJsonDocument(path);
    if (guard(value)) {
      results.push({ path, value });
    }
  }
  return results;
}

async function collectFeedbackSignals(
  runtimeRoot: string,
  window: DirectorDailySelfReflectionWindow,
): Promise<readonly string[]> {
  const sessions = await listJsonDocuments<EntrySessionLike>(
    join(runtimeRoot, "entry", "sessions"),
    isEntrySessionLike,
  );
  const signals: string[] = [];
  for (const session of sessions) {
    for (const turn of session.value.turns ?? []) {
      if (!isInWindow(toEpochMs(turn.receivedAt), window)) {
        continue;
      }
      const summary = turn.summary?.trim() ?? "";
      if (isFeedbackSignal(summary) && signals.length < 20) {
        signals.push(`${session.value.channel ?? "unknown"}: ${summary.slice(0, 180)}`);
      }
    }
  }
  return uniqueStrings(signals);
}

function isFeedbackSignal(value: string): boolean {
  return /(不对|错误|失败|没反应|看不到|太慢|垃圾|跑偏|不是|应该|需要修|修一下|改成|更好|好很多|别|不要|没有通讯|无法)/u.test(
    value,
  );
}

function latestExperienceReviews(
  reviews: readonly ExperienceReviewDecision[],
): Map<string, ExperienceReviewDecision> {
  const latest = new Map<string, ExperienceReviewDecision>();
  for (const review of reviews) {
    const current = latest.get(review.candidateId);
    if (current === undefined || current.decidedAtMs < review.decidedAtMs) {
      latest.set(review.candidateId, review);
    }
  }
  return latest;
}

function latestKnowledgeReviews(
  reviews: readonly DirectorKnowledgeReviewDecision[],
): Map<string, DirectorKnowledgeReviewDecision> {
  const latest = new Map<string, DirectorKnowledgeReviewDecision>();
  for (const review of reviews) {
    const current = latest.get(review.packId);
    if (current === undefined || (current.decidedAt ?? "") < (review.decidedAt ?? "")) {
      latest.set(review.packId, review);
    }
  }
  return latest;
}

function countJsonFiles(
  root: string,
  classifier: (value: unknown) => "ok" | "issue",
): { readonly ok: number; readonly issue: number } {
  if (!existsSync(root)) {
    return { ok: 0, issue: 0 };
  }
  let ok = 0;
  let issue = 0;
  try {
    const files = readdirSyncSafe(root);
    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith("._")) {
        continue;
      }
      const raw = JSON.parse(readFileSyncSafe(join(root, file)));
      if (classifier(raw) === "ok") {
        ok += 1;
      } else {
        issue += 1;
      }
    }
  } catch {
    issue += 1;
  }
  return { ok, issue };
}

function resolveRunReportTime(report: RunReportLike): number | undefined {
  return (
    toEpochMs(report.recordedAt) ??
    toEpochMs(report.run?.completedAt) ??
    toEpochMs(report.run?.updatedAt) ??
    toEpochMs(report.run?.createdAt)
  );
}

function createDailyWindow(date: string): DirectorDailySelfReflectionWindow {
  const startedAt = `${date}T00:00:00.000Z`;
  const endedAt = new Date(Date.parse(startedAt) + 24 * 60 * 60 * 1000).toISOString();
  return { date, startedAt, endedAt };
}

function normalizeDate(value: string | undefined, nowMs: number): string {
  if (value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }
  return new Date(nowMs).toISOString().slice(0, 10);
}

function isInWindow(
  valueMs: number | undefined,
  window: DirectorDailySelfReflectionWindow,
): boolean {
  if (valueMs === undefined) {
    return false;
  }
  return valueMs >= Date.parse(window.startedAt) && valueMs < Date.parse(window.endedAt);
}

function isReflectableStatus(status: string | undefined): boolean {
  return (
    status === "completed" || status === "failed" || status === "aborted" || status === "blocked"
  );
}

function isRunReportLike(value: unknown): value is RunReportLike {
  return isRecord(value) && typeof value.runId === "string" && isRecord(value.run);
}

function isReflectionReport(value: unknown): value is DirectorReflectionReport {
  return (
    isRecord(value) &&
    value.schemaVersion === "director.reflection.report.v1" &&
    typeof value.sourceId === "string"
  );
}

function isEntrySessionLike(value: unknown): value is EntrySessionLike {
  return isRecord(value) && Array.isArray(value.turns);
}

async function listDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonDocument(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readdirSyncSafe(path: string): string[] {
  return existsSync(path) ? readdirSync(path) : [];
}

function readFileSyncSafe(path: string): string {
  return readFileSync(path, "utf8");
}

function toEpochMs(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function formatBullets(values: readonly string[], prefix: string): readonly string[] {
  return values.length === 0 ? [`${prefix}(none)`] : values.map((value) => `${prefix}${value}`);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
