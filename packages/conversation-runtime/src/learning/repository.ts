import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { getConversationRuntimeStoreDir } from "../knowledge/paths.js";
import {
  type ConversationRuntimeKnowledgeImportResult,
  type ConversationRuntimePromptKnowledgeBundle,
  harvestKnowledgeBundle,
} from "../knowledge/repository.js";

export type ConversationRuntimeLearningCandidateStage =
  | "harvested"
  | "reviewed"
  | "publish-ready"
  | "promoted";

export type ConversationRuntimeLearningEventType =
  | "harvested"
  | "reviewed"
  | "publish-ready"
  | "promoted";

export interface ConversationRuntimeLearningCandidateRecord
  extends ConversationRuntimePromptKnowledgeBundle {
  stage: ConversationRuntimeLearningCandidateStage;
  createdAt: string;
  updatedAt: string;
  actor: string | null;
  notes: string[];
}

export interface ConversationRuntimeLearningEvent {
  eventId: string;
  type: ConversationRuntimeLearningEventType;
  stage: ConversationRuntimeLearningCandidateStage;
  itemId: string;
  revisionId: string;
  occurredAt: string;
  actor: string | null;
  notes: string[];
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function getLearningRootDir(dataDir?: string): string {
  return ensureDir(join(getConversationRuntimeStoreDir(dataDir), "learning"));
}

function getLearningCandidatesDir(dataDir?: string): string {
  return ensureDir(join(getLearningRootDir(dataDir), "candidates"));
}

function getLearningCandidateDir(itemId: string, dataDir?: string): string {
  return ensureDir(join(getLearningCandidatesDir(dataDir), itemId));
}

function getLearningCandidatePath(itemId: string, revisionId: string, dataDir?: string): string {
  return join(getLearningCandidateDir(itemId, dataDir), `${revisionId}.json`);
}

function getLearningEventsPath(dataDir?: string): string {
  return join(getLearningRootDir(dataDir), "events.jsonl");
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

function normalizeBundle(
  bundle: ConversationRuntimePromptKnowledgeBundle,
): ConversationRuntimePromptKnowledgeBundle {
  const itemId = bundle.itemId?.trim();
  const revisionId = bundle.revisionId?.trim();
  if (!itemId) {
    throw new Error("Learning candidate itemId is required.");
  }
  if (!revisionId) {
    throw new Error("Learning candidate revisionId is required.");
  }
  return {
    ...bundle,
    itemId,
    revisionId,
    publishedAt: bundle.publishedAt?.trim() ? bundle.publishedAt : nowIso(),
  };
}

function buildCandidateRecord(params: {
  bundle: ConversationRuntimePromptKnowledgeBundle;
  stage: ConversationRuntimeLearningCandidateStage;
  actor?: string | null;
  notes?: string[] | null;
  previous?: ConversationRuntimeLearningCandidateRecord | null;
}): ConversationRuntimeLearningCandidateRecord {
  const timestamp = nowIso();
  return {
    ...params.bundle,
    stage: params.stage,
    createdAt: params.previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    actor: params.actor ?? params.previous?.actor ?? null,
    notes: dedupeStrings([...(params.previous?.notes ?? []), ...normalizeNotes(params.notes)]),
  };
}

function loadLearningCandidate(
  itemId: string,
  revisionId: string,
  dataDir?: string,
): ConversationRuntimeLearningCandidateRecord | null {
  const record = readJsonFile<ConversationRuntimeLearningCandidateRecord | null>(
    getLearningCandidatePath(itemId, revisionId, dataDir),
    null,
  );
  return record?.itemId === itemId && record.revisionId === revisionId ? record : null;
}

export function readLearningCandidate(input: {
  itemId: string;
  revisionId: string;
  dataDir?: string;
}): ConversationRuntimeLearningCandidateRecord | null {
  return loadLearningCandidate(input.itemId, input.revisionId, input.dataDir);
}

function writeLearningCandidate(
  record: ConversationRuntimeLearningCandidateRecord,
  dataDir?: string,
): void {
  writeJsonFile(getLearningCandidatePath(record.itemId, record.revisionId, dataDir), record);
}

function appendLearningEvent(params: {
  type: ConversationRuntimeLearningEventType;
  stage: ConversationRuntimeLearningCandidateStage;
  itemId: string;
  revisionId: string;
  actor?: string | null;
  notes?: string[] | null;
  dataDir?: string;
}): ConversationRuntimeLearningEvent {
  const event: ConversationRuntimeLearningEvent = {
    eventId: randomUUID(),
    type: params.type,
    stage: params.stage,
    itemId: params.itemId,
    revisionId: params.revisionId,
    occurredAt: nowIso(),
    actor: params.actor ?? null,
    notes: normalizeNotes(params.notes),
  };
  appendJsonLine(getLearningEventsPath(params.dataDir), event);
  return event;
}

function toKnowledgeBundle(
  candidate: ConversationRuntimeLearningCandidateRecord,
): ConversationRuntimePromptKnowledgeBundle {
  return {
    bundleId: candidate.bundleId,
    itemId: candidate.itemId,
    revisionId: candidate.revisionId,
    title: candidate.title,
    description: candidate.description ?? null,
    adapterId: candidate.adapterId,
    modelAdapterId: candidate.modelAdapterId,
    executionProfileIds: candidate.executionProfileIds,
    status: candidate.status,
    source: candidate.source,
    tags: candidate.tags ?? [],
    metadata: candidate.metadata,
    fieldSchema: candidate.fieldSchema,
    layers: candidate.layers,
    defaultUserLayerIds: candidate.defaultUserLayerIds ?? [],
    inferenceRules: candidate.inferenceRules ?? [],
    template: candidate.template,
    publishedAt: candidate.publishedAt,
  };
}

export function harvestLearningCandidate(input: {
  bundle: ConversationRuntimePromptKnowledgeBundle;
  actor?: string | null;
  notes?: string[] | null;
  dataDir?: string;
}): {
  candidate: ConversationRuntimeLearningCandidateRecord;
  event: ConversationRuntimeLearningEvent;
} {
  const bundle = normalizeBundle(input.bundle);
  if (loadLearningCandidate(bundle.itemId, bundle.revisionId, input.dataDir)) {
    throw new Error(`Learning candidate already exists: ${bundle.itemId}/${bundle.revisionId}`);
  }
  const candidate = buildCandidateRecord({
    bundle,
    stage: "harvested",
    actor: input.actor ?? null,
    notes: input.notes ?? null,
  });
  const event = appendLearningEvent({
    type: "harvested",
    stage: "harvested",
    itemId: candidate.itemId,
    revisionId: candidate.revisionId,
    actor: input.actor ?? null,
    notes: input.notes ?? null,
    ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
  });
  writeLearningCandidate(candidate, input.dataDir);
  return { candidate, event };
}

export function reviewLearningCandidate(input: {
  itemId: string;
  revisionId: string;
  actor?: string | null;
  notes?: string[] | null;
  dataDir?: string;
}): {
  candidate: ConversationRuntimeLearningCandidateRecord;
  event: ConversationRuntimeLearningEvent;
} {
  const previous = loadLearningCandidate(input.itemId, input.revisionId, input.dataDir);
  if (!previous) {
    throw new Error(`Learning candidate not found: ${input.itemId}/${input.revisionId}`);
  }
  const candidate = buildCandidateRecord({
    bundle: toKnowledgeBundle(previous),
    stage: "reviewed",
    actor: input.actor ?? null,
    notes: input.notes ?? null,
    previous,
  });
  const event = appendLearningEvent({
    type: "reviewed",
    stage: "reviewed",
    itemId: candidate.itemId,
    revisionId: candidate.revisionId,
    actor: input.actor ?? null,
    notes: input.notes ?? null,
    ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
  });
  writeLearningCandidate(candidate, input.dataDir);
  return { candidate, event };
}

export function markLearningCandidatePublishReady(input: {
  itemId: string;
  revisionId: string;
  actor?: string | null;
  notes?: string[] | null;
  dataDir?: string;
}): {
  candidate: ConversationRuntimeLearningCandidateRecord;
  event: ConversationRuntimeLearningEvent;
} {
  const previous = loadLearningCandidate(input.itemId, input.revisionId, input.dataDir);
  if (!previous) {
    throw new Error(`Learning candidate not found: ${input.itemId}/${input.revisionId}`);
  }
  const candidate = buildCandidateRecord({
    bundle: toKnowledgeBundle(previous),
    stage: "publish-ready",
    actor: input.actor ?? null,
    notes: input.notes ?? null,
    previous,
  });
  const event = appendLearningEvent({
    type: "publish-ready",
    stage: "publish-ready",
    itemId: candidate.itemId,
    revisionId: candidate.revisionId,
    actor: input.actor ?? null,
    notes: input.notes ?? null,
    ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
  });
  writeLearningCandidate(candidate, input.dataDir);
  return { candidate, event };
}

export function promoteLearningCandidate(input: {
  itemId: string;
  revisionId: string;
  actor?: string | null;
  notes?: string[] | null;
  dataDir?: string;
}): {
  candidate: ConversationRuntimeLearningCandidateRecord;
  imported: ConversationRuntimeKnowledgeImportResult;
  event: ConversationRuntimeLearningEvent;
} {
  const previous = loadLearningCandidate(input.itemId, input.revisionId, input.dataDir);
  if (!previous) {
    throw new Error(`Learning candidate not found: ${input.itemId}/${input.revisionId}`);
  }
  if (previous.stage !== "publish-ready") {
    throw new Error(
      `Learning candidate must be publish-ready before promotion: ${input.itemId}/${input.revisionId}`,
    );
  }
  const imported = harvestKnowledgeBundle({
    bundle: toKnowledgeBundle(previous),
    actor: input.actor ?? null,
    notes: input.notes ?? [`Promoted from learning candidate ${input.itemId}/${input.revisionId}.`],
  });
  const candidate = buildCandidateRecord({
    bundle: toKnowledgeBundle(previous),
    stage: "promoted",
    actor: input.actor ?? null,
    notes: input.notes ?? [
      `Promoted to knowledge draft ${imported.item.itemId}/${imported.revision.revisionId}.`,
    ],
    previous,
  });
  const event = appendLearningEvent({
    type: "promoted",
    stage: "promoted",
    itemId: candidate.itemId,
    revisionId: candidate.revisionId,
    actor: input.actor ?? null,
    notes: candidate.notes,
    ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
  });
  writeLearningCandidate(candidate, input.dataDir);
  return { candidate, imported, event };
}

export function readLearningCandidates(
  input: {
    stage?: ConversationRuntimeLearningCandidateStage;
    dataDir?: string;
  } = {},
): {
  candidates: ConversationRuntimeLearningCandidateRecord[];
  rootDir: string;
} {
  const candidatesDir = getLearningCandidatesDir(input.dataDir);
  const candidates: ConversationRuntimeLearningCandidateRecord[] = [];
  for (const itemEntry of readdirSync(candidatesDir, { withFileTypes: true })) {
    if (!itemEntry.isDirectory()) {
      continue;
    }
    const itemDir = join(candidatesDir, itemEntry.name);
    for (const candidateFile of readdirSync(itemDir, { withFileTypes: true })) {
      if (!candidateFile.isFile() || !candidateFile.name.endsWith(".json")) {
        continue;
      }
      const candidate = readJsonFile<ConversationRuntimeLearningCandidateRecord | null>(
        join(itemDir, candidateFile.name),
        null,
      );
      if (!candidate) {
        continue;
      }
      candidates.push(candidate);
    }
  }
  const filtered =
    input.stage === undefined
      ? candidates
      : candidates.filter((candidate) => candidate.stage === input.stage);
  return {
    candidates: filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    rootDir: getLearningRootDir(input.dataDir),
  };
}

export function readLearningEvents(
  input: {
    dataDir?: string;
  } = {},
): {
  events: ConversationRuntimeLearningEvent[];
  rootDir: string;
} {
  return readLearningEventsInDir(input.dataDir);
}

function readLearningEventsInDir(dataDir?: string): {
  events: ConversationRuntimeLearningEvent[];
  rootDir: string;
} {
  const path = getLearningEventsPath(dataDir);
  if (!existsSync(path)) {
    return { events: [], rootDir: getLearningRootDir(dataDir) };
  }
  const events = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ConversationRuntimeLearningEvent];
      } catch {
        return [];
      }
    });
  return { events, rootDir: getLearningRootDir(dataDir) };
}
