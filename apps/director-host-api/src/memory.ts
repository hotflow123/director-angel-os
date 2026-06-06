import type { FileSystemDirectorMemoryStore } from "@hotflow/director-memory";
import type {
  DirectorMemoryRecallRequest,
  DirectorMemoryRecallResult,
  MemoryRecallPort,
} from "@hotflow/director-runtime";

export interface FileSystemDirectorMemoryRecallPortOptions {
  readonly store: FileSystemDirectorMemoryStore;
  readonly maxHits?: number;
}

export class FileSystemDirectorMemoryRecallPort implements MemoryRecallPort {
  private readonly maxHits: number;

  public constructor(private readonly options: FileSystemDirectorMemoryRecallPortOptions) {
    this.maxHits = options.maxHits ?? 3;
  }

  public async recall(request: DirectorMemoryRecallRequest): Promise<DirectorMemoryRecallResult> {
    const query = {
      projectId:
        request.workingContext.projectId ??
        request.workingContext.projectLabel ??
        request.workingContext.snapshotId,
      ...(request.workingContext.groupId === undefined
        ? {}
        : { groupId: request.workingContext.groupId }),
      anchorIds:
        request.workingContext.anchorIds.length > 0
          ? request.workingContext.anchorIds
          : request.recallHints.continuityAnchorIds,
      ...(request.workingContext.generationType === undefined
        ? {}
        : { generationType: request.workingContext.generationType }),
      ...(request.workingContext.generationStyle === undefined
        ? {}
        : { generationStyle: request.workingContext.generationStyle }),
      ...(request.recallHints.knowledgeSignalTags.length === 0
        ? {}
        : { knowledgeSignalTags: request.recallHints.knowledgeSignalTags }),
      maxHits: this.maxHits,
    } as const;

    const packet = await this.options.store.recall(query);

    return {
      status:
        packet.status === "ok" ? "hit" : packet.status === "disabled" ? "disabled" : packet.status,
      knowledgePacks: [],
      hits: packet.hits.map((hit) => ({
        recordId: hit.recordId,
        summary: hit.summary,
        status: hit.status,
        recordedAt: hit.recordedAt,
        score: hit.score,
        reasons: [...hit.reasons],
        selectedAdapters: [...hit.selectedAdapters],
        provenance: {
          runId: hit.provenance.runId,
          reportId: hit.provenance.reportId,
          observationIds: [...hit.provenance.observationIds],
        },
      })),
      notes: [...packet.notes],
    };
  }
}
