import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { FileSystemDirectorMemoryStore } from "@hotflow/director-memory";
import {
  DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
  type DirectorMemoryRecord,
  type DirectorRecallPacket,
  type DirectorRecallQuery,
} from "@hotflow/director-memory-contracts";
import { loadDirectorSwitchState } from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

type DirectorMemoryPortStatus = "ok" | "degraded" | "disabled";

interface DirectorMemoryIndexEntry {
  readonly recordId: string;
  readonly recordedAt: string;
}

interface DirectorMemoryIndexDocument {
  readonly entries?: readonly DirectorMemoryIndexEntry[];
}

export interface DirectorMemoryIngestAudit {
  readonly path: string;
  readonly runId: string;
  readonly reportId: string;
  readonly status: DirectorMemoryPortStatus;
  readonly recordedAt: string;
  readonly observationIds: readonly string[];
  readonly notes: readonly string[];
  readonly recordId?: string;
  readonly digestId?: string;
}

export interface DirectorMemoryInspection {
  readonly workspaceRoot: string;
  readonly memoryRoot: string;
  readonly switchPath: string;
  readonly switchSource: string;
  readonly enabled: boolean;
  readonly switchNotes: readonly string[];
  readonly switchIssues: readonly string[];
  readonly storeStatus: DirectorMemoryPortStatus;
  readonly recordCount: number;
  readonly lastRecordedAt?: string;
  readonly notes: readonly string[];
  readonly latestIngest?: DirectorMemoryIngestAudit;
  readonly latestRecord?: DirectorMemoryRecord;
}

export interface DirectorMemoryRecallInspection {
  readonly inspection: DirectorMemoryInspection;
  readonly packet: DirectorRecallPacket;
}

export async function inspectDirectorMemoryLane(
  workspaceRoot: string,
): Promise<DirectorMemoryInspection> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchPath = join(workspace.runtime, "switches.json");
  const switchState = loadDirectorSwitchState(switchPath);
  const memoryRoot = join(workspace.runtime, "memory");
  const store = new FileSystemDirectorMemoryStore({ rootPath: memoryRoot });
  const [status, latestIngest, latestRecord] = await Promise.all([
    store.getStatus(),
    readLatestDirectorMemoryIngest(memoryRoot),
    readLatestDirectorMemoryRecord(memoryRoot),
  ]);

  return {
    workspaceRoot,
    memoryRoot,
    switchPath,
    switchSource: switchState.source,
    enabled: switchState.features["memory.enabled"],
    switchNotes: [...switchState.notes],
    switchIssues: [...switchState.issues],
    storeStatus: status.status,
    recordCount: status.recordCount,
    ...(status.lastRecordedAt === undefined ? {} : { lastRecordedAt: status.lastRecordedAt }),
    notes: [...status.notes],
    ...(latestIngest === undefined ? {} : { latestIngest }),
    ...(latestRecord === undefined ? {} : { latestRecord }),
  };
}

export async function inspectDirectorMemoryRecall(
  workspaceRoot: string,
  query: DirectorRecallQuery,
): Promise<DirectorMemoryRecallInspection> {
  const inspection = await inspectDirectorMemoryLane(workspaceRoot);
  if (!inspection.enabled) {
    return {
      inspection,
      packet: {
        schemaVersion: DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
        queryId: "recall-disabled",
        status: "disabled",
        recordedAt: new Date().toISOString(),
        notes: ["Director memory recall is disabled by switch."],
        hits: [],
        query,
        truncated: false,
      },
    };
  }

  const store = new FileSystemDirectorMemoryStore({ rootPath: inspection.memoryRoot });
  const packet = await store.recall(query);
  return {
    inspection,
    packet,
  };
}

export async function describeDirectorMemoryStatus(workspaceRoot: string): Promise<string> {
  const inspection = await inspectDirectorMemoryLane(workspaceRoot);
  const lines = [
    "Director memory:",
    `  workspace root: ${inspection.workspaceRoot}`,
    `  switch path: ${inspection.switchPath}`,
    `  switch source: ${inspection.switchSource}`,
    `  enabled: ${inspection.enabled ? "yes" : "no"}`,
    `  store status: ${inspection.storeStatus}`,
    `  record count: ${inspection.recordCount}`,
  ];

  if (inspection.lastRecordedAt) {
    lines.push(`  last recorded at: ${inspection.lastRecordedAt}`);
  }

  if (inspection.latestRecord) {
    lines.push(`  latest record: ${inspection.latestRecord.recordId}`);
    lines.push(`  latest project: ${inspection.latestRecord.projectId}`);
    lines.push(`  latest group: ${inspection.latestRecord.groupId}`);
  }

  if (inspection.latestIngest) {
    lines.push(`  latest ingest: ${inspection.latestIngest.status}`);
    lines.push(`  latest ingest run: ${inspection.latestIngest.runId}`);
    if (inspection.latestIngest.recordId) {
      lines.push(`  latest ingest record: ${inspection.latestIngest.recordId}`);
    }
  } else {
    lines.push(`  latest ingest: ${inspection.enabled ? "none" : "disabled"}`);
  }

  if (inspection.notes.length > 0) {
    lines.push(`  store notes: ${inspection.notes.join(" | ")}`);
  }
  if (inspection.switchNotes.length > 0) {
    lines.push(`  switch notes: ${inspection.switchNotes.join(" | ")}`);
  }
  if (inspection.switchIssues.length > 0) {
    lines.push(`  switch issues: ${inspection.switchIssues.join(" | ")}`);
  }
  if (inspection.latestIngest?.notes.length) {
    lines.push(`  ingest notes: ${inspection.latestIngest.notes.join(" | ")}`);
  }

  return lines.join("\n");
}

export async function previewDirectorMemoryRecall(
  workspaceRoot: string,
  query: DirectorRecallQuery,
): Promise<string> {
  const { inspection, packet } = await inspectDirectorMemoryRecall(workspaceRoot, query);
  const lines = [
    "Director memory recall preview:",
    `  enabled: ${inspection.enabled ? "yes" : "no"}`,
    `  status: ${packet.status}`,
    `  hits: ${packet.hits.length}`,
    `  truncated: ${packet.truncated ? "yes" : "no"}`,
    `  max hits: ${packet.query.maxHits}`,
    `  project id: ${packet.query.projectId}`,
  ];

  if (packet.query.groupId) {
    lines.push(`  group id: ${packet.query.groupId}`);
  }
  if (packet.notes.length > 0) {
    lines.push(`  notes: ${packet.notes.join(" | ")}`);
  }

  if (packet.hits.length === 0) {
    lines.push("  recall hits: (none)");
    return lines.join("\n");
  }

  lines.push("  recall hits:");
  for (const hit of packet.hits) {
    lines.push(`  - ${hit.recordId} score=${hit.score} status=${hit.status}`);
    lines.push(`    summary: ${hit.summary}`);
    lines.push(`    why recalled: ${hit.reasons.join(" | ")}`);
    lines.push(
      `    provenance: run=${hit.provenance.runId} report=${hit.provenance.reportId} observations=${hit.provenance.observationIds.join(", ") || "(none)"}`,
    );
  }

  return lines.join("\n");
}

async function readLatestDirectorMemoryIngest(
  memoryRoot: string,
): Promise<DirectorMemoryIngestAudit | undefined> {
  const ingestRoot = join(memoryRoot, "ingest");
  try {
    const files = (await readdir(ingestRoot))
      .filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
      .sort((left, right) => left.localeCompare(right));
    const audits: DirectorMemoryIngestAudit[] = [];

    for (const file of files) {
      const path = join(ingestRoot, file);
      const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const recordedAt =
        typeof parsed.recordedAt === "string" ? parsed.recordedAt : "1970-01-01T00:00:00.000Z";
      audits.push({
        path,
        runId: typeof parsed.runId === "string" ? parsed.runId : file.replace(/\.json$/u, ""),
        reportId: typeof parsed.reportId === "string" ? parsed.reportId : "(unknown)",
        status: normalizePortStatus(parsed.status),
        recordedAt,
        observationIds: toStringList(parsed.observationIds),
        notes: toStringList(parsed.notes),
        ...(typeof parsed.recordId === "string" ? { recordId: parsed.recordId } : {}),
        ...(typeof parsed.digestId === "string" ? { digestId: parsed.digestId } : {}),
      });
    }

    audits.sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
    return audits[0];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return {
      path: ingestRoot,
      runId: "(unreadable)",
      reportId: "(unreadable)",
      status: "degraded",
      recordedAt: new Date().toISOString(),
      observationIds: [],
      notes: [`Director memory ingest audit degraded: ${toErrorMessage(error)}.`],
    };
  }
}

async function readLatestDirectorMemoryRecord(
  memoryRoot: string,
): Promise<DirectorMemoryRecord | undefined> {
  try {
    const indexPath = join(memoryRoot, "index.json");
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as DirectorMemoryIndexDocument;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const latestEntry = [...entries].sort(compareIndexEntries)[0];
    if (!latestEntry?.recordId) {
      return undefined;
    }
    return JSON.parse(
      await readFile(join(memoryRoot, "records", `${latestEntry.recordId}.json`), "utf8"),
    ) as DirectorMemoryRecord;
  } catch {
    return undefined;
  }
}

function compareIndexEntries(
  left: DirectorMemoryIndexEntry,
  right: DirectorMemoryIndexEntry,
): number {
  return Date.parse(right.recordedAt) - Date.parse(left.recordedAt);
}

function normalizePortStatus(value: unknown): DirectorMemoryPortStatus {
  if (value === "ok" || value === "disabled" || value === "degraded") {
    return value;
  }
  return "degraded";
}

function toStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
