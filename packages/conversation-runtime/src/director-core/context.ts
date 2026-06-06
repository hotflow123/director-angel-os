import type {
  BindingPolicy,
  DirectorContext,
  DirectorExecutionIntent,
  DirectorFieldLock,
  DirectorGenerationStyle,
  DirectorKnowledgeSignal,
  DirectorProjectInfo,
  DirectorRuntimeCapabilities,
  RuntimeHealthStatus,
} from "@hotflow/director-core";

type DirectorSidecarGenerationType = "new" | "extend" | "edit";

export interface DirectorCoreSidecarSnapshot {
  requestId?: string;
  projectId: string;
  groupId: string;
  timestamp?: string;
  triggerSource?: "cli" | "api" | "shadow";
  project?: Partial<DirectorProjectInfo>;
  group?: {
    generationStyle?: DirectorGenerationStyle;
    generationType?: DirectorSidecarGenerationType;
    sceneCount?: number;
    anchorIds?: readonly string[];
    totalDurationSeconds?: number;
  };
  runtime?: Partial<DirectorRuntimeCapabilities>;
  intent?: Partial<DirectorExecutionIntent>;
  locks?: {
    lockedFields?: readonly DirectorFieldLock[];
  };
  knowledgeSignals?: readonly DirectorKnowledgeSignal[];
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readRuntimeStatus(value: unknown): RuntimeHealthStatus {
  return value === "degraded" || value === "offline" ? value : "ready";
}

function readBindingPolicy(value: unknown): BindingPolicy {
  return value === "auto" || value === "require" ? value : "prefer";
}

function readGenerationType(value: unknown): DirectorSidecarGenerationType {
  return value === "extend" || value === "edit" ? value : "new";
}

function readGenerationStyle(value: unknown): DirectorGenerationStyle | undefined {
  return value === "standard" || value === "immersive" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function createDirectorContextFromSidecarSnapshot(
  snapshot: DirectorCoreSidecarSnapshot,
): DirectorContext {
  const projectId = readString(snapshot.projectId, "unknown-project");
  const groupId = readString(snapshot.groupId, "unknown-group");
  const requestId = readString(snapshot.requestId, `${projectId}:${groupId}`);
  const timestamp = readString(snapshot.timestamp, new Date().toISOString());
  const availableBindings = readStringArray(snapshot.runtime?.availableBindings);
  const generationStyle = readGenerationStyle(snapshot.group?.generationStyle);

  return {
    request: {
      requestId,
      projectId,
      groupId,
      timestamp,
      triggerSource: snapshot.triggerSource ?? "api",
    },
    project: {
      ...(snapshot.project?.title === undefined ? {} : { title: snapshot.project.title }),
      ...(snapshot.project?.outline === undefined ? {} : { outline: snapshot.project.outline }),
      ...(snapshot.project?.genre === undefined ? {} : { genre: snapshot.project.genre }),
      continuityPriority: snapshot.project?.continuityPriority ?? "medium",
    },
    group: {
      groupId,
      generationType: readGenerationType(snapshot.group?.generationType),
      sceneCount: Math.max(1, Number(snapshot.group?.sceneCount ?? 1)),
      anchorIds: readStringArray(snapshot.group?.anchorIds),
      ...(generationStyle ? { generationStyle } : {}),
      ...(snapshot.group?.totalDurationSeconds === undefined
        ? {}
        : { totalDurationSeconds: snapshot.group.totalDurationSeconds }),
    },
    runtime: {
      runtimeId: readString(snapshot.runtime?.runtimeId, "conversation-runtime"),
      status: readRuntimeStatus(snapshot.runtime?.status),
      availableBindings,
      maxPromptChars: Math.max(1, Number(snapshot.runtime?.maxPromptChars ?? 4000)),
      supportsVideo: snapshot.runtime?.supportsVideo !== false,
      ...(snapshot.runtime?.deterministicMode === "safe" ||
      snapshot.runtime?.deterministicMode === "balanced"
        ? { deterministicMode: snapshot.runtime.deterministicMode }
        : {}),
    },
    intent: {
      bindingPolicy: readBindingPolicy(snapshot.intent?.bindingPolicy),
      ...(snapshot.intent?.preferredImageBinding === undefined
        ? {}
        : { preferredImageBinding: snapshot.intent.preferredImageBinding }),
      ...(snapshot.intent?.preferredVideoBinding === undefined
        ? {}
        : { preferredVideoBinding: snapshot.intent.preferredVideoBinding }),
      ...(snapshot.intent?.requiredImageBinding === undefined
        ? {}
        : { requiredImageBinding: snapshot.intent.requiredImageBinding }),
      ...(snapshot.intent?.requiredVideoBinding === undefined
        ? {}
        : { requiredVideoBinding: snapshot.intent.requiredVideoBinding }),
      ...(snapshot.intent?.fallbackBindings === undefined
        ? {}
        : { fallbackBindings: [...snapshot.intent.fallbackBindings] }),
    },
    ...(snapshot.locks?.lockedFields === undefined
      ? {}
      : { locks: { lockedFields: [...snapshot.locks.lockedFields] } }),
    ...(snapshot.knowledgeSignals === undefined
      ? {}
      : { knowledgeSignals: [...snapshot.knowledgeSignals] }),
  };
}
