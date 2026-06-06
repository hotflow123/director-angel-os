import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type DirectorKnowledgeCandidateDocument,
  type DirectorKnowledgeReviewDecision,
  type DirectorKnowledgeRollbackRecord,
  isDirectorKnowledgeCandidateDocument,
  isDirectorKnowledgeReviewDecision,
  isDirectorKnowledgeRollbackRecord,
} from "./evolution.js";
import {
  type DirectorKnowledgePackDocument,
  type KnowledgePackMetadata,
  type KnowledgePackRecord,
  type KnowledgeState,
  isDirectorKnowledgePackDocument,
  isKnowledgePackMetadata,
} from "./types.js";

export interface KnowledgeStoreOptions {
  knowledgeDir: string;
}

export interface KnowledgePublishResult {
  readonly status: "ok" | "degraded";
  readonly packId: string;
  readonly version: number;
  readonly notes: readonly string[];
}

export interface KnowledgeCandidateWriteResult {
  readonly status: "ok" | "degraded";
  readonly packId: string;
  readonly version: number;
  readonly notes: readonly string[];
}

export interface KnowledgeReviewDecisionWriteResult {
  readonly status: "ok" | "degraded";
  readonly packId: string;
  readonly candidateVersion: number;
  readonly notes: readonly string[];
}

export interface KnowledgeRollbackRecordWriteResult {
  readonly status: "ok" | "degraded";
  readonly packId: string;
  readonly restoredFromVersion: number;
  readonly notes: readonly string[];
}

export class FileKnowledgeStore {
  private readonly paths = {
    published: "published",
    history: "history",
    review: "review",
    candidate: "candidate",
    rollback: "rollback",
  } as const;

  constructor(private readonly options: KnowledgeStoreOptions) {}

  async listPublished(): Promise<KnowledgePackRecord[]> {
    return this.readStateDirectory(this.paths.published, "published");
  }

  async listPublishedDocuments(): Promise<readonly DirectorKnowledgePackDocument[]> {
    return this.readDocumentsFromStateDirectory(
      this.paths.published,
      isDirectorKnowledgePackDocument,
    );
  }

  async listCandidateDocuments(): Promise<readonly DirectorKnowledgeCandidateDocument[]> {
    return this.readDocumentsFromStateDirectory(
      this.paths.candidate,
      isDirectorKnowledgeCandidateDocument,
    );
  }

  async getPublished(packId: string): Promise<DirectorKnowledgePackDocument | null> {
    const primaryPath = this.publishedPath(packId);
    const direct = await this.readDocument(primaryPath);
    if (direct) {
      return direct;
    }

    const records = await this.readStateDirectory(this.paths.published, "published");
    const fallback = records.find((record) => record.metadata.id === packId);
    if (!fallback) {
      return null;
    }

    return this.readDocument(join(this.options.knowledgeDir, this.paths.published, fallback.file));
  }

  async listHistory(packId: string): Promise<KnowledgePackRecord[]> {
    const records = await this.readStateDirectory(this.paths.history, "history");
    return records
      .filter((record) => record.metadata.id === packId)
      .sort((left, right) => right.metadata.version - left.metadata.version);
  }

  async listReviewQueue(): Promise<KnowledgePackRecord[]> {
    return this.readStateDirectory(this.paths.review, "review");
  }

  async getCandidate(): Promise<KnowledgePackRecord | null> {
    const candidates = await this.readStateDirectory(this.paths.candidate, "candidate");
    return candidates[0] ?? null;
  }

  async getCandidateDocument(packId: string): Promise<DirectorKnowledgeCandidateDocument | null> {
    const primaryPath = this.candidatePath(packId);
    const direct = await this.readCandidateDocument(primaryPath);
    if (direct) {
      return direct;
    }

    const records = await this.readStateDirectory(this.paths.candidate, "candidate");
    const fallback = records.find((record) => record.metadata.id === packId);
    if (!fallback) {
      return null;
    }

    return this.readCandidateDocument(
      join(this.options.knowledgeDir, this.paths.candidate, fallback.file),
    );
  }

  async listRollback(packId?: string): Promise<KnowledgePackRecord[]> {
    const records = await this.readStateDirectory(this.paths.rollback, "rollback");
    if (!packId) {
      return records;
    }
    return records.filter((record) => record.metadata.id === packId);
  }

  async listReviewDecisions(): Promise<readonly DirectorKnowledgeReviewDecision[]> {
    return this.readDocumentsFromStateDirectory(
      this.paths.review,
      isDirectorKnowledgeReviewDecision,
    );
  }

  async getReviewDecision(packId: string): Promise<DirectorKnowledgeReviewDecision | null> {
    const path = this.reviewDecisionPath(packId);
    return this.readReviewDecision(path);
  }

  async listRollbackRecords(packId?: string): Promise<readonly DirectorKnowledgeRollbackRecord[]> {
    const records = await this.readDocumentsFromStateDirectory(
      this.paths.rollback,
      isDirectorKnowledgeRollbackRecord,
    );
    if (packId === undefined) {
      return records;
    }
    return records.filter((record) => record.packId === packId);
  }

  async getHistoryDocument(
    packId: string,
    version: number,
  ): Promise<DirectorKnowledgePackDocument | null> {
    return this.readDocument(this.historyPath(packId, version));
  }

  async publish(document: DirectorKnowledgePackDocument): Promise<KnowledgePublishResult> {
    try {
      const current = await this.getPublished(document.metadata.id);
      const nextVersion = (current?.metadata.version ?? 0) + 1;
      const normalizedDocument: DirectorKnowledgePackDocument = {
        ...document,
        metadata: {
          ...document.metadata,
          version: nextVersion,
        },
      };

      await this.writeJson(this.publishedPath(normalizedDocument.metadata.id), normalizedDocument);
      await this.writeJson(
        this.historyPath(normalizedDocument.metadata.id, normalizedDocument.metadata.version),
        normalizedDocument,
      );

      return {
        status: "ok",
        packId: normalizedDocument.metadata.id,
        version: normalizedDocument.metadata.version,
        notes: [
          `Published Director knowledge pack ${normalizedDocument.metadata.id}.`,
          `Recorded history snapshot v${normalizedDocument.metadata.version}.`,
        ],
      };
    } catch (error) {
      return {
        status: "degraded",
        packId: document.metadata.id,
        version: document.metadata.version,
        notes: [`Director knowledge publish degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  async writeCandidate(
    document: DirectorKnowledgeCandidateDocument,
  ): Promise<KnowledgeCandidateWriteResult> {
    try {
      await this.writeJson(this.candidatePath(document.metadata.id), document);
      return {
        status: "ok",
        packId: document.metadata.id,
        version: document.metadata.version,
        notes: [
          `Stored Director knowledge candidate ${document.metadata.id}.`,
          `Prepared ${document.evolution.operation} candidate targeting v${document.evolution.nextVersion}.`,
        ],
      };
    } catch (error) {
      return {
        status: "degraded",
        packId: document.metadata.id,
        version: document.metadata.version,
        notes: [`Director knowledge candidate write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  async writeReviewDecision(
    decision: DirectorKnowledgeReviewDecision,
  ): Promise<KnowledgeReviewDecisionWriteResult> {
    try {
      await this.writeJson(this.reviewDecisionPath(decision.packId), decision);
      return {
        status: "ok",
        packId: decision.packId,
        candidateVersion: decision.candidateVersion,
        notes: [
          `Stored Director knowledge review decision for ${decision.packId}.`,
          `Recorded ${decision.decision} for candidate v${decision.candidateVersion}.`,
        ],
      };
    } catch (error) {
      return {
        status: "degraded",
        packId: decision.packId,
        candidateVersion: decision.candidateVersion,
        notes: [`Director knowledge review write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  async writeRollbackRecord(
    record: DirectorKnowledgeRollbackRecord,
  ): Promise<KnowledgeRollbackRecordWriteResult> {
    try {
      await this.writeJson(
        this.rollbackRecordPath(record.packId, record.currentVersionAfter),
        record,
      );
      return {
        status: "ok",
        packId: record.packId,
        restoredFromVersion: record.restoredFromVersion,
        notes: [
          `Recorded Director knowledge rollback for ${record.packId}.`,
          `Restored content from v${record.restoredFromVersion} into head v${record.currentVersionAfter}.`,
        ],
      };
    } catch (error) {
      return {
        status: "degraded",
        packId: record.packId,
        restoredFromVersion: record.restoredFromVersion,
        notes: [`Director knowledge rollback record degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  async deleteCandidate(packId: string): Promise<void> {
    const path = this.candidatePath(packId);
    try {
      const { rm } = await import("node:fs/promises");
      await rm(path, { force: true });
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }

  private async readStateDirectory(
    stateDir: string,
    state: KnowledgeState,
  ): Promise<KnowledgePackRecord[]> {
    const directory = join(this.options.knowledgeDir, stateDir);
    try {
      await stat(directory);
    } catch {
      return [];
    }

    const files = (await readdir(directory)).sort((left, right) => left.localeCompare(right));
    const records: KnowledgePackRecord[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const content = await readFile(join(directory, file), "utf-8");
        const parsed = JSON.parse(content) as unknown;
        const record = this.toRecord(parsed, state, file);
        if (record) {
          records.push(record);
        }
      } catch {
        // ignore malformed files
      }
    }

    return records;
  }

  private async readDocumentsFromStateDirectory<T>(
    stateDir: string,
    guard: (value: unknown) => value is T,
  ): Promise<readonly T[]> {
    const directory = join(this.options.knowledgeDir, stateDir);
    try {
      await stat(directory);
    } catch {
      return [];
    }

    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
    const documents: T[] = [];

    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(join(directory, file), "utf8")) as unknown;
        if (guard(parsed)) {
          documents.push(parsed);
        }
      } catch {
        // ignore malformed files
      }
    }

    return documents;
  }

  private async readDocument(path: string): Promise<DirectorKnowledgePackDocument | null> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      return isDirectorKnowledgePackDocument(parsed) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async readCandidateDocument(
    path: string,
  ): Promise<DirectorKnowledgeCandidateDocument | null> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      return isDirectorKnowledgeCandidateDocument(parsed) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async readReviewDecision(path: string): Promise<DirectorKnowledgeReviewDecision | null> {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      return isDirectorKnowledgeReviewDecision(parsed) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private toRecord(
    parsed: unknown,
    state: KnowledgeState,
    file: string,
  ): KnowledgePackRecord | null {
    if (isDirectorKnowledgePackDocument(parsed)) {
      return {
        metadata: parsed.metadata,
        state,
        file,
        createdAt: parsed.metadata.createdAt,
        method: parsed.method,
        ...(parsed.audit.author === undefined ? {} : { reviewedBy: parsed.audit.author }),
        ...(parsed.audit.note === undefined ? {} : { reviewNotes: parsed.audit.note }),
      };
    }

    if (isDirectorKnowledgeCandidateDocument(parsed)) {
      return {
        metadata: parsed.metadata,
        state,
        file,
        createdAt: parsed.audit.candidateAt,
        method: parsed.method,
        ...(parsed.audit.author === undefined ? {} : { reviewedBy: parsed.audit.author }),
        ...(parsed.audit.note === undefined ? {} : { reviewNotes: parsed.audit.note }),
      };
    }

    const metadata = this.parseLegacyMetadata(parsed);
    if (!metadata) {
      return null;
    }

    return {
      metadata,
      state,
      file,
      createdAt: metadata.createdAt,
    };
  }

  private parseLegacyMetadata(value: unknown): KnowledgePackMetadata | null {
    if (isKnowledgePackMetadata(value)) {
      return value;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "metadata" in value &&
      isKnowledgePackMetadata(value.metadata)
    ) {
      return value.metadata;
    }
    return null;
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  }

  private publishedPath(packId: string): string {
    return join(this.options.knowledgeDir, this.paths.published, `${packId}.json`);
  }

  private candidatePath(packId: string): string {
    return join(this.options.knowledgeDir, this.paths.candidate, `${packId}.json`);
  }

  private reviewDecisionPath(packId: string): string {
    return join(this.options.knowledgeDir, this.paths.review, `${packId}.json`);
  }

  private historyPath(packId: string, version: number): string {
    return join(this.options.knowledgeDir, this.paths.history, `${packId}.v${version}.json`);
  }

  private rollbackRecordPath(packId: string, version: number): string {
    return join(this.options.knowledgeDir, this.paths.rollback, `${packId}.v${version}.json`);
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
