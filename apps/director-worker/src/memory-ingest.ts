import { join } from "node:path";

import type { ExecutionRunReport } from "@hotflow/director-execution-contracts";
import {
  type DirectorMemoryIngestResult,
  FileSystemDirectorMemoryIngestService,
  FileSystemDirectorMemoryStore,
} from "@hotflow/director-memory";
import type { DirectorWorkspacePaths } from "@hotflow/director-workspace";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "aborted"]);

export async function ingestDirectorRunMemory(input: {
  readonly workspacePaths: DirectorWorkspacePaths;
  readonly report: ExecutionRunReport;
}): Promise<DirectorMemoryIngestResult | null> {
  if (!TERMINAL_RUN_STATUSES.has(input.report.run.status)) {
    return null;
  }

  const memoryRoot = join(input.workspacePaths.runtime, "memory");
  const ingest = new FileSystemDirectorMemoryIngestService({
    store: new FileSystemDirectorMemoryStore({
      rootPath: memoryRoot,
    }),
    observationPath: join(input.workspacePaths.runtime, "observations.ndjson"),
    auditRootPath: join(memoryRoot, "ingest"),
  });

  try {
    return await ingest.ingestReport(input.report);
  } catch {
    return null;
  }
}
