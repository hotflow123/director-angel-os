import type {
  ExternalToolInvokeRequest,
  ExternalToolInvokeResult,
  ExternalToolRegistry,
} from "./external-tools.js";
import { invokeExternalTool } from "./external-tools.js";

const DEFAULT_MOYIN_TOOL_ID = "moyin.provider";
const DEFAULT_MOYIN_WATCH_HEARTBEAT_INTERVAL_MS = 30_000;

export type MoyinSealedTaskMediaKind = "image" | "video";
export type MoyinSealedTaskOrchestrationStatus =
  | "approval-required"
  | "completed"
  | "preview-failed"
  | "previewed"
  | "submit-failed"
  | "submitted"
  | "watch-failed";

export interface MoyinSealedTaskOrchestrationInput {
  readonly registry: ExternalToolRegistry;
  readonly mediaKind: MoyinSealedTaskMediaKind;
  readonly toolId?: string;
  readonly projectId?: string;
  readonly requestJson?: Readonly<Record<string, unknown>>;
  readonly requestPath?: string;
  readonly scratchDir?: string;
  readonly previewPath?: string;
  readonly submit?: boolean;
  readonly watch?: boolean;
  readonly watchTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly resumeToken?: string;
  readonly readArtifacts?: boolean;
  readonly artifactType?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly approval?: ExternalToolInvokeRequest["approval"];
  readonly sandboxPreflight?: ExternalToolInvokeRequest["sandboxPreflight"];
  readonly sandboxRuntimePolicy?: ExternalToolInvokeRequest["sandboxRuntimePolicy"];
  readonly sandboxPolicy?: ExternalToolInvokeRequest["sandboxPolicy"];
  readonly requestedNetworkPolicy?: ExternalToolInvokeRequest["requestedNetworkPolicy"];
  readonly onEvent?: (event: MoyinSealedTaskOrchestrationEvent) => void;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MoyinSealedTaskOrchestrationEvent {
  readonly kind:
    | "moyin.task.watch.completed"
    | "moyin.task.watch.failed"
    | "moyin.task.watch.heartbeat"
    | "moyin.task.watch.started"
    | "moyin.task.watch.timeout";
  readonly mediaKind: MoyinSealedTaskMediaKind;
  readonly projectId?: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
  readonly resumeToken?: string;
  readonly occurredAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MoyinSealedTaskOrchestrationError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface MoyinSealedTaskOrchestrationResult {
  readonly ok: boolean;
  readonly status: MoyinSealedTaskOrchestrationStatus;
  readonly mediaKind: MoyinSealedTaskMediaKind;
  readonly projectId?: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
  readonly preview: ExternalToolInvokeResult;
  readonly submit?: ExternalToolInvokeResult;
  readonly watch?: ExternalToolInvokeResult;
  readonly artifacts?: ExternalToolInvokeResult;
  readonly error?: MoyinSealedTaskOrchestrationError;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export async function orchestrateMoyinSealedTask(
  input: MoyinSealedTaskOrchestrationInput,
): Promise<MoyinSealedTaskOrchestrationResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const preview = await invokeExternalTool(input.registry, {
    toolId,
    operationId: input.mediaKind === "image" ? "sealed.image.preview" : "sealed.video.preview",
    args: createMoyinSealedPreviewArgs(input),
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: createMoyinSealedTaskMetadata(input, "preview"),
  });
  const sealedRequestId = readSealedRequestId(preview);
  const projectId = input.projectId ?? readProjectId(preview);
  if (!preview.ok || sealedRequestId === undefined) {
    return createMoyinSealedTaskResult(input, {
      status: "preview-failed",
      projectId,
      sealedRequestId,
      preview,
      error: {
        code: preview.error ?? "MOYIN_SEALED_PREVIEW_FAILED",
        message: preview.content,
        recoverable: true,
      },
    });
  }

  if (input.submit !== true) {
    return createMoyinSealedTaskResult(input, {
      status: "previewed",
      projectId,
      sealedRequestId,
      preview,
      metadata: {
        submitted: false,
      },
    });
  }

  const submit = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "sealed.submit",
    args: { sealedRequestId },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    ...(input.sandboxPreflight === undefined ? {} : { sandboxPreflight: input.sandboxPreflight }),
    ...(input.sandboxRuntimePolicy === undefined
      ? {}
      : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
    ...(input.sandboxPolicy === undefined ? {} : { sandboxPolicy: input.sandboxPolicy }),
    ...(input.requestedNetworkPolicy === undefined
      ? {}
      : { requestedNetworkPolicy: input.requestedNetworkPolicy }),
    metadata: createMoyinSealedTaskMetadata(input, "submit"),
  });
  const taskId = readTaskId(submit);
  if (!submit.ok) {
    return createMoyinSealedTaskResult(input, {
      status: submit.status === "approval-required" ? "approval-required" : "submit-failed",
      projectId,
      sealedRequestId,
      taskId,
      preview,
      submit,
      error: {
        code: submit.error ?? "MOYIN_SEALED_SUBMIT_FAILED",
        message: submit.content,
        recoverable: submit.status !== "permission-denied",
      },
      metadata: {
        submitted: false,
      },
    });
  }

  if (input.watch !== true || taskId === undefined) {
    return createMoyinSealedTaskResult(input, {
      status: "submitted",
      projectId,
      sealedRequestId,
      taskId,
      preview,
      submit,
      metadata: {
        submitted: true,
      },
    });
  }

  const watch = await invokeMoyinTaskWatchWithLifecycle({
    input,
    toolId,
    projectId,
    sealedRequestId,
    taskId,
  });
  if (!watch.ok) {
    return createMoyinSealedTaskResult(input, {
      status: "watch-failed",
      projectId,
      sealedRequestId,
      taskId,
      preview,
      submit,
      watch,
      error: {
        code: watch.error ?? "MOYIN_TASK_WATCH_FAILED",
        message: watch.content,
        recoverable: true,
      },
      metadata: {
        submitted: true,
        watched: false,
        ...createMoyinWatchLifecycleMetadata(input, watch),
      },
    });
  }

  const artifactRecovery =
    input.readArtifacts === true && projectId !== undefined
      ? await readMoyinSealedTaskArtifactsWithBackfill({
          input,
          toolId,
          projectId,
          taskId,
        })
      : undefined;

  return createMoyinSealedTaskResult(input, {
    status: "completed",
    projectId,
    sealedRequestId,
    taskId,
    preview,
    submit,
    watch,
    artifacts: artifactRecovery?.artifacts,
    metadata: {
      submitted: true,
      watched: true,
      ...createMoyinWatchLifecycleMetadata(input, watch),
      artifactsRead: artifactRecovery?.artifacts.ok === true,
      ...(artifactRecovery?.metadata ?? {}),
    },
  });
}

async function readMoyinSealedTaskArtifactsWithBackfill(input: {
  readonly input: MoyinSealedTaskOrchestrationInput;
  readonly toolId: string;
  readonly projectId: string;
  readonly taskId: string;
}): Promise<{
  readonly artifacts: ExternalToolInvokeResult;
  readonly metadata: Readonly<Record<string, unknown>>;
}> {
  const listed = await invokeExternalTool(input.input.registry, {
    toolId: input.toolId,
    operationId: "artifact.list",
    args: {
      projectId: input.projectId,
      type: input.input.artifactType ?? input.input.mediaKind,
    },
    ...(input.input.turnId === undefined ? {} : { turnId: input.input.turnId }),
    ...(input.input.sessionKey === undefined ? {} : { sessionKey: input.input.sessionKey }),
    metadata: createMoyinSealedTaskMetadata(input.input, "artifacts"),
  });
  const initialArtifactCount = readExternalToolArtifactCount(listed);
  if (!listed.ok || initialArtifactCount !== 0) {
    return {
      artifacts: listed,
      metadata: {
        ...(initialArtifactCount === undefined ? {} : { initialArtifactCount }),
        artifactBackfillAttempted: false,
      },
    };
  }

  const backfilled = await invokeExternalTool(input.input.registry, {
    toolId: input.toolId,
    operationId: "artifact.backfill",
    args: {
      projectId: input.projectId,
      taskId: input.taskId,
    },
    ...(input.input.turnId === undefined ? {} : { turnId: input.input.turnId }),
    ...(input.input.sessionKey === undefined ? {} : { sessionKey: input.input.sessionKey }),
    metadata: createMoyinSealedTaskMetadata(input.input, "artifact-backfill"),
  });
  const recoveredArtifactCount = readExternalToolArtifactCount(backfilled);
  return {
    artifacts: backfilled,
    metadata: {
      initialArtifactCount,
      artifactBackfillAttempted: true,
      artifactsBackfilled: backfilled.ok && (recoveredArtifactCount ?? 0) > 0,
      ...(recoveredArtifactCount === undefined ? {} : { recoveredArtifactCount }),
    },
  };
}

async function invokeMoyinTaskWatchWithLifecycle(input: {
  readonly input: MoyinSealedTaskOrchestrationInput;
  readonly toolId: string;
  readonly projectId?: string | undefined;
  readonly sealedRequestId?: string | undefined;
  readonly taskId: string;
}): Promise<ExternalToolInvokeResult> {
  const heartbeatIntervalMs = normalizeMoyinWatchHeartbeatIntervalMs(
    input.input.heartbeatIntervalMs,
  );
  const watchTimeoutMs = normalizePositiveInteger(input.input.watchTimeoutMs);
  emitMoyinSealedTaskEvent(input.input, {
    kind: "moyin.task.watch.started",
    mediaKind: input.input.mediaKind,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
    taskId: input.taskId,
    ...(input.input.resumeToken === undefined ? {} : { resumeToken: input.input.resumeToken }),
    metadata: {
      heartbeatIntervalMs,
      ...(watchTimeoutMs === undefined ? {} : { watchTimeoutMs }),
    },
  });

  const watchPromise = invokeExternalTool(input.input.registry, {
    toolId: input.toolId,
    operationId: "task.watch",
    args: {
      taskId: input.taskId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    },
    ...(input.input.turnId === undefined ? {} : { turnId: input.input.turnId }),
    ...(input.input.sessionKey === undefined ? {} : { sessionKey: input.input.sessionKey }),
    metadata: createMoyinSealedTaskMetadata(input.input, "watch"),
  });
  void watchPromise.catch(() => undefined);

  const heartbeat = setInterval(() => {
    emitMoyinSealedTaskEvent(input.input, {
      kind: "moyin.task.watch.heartbeat",
      mediaKind: input.input.mediaKind,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
      taskId: input.taskId,
      ...(input.input.resumeToken === undefined ? {} : { resumeToken: input.input.resumeToken }),
      metadata: {
        heartbeatIntervalMs,
        ...(watchTimeoutMs === undefined ? {} : { watchTimeoutMs }),
      },
    });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    const watch =
      watchTimeoutMs === undefined
        ? await watchPromise
        : await Promise.race([
            watchPromise,
            createMoyinTaskWatchTimeoutResult({
              input: input.input,
              toolId: input.toolId,
              taskId: input.taskId,
              projectId: input.projectId,
              timeoutMs: watchTimeoutMs,
            }),
          ]);
    emitMoyinSealedTaskEvent(input.input, {
      kind:
        watch.error === "MOYIN_TASK_WATCH_TIMEOUT"
          ? "moyin.task.watch.timeout"
          : watch.ok
            ? "moyin.task.watch.completed"
            : "moyin.task.watch.failed",
      mediaKind: input.input.mediaKind,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
      taskId: input.taskId,
      ...(input.input.resumeToken === undefined ? {} : { resumeToken: input.input.resumeToken }),
      metadata: {
        status: watch.status,
        ...(watch.error === undefined ? {} : { error: watch.error }),
      },
    });
    return watch;
  } finally {
    clearInterval(heartbeat);
  }
}

function createMoyinTaskWatchTimeoutResult(input: {
  readonly input: MoyinSealedTaskOrchestrationInput;
  readonly toolId: string;
  readonly taskId: string;
  readonly projectId?: string | undefined;
  readonly timeoutMs: number;
}): Promise<ExternalToolInvokeResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: false,
        status: "error",
        toolId: input.toolId,
        operationId: "task.watch",
        content: `Moyin task watch timed out after ${input.timeoutMs}ms.`,
        error: "MOYIN_TASK_WATCH_TIMEOUT",
        trace: [
          {
            stage: "moyin.watch.timeout",
            detail: "Moyin task watch exceeded the orchestration timeout.",
            metadata: {
              taskId: input.taskId,
              ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
              timeoutMs: input.timeoutMs,
              ...(input.input.resumeToken === undefined
                ? {}
                : { resumeToken: input.input.resumeToken }),
            },
          },
        ],
        metadata: {
          timeoutMs: input.timeoutMs,
          ...(input.input.resumeToken === undefined
            ? {}
            : { resumeToken: input.input.resumeToken }),
        },
      });
    }, input.timeoutMs);
  });
}

function createMoyinSealedPreviewArgs(
  input: MoyinSealedTaskOrchestrationInput,
): Readonly<Record<string, unknown>> {
  return {
    ...(input.requestJson === undefined ? {} : { requestJson: input.requestJson }),
    ...(input.requestPath === undefined ? {} : { file: input.requestPath }),
    ...(input.scratchDir === undefined ? {} : { scratchDir: input.scratchDir }),
    ...(input.previewPath === undefined ? {} : { out: input.previewPath }),
  };
}

function createMoyinSealedTaskResult(
  input: MoyinSealedTaskOrchestrationInput,
  result: {
    readonly status: MoyinSealedTaskOrchestrationStatus;
    readonly projectId?: string | undefined;
    readonly sealedRequestId?: string | undefined;
    readonly taskId?: string | undefined;
    readonly preview: ExternalToolInvokeResult;
    readonly submit?: ExternalToolInvokeResult | undefined;
    readonly watch?: ExternalToolInvokeResult | undefined;
    readonly artifacts?: ExternalToolInvokeResult | undefined;
    readonly error?: MoyinSealedTaskOrchestrationError | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
): MoyinSealedTaskOrchestrationResult {
  return {
    ok:
      result.status === "previewed" ||
      result.status === "submitted" ||
      result.status === "completed",
    status: result.status,
    mediaKind: input.mediaKind,
    ...(result.projectId === undefined ? {} : { projectId: result.projectId }),
    ...(result.sealedRequestId === undefined ? {} : { sealedRequestId: result.sealedRequestId }),
    ...(result.taskId === undefined ? {} : { taskId: result.taskId }),
    preview: result.preview,
    ...(result.submit === undefined ? {} : { submit: result.submit }),
    ...(result.watch === undefined ? {} : { watch: result.watch }),
    ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.sealed-task.orchestrator.v1",
      submitted: false,
      watched: false,
      artifactsRead: false,
      ...(result.metadata ?? {}),
    },
  };
}

function createMoyinSealedTaskMetadata(
  input: MoyinSealedTaskOrchestrationInput,
  phase: "artifact-backfill" | "artifacts" | "preview" | "submit" | "watch",
): Readonly<Record<string, unknown>> {
  return {
    ...(input.metadata ?? {}),
    orchestration: "moyin.sealed-task",
    orchestrationPhase: phase,
    mediaKind: input.mediaKind,
    ...(phase !== "watch" ? {} : createMoyinWatchLifecycleMetadata(input)),
  };
}

function createMoyinWatchLifecycleMetadata(
  input: MoyinSealedTaskOrchestrationInput,
  result?: ExternalToolInvokeResult,
): Readonly<Record<string, unknown>> {
  return {
    heartbeatIntervalMs: normalizeMoyinWatchHeartbeatIntervalMs(input.heartbeatIntervalMs),
    ...(input.watchTimeoutMs === undefined
      ? {}
      : { watchTimeoutMs: normalizePositiveInteger(input.watchTimeoutMs) }),
    ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
    ...(result?.error === "MOYIN_TASK_WATCH_TIMEOUT" ? { watchTimedOut: true } : {}),
  };
}

function emitMoyinSealedTaskEvent(
  input: MoyinSealedTaskOrchestrationInput,
  event: Omit<MoyinSealedTaskOrchestrationEvent, "occurredAtMs">,
): void {
  input.onEvent?.({
    ...event,
    occurredAtMs: Date.now(),
  });
}

function normalizeMoyinWatchHeartbeatIntervalMs(value: number | undefined): number {
  const normalized = normalizePositiveInteger(value);
  return normalized === undefined
    ? DEFAULT_MOYIN_WATCH_HEARTBEAT_INTERVAL_MS
    : Math.min(normalized, DEFAULT_MOYIN_WATCH_HEARTBEAT_INTERVAL_MS);
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readSealedRequestId(result: ExternalToolInvokeResult): string | undefined {
  const output = readRecord(result.output);
  const payload = readRecord(output?.output);
  return (
    readString(payload?.sealedRequestId) ??
    readString(readRecord(payload?.sealedRequest)?.sealedRequestId)
  );
}

function readProjectId(result: ExternalToolInvokeResult): string | undefined {
  const output = readRecord(result.output);
  const payload = readRecord(output?.output);
  return (
    readString(payload?.projectId) ?? readString(readRecord(payload?.sealedRequest)?.projectId)
  );
}

function readTaskId(result: ExternalToolInvokeResult): string | undefined {
  const output = readRecord(result.output);
  const payload = readRecord(output?.output);
  const task = readRecord(payload?.task);
  return (
    readString(payload?.taskId) ??
    readString(payload?.id) ??
    readString(task?.taskId) ??
    readString(task?.id)
  );
}

function readExternalToolArtifactCount(result: ExternalToolInvokeResult): number | undefined {
  if (result.artifacts !== undefined) {
    return result.artifacts.length;
  }
  const output = readRecord(result.output);
  const payload = readRecord(output?.output);
  const items = payload?.items;
  if (Array.isArray(items)) {
    return items.length;
  }
  const total = payload?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
