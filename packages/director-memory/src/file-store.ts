import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DIRECTOR_MEMORY_RECORD_SCHEMA_VERSION,
  DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
  type DirectorMemoryRecord,
  type DirectorRecallHit,
  type DirectorRecallPacket,
  type DirectorRecallQuery,
  isDirectorMemoryRecord,
} from "@hotflow/director-memory-contracts";

import {
  DEFAULT_DIRECTOR_RECALL_SCORING_WEIGHTS,
  type DirectorRecallScoringWeights,
  scoreDirectorMemoryRecord,
} from "./scoring.js";
import type {
  DirectorMemoryCandidate,
  DirectorMemoryCandidatePublishInput,
  DirectorMemoryCandidatePublishResult,
  DirectorMemoryEvidenceRef,
  DirectorMemoryGovernanceAuditEntry,
  DirectorMemoryGovernanceInput,
  DirectorMemoryGovernanceResult,
  DirectorMemoryPort,
  DirectorMemoryPublicationGovernanceStatus,
  DirectorMemoryStatus,
  DirectorMemoryWriteResult,
} from "./types.js";

const DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION = "director.memory.index.v1" as const;
const DIRECTOR_MEMORY_CANDIDATE_SCHEMA_VERSION = "director.memory.candidate.v1" as const;
const DIRECTOR_MEMORY_PUBLICATION_SCHEMA_VERSION = "director.memory.publication.v1" as const;

interface DirectorMemoryIndexEntry {
  readonly recordId: string;
  readonly digestId: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly anchorIds: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly tags: readonly string[];
  readonly status: DirectorMemoryRecord["status"];
  readonly recordedAt: string;
}

interface DirectorMemoryIndexDocument {
  readonly schemaVersion: typeof DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly entries: readonly DirectorMemoryIndexEntry[];
}

interface StoredDirectorMemoryCandidate extends DirectorMemoryCandidate {
  readonly schemaVersion: typeof DIRECTOR_MEMORY_CANDIDATE_SCHEMA_VERSION;
  readonly status: "candidate" | "published" | "rejected";
}

interface DirectorMemoryPublicationRecord {
  readonly schemaVersion: typeof DIRECTOR_MEMORY_PUBLICATION_SCHEMA_VERSION;
  readonly candidateId: string;
  readonly recordId: string;
  readonly publishedAt: string;
  readonly actor?: string;
  readonly note?: string;
  readonly evidenceRefs: readonly DirectorMemoryEvidenceRef[];
  readonly summary?: string;
  readonly governanceStatus?: DirectorMemoryPublicationGovernanceStatus;
  readonly governanceAudit?: readonly DirectorMemoryGovernanceAuditEntry[];
}

export interface FileSystemDirectorMemoryStoreOptions {
  readonly rootPath: string;
  readonly clock?: () => string;
  readonly scoringWeights?: DirectorRecallScoringWeights;
}

export class FileSystemDirectorMemoryStore implements DirectorMemoryPort {
  private readonly clock;
  private readonly scoringWeights;

  public constructor(private readonly options: FileSystemDirectorMemoryStoreOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.scoringWeights = options.scoringWeights ?? DEFAULT_DIRECTOR_RECALL_SCORING_WEIGHTS;
  }

  public async writeRecord(record: DirectorMemoryRecord): Promise<DirectorMemoryWriteResult> {
    if (!isDirectorMemoryRecord(record)) {
      throw new Error("Cannot write an invalid DirectorMemoryRecord.");
    }

    try {
      await this.ensurePaths();
      await this.writeJson(this.recordPath(record.recordId), record);

      const index = await this.loadIndexDocument({ allowMissing: true });
      const nextEntries = new Map(index.entries.map((entry) => [entry.recordId, entry]));
      nextEntries.set(record.recordId, toIndexEntry(record));

      await this.writeJson(this.indexPath(), {
        schemaVersion: DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION,
        updatedAt: this.clock(),
        entries: [...nextEntries.values()].sort(compareIndexEntries),
      });

      return {
        status: "ok",
        recordId: record.recordId,
        notes: [`Stored Director memory record ${record.recordId}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        recordId: record.recordId,
        notes: [`Director memory write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async writeCandidate(
    candidate: DirectorMemoryCandidate,
  ): Promise<DirectorMemoryCandidatePublishResult> {
    if (!isDirectorMemoryRecord(candidate.record)) {
      throw new Error("Cannot write an invalid Director memory candidate record.");
    }

    try {
      await this.writeJson(this.candidatePath(candidate.candidateId), {
        schemaVersion: DIRECTOR_MEMORY_CANDIDATE_SCHEMA_VERSION,
        candidateId: candidate.candidateId,
        record: candidate.record,
        evidenceRefs: candidate.evidenceRefs.map(normalizeEvidenceRef),
        ...(candidate.summary === undefined ? {} : { summary: candidate.summary }),
        createdAt: candidate.createdAt,
        status: "candidate",
      } satisfies StoredDirectorMemoryCandidate);
      return {
        status: "ok",
        candidateId: candidate.candidateId,
        notes: [`Stored Director memory candidate ${candidate.candidateId}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        candidateId: candidate.candidateId,
        notes: [`Director memory candidate write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async publishCandidate(
    candidateId: string,
    input: DirectorMemoryCandidatePublishInput = {},
  ): Promise<DirectorMemoryCandidatePublishResult> {
    try {
      const candidate = await this.loadCandidate(candidateId);
      if (candidate.status === "published") {
        return {
          status: "degraded",
          candidateId,
          recordId: candidate.record.recordId,
          notes: [`Director memory candidate ${candidateId} is already published.`],
        };
      }
      const publishedAt = input.publishedAt ?? this.clock();
      const publication: DirectorMemoryPublicationRecord = {
        schemaVersion: DIRECTOR_MEMORY_PUBLICATION_SCHEMA_VERSION,
        candidateId,
        recordId: candidate.record.recordId,
        publishedAt,
        ...(input.actor === undefined ? {} : { actor: input.actor }),
        ...(input.note === undefined ? {} : { note: input.note }),
        evidenceRefs: candidate.evidenceRefs.map(normalizeEvidenceRef),
        ...(candidate.summary === undefined ? {} : { summary: candidate.summary }),
        governanceStatus: "published",
        governanceAudit: [],
      };
      const record: DirectorMemoryRecord = {
        ...candidate.record,
        recordedAt: candidate.record.recordedAt ?? publishedAt,
      };
      const writeResult = await this.writeRecord(record);
      if (writeResult.status !== "ok") {
        return {
          status: writeResult.status,
          candidateId,
          ...(writeResult.recordId === undefined ? {} : { recordId: writeResult.recordId }),
          notes: writeResult.notes,
        };
      }
      await this.writeJson(this.publicationPath(record.recordId), publication);
      await this.writeJson(this.candidatePath(candidateId), {
        ...candidate,
        status: "published",
      } satisfies StoredDirectorMemoryCandidate);
      return {
        status: "ok",
        candidateId,
        recordId: record.recordId,
        notes: [`Published Director memory candidate ${candidateId} as ${record.recordId}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        candidateId,
        notes: [`Director memory candidate publish degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async retractPublication(
    recordId: string,
    input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.updatePublicationGovernance(recordId, "retracted", input);
  }

  public async demotePublication(
    recordId: string,
    input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.updatePublicationGovernance(recordId, "demoted", input);
  }

  public async quarantinePublication(
    recordId: string,
    input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.updatePublicationGovernance(recordId, "quarantined", input);
  }

  public async restorePublication(
    recordId: string,
    input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.updatePublicationGovernance(recordId, "published", input);
  }

  public async recall(query: DirectorRecallQuery): Promise<DirectorRecallPacket> {
    const queryId = `recall-${this.clock()}`;

    try {
      const index = await this.loadIndexDocument({ allowMissing: true });
      const scoredHits = [];

      for (const entry of index.entries) {
        const record = await this.loadRecord(entry.recordId);
        if (record === null) {
          continue;
        }

        const publication = await this.loadPublication(record.recordId);
        const governanceStatus = publication?.governanceStatus ?? "published";
        if (governanceStatus === "retracted" || governanceStatus === "quarantined") {
          continue;
        }

        const score = scoreDirectorMemoryRecord(record, query, {
          now: this.clock(),
          weights: this.scoringWeights,
        });
        if (score === null) {
          continue;
        }

        const adjustedScore =
          governanceStatus === "demoted" ? Number((score.score * 0.5).toFixed(6)) : score.score;
        const reasons =
          governanceStatus === "demoted"
            ? [...score.reasons, "memory demoted by governance"]
            : score.reasons;
        scoredHits.push(
          buildRecallHit(record, {
            score: adjustedScore,
            reasons,
            publication,
          }),
        );
      }

      scoredHits.sort(compareRecallHits);
      const hits = scoredHits.slice(0, query.maxHits);

      return {
        schemaVersion: DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
        queryId,
        status: hits.length > 0 ? "ok" : "miss",
        recordedAt: this.clock(),
        notes:
          hits.length > 0
            ? [`${hits.length} hit(s) returned.`]
            : ["No matching Director memory records found."],
        hits,
        query,
        truncated: scoredHits.length > query.maxHits,
      };
    } catch (error) {
      return {
        schemaVersion: DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
        queryId,
        status: "degraded",
        recordedAt: this.clock(),
        notes: [`Director memory recall degraded: ${toErrorMessage(error)}.`],
        hits: [],
        query,
        truncated: false,
      };
    }
  }

  private async updatePublicationGovernance(
    recordId: string,
    nextStatus: DirectorMemoryPublicationGovernanceStatus,
    input: DirectorMemoryGovernanceInput,
  ): Promise<DirectorMemoryGovernanceResult> {
    try {
      const publication = await this.loadPublication(recordId);
      if (publication === null) {
        return {
          status: "degraded",
          recordId,
          notes: [`Director memory publication ${recordId} does not exist.`],
        };
      }
      const previousStatus = publication.governanceStatus ?? "published";
      const decidedAt = input.decidedAt ?? this.clock();
      const auditEntry: DirectorMemoryGovernanceAuditEntry = {
        ...(input.actor === undefined ? {} : { actor: input.actor }),
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        decidedAt,
        previousStatus,
        nextStatus,
      };
      await this.writeJson(this.publicationPath(recordId), {
        ...publication,
        governanceStatus: nextStatus,
        governanceAudit: [...(publication.governanceAudit ?? []), auditEntry],
      } satisfies DirectorMemoryPublicationRecord);
      return {
        status: "ok",
        recordId,
        governanceStatus: nextStatus,
        notes: [`Director memory publication ${recordId} governance changed to ${nextStatus}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        recordId,
        notes: [`Director memory governance degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async getStatus(): Promise<DirectorMemoryStatus> {
    try {
      const index = await this.loadIndexDocument({ allowMissing: true });
      return {
        status: "ok",
        rootPath: this.options.rootPath,
        recordCount: index.entries.length,
        ...(index.entries[0] === undefined ? {} : { lastRecordedAt: index.entries[0].recordedAt }),
        notes:
          index.entries.length > 0
            ? [`${index.entries.length} Director memory record(s) available.`]
            : ["No Director memory records stored yet."],
      };
    } catch (error) {
      return {
        status: "degraded",
        rootPath: this.options.rootPath,
        recordCount: 0,
        notes: [`Director memory status degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  private async ensurePaths(): Promise<void> {
    await mkdir(this.recordsRoot(), { recursive: true });
  }

  private async loadIndexDocument(options: {
    readonly allowMissing: boolean;
  }): Promise<DirectorMemoryIndexDocument> {
    try {
      const data = await readFile(this.indexPath(), "utf8");
      const parsed = JSON.parse(data) as DirectorMemoryIndexDocument;
      if (
        parsed.schemaVersion !== DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION ||
        !Array.isArray(parsed.entries)
      ) {
        throw new Error("Index schema is invalid.");
      }
      return parsed;
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (options.allowMissing && errno.code === "ENOENT") {
        return {
          schemaVersion: DIRECTOR_MEMORY_INDEX_SCHEMA_VERSION,
          updatedAt: this.clock(),
          entries: [],
        };
      }
      throw new Error(`Failed to load Director memory index: ${toErrorMessage(error)}`);
    }
  }

  private async loadRecord(recordId: string): Promise<DirectorMemoryRecord | null> {
    const data = await readFile(this.recordPath(recordId), "utf8");
    const parsed = JSON.parse(data) as unknown;
    if (!isDirectorMemoryRecord(parsed)) {
      throw new Error(`Record ${recordId} is invalid.`);
    }
    return parsed;
  }

  private async loadCandidate(candidateId: string): Promise<StoredDirectorMemoryCandidate> {
    const data = await readFile(this.candidatePath(candidateId), "utf8");
    const parsed = JSON.parse(data) as unknown;
    if (!isStoredDirectorMemoryCandidate(parsed)) {
      throw new Error(`Candidate ${candidateId} is invalid.`);
    }
    return parsed;
  }

  private async loadPublication(recordId: string): Promise<DirectorMemoryPublicationRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(this.publicationPath(recordId), "utf8")) as unknown;
      if (!isDirectorMemoryPublicationRecord(parsed)) {
        throw new Error(`Publication ${recordId} is invalid.`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  }

  private indexPath(): string {
    return join(this.options.rootPath, "index.json");
  }

  private recordsRoot(): string {
    return join(this.options.rootPath, "records");
  }

  private candidatesRoot(): string {
    return join(this.options.rootPath, "candidates");
  }

  private publicationsRoot(): string {
    return join(this.options.rootPath, "publications");
  }

  private recordPath(recordId: string): string {
    return join(this.recordsRoot(), `${recordId}.json`);
  }

  private candidatePath(candidateId: string): string {
    return join(this.candidatesRoot(), `${candidateId}.json`);
  }

  private publicationPath(recordId: string): string {
    return join(this.publicationsRoot(), `${recordId}.json`);
  }
}

function toIndexEntry(record: DirectorMemoryRecord): DirectorMemoryIndexEntry {
  return {
    recordId: record.recordId,
    digestId: record.digestId,
    projectId: record.projectId,
    groupId: record.groupId,
    anchorIds: record.anchorIds,
    selectedAdapters: record.selectedAdapters,
    tags: record.tags ?? [],
    status: record.status,
    recordedAt: record.recordedAt,
  };
}

function buildRecallHit(
  record: DirectorMemoryRecord,
  input: {
    readonly score: number;
    readonly reasons: readonly string[];
    readonly publication?: DirectorMemoryPublicationRecord | null;
  },
): DirectorRecallHit {
  return {
    recordId: record.recordId,
    digestId: record.digestId,
    projectId: record.projectId,
    groupId: record.groupId,
    anchorIds: record.anchorIds,
    selectedAdapters: record.selectedAdapters,
    status: record.status,
    recordedAt: record.recordedAt,
    score: input.score,
    reasons: [...input.reasons],
    summary: input.publication?.summary ?? buildSummary(record),
    provenance: {
      runId: record.digest.runId,
      reportId: record.digest.reportId,
      observationIds: record.digest.observationRefs.map((ref) => ref.observationId),
    },
    ...(input.publication === null || input.publication === undefined
      ? {}
      : {
          evidenceRefs: input.publication.evidenceRefs.map(normalizeEvidenceRef),
          publication: {
            candidateId: input.publication.candidateId,
            publishedAt: input.publication.publishedAt,
            ...(input.publication.actor === undefined ? {} : { actor: input.publication.actor }),
            ...(input.publication.note === undefined ? {} : { note: input.publication.note }),
          },
          governance: {
            status: input.publication.governanceStatus ?? "published",
            audit: [...(input.publication.governanceAudit ?? [])],
          },
        }),
  };
}

function normalizeEvidenceRef(ref: DirectorMemoryEvidenceRef): DirectorMemoryEvidenceRef {
  return {
    evidenceId: ref.evidenceId,
    ...(ref.sourceKind === undefined ? {} : { sourceKind: ref.sourceKind }),
    sourceRef: ref.sourceRef,
    ...(ref.sourceSnapshotId === undefined ? {} : { sourceSnapshotId: ref.sourceSnapshotId }),
    ...(ref.summary === undefined ? {} : { summary: ref.summary }),
  };
}

function isStoredDirectorMemoryCandidate(value: unknown): value is StoredDirectorMemoryCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<StoredDirectorMemoryCandidate>;
  return (
    candidate.schemaVersion === DIRECTOR_MEMORY_CANDIDATE_SCHEMA_VERSION &&
    typeof candidate.candidateId === "string" &&
    isDirectorMemoryRecord(candidate.record) &&
    Array.isArray(candidate.evidenceRefs) &&
    candidate.evidenceRefs.every(isDirectorMemoryEvidenceRef) &&
    (candidate.summary === undefined || typeof candidate.summary === "string") &&
    typeof candidate.createdAt === "string" &&
    (candidate.status === "candidate" ||
      candidate.status === "published" ||
      candidate.status === "rejected")
  );
}

function isDirectorMemoryPublicationRecord(
  value: unknown,
): value is DirectorMemoryPublicationRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const publication = value as Partial<DirectorMemoryPublicationRecord>;
  return (
    publication.schemaVersion === DIRECTOR_MEMORY_PUBLICATION_SCHEMA_VERSION &&
    typeof publication.candidateId === "string" &&
    typeof publication.recordId === "string" &&
    typeof publication.publishedAt === "string" &&
    (publication.actor === undefined || typeof publication.actor === "string") &&
    (publication.note === undefined || typeof publication.note === "string") &&
    Array.isArray(publication.evidenceRefs) &&
    publication.evidenceRefs.every(isDirectorMemoryEvidenceRef) &&
    (publication.summary === undefined || typeof publication.summary === "string") &&
    (publication.governanceStatus === undefined ||
      isDirectorMemoryPublicationGovernanceStatus(publication.governanceStatus)) &&
    (publication.governanceAudit === undefined ||
      (Array.isArray(publication.governanceAudit) &&
        publication.governanceAudit.every(isDirectorMemoryGovernanceAuditEntry)))
  );
}

function isDirectorMemoryPublicationGovernanceStatus(
  value: unknown,
): value is DirectorMemoryPublicationGovernanceStatus {
  return (
    value === "published" || value === "retracted" || value === "demoted" || value === "quarantined"
  );
}

function isDirectorMemoryGovernanceAuditEntry(
  value: unknown,
): value is DirectorMemoryGovernanceAuditEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const audit = value as Partial<DirectorMemoryGovernanceAuditEntry>;
  return (
    (audit.actor === undefined || typeof audit.actor === "string") &&
    (audit.note === undefined || typeof audit.note === "string") &&
    (audit.reason === undefined || typeof audit.reason === "string") &&
    typeof audit.decidedAt === "string" &&
    isDirectorMemoryPublicationGovernanceStatus(audit.previousStatus) &&
    isDirectorMemoryPublicationGovernanceStatus(audit.nextStatus)
  );
}

function isDirectorMemoryEvidenceRef(value: unknown): value is DirectorMemoryEvidenceRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const ref = value as Partial<DirectorMemoryEvidenceRef>;
  return (
    typeof ref.evidenceId === "string" &&
    (ref.sourceKind === undefined || typeof ref.sourceKind === "string") &&
    typeof ref.sourceRef === "string" &&
    (ref.sourceSnapshotId === undefined || typeof ref.sourceSnapshotId === "string") &&
    (ref.summary === undefined || typeof ref.summary === "string")
  );
}

function buildSummary(record: DirectorMemoryRecord): string {
  const adapterSummary =
    record.selectedAdapters.length > 0 ? ` using ${record.selectedAdapters.join(", ")}` : "";
  return `Previous ${record.status} run for "${record.digest.goal}"${adapterSummary}.`;
}

function compareIndexEntries(
  left: DirectorMemoryIndexEntry,
  right: DirectorMemoryIndexEntry,
): number {
  if (left.recordedAt === right.recordedAt) {
    return left.recordId.localeCompare(right.recordId);
  }
  return right.recordedAt.localeCompare(left.recordedAt);
}

function compareRecallHits(left: DirectorRecallHit, right: DirectorRecallHit): number {
  if (left.score === right.score) {
    if (left.recordedAt === right.recordedAt) {
      return left.recordId.localeCompare(right.recordId);
    }
    return right.recordedAt.localeCompare(left.recordedAt);
  }
  return right.score - left.score;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
