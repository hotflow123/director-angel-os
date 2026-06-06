import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  getKnowledgeEventsPath,
  getKnowledgeItemMetaPath,
  getKnowledgeItemsDir,
  getKnowledgePublishedCurrentPath,
  getKnowledgePublishedHistoryPath,
  getKnowledgeRegistryPath,
  getKnowledgeRevisionPath,
  getKnowledgeRevisionsDir,
  getKnowledgeRootDir,
} from "./paths.js";

export type ConversationRuntimeKnowledgeSource = "builtin" | "external";
export type ConversationRuntimeKnowledgeRevisionStatus =
  | "draft"
  | "reviewed"
  | "published"
  | "archived"
  | "disabled";

export interface ConversationRuntimeKnowledgeEvidenceRef {
  label: string;
  source?: string | null;
  url?: string | null;
  note?: string | null;
}

export interface ConversationRuntimePromptKnowledgeBundle {
  bundleId: string;
  itemId: string;
  revisionId: string;
  title: string;
  description?: string | null | undefined;
  adapterId: string;
  modelAdapterId: string;
  executionProfileIds: string[];
  status: string;
  source: ConversationRuntimeKnowledgeSource;
  tags?: string[] | undefined;
  metadata?:
    | (Record<string, unknown> & {
        evidence?: ConversationRuntimeKnowledgeEvidenceRef[];
      })
    | undefined;
  fieldSchema: unknown[];
  layers: Array<{
    id: string;
    label: string;
    category: string;
    description: string;
    directives: string[];
    fieldKeys?: string[] | undefined;
    notes?: string[] | undefined;
    tags?: string[] | undefined;
  }>;
  defaultUserLayerIds?: string[] | undefined;
  inferenceRules?: unknown[] | undefined;
  template: {
    header: string;
    body?: string | undefined;
    footer?: string | undefined;
  };
  publishedAt?: string | null | undefined;
}

export interface ConversationRuntimeKnowledgeItemMeta {
  itemId: string;
  bundleId: string;
  title: string;
  status: ConversationRuntimeKnowledgeRevisionStatus;
  latestRevisionId: string;
  publishedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRuntimeKnowledgeRevisionRecord
  extends ConversationRuntimePromptKnowledgeBundle {
  status: ConversationRuntimeKnowledgeRevisionStatus;
  source: "external";
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  score: number | null;
  reviewNotes: string[] | null;
  sourcePath: string | null;
}

export type ConversationRuntimeKnowledgeEventType = "imported" | "reviewed" | "published";

export interface ConversationRuntimeKnowledgeEvent {
  eventId: string;
  type: ConversationRuntimeKnowledgeEventType;
  itemId: string;
  revisionId: string;
  occurredAt: string;
  actor: string | null;
  notes: string[];
}

export interface ConversationRuntimeKnowledgeImportResult {
  item: ConversationRuntimeKnowledgeItemMeta;
  revision: ConversationRuntimeKnowledgeRevisionRecord;
  event: ConversationRuntimeKnowledgeEvent;
}

export interface ConversationRuntimeKnowledgeHistoryResult {
  item: ConversationRuntimeKnowledgeItemMeta | null;
  revisions: ConversationRuntimeKnowledgeRevisionRecord[];
  published: ConversationRuntimePromptKnowledgeBundle | null;
  events: ConversationRuntimeKnowledgeEvent[];
}

interface KnowledgeRegistryFile {
  version: 1;
  items: ConversationRuntimeKnowledgeItemMeta[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonLine(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function normalizeNotes(notes?: string[] | null): string[] {
  return dedupeStrings((notes ?? []).map((note) => note.trim()).filter(Boolean));
}

function validateBundle(bundle: ConversationRuntimePromptKnowledgeBundle): void {
  const errors: string[] = [];
  if (!bundle.bundleId?.trim()) errors.push("bundleId is required.");
  if (!bundle.itemId?.trim()) errors.push("itemId is required.");
  if (!bundle.revisionId?.trim()) errors.push("revisionId is required.");
  if (!bundle.title?.trim()) errors.push("title is required.");
  if (!bundle.adapterId?.trim()) errors.push("adapterId is required.");
  if (!bundle.modelAdapterId?.trim()) errors.push("modelAdapterId is required.");
  if (!Array.isArray(bundle.executionProfileIds) || bundle.executionProfileIds.length === 0) {
    errors.push("executionProfileIds must contain at least one profile.");
  }
  if (!Array.isArray(bundle.layers) || bundle.layers.length === 0) {
    errors.push("layers must contain at least one layer.");
  }
  if (!bundle.template?.header?.trim()) errors.push("template.header is required.");
  if (errors.length > 0) {
    throw new Error(`Invalid knowledge bundle: ${errors.join(" ")}`);
  }
}

function toRevisionRecord(params: {
  bundle: ConversationRuntimePromptKnowledgeBundle;
  status: ConversationRuntimeKnowledgeRevisionStatus;
  actor?: string | null;
  sourcePath?: string | null;
  createdAt?: string;
  updatedAt?: string;
  reviewNotes?: string[] | null;
  score?: number | null;
}): ConversationRuntimeKnowledgeRevisionRecord {
  const createdAt = params.createdAt ?? nowIso();
  return {
    ...params.bundle,
    status: params.status,
    source: "external",
    publishedAt: params.bundle.publishedAt?.trim() ? params.bundle.publishedAt : createdAt,
    createdAt,
    updatedAt: params.updatedAt ?? createdAt,
    createdBy: params.actor ?? null,
    score: params.score ?? null,
    reviewNotes: params.reviewNotes ?? null,
    sourcePath: params.sourcePath ?? null,
  };
}

function toPublishedBundle(
  revision: ConversationRuntimeKnowledgeRevisionRecord,
): ConversationRuntimePromptKnowledgeBundle {
  return {
    bundleId: revision.bundleId,
    itemId: revision.itemId,
    revisionId: revision.revisionId,
    title: revision.title,
    description: revision.description ?? null,
    adapterId: revision.adapterId,
    modelAdapterId: revision.modelAdapterId,
    executionProfileIds: revision.executionProfileIds,
    status: "published",
    source: "external",
    tags: revision.tags ?? [],
    metadata: revision.metadata,
    fieldSchema: revision.fieldSchema,
    layers: revision.layers,
    defaultUserLayerIds: revision.defaultUserLayerIds ?? [],
    inferenceRules: revision.inferenceRules ?? [],
    template: revision.template,
    publishedAt: nowIso(),
  };
}

function readRegistry(): KnowledgeRegistryFile {
  return readJsonFile<KnowledgeRegistryFile>(getKnowledgeRegistryPath(), { version: 1, items: [] });
}

function writeRegistry(registry: KnowledgeRegistryFile): void {
  writeJsonFile(getKnowledgeRegistryPath(), registry);
}

function appendKnowledgeEvent(params: {
  type: ConversationRuntimeKnowledgeEventType;
  itemId: string;
  revisionId: string;
  actor?: string | null;
  notes?: string[] | null;
}): ConversationRuntimeKnowledgeEvent {
  const event: ConversationRuntimeKnowledgeEvent = {
    eventId: randomUUID(),
    type: params.type,
    itemId: params.itemId,
    revisionId: params.revisionId,
    occurredAt: nowIso(),
    actor: params.actor ?? null,
    notes: normalizeNotes(params.notes),
  };
  appendJsonLine(getKnowledgeEventsPath(), event);
  return event;
}

function readItemMeta(itemId: string): ConversationRuntimeKnowledgeItemMeta | null {
  const item = readJsonFile<ConversationRuntimeKnowledgeItemMeta | null>(
    getKnowledgeItemMetaPath(itemId),
    null,
  );
  return item?.itemId === itemId ? item : null;
}

function writeItemMeta(item: ConversationRuntimeKnowledgeItemMeta): void {
  writeJsonFile(getKnowledgeItemMetaPath(item.itemId), item);
  const registry = readRegistry();
  const items = registry.items.filter((entry) => entry.itemId !== item.itemId);
  items.push(item);
  items.sort((left, right) => left.title.localeCompare(right.title));
  writeRegistry({ version: 1, items });
}

function readRevision(
  itemId: string,
  revisionId: string,
): ConversationRuntimeKnowledgeRevisionRecord | null {
  const revision = readJsonFile<ConversationRuntimeKnowledgeRevisionRecord | null>(
    getKnowledgeRevisionPath(itemId, revisionId),
    null,
  );
  return revision?.itemId === itemId && revision.revisionId === revisionId ? revision : null;
}

function writeRevision(revision: ConversationRuntimeKnowledgeRevisionRecord): void {
  writeJsonFile(getKnowledgeRevisionPath(revision.itemId, revision.revisionId), revision);
}

export function importKnowledgeBundle(input: {
  bundle: ConversationRuntimePromptKnowledgeBundle;
  actor?: string | null;
  sourcePath?: string | null;
  notes?: string[] | null;
}): ConversationRuntimeKnowledgeImportResult {
  validateBundle(input.bundle);
  if (readRevision(input.bundle.itemId, input.bundle.revisionId)) {
    throw new Error(
      `Knowledge revision already exists: ${input.bundle.itemId}/${input.bundle.revisionId}`,
    );
  }

  const previous = readItemMeta(input.bundle.itemId);
  const timestamp = nowIso();
  const revision = toRevisionRecord({
    bundle: input.bundle,
    status: "draft",
    actor: input.actor ?? null,
    sourcePath: input.sourcePath ?? null,
    createdAt: timestamp,
  });
  const item: ConversationRuntimeKnowledgeItemMeta = {
    itemId: input.bundle.itemId,
    bundleId: input.bundle.bundleId,
    title: input.bundle.title,
    status: "draft",
    latestRevisionId: input.bundle.revisionId,
    publishedRevisionId: previous?.publishedRevisionId ?? null,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const event = appendKnowledgeEvent({
    type: "imported",
    itemId: input.bundle.itemId,
    revisionId: input.bundle.revisionId,
    actor: input.actor ?? null,
    notes: input.notes ?? null,
  });

  writeRevision(revision);
  writeItemMeta(item);
  return { item, revision, event };
}

export function harvestKnowledgeBundle(input: {
  bundle: ConversationRuntimePromptKnowledgeBundle;
  actor?: string | null;
  sourcePath?: string | null;
  notes?: string[] | null;
}): ConversationRuntimeKnowledgeImportResult {
  return importKnowledgeBundle(input);
}

export function reviewKnowledgeRevision(input: {
  itemId: string;
  revisionId: string;
  actor?: string | null;
  score?: number | null;
  reviewNotes?: string[] | null;
}): {
  item: ConversationRuntimeKnowledgeItemMeta;
  revision: ConversationRuntimeKnowledgeRevisionRecord;
  event: ConversationRuntimeKnowledgeEvent;
} {
  const revision = readRevision(input.itemId, input.revisionId);
  if (!revision) {
    throw new Error(`Knowledge revision not found: ${input.itemId}/${input.revisionId}`);
  }

  const updated: ConversationRuntimeKnowledgeRevisionRecord = {
    ...revision,
    status: "reviewed",
    updatedAt: nowIso(),
    score: input.score ?? revision.score,
    reviewNotes: normalizeNotes(input.reviewNotes ?? revision.reviewNotes),
  };
  const previous = readItemMeta(input.itemId);
  const item: ConversationRuntimeKnowledgeItemMeta = {
    itemId: updated.itemId,
    bundleId: updated.bundleId,
    title: updated.title,
    status: "reviewed",
    latestRevisionId: updated.revisionId,
    publishedRevisionId: previous?.publishedRevisionId ?? null,
    createdAt: previous?.createdAt ?? updated.createdAt,
    updatedAt: updated.updatedAt,
  };
  const event = appendKnowledgeEvent({
    type: "reviewed",
    itemId: updated.itemId,
    revisionId: updated.revisionId,
    actor: input.actor ?? null,
    notes: updated.reviewNotes,
  });

  writeRevision(updated);
  writeItemMeta(item);
  return { item, revision: updated, event };
}

export function publishKnowledgeRevision(input: {
  itemId: string;
  revisionId: string;
  actor?: string | null;
  notes?: string[] | null;
}): {
  item: ConversationRuntimeKnowledgeItemMeta;
  revision: ConversationRuntimeKnowledgeRevisionRecord;
  published: ConversationRuntimePromptKnowledgeBundle;
  event: ConversationRuntimeKnowledgeEvent;
} {
  const revision = readRevision(input.itemId, input.revisionId);
  if (!revision) {
    throw new Error(`Knowledge revision not found: ${input.itemId}/${input.revisionId}`);
  }

  const updated: ConversationRuntimeKnowledgeRevisionRecord = {
    ...revision,
    status: "published",
    updatedAt: nowIso(),
  };
  const previous = readItemMeta(input.itemId);
  const item: ConversationRuntimeKnowledgeItemMeta = {
    itemId: updated.itemId,
    bundleId: updated.bundleId,
    title: updated.title,
    status: "published",
    latestRevisionId: updated.revisionId,
    publishedRevisionId: updated.revisionId,
    createdAt: previous?.createdAt ?? updated.createdAt,
    updatedAt: updated.updatedAt,
  };
  const published = toPublishedBundle(updated);
  const event = appendKnowledgeEvent({
    type: "published",
    itemId: updated.itemId,
    revisionId: updated.revisionId,
    actor: input.actor ?? null,
    notes: input.notes ?? null,
  });

  writeRevision(updated);
  writeItemMeta(item);
  writeJsonFile(getKnowledgePublishedCurrentPath(updated.itemId), published);
  writeJsonFile(getKnowledgePublishedHistoryPath(updated.itemId, updated.revisionId), published);
  return { item, revision: updated, published, event };
}

export function readKnowledgeHistory(input: {
  itemId: string;
  includeEvents?: boolean;
}): ConversationRuntimeKnowledgeHistoryResult {
  const item = readItemMeta(input.itemId);
  const revisionsDir = getKnowledgeRevisionsDir(input.itemId);
  const revisions = existsSync(revisionsDir)
    ? readdirSync(revisionsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .flatMap((entry) => {
          const revision = readJsonFile<ConversationRuntimeKnowledgeRevisionRecord | null>(
            join(revisionsDir, entry.name),
            null,
          );
          return revision ? [revision] : [];
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    : [];
  const published = readJsonFile<ConversationRuntimePromptKnowledgeBundle | null>(
    getKnowledgePublishedCurrentPath(input.itemId),
    null,
  );
  const events = input.includeEvents === true ? readKnowledgeEventsForItem(input.itemId) : [];
  return { item, revisions, published, events };
}

export function readKnowledgeCatalog(): {
  items: ConversationRuntimeKnowledgeItemMeta[];
  rootDir: string;
} {
  getKnowledgeItemsDir();
  return {
    items: readRegistry().items.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
    rootDir: getKnowledgeRootDir(),
  };
}

export function getPublishedKnowledgeBundle(input: {
  itemId?: string | null;
  bundleId?: string | null;
}): ConversationRuntimePromptKnowledgeBundle | null {
  const registry = readRegistry();
  const item = registry.items.find((entry) => {
    if (input.itemId?.trim()) {
      return entry.itemId === input.itemId.trim();
    }
    if (input.bundleId?.trim()) {
      return entry.bundleId === input.bundleId.trim();
    }
    return false;
  });
  if (!item) {
    return null;
  }
  return readJsonFile<ConversationRuntimePromptKnowledgeBundle | null>(
    getKnowledgePublishedCurrentPath(item.itemId),
    null,
  );
}

function readKnowledgeEventsForItem(itemId: string): ConversationRuntimeKnowledgeEvent[] {
  const path = getKnowledgeEventsPath();
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as ConversationRuntimeKnowledgeEvent;
        return event.itemId === itemId ? [event] : [];
      } catch {
        return [];
      }
    });
}
