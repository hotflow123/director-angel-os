import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import type {
  ExperienceCandidate,
  ExperiencePromotionRecord,
  ExperienceReviewDecision,
} from "@hotflow/contracts";

import {
  type DirectorKnowledgeCandidateDocument,
  type DirectorKnowledgeReviewDecision,
  type DirectorKnowledgeRollbackRecord,
  isDirectorKnowledgeCandidateDocument,
  isDirectorKnowledgeReviewDecision,
  isDirectorKnowledgeRollbackRecord,
} from "./evolution.js";
import { FileExperienceStore } from "./experience-store.js";
import { type DirectorKnowledgePackDocument, isDirectorKnowledgePackDocument } from "./types.js";

export interface DirectorMaintenancePolicy {
  readonly logRetentionDays?: number;
  readonly logMaxBytes?: number;
  readonly archivePromotedExperienceAfterDays?: number;
  readonly archiveRejectedExperienceAfterDays?: number;
  readonly archiveQuarantineAfterDays?: number;
  readonly archiveUnreferencedArtifactsAfterDays?: number;
  readonly staleUnreviewedExperienceDays?: number;
  readonly staleUnreviewedMinimumScore?: number;
  readonly archiveRejectedKnowledgeAfterDays?: number;
  readonly staleUnreviewedKnowledgeDays?: number;
  readonly archiveOrphanKnowledgeReviewsAfterDays?: number;
  readonly knowledgeHistoryRetentionVersions?: number;
  readonly archiveKnowledgeRollbackAfterDays?: number;
  readonly duplicateExperienceStrategy?: "archive-lower-signal" | "off";
  readonly governanceAcceptedExperienceBacklogLimit?: number;
  readonly governancePendingExperienceBacklogLimit?: number;
  readonly governanceSampleLimit?: number;
}

export interface DirectorMaintenanceInput {
  readonly runtimeRoot?: string;
  readonly experienceDir?: string;
  readonly knowledgeDir?: string;
  readonly nowMs?: number;
  readonly policy?: DirectorMaintenancePolicy;
}

export interface DirectorMaintenanceReport {
  readonly schemaId: "director.maintenance.report.v1";
  readonly generatedAt: string;
  readonly mode: "preview" | "apply";
  readonly policy: Required<DirectorMaintenancePolicy>;
  readonly logMaintenance: DirectorLogMaintenanceReport;
  readonly experienceMaintenance: DirectorExperienceMaintenanceReport;
  readonly knowledgeMaintenance: DirectorKnowledgeMaintenanceReport;
  readonly learningGovernance: DirectorLearningGovernanceReport;
  readonly auditPath: string;
}

export interface DirectorLogMaintenanceReport {
  readonly logsDir: string | null;
  readonly summary: {
    readonly scannedFiles: number;
    readonly archiveFiles: number;
    readonly archiveBytes: number;
  };
  readonly actions: readonly DirectorLogMaintenanceAction[];
}

export interface DirectorLogMaintenanceAction {
  readonly action: "archive";
  readonly reason: "older-than-retention" | "oversized-log";
  readonly status: "preview" | "applied" | "skipped";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly ageDays: number;
}

export interface DirectorExperienceMaintenanceReport {
  readonly experienceDir: string | null;
  readonly summary: {
    readonly activeCandidates: number;
    readonly archiveCandidates: number;
    readonly archiveQuarantines: number;
    readonly archiveArtifacts: number;
    readonly duplicateGroups: number;
  };
  readonly actions: readonly DirectorExperienceMaintenanceAction[];
}

export interface DirectorExperienceMaintenanceAction {
  readonly action: "archive";
  readonly recordKind: "candidate" | "quarantine" | "artifact";
  readonly reason:
    | "already-promoted"
    | "latest-review-rejected"
    | "stale-low-signal"
    | "duplicate-lower-signal"
    | "stale-quarantine"
    | "unreferenced-source-artifact";
  readonly status: "preview" | "applied" | "skipped";
  readonly recordId: string;
  readonly candidateId?: string;
  readonly quarantineId?: string;
  readonly artifactId?: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly createdAtMs: number;
  readonly ageDays: number;
  readonly qualityScore: number | null;
  readonly latestReviewDecision?: "accepted" | "rejected";
  readonly promotedAtMs?: number;
  readonly duplicateKey?: string;
  readonly retainedCandidateId?: string;
}

export interface DirectorKnowledgeMaintenanceReport {
  readonly knowledgeDir: string | null;
  readonly summary: {
    readonly activeCandidates: number;
    readonly archiveCandidates: number;
    readonly archiveReviews: number;
    readonly archiveHistory: number;
    readonly archiveRollback: number;
  };
  readonly actions: readonly DirectorKnowledgeMaintenanceAction[];
}

export interface DirectorKnowledgeMaintenanceAction {
  readonly action: "archive";
  readonly recordKind: "candidate" | "review" | "history" | "rollback";
  readonly reason:
    | "latest-review-rejected"
    | "stale-unreviewed"
    | "orphan-review"
    | "superseded-history"
    | "stale-rollback";
  readonly status: "preview" | "applied" | "skipped";
  readonly recordId: string;
  readonly packId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly createdAtMs: number;
  readonly ageDays: number;
  readonly version?: number;
  readonly candidateVersion?: number;
  readonly latestReviewDecision?: "accepted" | "rejected";
}

export interface DirectorLearningGovernanceReport {
  readonly summary: {
    readonly acceptedExperienceBacklog: number;
    readonly pendingExperienceBacklog: number;
    readonly publishedKnowledgeWithoutRecallEval: number;
    readonly recommendedActions: number;
  };
  readonly actions: readonly DirectorLearningGovernanceAction[];
}

export interface DirectorLearningGovernanceAction {
  readonly action:
    | "promote-or-reject-accepted-experience"
    | "distill-pending-experience"
    | "evaluate-published-knowledge-recall";
  readonly reason:
    | "accepted-experience-backlog"
    | "pending-experience-backlog"
    | "published-knowledge-missing-recall-eval";
  readonly severity: "info" | "warn";
  readonly count: number;
  readonly sampleIds: readonly string[];
  readonly nextAction: string;
}

const DEFAULT_POLICY: Required<DirectorMaintenancePolicy> = {
  logRetentionDays: 14,
  logMaxBytes: 25 * 1024 * 1024,
  archivePromotedExperienceAfterDays: 14,
  archiveRejectedExperienceAfterDays: 14,
  archiveQuarantineAfterDays: 30,
  archiveUnreferencedArtifactsAfterDays: 45,
  staleUnreviewedExperienceDays: 45,
  staleUnreviewedMinimumScore: 55,
  archiveRejectedKnowledgeAfterDays: 14,
  staleUnreviewedKnowledgeDays: 45,
  archiveOrphanKnowledgeReviewsAfterDays: 30,
  knowledgeHistoryRetentionVersions: 20,
  archiveKnowledgeRollbackAfterDays: 90,
  duplicateExperienceStrategy: "archive-lower-signal",
  governanceAcceptedExperienceBacklogLimit: 8,
  governancePendingExperienceBacklogLimit: 20,
  governanceSampleLimit: 5,
};

export async function inspectDirectorMaintenance(
  input: DirectorMaintenanceInput,
): Promise<DirectorMaintenanceReport> {
  return buildDirectorMaintenanceReport(input, "preview");
}

export async function applyDirectorMaintenance(
  input: DirectorMaintenanceInput,
): Promise<DirectorMaintenanceReport> {
  const report = await buildDirectorMaintenanceReport(input, "apply");
  await writeMaintenanceAudit(report);
  return report;
}

async function buildDirectorMaintenanceReport(
  input: DirectorMaintenanceInput,
  mode: "preview" | "apply",
): Promise<DirectorMaintenanceReport> {
  const nowMs = input.nowMs ?? Date.now();
  const policy = {
    ...DEFAULT_POLICY,
    ...(input.policy ?? {}),
  };
  const auditPath = resolveAuditPath(input, nowMs);
  const logMaintenance = await inspectLogMaintenance({
    ...(input.runtimeRoot === undefined ? {} : { runtimeRoot: input.runtimeRoot }),
    nowMs,
    policy,
    mode,
  });
  const experienceMaintenance = await inspectExperienceMaintenance({
    ...(input.experienceDir === undefined ? {} : { experienceDir: input.experienceDir }),
    nowMs,
    policy,
    mode,
  });
  const knowledgeMaintenance = await inspectKnowledgeMaintenance({
    ...(input.knowledgeDir === undefined ? {} : { knowledgeDir: input.knowledgeDir }),
    nowMs,
    policy,
    mode,
  });
  const learningGovernance = await inspectLearningGovernance({
    ...(input.experienceDir === undefined ? {} : { experienceDir: input.experienceDir }),
    ...(input.knowledgeDir === undefined ? {} : { knowledgeDir: input.knowledgeDir }),
    policy,
  });

  return {
    schemaId: "director.maintenance.report.v1",
    generatedAt: new Date(nowMs).toISOString(),
    mode,
    policy,
    logMaintenance,
    experienceMaintenance,
    knowledgeMaintenance,
    learningGovernance,
    auditPath,
  };
}

async function inspectLogMaintenance(input: {
  readonly runtimeRoot?: string;
  readonly nowMs: number;
  readonly policy: Required<DirectorMaintenancePolicy>;
  readonly mode: "preview" | "apply";
}): Promise<DirectorLogMaintenanceReport> {
  if (input.runtimeRoot === undefined) {
    return {
      logsDir: null,
      summary: { scannedFiles: 0, archiveFiles: 0, archiveBytes: 0 },
      actions: [],
    };
  }

  const logsDir = join(input.runtimeRoot, "logs");
  const files = await listRegularFiles(logsDir);
  const actions: DirectorLogMaintenanceAction[] = [];
  for (const file of files) {
    if (!isRuntimeLogFile(file.path)) {
      continue;
    }
    const ageDays = ageInDays(input.nowMs, file.mtimeMs);
    const targetPath = join(
      input.runtimeRoot,
      "archive",
      "logs",
      datePartition(input.nowMs),
      safeArchiveName(relative(logsDir, file.path)),
    );
    const oversized = file.bytes > input.policy.logMaxBytes;
    const expired = ageDays >= input.policy.logRetentionDays;
    if (!expired && !oversized) {
      continue;
    }
    actions.push({
      action: "archive",
      reason: expired ? "older-than-retention" : "oversized-log",
      status: input.mode === "apply" ? await archiveFile(file.path, targetPath) : "preview",
      sourcePath: file.path,
      targetPath,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
      ageDays,
    });
  }

  return {
    logsDir,
    summary: {
      scannedFiles: files.length,
      archiveFiles: actions.length,
      archiveBytes: actions.reduce((sum, action) => sum + action.bytes, 0),
    },
    actions,
  };
}

async function inspectExperienceMaintenance(input: {
  readonly experienceDir?: string;
  readonly nowMs: number;
  readonly policy: Required<DirectorMaintenancePolicy>;
  readonly mode: "preview" | "apply";
}): Promise<DirectorExperienceMaintenanceReport> {
  if (input.experienceDir === undefined) {
    return {
      experienceDir: null,
      summary: {
        activeCandidates: 0,
        archiveCandidates: 0,
        archiveQuarantines: 0,
        archiveArtifacts: 0,
        duplicateGroups: 0,
      },
      actions: [],
    };
  }

  const store = new FileExperienceStore({ experienceDir: input.experienceDir });
  const experienceDir = input.experienceDir;
  const [candidates, reviews, promotions, quarantines, artifacts] = await Promise.all([
    store.listCandidates(),
    store.listReviewDecisions(),
    store.listPromotions(),
    store.listQuarantineRecords(),
    store.listSourceArtifacts(),
  ]);
  const actionByCandidate = new Map<string, DirectorExperienceMaintenanceAction>();

  for (const candidate of candidates) {
    const latestReview = selectLatestReview(reviews, candidate.candidateId);
    const latestPromotion = selectLatestPromotion(promotions, candidate.candidateId);
    const candidateAgeDays = ageInDays(input.nowMs, candidate.createdAtMs);
    const base = buildExperienceActionBase(experienceDir, input.nowMs, candidate);
    if (
      latestPromotion !== null &&
      ageInDays(input.nowMs, latestPromotion.promotedAtMs) >=
        input.policy.archivePromotedExperienceAfterDays
    ) {
      actionByCandidate.set(candidate.candidateId, {
        ...base,
        reason: "already-promoted",
        promotedAtMs: latestPromotion.promotedAtMs,
      });
      continue;
    }
    if (
      latestReview?.decision === "rejected" &&
      ageInDays(input.nowMs, latestReview.decidedAtMs) >=
        input.policy.archiveRejectedExperienceAfterDays
    ) {
      actionByCandidate.set(candidate.candidateId, {
        ...base,
        reason: "latest-review-rejected",
        latestReviewDecision: "rejected",
      });
      continue;
    }
    if (
      latestReview === null &&
      latestPromotion === null &&
      candidateAgeDays >= input.policy.staleUnreviewedExperienceDays &&
      resolveQualityScore(candidate) < input.policy.staleUnreviewedMinimumScore
    ) {
      actionByCandidate.set(candidate.candidateId, {
        ...base,
        reason: "stale-low-signal",
      });
    }
  }

  const duplicateGroups =
    input.policy.duplicateExperienceStrategy === "off"
      ? []
      : groupDuplicateCandidates(
          candidates.filter((candidate) => !actionByCandidate.has(candidate.candidateId)),
        );
  for (const group of duplicateGroups) {
    const retained = group.candidates[0];
    if (retained === undefined) {
      continue;
    }
    for (const duplicate of group.candidates.slice(1)) {
      actionByCandidate.set(duplicate.candidateId, {
        ...buildExperienceActionBase(experienceDir, input.nowMs, duplicate),
        reason: "duplicate-lower-signal",
        duplicateKey: group.key,
        retainedCandidateId: retained.candidateId,
      });
    }
  }

  const referencedArtifactIds = new Set(
    candidates
      .filter((candidate) => !actionByCandidate.has(candidate.candidateId))
      .map((candidate) => candidate.sourceArtifactId)
      .filter((artifactId): artifactId is string => artifactId !== undefined),
  );
  const quarantineActions = quarantines
    .filter(
      (record) =>
        ageInDays(input.nowMs, record.createdAtMs) >= input.policy.archiveQuarantineAfterDays,
    )
    .map(
      (record): DirectorExperienceMaintenanceAction => ({
        action: "archive",
        recordKind: "quarantine",
        reason: "stale-quarantine",
        status: "preview",
        recordId: record.quarantineId,
        quarantineId: record.quarantineId,
        sourcePath: join(experienceDir, "quarantine", `${safeFileToken(record.quarantineId)}.json`),
        targetPath: join(
          dirname(experienceDir),
          "maintenance",
          "archive",
          "experience",
          "quarantine",
          datePartition(input.nowMs),
          `${safeFileToken(record.quarantineId)}.json`,
        ),
        createdAtMs: record.createdAtMs,
        ageDays: ageInDays(input.nowMs, record.createdAtMs),
        qualityScore: record.artifact.quality.score,
      }),
    );
  const artifactActions = artifacts
    .filter(
      (artifact) =>
        !referencedArtifactIds.has(artifact.artifactId) &&
        ageInDays(input.nowMs, artifact.capturedAtMs) >=
          input.policy.archiveUnreferencedArtifactsAfterDays,
    )
    .map(
      (artifact): DirectorExperienceMaintenanceAction => ({
        action: "archive",
        recordKind: "artifact",
        reason: "unreferenced-source-artifact",
        status: "preview",
        recordId: artifact.artifactId,
        artifactId: artifact.artifactId,
        sourcePath: join(experienceDir, "artifact", `${safeFileToken(artifact.artifactId)}.json`),
        targetPath: join(
          dirname(experienceDir),
          "maintenance",
          "archive",
          "experience",
          "artifact",
          datePartition(input.nowMs),
          `${safeFileToken(artifact.artifactId)}.json`,
        ),
        createdAtMs: artifact.capturedAtMs,
        ageDays: ageInDays(input.nowMs, artifact.capturedAtMs),
        qualityScore: artifact.quality.score,
      }),
    );

  const actions = [...actionByCandidate.values(), ...quarantineActions, ...artifactActions].sort(
    compareExperienceActions,
  );
  const appliedActions =
    input.mode === "apply"
      ? await Promise.all(
          actions.map(async (action) => ({
            ...action,
            status: await archiveFile(action.sourcePath, action.targetPath),
          })),
        )
      : actions;

  return {
    experienceDir,
    summary: {
      activeCandidates: candidates.length,
      archiveCandidates: appliedActions.filter((action) => action.recordKind === "candidate")
        .length,
      archiveQuarantines: appliedActions.filter((action) => action.recordKind === "quarantine")
        .length,
      archiveArtifacts: appliedActions.filter((action) => action.recordKind === "artifact").length,
      duplicateGroups: duplicateGroups.length,
    },
    actions: appliedActions,
  };
}

function buildExperienceActionBase(
  experienceDir: string,
  nowMs: number,
  candidate: ExperienceCandidate,
): Omit<DirectorExperienceMaintenanceAction, "reason"> {
  const sourcePath = join(
    experienceDir,
    "candidate",
    `${safeFileToken(candidate.candidateId)}.json`,
  );
  return {
    action: "archive",
    recordKind: "candidate",
    status: "preview",
    recordId: candidate.candidateId,
    candidateId: candidate.candidateId,
    sourcePath,
    targetPath: join(
      dirname(experienceDir),
      "maintenance",
      "archive",
      "experience",
      "candidate",
      datePartition(nowMs),
      `${safeFileToken(candidate.candidateId)}.json`,
    ),
    createdAtMs: candidate.createdAtMs,
    ageDays: ageInDays(nowMs, candidate.createdAtMs),
    qualityScore: candidate.quality?.score ?? null,
  };
}

async function inspectKnowledgeMaintenance(input: {
  readonly knowledgeDir?: string;
  readonly nowMs: number;
  readonly policy: Required<DirectorMaintenancePolicy>;
  readonly mode: "preview" | "apply";
}): Promise<DirectorKnowledgeMaintenanceReport> {
  if (input.knowledgeDir === undefined) {
    return {
      knowledgeDir: null,
      summary: {
        activeCandidates: 0,
        archiveCandidates: 0,
        archiveReviews: 0,
        archiveHistory: 0,
        archiveRollback: 0,
      },
      actions: [],
    };
  }

  const knowledgeDir = input.knowledgeDir;
  const [candidates, reviews, published, history, rollback] = await Promise.all([
    readKnowledgeDocuments(join(knowledgeDir, "candidate"), isDirectorKnowledgeCandidateDocument),
    readKnowledgeDocuments(join(knowledgeDir, "review"), isDirectorKnowledgeReviewDecision),
    readKnowledgeDocuments(join(knowledgeDir, "published"), isDirectorKnowledgePackDocument),
    readKnowledgeDocuments(join(knowledgeDir, "history"), isDirectorKnowledgePackDocument),
    readKnowledgeDocuments(join(knowledgeDir, "rollback"), isDirectorKnowledgeRollbackRecord),
  ]);
  const candidateByPackId = new Map(candidates.map((entry) => [entry.document.metadata.id, entry]));
  const latestReviewByPackId = new Map<
    string,
    KnowledgeDocumentEntry<DirectorKnowledgeReviewDecision>
  >();
  for (const review of reviews) {
    const current = latestReviewByPackId.get(review.document.packId);
    if (
      current === undefined ||
      toEpochMs(review.document.decidedAt) > toEpochMs(current.document.decidedAt)
    ) {
      latestReviewByPackId.set(review.document.packId, review);
    }
  }

  const actions: DirectorKnowledgeMaintenanceAction[] = [];
  for (const candidate of candidates) {
    const latestReview = latestReviewByPackId.get(candidate.document.metadata.id);
    const candidateAgeDays = ageInDays(
      input.nowMs,
      toEpochMs(candidate.document.audit.candidateAt),
    );
    if (
      latestReview?.document.decision === "rejected" &&
      ageInDays(input.nowMs, toEpochMs(latestReview.document.decidedAt)) >=
        input.policy.archiveRejectedKnowledgeAfterDays
    ) {
      actions.push(
        buildKnowledgeAction({
          knowledgeDir,
          nowMs: input.nowMs,
          entry: candidate,
          recordKind: "candidate",
          reason: "latest-review-rejected",
          createdAtMs: toEpochMs(candidate.document.audit.candidateAt),
          latestReviewDecision: "rejected",
          candidateVersion: candidate.document.metadata.version,
        }),
      );
      continue;
    }
    if (
      latestReview === undefined &&
      candidateAgeDays >= input.policy.staleUnreviewedKnowledgeDays
    ) {
      actions.push(
        buildKnowledgeAction({
          knowledgeDir,
          nowMs: input.nowMs,
          entry: candidate,
          recordKind: "candidate",
          reason: "stale-unreviewed",
          createdAtMs: toEpochMs(candidate.document.audit.candidateAt),
          candidateVersion: candidate.document.metadata.version,
        }),
      );
    }
  }

  const archivedCandidatePackIds = new Set(
    actions.filter((action) => action.recordKind === "candidate").map((action) => action.packId),
  );
  for (const review of reviews) {
    const candidate = candidateByPackId.get(review.document.packId);
    if (candidate !== undefined && !archivedCandidatePackIds.has(review.document.packId)) {
      continue;
    }
    if (
      ageInDays(input.nowMs, toEpochMs(review.document.decidedAt)) <
      input.policy.archiveOrphanKnowledgeReviewsAfterDays
    ) {
      continue;
    }
    actions.push(
      buildKnowledgeAction({
        knowledgeDir,
        nowMs: input.nowMs,
        entry: review,
        recordKind: "review",
        reason: "orphan-review",
        createdAtMs: toEpochMs(review.document.decidedAt),
        candidateVersion: review.document.candidateVersion,
        latestReviewDecision: review.document.decision,
      }),
    );
  }

  const historyByPackId = groupKnowledgeHistory(history);
  for (const entries of historyByPackId.values()) {
    const retained = entries.slice(0, input.policy.knowledgeHistoryRetentionVersions);
    const retainedPaths = new Set(retained.map((entry) => entry.path));
    for (const entry of entries) {
      if (retainedPaths.has(entry.path)) {
        continue;
      }
      actions.push(
        buildKnowledgeAction({
          knowledgeDir,
          nowMs: input.nowMs,
          entry,
          recordKind: "history",
          reason: "superseded-history",
          createdAtMs: toEpochMs(entry.document.audit.publishedAt),
          version: entry.document.metadata.version,
        }),
      );
    }
  }

  for (const entry of rollback) {
    const createdAtMs = toEpochMs(entry.document.rolledBackAt);
    if (ageInDays(input.nowMs, createdAtMs) < input.policy.archiveKnowledgeRollbackAfterDays) {
      continue;
    }
    actions.push(
      buildKnowledgeAction({
        knowledgeDir,
        nowMs: input.nowMs,
        entry,
        recordKind: "rollback",
        reason: "stale-rollback",
        createdAtMs,
        version: entry.document.currentVersionAfter,
      }),
    );
  }

  const sortedActions = actions.sort(compareKnowledgeActions);
  const appliedActions =
    input.mode === "apply"
      ? await Promise.all(
          sortedActions.map(async (action) => ({
            ...action,
            status: await archiveFile(action.sourcePath, action.targetPath),
          })),
        )
      : sortedActions;

  return {
    knowledgeDir,
    summary: {
      activeCandidates: candidates.length,
      archiveCandidates: appliedActions.filter((action) => action.recordKind === "candidate")
        .length,
      archiveReviews: appliedActions.filter((action) => action.recordKind === "review").length,
      archiveHistory: appliedActions.filter((action) => action.recordKind === "history").length,
      archiveRollback: appliedActions.filter((action) => action.recordKind === "rollback").length,
    },
    actions: appliedActions,
  };
}

async function inspectLearningGovernance(input: {
  readonly experienceDir?: string;
  readonly knowledgeDir?: string;
  readonly policy: Required<DirectorMaintenancePolicy>;
}): Promise<DirectorLearningGovernanceReport> {
  const [acceptedExperienceBacklog, pendingExperienceBacklog, publishedWithoutRecallEval] =
    await Promise.all([
      inspectAcceptedExperienceBacklog(input.experienceDir),
      inspectPendingExperienceBacklog(input.experienceDir),
      inspectPublishedKnowledgeWithoutRecallEval(input.knowledgeDir),
    ]);
  const sampleLimit = input.policy.governanceSampleLimit;
  const actions: DirectorLearningGovernanceAction[] = [];

  if (acceptedExperienceBacklog.length > input.policy.governanceAcceptedExperienceBacklogLimit) {
    actions.push({
      action: "promote-or-reject-accepted-experience",
      reason: "accepted-experience-backlog",
      severity: "warn",
      count: acceptedExperienceBacklog.length,
      sampleIds: acceptedExperienceBacklog.slice(0, sampleLimit),
      nextAction:
        "Review accepted experience candidates and either promote them into knowledge/skills or reject stale entries before more learning is admitted.",
    });
  }

  if (pendingExperienceBacklog.length > input.policy.governancePendingExperienceBacklogLimit) {
    actions.push({
      action: "distill-pending-experience",
      reason: "pending-experience-backlog",
      severity: "info",
      count: pendingExperienceBacklog.length,
      sampleIds: pendingExperienceBacklog.slice(0, sampleLimit),
      nextAction:
        "Run deterministic/model distillation and human review on pending experience candidates before accepting more daily learning.",
    });
  }

  if (publishedWithoutRecallEval.length > 0) {
    actions.push({
      action: "evaluate-published-knowledge-recall",
      reason: "published-knowledge-missing-recall-eval",
      severity: "warn",
      count: publishedWithoutRecallEval.length,
      sampleIds: publishedWithoutRecallEval.slice(0, sampleLimit),
      nextAction:
        "Create or run recall evaluation cases for published knowledge packs so future production tasks can prove they are actually retrievable.",
    });
  }

  return {
    summary: {
      acceptedExperienceBacklog: acceptedExperienceBacklog.length,
      pendingExperienceBacklog: pendingExperienceBacklog.length,
      publishedKnowledgeWithoutRecallEval: publishedWithoutRecallEval.length,
      recommendedActions: actions.length,
    },
    actions,
  };
}

async function inspectAcceptedExperienceBacklog(
  experienceDir: string | undefined,
): Promise<readonly string[]> {
  if (experienceDir === undefined) {
    return [];
  }

  const store = new FileExperienceStore({ experienceDir });
  const [candidates, reviews, promotions] = await Promise.all([
    store.listCandidates(),
    store.listReviewDecisions(),
    store.listPromotions(),
  ]);
  const promotedCandidateIds = new Set(promotions.map((promotion) => promotion.candidateId));

  return candidates
    .filter((candidate) => !promotedCandidateIds.has(candidate.candidateId))
    .filter(
      (candidate) => selectLatestReview(reviews, candidate.candidateId)?.decision === "accepted",
    )
    .sort(compareCandidateIds)
    .map((candidate) => candidate.candidateId);
}

async function inspectPendingExperienceBacklog(
  experienceDir: string | undefined,
): Promise<readonly string[]> {
  if (experienceDir === undefined) {
    return [];
  }

  const store = new FileExperienceStore({ experienceDir });
  const [candidates, reviews, promotions] = await Promise.all([
    store.listCandidates(),
    store.listReviewDecisions(),
    store.listPromotions(),
  ]);
  const promotedCandidateIds = new Set(promotions.map((promotion) => promotion.candidateId));

  return candidates
    .filter((candidate) => !promotedCandidateIds.has(candidate.candidateId))
    .filter((candidate) => selectLatestReview(reviews, candidate.candidateId) === null)
    .sort(compareCandidateIds)
    .map((candidate) => candidate.candidateId);
}

async function inspectPublishedKnowledgeWithoutRecallEval(
  knowledgeDir: string | undefined,
): Promise<readonly string[]> {
  if (knowledgeDir === undefined) {
    return [];
  }

  const published = await readKnowledgeDocuments(
    join(knowledgeDir, "published"),
    isDirectorKnowledgePackDocument,
  );
  const evaluatedPackIds = await readEvaluatedKnowledgePackIds(knowledgeDir);

  return published
    .map((entry) => entry.document.metadata.id)
    .filter((packId) => !evaluatedPackIds.has(packId))
    .sort((left, right) => left.localeCompare(right));
}

async function readEvaluatedKnowledgePackIds(knowledgeDir: string): Promise<ReadonlySet<string>> {
  const files = await listRegularFiles(join(knowledgeDir, "recall-eval"));
  const ids = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith(".json")) {
      continue;
    }
    try {
      collectRecallEvalIds(JSON.parse(await readFile(file.path, "utf8")) as unknown, ids);
    } catch {
      // Ignore malformed recall eval files; governance should report missing proof, not fail.
    }
  }
  return ids;
}

function collectRecallEvalIds(value: unknown, ids: Set<string>): void {
  if (typeof value === "string") {
    collectPotentialKnowledgeId(value, ids);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRecallEvalIds(item, ids);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  for (const entry of Object.values(value)) {
    collectRecallEvalIds(entry, ids);
  }
}

function collectPotentialKnowledgeId(value: string, ids: Set<string>): void {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return;
  }
  if (normalized.startsWith("knowledge:")) {
    ids.add(normalized.slice("knowledge:".length));
    return;
  }
  if (normalized.startsWith("director-method-")) {
    ids.add(normalized);
  }
}

function compareCandidateIds(left: ExperienceCandidate, right: ExperienceCandidate): number {
  return left.candidateId.localeCompare(right.candidateId);
}

interface KnowledgeDocumentEntry<T> {
  readonly document: T;
  readonly path: string;
  readonly file: string;
}

async function readKnowledgeDocuments<T>(
  directory: string,
  guard: (value: unknown) => value is T,
): Promise<KnowledgeDocumentEntry<T>[]> {
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const documents: KnowledgeDocumentEntry<T>[] = [];
  for (const file of files.sort((left, right) => left.localeCompare(right))) {
    const path = join(directory, file);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (guard(parsed)) {
        documents.push({ document: parsed, path, file });
      }
    } catch {
      // ignore malformed knowledge files; maintenance should not make them worse.
    }
  }
  return documents;
}

function buildKnowledgeAction(input: {
  readonly knowledgeDir: string;
  readonly nowMs: number;
  readonly entry: KnowledgeDocumentEntry<
    | DirectorKnowledgeCandidateDocument
    | DirectorKnowledgeReviewDecision
    | DirectorKnowledgePackDocument
    | DirectorKnowledgeRollbackRecord
  >;
  readonly recordKind: DirectorKnowledgeMaintenanceAction["recordKind"];
  readonly reason: DirectorKnowledgeMaintenanceAction["reason"];
  readonly createdAtMs: number;
  readonly version?: number;
  readonly candidateVersion?: number;
  readonly latestReviewDecision?: "accepted" | "rejected";
}): DirectorKnowledgeMaintenanceAction {
  const packId = readKnowledgePackId(input.entry.document);
  return {
    action: "archive",
    recordKind: input.recordKind,
    reason: input.reason,
    status: "preview",
    recordId:
      input.version === undefined ? packId : `${packId}.v${String(input.version).padStart(4, "0")}`,
    packId,
    sourcePath: input.entry.path,
    targetPath: join(
      input.knowledgeDir,
      "maintenance",
      "archive",
      "knowledge",
      input.recordKind,
      datePartition(input.nowMs),
      safeArchiveName(input.entry.file),
    ),
    createdAtMs: input.createdAtMs,
    ageDays: ageInDays(input.nowMs, input.createdAtMs),
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.candidateVersion === undefined ? {} : { candidateVersion: input.candidateVersion }),
    ...(input.latestReviewDecision === undefined
      ? {}
      : { latestReviewDecision: input.latestReviewDecision }),
  };
}

function readKnowledgePackId(
  document:
    | DirectorKnowledgeCandidateDocument
    | DirectorKnowledgeReviewDecision
    | DirectorKnowledgePackDocument
    | DirectorKnowledgeRollbackRecord,
): string {
  if ("packId" in document) {
    return document.packId;
  }
  return document.metadata.id;
}

function groupKnowledgeHistory(
  history: readonly KnowledgeDocumentEntry<DirectorKnowledgePackDocument>[],
): Map<string, readonly KnowledgeDocumentEntry<DirectorKnowledgePackDocument>[]> {
  const groups = new Map<string, KnowledgeDocumentEntry<DirectorKnowledgePackDocument>[]>();
  for (const entry of history) {
    const key = entry.document.metadata.id;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return new Map(
    [...groups.entries()].map(([key, entries]) => [
      key,
      entries.sort(
        (left, right) =>
          right.document.metadata.version - left.document.metadata.version ||
          right.file.localeCompare(left.file),
      ),
    ]),
  );
}

async function writeMaintenanceAudit(report: DirectorMaintenanceReport): Promise<void> {
  await mkdir(dirname(report.auditPath), { recursive: true });
  await writeFile(report.auditPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function resolveAuditPath(input: DirectorMaintenanceInput, nowMs: number): string {
  const base =
    input.knowledgeDir === undefined
      ? input.experienceDir === undefined
        ? input.runtimeRoot === undefined
          ? process.cwd()
          : dirname(input.runtimeRoot)
        : dirname(input.experienceDir)
      : input.knowledgeDir;
  return join(base, "maintenance", "audits", `maintenance-${nowMs}.json`);
}

async function listRegularFiles(root: string): Promise<
  Array<{
    readonly path: string;
    readonly bytes: number;
    readonly mtimeMs: number;
  }>
> {
  let entries: readonly import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: Array<{ path: string; bytes: number; mtimeMs: number }> = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRegularFiles(path)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const details = await stat(path);
    files.push({
      path,
      bytes: details.size,
      mtimeMs: details.mtimeMs,
    });
  }
  return files;
}

async function archiveFile(sourcePath: string, targetPath: string): Promise<"applied" | "skipped"> {
  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await rename(sourcePath, targetPath);
    return "applied";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "skipped";
    }
    throw error;
  }
}

function groupDuplicateCandidates(candidates: readonly ExperienceCandidate[]): Array<{
  readonly key: string;
  readonly candidates: readonly ExperienceCandidate[];
}> {
  const groups = new Map<string, ExperienceCandidate[]>();
  for (const candidate of candidates) {
    const key = resolveDuplicateKey(candidate);
    if (key === null) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      candidates: group.sort(compareDuplicateSignal),
    }));
}

function resolveDuplicateKey(candidate: ExperienceCandidate): string | null {
  const key =
    candidate.sourceDigest ??
    candidate.sourceArtifactId ??
    `${candidate.sourceAdapter.adapterId}:${candidate.sourceAdapter.sourceRef}:${candidate.title}`;
  const normalized = key.trim();
  return normalized.length === 0 ? null : normalized;
}

function compareDuplicateSignal(left: ExperienceCandidate, right: ExperienceCandidate): number {
  return (
    resolveQualityScore(right) - resolveQualityScore(left) ||
    right.createdAtMs - left.createdAtMs ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function compareExperienceActions(
  left: DirectorExperienceMaintenanceAction,
  right: DirectorExperienceMaintenanceAction,
): number {
  return (
    reasonRank(left.reason) - reasonRank(right.reason) ||
    left.createdAtMs - right.createdAtMs ||
    left.recordId.localeCompare(right.recordId)
  );
}

function compareKnowledgeActions(
  left: DirectorKnowledgeMaintenanceAction,
  right: DirectorKnowledgeMaintenanceAction,
): number {
  return (
    knowledgeReasonRank(left.reason) - knowledgeReasonRank(right.reason) ||
    left.createdAtMs - right.createdAtMs ||
    left.recordId.localeCompare(right.recordId)
  );
}

function knowledgeReasonRank(reason: DirectorKnowledgeMaintenanceAction["reason"]): number {
  switch (reason) {
    case "latest-review-rejected":
      return 0;
    case "stale-unreviewed":
      return 1;
    case "orphan-review":
      return 2;
    case "superseded-history":
      return 3;
    case "stale-rollback":
      return 4;
  }
}

function reasonRank(reason: DirectorExperienceMaintenanceAction["reason"]): number {
  switch (reason) {
    case "already-promoted":
      return 0;
    case "latest-review-rejected":
      return 1;
    case "stale-low-signal":
      return 2;
    case "duplicate-lower-signal":
      return 3;
    case "stale-quarantine":
      return 4;
    case "unreferenced-source-artifact":
      return 5;
  }
}

function selectLatestReview(
  reviews: readonly ExperienceReviewDecision[],
  candidateId: string,
): ExperienceReviewDecision | null {
  return (
    reviews
      .filter((review) => review.candidateId === candidateId)
      .sort((left, right) => right.decidedAtMs - left.decidedAtMs)[0] ?? null
  );
}

function selectLatestPromotion(
  promotions: readonly ExperiencePromotionRecord[],
  candidateId: string,
): ExperiencePromotionRecord | null {
  return (
    promotions
      .filter((promotion) => promotion.candidateId === candidateId)
      .sort((left, right) => right.promotedAtMs - left.promotedAtMs)[0] ?? null
  );
}

function resolveQualityScore(candidate: ExperienceCandidate): number {
  return candidate.quality?.score ?? 50;
}

function ageInDays(nowMs: number, thenMs: number): number {
  return Math.max(0, Math.floor((nowMs - thenMs) / 86_400_000));
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function datePartition(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function isRuntimeLogFile(path: string): boolean {
  return /\.(?:log|jsonl|ndjson)$/iu.test(path);
}

function safeArchiveName(value: string): string {
  return value.replace(/[/\\:]/gu, "__");
}

function safeFileToken(value: string): string {
  return encodeURIComponent(value).replace(/%/gu, "_");
}
