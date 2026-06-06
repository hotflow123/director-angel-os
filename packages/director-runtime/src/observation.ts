import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  DirectorMemoryRecallRequest,
  DirectorMemoryRecallResult,
  DirectorObservationEnvelope,
} from "./types.js";

type MaybePromise<T> = T | Promise<T>;

export interface MemoryRecallPort {
  recall(request: DirectorMemoryRecallRequest): MaybePromise<DirectorMemoryRecallResult>;
}

export interface LearningObservationSink {
  append(envelope: DirectorObservationEnvelope): MaybePromise<void>;
}

export interface AppendOnlyFileLearningObservationSinkOptions {
  readonly path: string;
}

export class NoopMemoryRecallPort implements MemoryRecallPort {
  public async recall(_request: DirectorMemoryRecallRequest): Promise<DirectorMemoryRecallResult> {
    return {
      status: "disabled",
      knowledgePacks: [],
      hits: [],
      notes: ["Memory recall is disabled in Director Angel Beta-1."],
    };
  }
}

export class NoopLearningSink implements LearningObservationSink {
  public async append(_envelope: DirectorObservationEnvelope): Promise<void> {}
}

export class AppendOnlyFileLearningObservationSink implements LearningObservationSink {
  public constructor(private readonly options: AppendOnlyFileLearningObservationSinkOptions) {}

  public async append(envelope: DirectorObservationEnvelope): Promise<void> {
    await mkdir(dirname(this.options.path), { recursive: true });
    await appendFile(this.options.path, `${JSON.stringify(envelope)}\n`, "utf8");
  }
}
