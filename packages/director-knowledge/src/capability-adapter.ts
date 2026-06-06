import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadDirectorSwitchState } from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";
import { SessionStore } from "@hotflow/sessions";
import {
  FileBackedSkillRepository,
  SkillManagementStore,
  SkillPromptIndex,
  SkillSnapshotFileStore,
  resolveApprovedSkillSnapshotPath,
  resolveSkillManagementPath,
} from "@hotflow/skills";

import {
  type BuildDirectorContextualRecallInput,
  type DirectorContextualRecallPacket,
  type DirectorLongTermMemorySignalLike,
  buildDirectorContextualRecall,
  truncateContextualRecallText,
} from "./contextual-recall.js";
import type { DirectorKnowledgeRecallQuery } from "./recall.js";
import { FileKnowledgeStore } from "./store.js";
import { type DirectorKnowledgePackDocument, isDirectorKnowledgePackDocument } from "./types.js";

export type DirectorCapabilitySurface =
  | "desktop-chat"
  | "weixin-chat"
  | "production"
  | "comfyui-workflow";

export interface DirectorCapabilityPolicy {
  readonly surface: DirectorCapabilitySurface;
  readonly defaultTags: readonly string[];
  readonly knowledgeMaxHits: number;
  readonly knowledgeMaxChars: number;
  readonly skillLimit: number;
  readonly skillMaxChars: number;
  readonly memoryMaxSignals: number;
  readonly memoryMaxChars: number;
  readonly includeGlobalExperience: boolean;
  readonly hiddenContext: true;
  readonly traceEnabled: true;
  readonly userVisible: "summary-only";
}

export interface ResolveDirectorCapabilityContextInput
  extends Omit<
    BuildDirectorContextualRecallInput,
    | "knowledgeQuery"
    | "maxKnowledgeHits"
    | "maxKnowledgeChars"
    | "maxSkillSignals"
    | "maxSkillChars"
    | "maxMemorySignals"
    | "maxMemoryChars"
  > {
  readonly surface: DirectorCapabilitySurface;
  readonly intentTags?: readonly string[];
  readonly knowledgeQuery?: DirectorKnowledgeRecallQuery;
  readonly workingMemoryRecall?: DirectorWorkingMemoryRecallBlockLike;
}

export interface DirectorCapabilityContextPacket extends DirectorContextualRecallPacket {
  readonly policy: DirectorCapabilityPolicy;
}

export interface ResolveDirectorWorkspaceCapabilityContextInput {
  readonly workspaceRoot: string;
  readonly dataDir?: string;
  readonly sessionDbPath?: string;
  readonly surface: DirectorCapabilitySurface;
  readonly userText: string;
  readonly availableTools?: readonly string[];
  readonly availableToolsets?: readonly string[];
  readonly intentTags?: readonly string[];
  readonly knowledgeQuery?: DirectorKnowledgeRecallQuery;
  readonly workingMemoryRecall?: DirectorWorkingMemoryRecallBlockLike;
  readonly additionalLongTermMemorySignals?: readonly DirectorLongTermMemorySignalLike[];
}

export interface ResolveDirectorWorkspaceCapabilityContextSyncInput
  extends ResolveDirectorWorkspaceCapabilityContextInput {
  readonly skillSections?: BuildDirectorContextualRecallInput["skillSections"];
}

export interface DirectorCapabilityKnowledgeSignal {
  readonly id: string;
  readonly description: string;
  readonly confidence: number;
  readonly tags: readonly string[];
}

export interface DirectorWorkingMemoryRecallBlockLike {
  readonly blockId: string;
  readonly source: "working-memory" | (string & {});
  readonly scope: Readonly<Record<string, unknown>>;
  readonly query?: string;
  readonly items: readonly DirectorWorkingMemoryRecallItemLike[];
  readonly degraded?: DirectorWorkingMemoryRecallDegradeLike;
}

export interface DirectorWorkingMemoryRecallItemLike {
  readonly id: string;
  readonly layer: "layer0" | "layer1" | (string & {});
  readonly content: string;
  readonly score: number;
  readonly updatedAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DirectorWorkingMemoryRecallDegradeLike {
  readonly reason: string;
  readonly message?: string;
}

export function resolveDirectorCapabilityContext(
  input: ResolveDirectorCapabilityContextInput,
): DirectorCapabilityContextPacket {
  const policy = resolveDirectorCapabilityPolicy(input.surface, input.intentTags ?? []);
  const knowledgeMaxHits = clampCapabilityLimit(
    input.knowledgeQuery?.maxHits,
    policy.knowledgeMaxHits,
  );
  const knowledgeMaxChars = clampCapabilityLimit(
    input.knowledgeQuery?.maxChars,
    policy.knowledgeMaxChars,
  );
  const memoryMerge = mergeDirectorMemorySignals({
    longTermMemorySignals: input.longTermMemorySignals ?? [],
    ...(input.workingMemoryRecall === undefined
      ? {}
      : { workingMemoryRecall: input.workingMemoryRecall }),
    ...(input.memoryDegradedMessage === undefined
      ? {}
      : { memoryDegradedMessage: input.memoryDegradedMessage }),
    maxSignals: policy.memoryMaxSignals,
    maxChars: policy.memoryMaxChars,
  });
  const packet = buildDirectorContextualRecall({
    ...input,
    knowledgeQuery: {
      ...(input.knowledgeQuery ?? {}),
      tags: uniqueCapabilityTags([
        ...policy.defaultTags,
        ...(input.knowledgeQuery?.tags ?? []),
        ...(input.intentTags ?? []),
      ]),
      includeGlobalExperience:
        input.knowledgeQuery?.includeGlobalExperience ?? policy.includeGlobalExperience,
      maxHits: knowledgeMaxHits,
      maxChars: knowledgeMaxChars,
    },
    maxKnowledgeHits: knowledgeMaxHits,
    maxKnowledgeChars: knowledgeMaxChars,
    maxSkillSignals: policy.skillLimit,
    maxSkillChars: policy.skillMaxChars,
    maxMemorySignals: policy.memoryMaxSignals,
    maxMemoryChars: policy.memoryMaxChars,
    longTermMemorySignals: memoryMerge.signals,
    ...(memoryMerge.degradedMessage === undefined
      ? {}
      : { memoryDegradedMessage: memoryMerge.degradedMessage }),
  });
  return {
    ...packet,
    policy,
  };
}

export function resolveDirectorWorkspaceCapabilityContextSync(
  input: ResolveDirectorWorkspaceCapabilityContextSyncInput,
): DirectorCapabilityContextPacket {
  const workspace = resolveDirectorWorkspace({ root: input.workspaceRoot });
  const switchState = loadDirectorSwitchState(join(workspace.runtime, "switches.json"));
  const policy = resolveDirectorCapabilityPolicy(input.surface, input.intentTags ?? []);
  const knowledgeEnabled = switchState.features["knowledgeRecall.enabled"] === true;
  const skillSections = input.skillSections ?? [];
  return resolveDirectorCapabilityContext({
    surface: input.surface,
    userText: input.userText,
    ...(input.intentTags === undefined ? {} : { intentTags: input.intentTags }),
    knowledgeDocuments: knowledgeEnabled
      ? readPublishedKnowledgeDocumentsSync(workspace.knowledge)
      : [],
    knowledgeEnabled,
    knowledgeQuery: {
      ...(input.knowledgeQuery ?? {}),
      includeGlobalExperience:
        input.knowledgeQuery?.includeGlobalExperience ?? policy.includeGlobalExperience,
    },
    skillSections,
    longTermMemorySignals:
      switchState.features["memory.enabled"] === true
        ? [
            ...readWorkspaceLongTermMemorySignals(workspace.root),
            ...(input.additionalLongTermMemorySignals ?? []),
          ]
        : [],
    ...(input.workingMemoryRecall === undefined || switchState.features["memory.enabled"] !== true
      ? {}
      : { workingMemoryRecall: input.workingMemoryRecall }),
  });
}

export function createDirectorCapabilityKnowledgeSignals(
  packet: DirectorCapabilityContextPacket,
): readonly DirectorCapabilityKnowledgeSignal[] {
  return [
    ...packet.knowledgeHits.map((hit) => ({
      id: `knowledge-pack:${hit.id}`,
      description: hit.title ?? hit.id,
      confidence: 0.86,
      tags: ["knowledge", "experience", packet.policy.surface],
    })),
    ...packet.skillHits.map((hit) => ({
      id: `skill:${hit.id}`,
      description: hit.title ?? hit.id,
      confidence: 0.82,
      tags: ["skill", hit.id, packet.policy.surface],
    })),
    ...packet.recallTrace
      .filter((trace) => trace.source === "memory" && trace.status === "hit")
      .map((trace) => ({
        id: `memory:${trace.id ?? "long-term"}`,
        description: trace.title ?? trace.id ?? "Long-term memory signal",
        confidence: 0.78,
        tags: ["memory", packet.policy.surface],
      })),
  ];
}

export async function resolveDirectorWorkspaceCapabilityContext(
  input: ResolveDirectorWorkspaceCapabilityContextInput,
): Promise<DirectorCapabilityContextPacket> {
  const workspace = resolveDirectorWorkspace({ root: input.workspaceRoot });
  const dataDir = input.dataDir ?? join(input.workspaceRoot, ".hotflow");
  const switchState = loadDirectorSwitchState(join(workspace.runtime, "switches.json"));
  const policy = resolveDirectorCapabilityPolicy(input.surface, input.intentTags ?? []);

  let knowledgeDocuments: readonly DirectorKnowledgePackDocument[] = [];
  let knowledgeDegradedMessage: string | undefined;
  const knowledgeEnabled = switchState.features["knowledgeRecall.enabled"] === true;
  if (knowledgeEnabled) {
    try {
      knowledgeDocuments = await new FileKnowledgeStore({
        knowledgeDir: workspace.knowledge,
      }).listPublishedDocuments();
    } catch (error) {
      knowledgeDegradedMessage = toCapabilityAdapterErrorMessage(error);
    }
  }

  let skillSections: BuildDirectorContextualRecallInput["skillSections"] = [];
  let skillDegradedMessage: string | undefined;
  try {
    const skillManagementStore = new SkillManagementStore(resolveSkillManagementPath({ dataDir }));
    const disabledSkillIds = new Set(skillManagementStore.readDocument().disabledSkillIds);
    skillSections = new SkillPromptIndex(
      new FileBackedSkillRepository(
        new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir })),
      ),
      {
        isSkillEnabled: (skill) => !disabledSkillIds.has(skill.id),
      },
    ).buildSections({
      userText: input.userText,
      ...(input.availableTools === undefined ? {} : { availableTools: input.availableTools }),
      ...(input.availableToolsets === undefined
        ? {}
        : { availableToolsets: input.availableToolsets }),
      limit: policy.skillLimit,
    });
  } catch (error) {
    skillDegradedMessage = toCapabilityAdapterErrorMessage(error);
  }

  let longTermMemorySignals: readonly DirectorLongTermMemorySignalLike[] = [];
  let memoryDegradedMessage: string | undefined;
  if (switchState.features["memory.enabled"] === true) {
    try {
      longTermMemorySignals = [
        ...readWorkspaceLongTermMemorySignals(workspace.root),
        ...(input.additionalLongTermMemorySignals ?? []),
        ...readWorkspaceSessionArchiveMemorySignals({
          dataDir,
          ...(input.sessionDbPath === undefined ? {} : { sessionDbPath: input.sessionDbPath }),
          userText: input.userText,
          maxSignals: policy.memoryMaxSignals,
          maxChars: policy.memoryMaxChars,
        }),
      ];
    } catch (error) {
      memoryDegradedMessage = toCapabilityAdapterErrorMessage(error);
    }
  }

  return resolveDirectorCapabilityContext({
    surface: input.surface,
    userText: input.userText,
    ...(input.intentTags === undefined ? {} : { intentTags: input.intentTags }),
    knowledgeDocuments,
    knowledgeEnabled,
    ...(knowledgeDegradedMessage === undefined ? {} : { knowledgeDegradedMessage }),
    knowledgeQuery: {
      ...(input.knowledgeQuery ?? {}),
      includeGlobalExperience:
        input.knowledgeQuery?.includeGlobalExperience ?? policy.includeGlobalExperience,
    },
    skillSections,
    ...(skillDegradedMessage === undefined ? {} : { skillDegradedMessage }),
    longTermMemorySignals,
    ...(input.workingMemoryRecall === undefined || switchState.features["memory.enabled"] !== true
      ? {}
      : { workingMemoryRecall: input.workingMemoryRecall }),
    ...(memoryDegradedMessage === undefined ? {} : { memoryDegradedMessage }),
  });
}

export function resolveDirectorCapabilityPolicy(
  surface: DirectorCapabilitySurface,
  intentTags: readonly string[] = [],
): DirectorCapabilityPolicy {
  const base = {
    surface,
    defaultTags: uniqueCapabilityTags([...defaultTagsForSurface(surface), ...intentTags]),
    hiddenContext: true,
    traceEnabled: true,
    userVisible: "summary-only" as const,
  } as const;
  if (surface === "production") {
    return {
      ...base,
      knowledgeMaxHits: 5,
      knowledgeMaxChars: 1_400,
      skillLimit: 5,
      skillMaxChars: 720,
      memoryMaxSignals: 4,
      memoryMaxChars: 420,
      includeGlobalExperience: true,
    };
  }
  if (surface === "weixin-chat") {
    return {
      ...base,
      knowledgeMaxHits: 2,
      knowledgeMaxChars: 700,
      skillLimit: 2,
      skillMaxChars: 420,
      memoryMaxSignals: 2,
      memoryMaxChars: 220,
      includeGlobalExperience: true,
    };
  }
  if (surface === "comfyui-workflow") {
    return {
      ...base,
      knowledgeMaxHits: 4,
      knowledgeMaxChars: 1_200,
      skillLimit: 4,
      skillMaxChars: 650,
      memoryMaxSignals: 3,
      memoryMaxChars: 320,
      includeGlobalExperience: true,
    };
  }
  return {
    ...base,
    knowledgeMaxHits: 3,
    knowledgeMaxChars: 900,
    skillLimit: 3,
    skillMaxChars: 520,
    memoryMaxSignals: 3,
    memoryMaxChars: 320,
    includeGlobalExperience: true,
  };
}

function defaultTagsForSurface(surface: DirectorCapabilitySurface): readonly string[] {
  if (surface === "production") {
    return ["production", "workflow"];
  }
  if (surface === "comfyui-workflow") {
    return ["comfyui", "script", "image", "video", "workflow"];
  }
  return ["chat"];
}

function uniqueCapabilityTags(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function clampCapabilityLimit(value: number | undefined, policyMax: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return policyMax;
  }
  return Math.min(policyMax, Math.max(0, Math.trunc(value)));
}

function readWorkspaceLongTermMemorySignals(
  directorRoot: string,
): readonly DirectorLongTermMemorySignalLike[] {
  const memoryDir = join(directorRoot, "memory");
  return [
    readWorkspaceLongTermMemorySignal(join(memoryDir, "MEMORY.md"), "long-term-memory:memory"),
    readWorkspaceLongTermMemorySignal(join(memoryDir, "USER.md"), "long-term-memory:user"),
  ].filter((item): item is DirectorLongTermMemorySignalLike => item !== null);
}

function readWorkspaceSessionArchiveMemorySignals(input: {
  readonly dataDir: string;
  readonly sessionDbPath?: string;
  readonly userText: string;
  readonly maxSignals: number;
  readonly maxChars: number;
}): readonly DirectorLongTermMemorySignalLike[] {
  const sessionDbPath = input.sessionDbPath ?? join(input.dataDir, "sessions", "sessions.sqlite");
  if (!existsSync(sessionDbPath)) {
    return [];
  }
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    return store
      .search({
        query: input.userText,
        limit: input.maxSignals,
        status: "all",
      })
      .hits.map((hit) => ({
        id: `session-search:${hit.session.sessionId}:${hit.entry?.seq ?? hit.source}`,
        description: truncateContextualRecallText(
          [
            "Session archive:",
            readSessionArchiveTitle(hit.session.metadata),
            hit.entry?.turnId ? `turn ${hit.entry.turnId}` : "",
            hit.matchedText,
          ]
            .filter((part) => part.length > 0)
            .join(" | "),
          input.maxChars,
        ),
      }));
  } finally {
    store.close();
  }
}

function mergeDirectorMemorySignals(input: {
  readonly longTermMemorySignals: readonly DirectorLongTermMemorySignalLike[];
  readonly workingMemoryRecall?: DirectorWorkingMemoryRecallBlockLike;
  readonly memoryDegradedMessage?: string;
  readonly maxSignals: number;
  readonly maxChars: number;
}): {
  readonly signals: readonly DirectorLongTermMemorySignalLike[];
  readonly degradedMessage?: string;
} {
  const workingMemory = input.workingMemoryRecall;
  const workingSignals =
    workingMemory === undefined
      ? []
      : workingMemory.items.map((item) =>
          mapWorkingMemoryRecallItemToDirectorMemorySignal(item, workingMemory, input.maxChars),
        );
  const degradedMessages = [
    input.memoryDegradedMessage,
    ...(workingMemory?.degraded === undefined
      ? []
      : [renderWorkingMemoryDegradeReason(workingMemory.degraded)]),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const retainedWorkingSignals = workingSignals.slice(0, input.maxSignals);
  const remainingSignalSlots = Math.max(0, input.maxSignals - retainedWorkingSignals.length);

  return {
    signals: [
      ...retainedWorkingSignals,
      ...input.longTermMemorySignals.slice(0, remainingSignalSlots),
    ],
    ...(degradedMessages.length === 0 ? {} : { degradedMessage: degradedMessages.join(" | ") }),
  };
}

function mapWorkingMemoryRecallItemToDirectorMemorySignal(
  item: DirectorWorkingMemoryRecallItemLike,
  block: DirectorWorkingMemoryRecallBlockLike,
  maxChars: number,
): DirectorLongTermMemorySignalLike {
  const retrieval = buildWorkingMemoryRetrievalTrace(item, block);
  const source =
    readWorkingMemoryMetadataString(item, "source") ??
    (item.id.startsWith("mempalace:") ? "mempalace" : block.source);
  const matchMode = readWorkingMemoryMetadataString(item, "matchMode");
  const wing = readWorkingMemoryMetadataString(item, "wing");
  const room = readWorkingMemoryMetadataString(item, "room");
  const memoryLayer = readWorkingMemoryMetadataString(item, "memoryLayer");
  const layerLabel = readWorkingMemoryMetadataString(item, "layerLabel");
  const verbatim = normalizeWorkingMemoryVerbatimText(
    readWorkingMemoryMetadataString(item, "verbatimExcerpt") ??
      readWorkingMemoryMetadataString(item, "verbatim"),
  );
  const sourcePointer = renderWorkingMemorySourcePointer(item);
  const memoryText =
    verbatim === undefined
      ? item.content
      : [`原文片段：${verbatim}`, sourcePointer === undefined ? "" : `来源指针：${sourcePointer}`]
          .filter((value) => value.length > 0)
          .join(" ");
  return {
    id: `working-memory:${item.id}`,
    description: truncateContextualRecallText(
      [
        "Working memory:",
        memoryText,
        `source=${source}`,
        `layer=${item.layer}`,
        `score=${item.score}`,
        matchMode === undefined ? "" : `matchMode=${matchMode}`,
        memoryLayer === undefined ? "" : `memoryLayer=${memoryLayer}`,
        layerLabel === undefined ? "" : `layerLabel=${layerLabel}`,
        wing === undefined ? "" : `wing=${wing}`,
        room === undefined ? "" : `room=${room}`,
      ].join(" "),
      maxChars,
    ),
    score: item.score,
    ...(block.query === undefined ? {} : { query: block.query }),
    ...(matchMode === undefined ? {} : { matchMode }),
    ...(memoryLayer === undefined ? {} : { memoryLayer }),
    ...(verbatim === undefined
      ? {}
      : {
          retrievalMode: "verbatim-first",
          verbatimExcerpt: truncateContextualRecallText(verbatim, maxChars),
        }),
    ...(retrieval === undefined ? {} : { retrieval }),
  };
}

function renderWorkingMemorySourcePointer(
  item: DirectorWorkingMemoryRecallItemLike,
): string | undefined {
  const sourceFile = readWorkingMemoryMetadataString(item, "sourceFile");
  const wing = readWorkingMemoryMetadataString(item, "wing");
  const room = readWorkingMemoryMetadataString(item, "room");
  const drawerIndex = readWorkingMemoryMetadataNumber(item, "drawerIndex");
  const totalDrawers = readWorkingMemoryMetadataNumber(item, "totalDrawers");
  const parts = [
    sourceFile === undefined ? "" : `sourceFile=${sourceFile}`,
    wing === undefined ? "" : `wing=${wing}`,
    room === undefined ? "" : `room=${room}`,
    drawerIndex === undefined
      ? ""
      : `drawer=${drawerIndex}${totalDrawers === undefined ? "" : `/${totalDrawers}`}`,
  ].filter((value) => value.length > 0);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function buildWorkingMemoryRetrievalTrace(
  item: DirectorWorkingMemoryRecallItemLike,
  block: DirectorWorkingMemoryRecallBlockLike,
): Readonly<Record<string, unknown>> | undefined {
  const metadata = item.metadata ?? {};
  const trace: Record<string, unknown> = {
    provider:
      readWorkingMemoryMetadataString(item, "source") ??
      (item.id.startsWith("mempalace:") ? "mempalace" : block.source),
    blockId: block.blockId,
    layer: item.layer,
    updatedAt: item.updatedAt,
    scope: { ...block.scope },
  };
  for (const key of [
    "matchMode",
    "vectorSimilarity",
    "lexicalScore",
    "bm25Score",
    "distance",
    "effectiveDistance",
    "closetBoost",
    "wing",
    "room",
    "sourceFile",
    "memoryLayer",
    "layerLabel",
    "drawerIndex",
    "totalDrawers",
    "providerId",
    "providerKind",
    "directStoreAccessAllowed",
  ]) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      trace[key] = value;
    }
  }
  return Object.keys(trace).length > 0 ? trace : undefined;
}

function readWorkingMemoryMetadataString(
  item: DirectorWorkingMemoryRecallItemLike,
  key: string,
): string | undefined {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeWorkingMemoryVerbatimText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? undefined : normalized;
}

function readWorkingMemoryMetadataNumber(
  item: DirectorWorkingMemoryRecallItemLike,
  key: string,
): number | undefined {
  const value = item.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function renderWorkingMemoryDegradeReason(
  degraded: DirectorWorkingMemoryRecallDegradeLike,
): string {
  return degraded.message === undefined
    ? degraded.reason
    : `${degraded.reason}: ${degraded.message}`;
}

function readPublishedKnowledgeDocumentsSync(
  knowledgeDir: string,
): readonly DirectorKnowledgePackDocument[] {
  const publishedDir = join(knowledgeDir, "published");
  if (!existsSync(publishedDir)) {
    return [];
  }
  return readdirSync(publishedDir)
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((file) => {
      try {
        const parsed = JSON.parse(readFileSync(join(publishedDir, file), "utf8")) as unknown;
        return isDirectorKnowledgePackDocument(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function readWorkspaceLongTermMemorySignal(
  path: string,
  id: string,
): DirectorLongTermMemorySignalLike | null {
  if (!existsSync(path)) {
    return null;
  }
  const compact = compactWorkspaceMarkdownMemory(readFileSync(path, "utf8"));
  if (compact.length === 0) {
    return null;
  }
  return { id, description: compact };
}

function compactWorkspaceMarkdownMemory(content: string): string {
  return truncateContextualRecallText(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .join(" § "),
    900,
  );
}

function readSessionArchiveTitle(metadata: Readonly<Record<string, unknown>>): string {
  const title = metadata.title;
  return typeof title === "string" ? title : "";
}

function toCapabilityAdapterErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
