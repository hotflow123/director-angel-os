import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { type ExecutionEvent, isExecutionEvent } from "@hotflow/director-execution-contracts";

export interface FileSystemEventLogOptions {
  readonly rootPath: string;
}

export class FileSystemEventLog {
  public constructor(private readonly options: FileSystemEventLogOptions) {}

  public async append(runId: string, event: ExecutionEvent): Promise<void> {
    const path = this.eventPath(runId);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  }

  public async read(runId: string): Promise<ExecutionEvent[]> {
    const path = this.eventPath(runId);
    try {
      const raw = await readFile(path, "utf8");
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown)
        .filter(isExecutionEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private eventPath(runId: string): string {
    return join(this.options.rootPath, runId, "events.ndjson");
  }
}
