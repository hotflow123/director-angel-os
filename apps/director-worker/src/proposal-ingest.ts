import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isDirectorMemoryRecord } from "@hotflow/director-memory-contracts";
import {
  type DirectorProposalWriteResult,
  FileSystemDirectorProposalStore,
  generateDirectorProposalFromRecord,
} from "@hotflow/director-proposals";
import type { DirectorWorkspacePaths } from "@hotflow/director-workspace";

export interface DirectorProposalIngestResult {
  readonly status: "ok" | "degraded";
  readonly proposalId?: string;
  readonly notes: readonly string[];
}

export async function ingestDirectorTraceProposal(input: {
  readonly workspacePaths: DirectorWorkspacePaths;
  readonly recordId: string;
}): Promise<DirectorProposalIngestResult> {
  try {
    const record = await loadDirectorMemoryRecord(input.workspacePaths, input.recordId);
    const proposal = generateDirectorProposalFromRecord({
      record,
      provenance: "director-worker/proposal-ingest",
    });
    const store = new FileSystemDirectorProposalStore({
      rootPath: join(input.workspacePaths.runtime, "proposals"),
    });

    return normalizeWriteResult(await store.writeProposal(proposal));
  } catch (error) {
    return {
      status: "degraded",
      notes: [`Director proposal ingest degraded: ${toErrorMessage(error)}.`],
    };
  }
}

async function loadDirectorMemoryRecord(workspacePaths: DirectorWorkspacePaths, recordId: string) {
  const path = join(workspacePaths.runtime, "memory", "records", `${recordId}.json`);
  const data = await readFile(path, "utf8");
  const parsed = JSON.parse(data) as unknown;

  if (!isDirectorMemoryRecord(parsed)) {
    throw new Error(`Director memory record ${recordId} is invalid.`);
  }

  return parsed;
}

function normalizeWriteResult(result: DirectorProposalWriteResult): DirectorProposalIngestResult {
  return {
    status: result.status === "ok" ? "ok" : "degraded",
    proposalId: result.proposalId,
    notes: result.notes,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
