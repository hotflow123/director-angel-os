import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  ExperienceCandidate,
  ExperiencePromotionRecord,
  ExperienceQuarantineRecord,
  ExperienceReviewDecision,
  ExperienceRollbackRecord,
  ExperienceSourceArtifact,
} from "@hotflow/contracts";

export interface ExperienceStoreOptions {
  readonly experienceDir: string;
}

export interface ExperienceStoreWriteResult {
  readonly status: "ok" | "degraded";
  readonly notes: readonly string[];
}

export type ExperienceCandidateEvaluationStatus = "effective" | "ineffective" | "mixed" | "unknown";

export interface ExperienceCandidateEvaluationRecord {
  readonly schemaVersion: "director.experience.evaluation.v1";
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly runId?: string;
  readonly status: ExperienceCandidateEvaluationStatus;
  readonly score: number;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly evaluatedAtMs: number;
  readonly evaluatorId?: string;
}

export interface CreateExperienceCandidateEvaluationRecordInput {
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly runId?: string;
  readonly status: ExperienceCandidateEvaluationStatus;
  readonly score: number;
  readonly summary: string;
  readonly evidenceRefs?: readonly string[];
  readonly evaluatedAtMs: number;
  readonly evaluatorId?: string;
}

const STATE_DIRS = {
  artifact: "artifact",
  candidate: "candidate",
  quarantine: "quarantine",
  review: "review",
  promotion: "promotion",
  rollback: "rollback",
  evaluation: "evaluation",
} as const;

export class FileExperienceStore {
  public constructor(private readonly options: ExperienceStoreOptions) {}

  public async writeSourceArtifact(
    artifact: ExperienceSourceArtifact,
  ): Promise<ExperienceStoreWriteResult> {
    await this.writeJson(this.artifactPath(artifact.artifactId), artifact);
    return {
      status: "ok",
      notes: [`Stored experience source artifact ${artifact.artifactId}.`],
    };
  }

  public async listSourceArtifacts(): Promise<readonly ExperienceSourceArtifact[]> {
    return this.readStateDirectory(
      STATE_DIRS.artifact,
      isExperienceSourceArtifact,
      compareSourceArtifact,
    );
  }

  public async writeCandidate(candidate: ExperienceCandidate): Promise<ExperienceStoreWriteResult> {
    await this.writeJson(this.candidatePath(candidate.candidateId), candidate);
    return {
      status: "ok",
      notes: [`Stored experience candidate ${candidate.candidateId}.`],
    };
  }

  public async getCandidate(candidateId: string): Promise<ExperienceCandidate | null> {
    return this.readJson(this.candidatePath(candidateId), isExperienceCandidate);
  }

  public async listCandidates(): Promise<readonly ExperienceCandidate[]> {
    return this.readStateDirectory(STATE_DIRS.candidate, isExperienceCandidate, (left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    );
  }

  public async writeQuarantineRecord(
    record: ExperienceQuarantineRecord,
  ): Promise<ExperienceStoreWriteResult> {
    await this.writeJson(this.quarantinePath(record.quarantineId), record);
    return {
      status: "ok",
      notes: [`Stored quarantined experience source ${record.quarantineId}.`],
    };
  }

  public async writeQuarantine(
    record: ExperienceQuarantineRecord,
  ): Promise<ExperienceStoreWriteResult> {
    return this.writeQuarantineRecord(record);
  }

  public async getQuarantine(quarantineId: string): Promise<ExperienceQuarantineRecord | null> {
    return this.readJson(this.quarantinePath(quarantineId), isExperienceQuarantineRecord);
  }

  public async listQuarantineRecords(): Promise<readonly ExperienceQuarantineRecord[]> {
    return this.readStateDirectory(
      STATE_DIRS.quarantine,
      isExperienceQuarantineRecord,
      compareQuarantineRecord,
    );
  }

  public async listQuarantines(): Promise<readonly ExperienceQuarantineRecord[]> {
    return this.listQuarantineRecords();
  }

  public async writeReviewDecision(
    decision: ExperienceReviewDecision,
  ): Promise<ExperienceStoreWriteResult> {
    await this.writeJson(this.reviewPath(decision.candidateId, decision.decisionId), decision);
    return {
      status: "ok",
      notes: [
        `Stored ${decision.decision} experience review ${decision.decisionId} for ${decision.candidateId}.`,
      ],
    };
  }

  public async listReviewDecisions(
    candidateId?: string,
  ): Promise<readonly ExperienceReviewDecision[]> {
    const decisions = await this.readStateDirectory(
      STATE_DIRS.review,
      isExperienceReviewDecision,
      compareReviewDecision,
    );
    return candidateId === undefined
      ? decisions
      : decisions.filter((decision) => decision.candidateId === candidateId);
  }

  public async writePromotion(
    promotion: ExperiencePromotionRecord,
  ): Promise<ExperienceStoreWriteResult> {
    const candidate = await this.getCandidate(promotion.candidateId);
    if (candidate === null) {
      return {
        status: "degraded",
        notes: [`Experience promotion blocked: candidate ${promotion.candidateId} was not found.`],
      };
    }
    if (candidate.quality?.verdict === "quarantine") {
      return {
        status: "degraded",
        notes: [
          `Experience promotion blocked: candidate ${promotion.candidateId} failed source admission and must stay quarantined.`,
        ],
      };
    }

    const latestReview = selectLatestReviewDecision(
      await this.listReviewDecisions(promotion.candidateId),
    );
    if (latestReview?.decision !== "accepted") {
      return {
        status: "degraded",
        notes: [
          `Experience promotion blocked: candidate ${promotion.candidateId} requires the latest review to be accepted.`,
        ],
      };
    }

    await this.writeJson(
      this.promotionPath(promotion.candidateId, promotion.promotionId),
      promotion,
    );
    return {
      status: "ok",
      notes: [`Stored experience promotion ${promotion.promotionId}.`],
    };
  }

  public async listPromotions(candidateId?: string): Promise<readonly ExperiencePromotionRecord[]> {
    const promotions = await this.readStateDirectory(
      STATE_DIRS.promotion,
      isExperiencePromotionRecord,
      comparePromotionRecord,
    );
    return candidateId === undefined
      ? promotions
      : promotions.filter((promotion) => promotion.candidateId === candidateId);
  }

  public async writeRollback(
    rollback: ExperienceRollbackRecord,
  ): Promise<ExperienceStoreWriteResult> {
    const promotion = (await this.listPromotions(rollback.candidateId)).find(
      (entry) => entry.promotionId === rollback.promotionId,
    );
    if (promotion === undefined) {
      return {
        status: "degraded",
        notes: [
          `Experience rollback blocked: promotion ${rollback.promotionId} was not found for ${rollback.candidateId}.`,
        ],
      };
    }

    await this.writeJson(this.rollbackPath(rollback.candidateId, rollback.rollbackId), rollback);
    return {
      status: "ok",
      notes: [`Stored experience rollback ${rollback.rollbackId}.`],
    };
  }

  public async listRollbacks(candidateId?: string): Promise<readonly ExperienceRollbackRecord[]> {
    const rollbacks = await this.readStateDirectory(
      STATE_DIRS.rollback,
      isExperienceRollbackRecord,
      compareRollbackRecord,
    );
    return candidateId === undefined
      ? rollbacks
      : rollbacks.filter((rollback) => rollback.candidateId === candidateId);
  }

  public async writeEvaluation(
    input: CreateExperienceCandidateEvaluationRecordInput,
  ): Promise<ExperienceStoreWriteResult> {
    const candidate = await this.getCandidate(input.candidateId);
    if (candidate === null) {
      return {
        status: "degraded",
        notes: [`Experience evaluation blocked: candidate ${input.candidateId} was not found.`],
      };
    }
    const evaluation = createExperienceCandidateEvaluationRecord(input);
    await this.writeJson(
      this.evaluationPath(evaluation.candidateId, evaluation.evaluationId),
      evaluation,
    );
    return {
      status: "ok",
      notes: [`Stored experience evaluation ${evaluation.evaluationId}.`],
    };
  }

  public async listEvaluations(
    candidateId?: string,
  ): Promise<readonly ExperienceCandidateEvaluationRecord[]> {
    const evaluations = await this.readStateDirectory(
      STATE_DIRS.evaluation,
      isExperienceCandidateEvaluationRecord,
      compareEvaluationRecord,
    );
    return candidateId === undefined
      ? evaluations
      : evaluations.filter((evaluation) => evaluation.candidateId === candidateId);
  }

  private candidatePath(candidateId: string): string {
    return join(
      this.options.experienceDir,
      STATE_DIRS.candidate,
      `${safeFileToken(candidateId)}.json`,
    );
  }

  private artifactPath(artifactId: string): string {
    return join(
      this.options.experienceDir,
      STATE_DIRS.artifact,
      `${safeFileToken(artifactId)}.json`,
    );
  }

  private quarantinePath(quarantineId: string): string {
    return join(
      this.options.experienceDir,
      STATE_DIRS.quarantine,
      `${safeFileToken(quarantineId)}.json`,
    );
  }

  private reviewPath(candidateId: string, decisionId: string): string {
    return join(
      this.options.experienceDir,
      STATE_DIRS.review,
      `${safeFileToken(candidateId)}__${safeFileToken(decisionId)}.json`,
    );
  }

  private promotionPath(candidateId: string, promotionId: string): string {
    return join(
      this.options.experienceDir,
      STATE_DIRS.promotion,
      `${safeFileToken(candidateId)}__${safeFileToken(promotionId)}.json`,
    );
  }

  private rollbackPath(candidateId: string, rollbackId: string): string {
    return join(
      this.options.experienceDir,
      STATE_DIRS.rollback,
      `${safeFileToken(candidateId)}__${safeFileToken(rollbackId)}.json`,
    );
  }

  private evaluationPath(candidateId: string, evaluationId: string): string {
    return join(
      this.options.experienceDir,
      STATE_DIRS.evaluation,
      `${safeFileToken(candidateId)}__${safeFileToken(evaluationId)}.json`,
    );
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private async readJson<T>(
    path: string,
    guard: (value: unknown) => value is T,
  ): Promise<T | null> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      return guard(parsed) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async readStateDirectory<T>(
    stateDir: string,
    guard: (value: unknown) => value is T,
    compare: (left: T, right: T) => number,
  ): Promise<readonly T[]> {
    const directory = join(this.options.experienceDir, stateDir);
    let files: readonly string[];
    try {
      files = (await readdir(directory))
        .filter((file) => file.endsWith(".json"))
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      if (isIgnorableStateDirectoryReadError(error)) {
        return [];
      }
      throw error;
    }

    const records: T[] = [];
    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(join(directory, file), "utf8")) as unknown;
        if (guard(parsed)) {
          records.push(parsed);
        }
      } catch {
        // Ignore malformed experience records so one bad file does not hide the queue.
      }
    }
    return records.sort(compare);
  }
}

function isIgnorableStateDirectoryReadError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR";
}

function compareReviewDecision(
  left: ExperienceReviewDecision,
  right: ExperienceReviewDecision,
): number {
  return left.decidedAtMs - right.decidedAtMs || left.decisionId.localeCompare(right.decisionId);
}

function compareSourceArtifact(
  left: ExperienceSourceArtifact,
  right: ExperienceSourceArtifact,
): number {
  return left.capturedAtMs - right.capturedAtMs || left.artifactId.localeCompare(right.artifactId);
}

function compareQuarantineRecord(
  left: ExperienceQuarantineRecord,
  right: ExperienceQuarantineRecord,
): number {
  return (
    left.createdAtMs - right.createdAtMs || left.quarantineId.localeCompare(right.quarantineId)
  );
}

function selectLatestReviewDecision(
  decisions: readonly ExperienceReviewDecision[],
): ExperienceReviewDecision | null {
  return decisions.at(-1) ?? null;
}

function comparePromotionRecord(
  left: ExperiencePromotionRecord,
  right: ExperiencePromotionRecord,
): number {
  return (
    left.promotedAtMs - right.promotedAtMs || left.promotionId.localeCompare(right.promotionId)
  );
}

function compareRollbackRecord(
  left: ExperienceRollbackRecord,
  right: ExperienceRollbackRecord,
): number {
  return (
    left.rolledBackAtMs - right.rolledBackAtMs || left.rollbackId.localeCompare(right.rollbackId)
  );
}

function compareEvaluationRecord(
  left: ExperienceCandidateEvaluationRecord,
  right: ExperienceCandidateEvaluationRecord,
): number {
  return (
    left.evaluatedAtMs - right.evaluatedAtMs || left.evaluationId.localeCompare(right.evaluationId)
  );
}

function createExperienceCandidateEvaluationRecord(
  input: CreateExperienceCandidateEvaluationRecordInput,
): ExperienceCandidateEvaluationRecord {
  return {
    schemaVersion: "director.experience.evaluation.v1",
    evaluationId: input.evaluationId,
    candidateId: input.candidateId,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    status: input.status,
    score: normalizeEvaluationScore(input.score),
    summary: input.summary,
    evidenceRefs: [...new Set(input.evidenceRefs ?? [])].sort((left, right) =>
      left.localeCompare(right),
    ),
    evaluatedAtMs: input.evaluatedAtMs,
    ...(input.evaluatorId === undefined ? {} : { evaluatorId: input.evaluatorId }),
  };
}

function safeFileToken(value: string): string {
  return encodeURIComponent(value).replace(/%/gu, "_");
}

function isExperienceCandidate(value: unknown): value is ExperienceCandidate {
  return (
    isRecord(value) &&
    isString(value.schemaVersion) &&
    isString(value.candidateId) &&
    isRecord(value.sourceAdapter) &&
    isString(value.title) &&
    isString(value.summary) &&
    isString(value.applicability) &&
    isStringArray(value.risks) &&
    isStringArray(value.tags) &&
    Array.isArray(value.evidence) &&
    (value.sourceArtifactId === undefined || isString(value.sourceArtifactId)) &&
    (value.sourceDigest === undefined || isString(value.sourceDigest)) &&
    (value.evidencePreview === undefined || isString(value.evidencePreview)) &&
    (value.quality === undefined || isExperienceQualityAssessment(value.quality)) &&
    value.status === "candidate" &&
    isString(value.privacy) &&
    value.runtimeInjection === "disabled" &&
    isString(value.provenance) &&
    typeof value.createdAtMs === "number"
  );
}

function isExperienceSourceArtifact(value: unknown): value is ExperienceSourceArtifact {
  return (
    isRecord(value) &&
    isString(value.schemaVersion) &&
    isString(value.artifactId) &&
    isString(value.sourceKind) &&
    isString(value.sourceRef) &&
    (value.title === undefined || isString(value.title)) &&
    (value.path === undefined || isString(value.path)) &&
    (value.contentType === undefined || isString(value.contentType)) &&
    isString(value.digest) &&
    typeof value.bytes === "number" &&
    isString(value.textPreview) &&
    (value.rawContent === undefined || isString(value.rawContent)) &&
    (value.readableContent === undefined || isString(value.readableContent)) &&
    (value.extractionReport === undefined ||
      isExperienceExtractionReport(value.extractionReport)) &&
    isExperienceQualityAssessment(value.quality) &&
    isString(value.privacy) &&
    isString(value.provenance) &&
    typeof value.capturedAtMs === "number"
  );
}

function isExperienceQuarantineRecord(value: unknown): value is ExperienceQuarantineRecord {
  return (
    isRecord(value) &&
    isString(value.schemaVersion) &&
    isString(value.quarantineId) &&
    isExperienceSourceArtifact(value.artifact) &&
    isString(value.reason) &&
    isStringArray(value.notes) &&
    typeof value.createdAtMs === "number"
  );
}

function isExperienceQualityAssessment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.score === "number" &&
    (value.verdict === "usable" || value.verdict === "quarantine") &&
    isStringArray(value.reasons) &&
    (value.metrics === undefined || isRecord(value.metrics))
  );
}

function isExperienceExtractionReport(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.status === "ok" || value.status === "partial" || value.status === "failed") &&
    typeof value.readableChars === "number" &&
    typeof value.rawChars === "number" &&
    isStringArray(value.transformations) &&
    isStringArray(value.notes) &&
    (value.unavailable === undefined || isStringArray(value.unavailable))
  );
}

function isExperienceReviewDecision(value: unknown): value is ExperienceReviewDecision {
  return (
    isRecord(value) &&
    isString(value.schemaVersion) &&
    isString(value.decisionId) &&
    isString(value.candidateId) &&
    (value.gate === "human" || value.gate === "verifier") &&
    (value.decision === "accepted" || value.decision === "rejected") &&
    typeof value.decidedAtMs === "number" &&
    (value.reviewerId === undefined || isString(value.reviewerId)) &&
    (value.note === undefined || isString(value.note))
  );
}

function isExperiencePromotionRecord(value: unknown): value is ExperiencePromotionRecord {
  return (
    isRecord(value) &&
    isString(value.schemaVersion) &&
    isString(value.promotionId) &&
    isString(value.candidateId) &&
    isString(value.promotedTo) &&
    isString(value.promotedRef) &&
    typeof value.promotedAtMs === "number" &&
    (value.actorId === undefined || isString(value.actorId))
  );
}

function isExperienceRollbackRecord(value: unknown): value is ExperienceRollbackRecord {
  return (
    isRecord(value) &&
    isString(value.schemaVersion) &&
    isString(value.rollbackId) &&
    isString(value.promotionId) &&
    isString(value.candidateId) &&
    typeof value.rolledBackAtMs === "number" &&
    isString(value.reason) &&
    (value.actorId === undefined || isString(value.actorId))
  );
}

function isExperienceCandidateEvaluationRecord(
  value: unknown,
): value is ExperienceCandidateEvaluationRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === "director.experience.evaluation.v1" &&
    isString(value.evaluationId) &&
    isString(value.candidateId) &&
    (value.runId === undefined || isString(value.runId)) &&
    isExperienceCandidateEvaluationStatus(value.status) &&
    typeof value.score === "number" &&
    value.score >= 0 &&
    value.score <= 1 &&
    isString(value.summary) &&
    isStringArray(value.evidenceRefs) &&
    typeof value.evaluatedAtMs === "number" &&
    (value.evaluatorId === undefined || isString(value.evaluatorId))
  );
}

function isExperienceCandidateEvaluationStatus(
  value: unknown,
): value is ExperienceCandidateEvaluationStatus {
  return (
    value === "effective" || value === "ineffective" || value === "mixed" || value === "unknown"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function normalizeEvaluationScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(1, score));
}
