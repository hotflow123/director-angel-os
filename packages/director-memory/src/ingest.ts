import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type DirectorMemoryRecord,
  type DirectorTraceObservationRef,
  buildDirectorTraceDigest,
} from "@hotflow/director-memory-contracts";

import type { DirectorMemoryPort, DirectorMemoryPortStatus } from "./types.js";

type ExecutionRunReport = Parameters<typeof buildDirectorTraceDigest>[0]["report"];

const DIRECTOR_MEMORY_INGEST_AUDIT_SCHEMA_VERSION = "director.memory.ingest.audit.v1" as const;

type ObservationSource = "evaluation" | "outcome";

interface StoredDirectorWorkingContext {
  readonly projectId?: string;
  readonly groupId?: string;
  readonly generationType?: string;
  readonly generationStyle?: string;
  readonly anchorIds?: readonly string[];
}

interface StoredDirectorRecallHints {
  readonly knowledgeSignalTags?: readonly string[];
}

interface StoredDirectorObservation {
  readonly observationId: string;
  readonly source: ObservationSource;
  readonly recordedAt: string;
  readonly snapshotId: string;
  readonly runtimeId: string;
  readonly blueprintId?: string;
  readonly handoffId?: string;
  readonly workingContext?: StoredDirectorWorkingContext;
  readonly recallHints?: StoredDirectorRecallHints;
}

interface DirectorMemoryIngestAuditDocument {
  readonly schemaVersion: typeof DIRECTOR_MEMORY_INGEST_AUDIT_SCHEMA_VERSION;
  readonly runId: string;
  readonly reportId: string;
  readonly status: DirectorMemoryPortStatus;
  readonly recordedAt: string;
  readonly observationIds: readonly string[];
  readonly notes: readonly string[];
  readonly recordId?: string;
  readonly digestId?: string;
}

export interface DirectorMemoryIngestResult {
  readonly status: DirectorMemoryPortStatus;
  readonly runId: string;
  readonly reportId: string;
  readonly recordedAt: string;
  readonly observationIds: readonly string[];
  readonly notes: readonly string[];
  readonly recordId?: string;
  readonly digestId?: string;
  readonly auditPath?: string;
}

export interface FileSystemDirectorMemoryIngestServiceOptions {
  readonly store: DirectorMemoryPort;
  readonly observationPath: string;
  readonly auditRootPath: string;
  readonly clock?: () => string;
  readonly digestIdProvider?: (report: ExecutionRunReport) => string;
  readonly recordIdProvider?: (report: ExecutionRunReport) => string;
}

export class FileSystemDirectorMemoryIngestService {
  private readonly clock;
  private readonly digestIdProvider;
  private readonly recordIdProvider;

  public constructor(private readonly options: FileSystemDirectorMemoryIngestServiceOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.digestIdProvider = options.digestIdProvider ?? ((report) => `digest-${report.runId}`);
    this.recordIdProvider = options.recordIdProvider ?? ((report) => `record-${report.runId}`);
  }

  public async ingestReport(report: ExecutionRunReport): Promise<DirectorMemoryIngestResult> {
    const recordedAt = this.clock();
    let result: DirectorMemoryIngestResult;

    try {
      const observations = await this.loadObservations();
      const evaluation = selectEvaluationObservation(report, observations);
      if (
        evaluation === null ||
        evaluation.workingContext?.projectId === undefined ||
        evaluation.workingContext?.groupId === undefined
      ) {
        result = {
          status: "degraded",
          runId: report.runId,
          reportId: report.reportId,
          recordedAt,
          observationIds: [],
          notes: [
            "Director memory ingest degraded: matching evaluation observation with projectId/groupId was not found.",
          ],
        };
      } else {
        const outcome = selectOutcomeObservation(report, observations);
        const observationRefs = buildObservationRefs(
          [evaluation, outcome].filter(
            (value): value is StoredDirectorObservation => value !== null,
          ),
        );
        const observationIds = observationRefs.map((ref) => ref.observationId);
        if (report.run.status !== "completed") {
          result = {
            status: "degraded",
            runId: report.runId,
            reportId: report.reportId,
            recordedAt,
            observationIds,
            notes: [
              `Director memory ingest requires review before recallable memory: run ${report.runId} ended with status ${report.run.status}.`,
            ],
          };
        } else if (isLowSignalDirectorMemoryRun(report)) {
          result = {
            status: "degraded",
            runId: report.runId,
            reportId: report.reportId,
            recordedAt,
            observationIds,
            notes: [
              `Director memory ingest skipped low-signal casual run ${report.runId}; no recallable memory was written.`,
            ],
          };
        } else {
          const knowledgeSignalTags = sortUniqueStrings(
            evaluation.recallHints?.knowledgeSignalTags ?? [],
          );
          const memoryAdmissionTags = createDirectorMemoryAdmissionTags(report.run.status);
          const digest = buildDirectorTraceDigest({
            digestId: this.digestIdProvider(report),
            recordedAt,
            report,
            projectId: evaluation.workingContext.projectId,
            groupId: evaluation.workingContext.groupId,
            anchorIds: sortUniqueStrings(evaluation.workingContext.anchorIds ?? []),
            observationRefs,
            ...(evaluation.workingContext.generationType === undefined
              ? {}
              : { generationType: evaluation.workingContext.generationType }),
            ...(evaluation.workingContext.generationStyle === undefined
              ? {}
              : { generationStyle: evaluation.workingContext.generationStyle }),
            ...(knowledgeSignalTags.length === 0 ? {} : { knowledgeSignalTags }),
          });
          const record: DirectorMemoryRecord = {
            schemaVersion: "director.memory.record.v1",
            recordId: this.recordIdProvider(report),
            digestId: digest.digestId,
            projectId: digest.projectId,
            groupId: digest.groupId,
            anchorIds: digest.anchorIds,
            selectedAdapters: digest.selectedAdapters,
            tags: sortUniqueStrings([...knowledgeSignalTags, ...memoryAdmissionTags]),
            status: digest.status,
            recordedAt,
            digest,
          };
          const writeResult = await this.options.store.writeRecord(record);
          result = {
            status: writeResult.status,
            runId: report.runId,
            reportId: report.reportId,
            recordedAt,
            observationIds,
            notes: [...writeResult.notes],
            recordId: writeResult.recordId ?? record.recordId,
            digestId: record.digestId,
          };
        }
      }
    } catch (error) {
      result = {
        status: "degraded",
        runId: report.runId,
        reportId: report.reportId,
        recordedAt,
        observationIds: [],
        notes: [`Director memory ingest degraded: ${toErrorMessage(error)}.`],
      };
    }

    try {
      const auditPath = await this.writeAudit(result);
      return {
        ...result,
        auditPath,
      };
    } catch (error) {
      return {
        ...result,
        status: "degraded",
        notes: [...result.notes, `Director memory audit degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  private async loadObservations(): Promise<StoredDirectorObservation[]> {
    try {
      const data = await readFile(this.options.observationPath, "utf8");
      return data
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(parseObservationLine)
        .filter((value): value is StoredDirectorObservation => value !== null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeAudit(result: DirectorMemoryIngestResult): Promise<string> {
    const path = join(this.options.auditRootPath, `${result.runId}.json`);
    const document: DirectorMemoryIngestAuditDocument = {
      schemaVersion: DIRECTOR_MEMORY_INGEST_AUDIT_SCHEMA_VERSION,
      runId: result.runId,
      reportId: result.reportId,
      status: result.status,
      recordedAt: result.recordedAt,
      observationIds: [...result.observationIds],
      notes: [...result.notes],
      ...(result.recordId === undefined ? {} : { recordId: result.recordId }),
      ...(result.digestId === undefined ? {} : { digestId: result.digestId }),
    };

    await writeJson(path, document);
    return path;
  }
}

function createDirectorMemoryAdmissionTags(status: ExecutionRunReport["run"]["status"]): string[] {
  return [
    "memory:director-run",
    "memory:admission:run-trajectory",
    status === "completed" ? "memory:outcome:completed" : "memory:outcome:failure-only",
  ];
}

function isLowSignalDirectorMemoryRun(report: ExecutionRunReport): boolean {
  if (
    /(?:今天天气|天气不错|随便聊聊|随便说说|闲聊|没事|挺开心|hello|hi|just chatting)/iu.test(
      report.run.goal,
    ) &&
    !/(短剧|视频|分镜|镜头|脚本|制作|生成|学习|经验|知识|资料|链接|文件|目录|brief|story|script|video|shot|teaser)/iu.test(
      report.run.goal,
    )
  ) {
    return true;
  }
  const text = `${report.run.goal}\n${report.run.previewSummary}\n${report.summary.join("\n")}`;
  if (
    /(短剧|视频|分镜|镜头|脚本|制作|生成|学习|经验|知识|资料|链接|文件|目录|brief|story|script|video|shot|teaser)/iu.test(
      text,
    )
  ) {
    return false;
  }
  return /(?:今天天气|天气不错|随便聊聊|随便说说|闲聊|没事|挺开心|日常|流水账|hello|hi|just chatting)/iu.test(
    text,
  );
}

function parseObservationLine(line: string): StoredDirectorObservation | null {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  if (
    typeof parsed.observationId !== "string" ||
    (parsed.source !== "evaluation" && parsed.source !== "outcome") ||
    typeof parsed.recordedAt !== "string" ||
    typeof parsed.snapshotId !== "string" ||
    typeof parsed.runtimeId !== "string"
  ) {
    return null;
  }

  return {
    observationId: parsed.observationId,
    source: parsed.source,
    recordedAt: parsed.recordedAt,
    snapshotId: parsed.snapshotId,
    runtimeId: parsed.runtimeId,
    ...(typeof parsed.blueprintId === "string" ? { blueprintId: parsed.blueprintId } : {}),
    ...(typeof parsed.handoffId === "string" ? { handoffId: parsed.handoffId } : {}),
    ...(isWorkingContext(parsed.workingContext) ? { workingContext: parsed.workingContext } : {}),
    ...(isRecallHints(parsed.recallHints) ? { recallHints: parsed.recallHints } : {}),
  };
}

function selectEvaluationObservation(
  report: ExecutionRunReport,
  observations: readonly StoredDirectorObservation[],
): StoredDirectorObservation | null {
  const matches = observations
    .filter(
      (observation) =>
        observation.source === "evaluation" &&
        observation.snapshotId === report.run.snapshotId &&
        observation.runtimeId === report.run.runtimeId,
    )
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));

  const beforeRun = matches.filter((observation) => observation.recordedAt <= report.run.createdAt);
  return beforeRun[0] ?? matches[0] ?? null;
}

function selectOutcomeObservation(
  report: ExecutionRunReport,
  observations: readonly StoredDirectorObservation[],
): StoredDirectorObservation | null {
  return (
    observations
      .filter(
        (observation) =>
          observation.source === "outcome" &&
          observation.snapshotId === report.run.snapshotId &&
          observation.blueprintId === report.run.blueprintId &&
          observation.handoffId === report.run.handoffId,
      )
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0] ?? null
  );
}

function buildObservationRefs(
  observations: readonly StoredDirectorObservation[],
): DirectorTraceObservationRef[] {
  return observations.map((observation) => ({
    observationId: observation.observationId,
    source: observation.source,
    recordedAt: observation.recordedAt,
  }));
}

function isWorkingContext(value: unknown): value is StoredDirectorWorkingContext {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.projectId === undefined || typeof candidate.projectId === "string") &&
    (candidate.groupId === undefined || typeof candidate.groupId === "string") &&
    (candidate.generationType === undefined || typeof candidate.generationType === "string") &&
    (candidate.generationStyle === undefined || typeof candidate.generationStyle === "string") &&
    (candidate.anchorIds === undefined ||
      (Array.isArray(candidate.anchorIds) &&
        candidate.anchorIds.every((entry) => typeof entry === "string")))
  );
}

function isRecallHints(value: unknown): value is StoredDirectorRecallHints {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.knowledgeSignalTags === undefined ||
    (Array.isArray(candidate.knowledgeSignalTags) &&
      candidate.knowledgeSignalTags.every((entry) => typeof entry === "string"))
  );
}

function sortUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
