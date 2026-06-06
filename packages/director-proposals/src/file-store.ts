import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type DirectorProposalAuditAction,
  type DirectorProposalAuditEvent,
  type DirectorProposalDecisionStatus,
  type DirectorProposalStoreStatus,
  type DirectorProposalTransitionResult,
  type DirectorProposalWriteResult,
  type DirectorTraceProposal,
  isDirectorTraceProposal,
} from "./types.js";

const DIRECTOR_PROPOSAL_INDEX_SCHEMA_VERSION = "director.proposal.index.v1" as const;

interface DirectorProposalIndexEntry {
  readonly proposalId: string;
  readonly kind: DirectorTraceProposal["kind"];
  readonly status: DirectorTraceProposal["status"];
  readonly projectId: string;
  readonly groupId: string;
  readonly title: string;
  readonly riskLevel: DirectorTraceProposal["riskLevel"];
  readonly confidence: number;
  readonly updatedAt: string;
}

interface DirectorProposalIndexDocument {
  readonly schemaVersion: typeof DIRECTOR_PROPOSAL_INDEX_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly entries: readonly DirectorProposalIndexEntry[];
}

export interface FileSystemDirectorProposalStoreOptions {
  readonly rootPath: string;
  readonly clock?: () => string;
}

export class FileSystemDirectorProposalStore {
  private readonly clock;

  public constructor(private readonly options: FileSystemDirectorProposalStoreOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async writeProposal(
    proposal: DirectorTraceProposal,
  ): Promise<DirectorProposalWriteResult> {
    if (!isDirectorTraceProposal(proposal)) {
      throw new Error("Cannot write an invalid DirectorTraceProposal.");
    }

    try {
      await this.writeJson(this.proposalPath(proposal.proposalId), proposal);

      const index = await this.loadIndex({ allowMissing: true });
      const nextEntries = new Map(index.entries.map((entry) => [entry.proposalId, entry]));
      nextEntries.set(proposal.proposalId, {
        proposalId: proposal.proposalId,
        kind: proposal.kind,
        status: proposal.status,
        projectId: proposal.projectId,
        groupId: proposal.groupId,
        title: proposal.title,
        riskLevel: proposal.riskLevel,
        confidence: proposal.confidence,
        updatedAt: proposal.updatedAt,
      });

      await this.writeJson(this.indexPath(), {
        schemaVersion: DIRECTOR_PROPOSAL_INDEX_SCHEMA_VERSION,
        updatedAt: this.clock(),
        entries: [...nextEntries.values()].sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.proposalId.localeCompare(right.proposalId),
        ),
      });

      return {
        status: "ok",
        proposalId: proposal.proposalId,
        notes: [`Stored Director proposal ${proposal.proposalId}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        proposalId: proposal.proposalId,
        notes: [`Director proposal write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async listProposals(): Promise<readonly DirectorTraceProposal[]> {
    const index = await this.loadIndex({ allowMissing: true });
    const proposals = await Promise.all(
      index.entries.map((entry) => this.getProposal(entry.proposalId)),
    );
    return proposals.filter((proposal): proposal is DirectorTraceProposal => proposal !== null);
  }

  public async getProposal(proposalId: string): Promise<DirectorTraceProposal | null> {
    try {
      const data = await readFile(this.proposalPath(proposalId), "utf8");
      const parsed = JSON.parse(data) as unknown;
      if (!isDirectorTraceProposal(parsed)) {
        throw new Error(`Director proposal ${proposalId} is invalid.`);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  public async getStatus(): Promise<DirectorProposalStoreStatus> {
    try {
      const index = await this.loadIndex({ allowMissing: true });
      return {
        status: "ok",
        proposalCount: index.entries.length,
        ...(index.entries[0] === undefined ? {} : { lastUpdatedAt: index.entries[0].updatedAt }),
        notes:
          index.entries.length > 0
            ? [`${index.entries.length} Director proposal(s) available.`]
            : ["No Director proposals stored yet."],
      };
    } catch (error) {
      return {
        status: "degraded",
        proposalCount: 0,
        notes: [`Director proposal status degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async transitionProposal(input: {
    readonly proposalId: string;
    readonly nextStatus: DirectorProposalDecisionStatus;
    readonly note?: string;
  }): Promise<DirectorProposalTransitionResult> {
    try {
      const proposal = await this.getProposal(input.proposalId);
      if (!proposal) {
        return {
          status: "degraded",
          proposalId: input.proposalId,
          nextStatus: input.nextStatus,
          notes: [`Unknown Director proposal: ${input.proposalId}.`],
        };
      }

      if (proposal.status !== "pending") {
        return {
          status: "degraded",
          proposalId: input.proposalId,
          previousStatus: proposal.status,
          nextStatus: input.nextStatus,
          notes: [`Director proposal ${input.proposalId} is already ${proposal.status}.`],
        };
      }

      const recordedAt = this.clock();
      const nextProposal: DirectorTraceProposal = {
        ...proposal,
        status: input.nextStatus,
        updatedAt: recordedAt,
        latestDecision: {
          decidedAt: recordedAt,
          decidedStatus: input.nextStatus,
          ...(input.note === undefined ? {} : { note: input.note }),
        },
      };
      const writeResult = await this.writeProposal(nextProposal);
      const auditResult = await this.appendAuditEvent({
        proposalId: input.proposalId,
        action: "decision",
        previousStatus: proposal.status,
        nextStatus: input.nextStatus,
        recordedAt,
        ...(input.note === undefined ? {} : { note: input.note }),
      });

      return {
        status: writeResult.status === "ok" && auditResult.status === "ok" ? "ok" : "degraded",
        proposalId: input.proposalId,
        previousStatus: proposal.status,
        nextStatus: input.nextStatus,
        recordedAt,
        notes: [
          `Director proposal ${input.proposalId} transitioned ${proposal.status} -> ${input.nextStatus}.`,
          ...writeResult.notes,
          ...auditResult.notes,
        ],
      };
    } catch (error) {
      return {
        status: "degraded",
        proposalId: input.proposalId,
        nextStatus: input.nextStatus,
        notes: [`Director proposal transition degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async appendAuditEvent(input: {
    readonly proposalId: string;
    readonly action: DirectorProposalAuditAction;
    readonly recordedAt?: string;
    readonly previousStatus?: DirectorProposalAuditEvent["previousStatus"];
    readonly nextStatus?: DirectorProposalAuditEvent["nextStatus"];
    readonly previewId?: string;
    readonly runId?: string;
    readonly reportId?: string;
    readonly note?: string;
  }): Promise<{
    readonly status: "ok" | "degraded";
    readonly notes: readonly string[];
  }> {
    try {
      await this.writeAuditEvent({
        proposalId: input.proposalId,
        action: input.action,
        recordedAt: input.recordedAt ?? this.clock(),
        ...(input.previousStatus === undefined ? {} : { previousStatus: input.previousStatus }),
        ...(input.nextStatus === undefined ? {} : { nextStatus: input.nextStatus }),
        ...(input.previewId === undefined ? {} : { previewId: input.previewId }),
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.reportId === undefined ? {} : { reportId: input.reportId }),
        ...(input.note === undefined ? {} : { note: input.note }),
      });

      return {
        status: "ok",
        notes: [`Recorded Director proposal audit action ${input.action} for ${input.proposalId}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        notes: [`Director proposal audit degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  private async loadIndex(options: {
    readonly allowMissing: boolean;
  }): Promise<DirectorProposalIndexDocument> {
    try {
      const data = await readFile(this.indexPath(), "utf8");
      const parsed = JSON.parse(data) as DirectorProposalIndexDocument;
      if (
        parsed.schemaVersion !== DIRECTOR_PROPOSAL_INDEX_SCHEMA_VERSION ||
        !Array.isArray(parsed.entries)
      ) {
        throw new Error("Index schema is invalid.");
      }
      return parsed;
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (options.allowMissing && errno.code === "ENOENT") {
        return {
          schemaVersion: DIRECTOR_PROPOSAL_INDEX_SCHEMA_VERSION,
          updatedAt: this.clock(),
          entries: [],
        };
      }
      throw new Error(`Failed to load Director proposal index: ${toErrorMessage(error)}`);
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

  private proposalPath(proposalId: string): string {
    return join(this.options.rootPath, "records", `${proposalId}.json`);
  }

  private auditPath(proposalId: string): string {
    return join(this.options.rootPath, "audits", `${proposalId}.ndjson`);
  }

  private async writeAuditEvent(
    input: Omit<DirectorProposalAuditEvent, "schemaVersion" | "auditId">,
  ): Promise<void> {
    const event: DirectorProposalAuditEvent = {
      schemaVersion: "director.proposal.audit.v1",
      auditId: `audit-${input.proposalId}-${Date.now()}`,
      ...input,
    };
    const path = this.auditPath(input.proposalId);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
