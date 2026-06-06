import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import {
  getConversationRuntimeDataDir,
  getConversationRuntimeStoreDir,
} from "../knowledge/paths.js";
import type { ConversationRuntimePromptKnowledgeBundle } from "../knowledge/repository.js";
import { harvestLearningCandidate } from "./repository.js";

export interface ConversationRuntimeLearningJobDefinition {
  jobId: string;
  bundlePath: string;
  enabled: boolean;
  actor: string | null;
  note: string | null;
}

export interface ConversationRuntimeLearningJobUpsertInput {
  jobId: string;
  bundlePath: string;
  enabled?: boolean;
  actor?: string | null;
  note?: string | null;
}

export interface ConversationRuntimeLearningJobListResult {
  jobs: ConversationRuntimeLearningJobDefinition[];
  configPath: string;
  rootDir: string;
}

export interface ConversationRuntimeLearningJobUpsertResult {
  job: ConversationRuntimeLearningJobDefinition;
  configPath: string;
  rootDir: string;
}

export interface ConversationRuntimeLearningSchedulerOptions {
  configPath?: string | null;
  candidateStorePath?: string | null;
  dataDir?: string;
}

export interface ConversationRuntimeLearningTaskResult {
  taskId: string;
  bundlePath: string;
  status: "harvested" | "failed" | "skipped";
  message: string;
  itemId?: string;
  revisionId?: string;
}

export interface ConversationRuntimeLearningSchedulerRunResult {
  configPath: string;
  candidateStorePath: string;
  startedAt: string;
  finishedAt: string;
  tasks: ConversationRuntimeLearningTaskResult[];
}

interface LearningTaskSpec {
  id: string;
  bundlePath: string;
  enabled?: boolean;
  actor?: string;
  note?: string;
}

interface LearningCandidateRecord {
  taskId: string;
  bundlePath: string;
  configPath: string;
  status: ConversationRuntimeLearningTaskResult["status"];
  bundleId?: string;
  itemId?: string;
  revisionId?: string;
  timestamp: string;
  message: string;
  note?: string;
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function getLearningRootDir(dataDir?: string): string {
  return ensureDir(join(getConversationRuntimeStoreDir(dataDir), "learning"));
}

function getDefaultLearningTaskConfigPath(dataDir?: string): string {
  return join(getLearningRootDir(dataDir), "tasks.json");
}

function getDefaultLearningCandidateStorePath(dataDir?: string): string {
  return join(getLearningRootDir(dataDir), "candidates.jsonl");
}

export const LEARNING_TASK_CONFIG_PATH = join(
  getConversationRuntimeDataDir(),
  "conversation-runtime",
  "learning",
  "tasks.json",
);
export const LEARNING_CANDIDATE_STORE_PATH = join(
  getConversationRuntimeDataDir(),
  "conversation-runtime",
  "learning",
  "candidates.jsonl",
);

function normalizeTaskSpec(raw: unknown): LearningTaskSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const bundlePath = typeof candidate.bundlePath === "string" ? candidate.bundlePath.trim() : "";
  if (!bundlePath) {
    return null;
  }
  const id =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : bundlePath;
  return {
    id,
    bundlePath,
    enabled: candidate.enabled !== false,
    ...(typeof candidate.actor === "string" && candidate.actor.trim().length > 0
      ? { actor: candidate.actor.trim() }
      : {}),
    ...(typeof candidate.note === "string" && candidate.note.trim().length > 0
      ? { note: candidate.note.trim() }
      : {}),
  };
}

function readLearningTasks(configPath: string): LearningTaskSpec[] {
  if (!existsSync(configPath)) {
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    const entries = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? (raw as { tasks?: unknown }).tasks
        : [];
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.flatMap((entry) => {
      const spec = normalizeTaskSpec(entry);
      return spec === null ? [] : [spec];
    });
  } catch {
    return [];
  }
}

function writeLearningTasks(configPath: string, tasks: LearningTaskSpec[]): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
}

function toLearningJobDefinition(task: LearningTaskSpec): ConversationRuntimeLearningJobDefinition {
  return {
    jobId: task.id,
    bundlePath: task.bundlePath,
    enabled: task.enabled !== false,
    actor: task.actor ?? null,
    note: task.note ?? null,
  };
}

function resolveConfigPath(options: ConversationRuntimeLearningSchedulerOptions = {}): string {
  return options.configPath?.trim()
    ? options.configPath.trim()
    : getDefaultLearningTaskConfigPath(options.dataDir);
}

function resolveCandidateStorePath(
  options: ConversationRuntimeLearningSchedulerOptions = {},
  configPath?: string,
): string {
  return options.candidateStorePath?.trim()
    ? options.candidateStorePath.trim()
    : options.dataDir === undefined && configPath !== undefined
      ? join(dirname(configPath), "candidates.jsonl")
      : getDefaultLearningCandidateStorePath(options.dataDir);
}

function resolveLearningRootDir(
  options: ConversationRuntimeLearningSchedulerOptions,
  configPath: string,
): string {
  return options.dataDir === undefined ? dirname(configPath) : getLearningRootDir(options.dataDir);
}

function appendCandidateRecord(path: string, record: LearningCandidateRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

function resolveBundlePath(task: LearningTaskSpec, configDir: string): string {
  return isAbsolute(task.bundlePath) ? task.bundlePath : join(configDir, task.bundlePath);
}

export function listLearningJobs(
  options: string | ConversationRuntimeLearningSchedulerOptions = {},
): ConversationRuntimeLearningJobListResult {
  const normalizedOptions = typeof options === "string" ? { configPath: options } : options;
  const configPath = resolveConfigPath(normalizedOptions);
  return {
    jobs: readLearningTasks(configPath).map(toLearningJobDefinition),
    configPath,
    rootDir: resolveLearningRootDir(normalizedOptions, configPath),
  };
}

export function upsertLearningJob(
  input: ConversationRuntimeLearningJobUpsertInput,
  options: string | ConversationRuntimeLearningSchedulerOptions = {},
): ConversationRuntimeLearningJobUpsertResult {
  const normalizedOptions = typeof options === "string" ? { configPath: options } : options;
  const configPath = resolveConfigPath(normalizedOptions);
  const task: LearningTaskSpec = {
    id: input.jobId.trim(),
    bundlePath: input.bundlePath.trim(),
    enabled: input.enabled !== false,
    ...(input.actor?.trim() ? { actor: input.actor.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  if (!task.id) {
    throw new Error("learning job jobId is required.");
  }
  if (!task.bundlePath) {
    throw new Error("learning job bundlePath is required.");
  }
  const tasks = readLearningTasks(configPath).filter((entry) => entry.id !== task.id);
  tasks.push(task);
  tasks.sort((left, right) => left.id.localeCompare(right.id));
  writeLearningTasks(configPath, tasks);
  return {
    job: toLearningJobDefinition(task),
    configPath,
    rootDir: resolveLearningRootDir(normalizedOptions, configPath),
  };
}

export function runLearningSchedulerCycle(
  options: ConversationRuntimeLearningSchedulerOptions = {},
): ConversationRuntimeLearningSchedulerRunResult {
  const configPath = resolveConfigPath(options);
  const candidateStorePath = resolveCandidateStorePath(options, configPath);
  const startedAt = new Date().toISOString();
  const configDir = dirname(configPath);
  const tasks = readLearningTasks(configPath);
  const results: ConversationRuntimeLearningTaskResult[] = [];
  for (const task of tasks) {
    results.push(
      runLearningSchedulerTask({
        task,
        configDir,
        configPath,
        candidateStorePath,
        ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
      }),
    );
  }
  return {
    configPath,
    candidateStorePath,
    startedAt,
    finishedAt: new Date().toISOString(),
    tasks: results,
  };
}

function runLearningSchedulerTask(input: {
  task: LearningTaskSpec;
  configDir: string;
  configPath: string;
  candidateStorePath: string;
  dataDir?: string;
}): ConversationRuntimeLearningTaskResult {
  const { task } = input;
  if (task.enabled === false) {
    return {
      taskId: task.id,
      bundlePath: task.bundlePath,
      status: "skipped",
      message: "Task is disabled.",
    };
  }
  const bundlePath = resolveBundlePath(task, input.configDir);
  if (!existsSync(bundlePath)) {
    const message = `Bundle path not found: ${bundlePath}`;
    appendCandidateRecord(input.candidateStorePath, {
      taskId: task.id,
      bundlePath,
      configPath: input.configPath,
      status: "failed",
      timestamp: new Date().toISOString(),
      message,
      ...(task.note === undefined ? {} : { note: task.note }),
    });
    return { taskId: task.id, bundlePath, status: "failed", message };
  }
  try {
    const bundle = JSON.parse(
      readFileSync(bundlePath, "utf8"),
    ) as ConversationRuntimePromptKnowledgeBundle;
    const harvestResult = harvestLearningCandidate({
      bundle,
      actor: task.actor ?? "learning-scheduler",
      notes: task.note ? [task.note] : null,
      ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
    });
    const message = `Harvested learning candidate ${harvestResult.candidate.bundleId}@${harvestResult.candidate.revisionId}`;
    appendCandidateRecord(input.candidateStorePath, {
      taskId: task.id,
      bundlePath,
      configPath: input.configPath,
      status: "harvested",
      bundleId: harvestResult.candidate.bundleId,
      itemId: harvestResult.candidate.itemId,
      revisionId: harvestResult.candidate.revisionId,
      timestamp: new Date().toISOString(),
      message,
      ...(task.note === undefined ? {} : { note: task.note }),
    });
    return {
      taskId: task.id,
      bundlePath,
      status: "harvested",
      message,
      itemId: harvestResult.candidate.itemId,
      revisionId: harvestResult.candidate.revisionId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error during harvest";
    appendCandidateRecord(input.candidateStorePath, {
      taskId: task.id,
      bundlePath,
      configPath: input.configPath,
      status: "failed",
      timestamp: new Date().toISOString(),
      message,
      ...(task.note === undefined ? {} : { note: task.note }),
    });
    return { taskId: task.id, bundlePath, status: "failed", message };
  }
}
