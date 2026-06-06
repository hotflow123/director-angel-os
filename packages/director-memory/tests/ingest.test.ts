import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionRunReport } from "@hotflow/director-execution-contracts";
import type { DirectorObservationEnvelope } from "@hotflow/director-runtime";

import {
  FileSystemDirectorMemoryIngestService,
  FileSystemDirectorMemoryStore,
} from "../src/index.js";

describe("director-memory ingest", () => {
  it("ingests a terminal run into a memory record with provenance and audit evidence", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-ingest-"));
    const observationPath = join(rootPath, "observations.ndjson");
    const memoryRoot = join(rootPath, "memory");
    const store = new FileSystemDirectorMemoryStore({
      rootPath: memoryRoot,
      clock: () => "2026-04-12T15:00:00.000Z",
    });
    const ingest = new FileSystemDirectorMemoryIngestService({
      store,
      observationPath,
      auditRootPath: join(memoryRoot, "ingest"),
      clock: () => "2026-04-12T15:00:00.000Z",
    });

    await writeObservationLog(observationPath, [
      createEvaluationObservation(),
      createOutcomeObservation(),
    ]);

    const result = await ingest.ingestReport(createExecutionRunReport());
    const indexDocument = JSON.parse(await readFile(join(memoryRoot, "index.json"), "utf8")) as {
      entries: Array<{ recordId: string }>;
    };
    const recordDocument = JSON.parse(
      await readFile(
        join(memoryRoot, "records", `${indexDocument.entries[0]?.recordId}.json`),
        "utf8",
      ),
    ) as {
      recordId: string;
      digest: {
        projectId: string;
        groupId: string;
        observationRefs: Array<{ observationId: string }>;
      };
      tags?: string[];
    };
    const auditDocument = JSON.parse(
      await readFile(join(memoryRoot, "ingest", "run-1.json"), "utf8"),
    ) as {
      status: string;
      recordId?: string;
      observationIds: string[];
      notes: string[];
    };

    expect(result.status).toBe("ok");
    expect(result.recordId).toBe(indexDocument.entries[0]?.recordId);
    expect(recordDocument.digest.projectId).toBe("project-1");
    expect(recordDocument.digest.groupId).toBe("group-1");
    expect(recordDocument.digest.observationRefs.map((ref) => ref.observationId)).toEqual([
      "observation-evaluation-1",
      "observation-outcome-1",
    ]);
    expect(recordDocument.tags).toEqual([
      "character",
      "continuity",
      "memory:admission:run-trajectory",
      "memory:director-run",
      "memory:outcome:completed",
    ]);
    expect(auditDocument.status).toBe("ok");
    expect(auditDocument.recordId).toBe(result.recordId);
    expect(auditDocument.observationIds).toEqual([
      "observation-evaluation-1",
      "observation-outcome-1",
    ]);
  });

  it("degrades safely and still writes an audit record when the evaluation observation is missing", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-ingest-missing-"));
    const observationPath = join(rootPath, "observations.ndjson");
    const memoryRoot = join(rootPath, "memory");
    const store = new FileSystemDirectorMemoryStore({
      rootPath: memoryRoot,
      clock: () => "2026-04-12T16:00:00.000Z",
    });
    const ingest = new FileSystemDirectorMemoryIngestService({
      store,
      observationPath,
      auditRootPath: join(memoryRoot, "ingest"),
      clock: () => "2026-04-12T16:00:00.000Z",
    });

    await mkdir(rootPath, { recursive: true });
    await writeFile(observationPath, "", "utf8");

    const result = await ingest.ingestReport(createExecutionRunReport());
    const status = await store.getStatus();
    const auditDocument = JSON.parse(
      await readFile(join(memoryRoot, "ingest", "run-1.json"), "utf8"),
    ) as {
      status: string;
      notes: string[];
    };

    expect(result.status).toBe("degraded");
    expect(result.notes.join(" ")).toMatch(/evaluation/i);
    expect(status.recordCount).toBe(0);
    expect(auditDocument.status).toBe("degraded");
    expect(auditDocument.notes.join(" ")).toMatch(/evaluation/i);
  });

  it("does not turn failed runs into recallable director memory without review", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-ingest-failed-"));
    const observationPath = join(rootPath, "observations.ndjson");
    const memoryRoot = join(rootPath, "memory");
    const store = new FileSystemDirectorMemoryStore({
      rootPath: memoryRoot,
      clock: () => "2026-04-12T17:00:00.000Z",
    });
    const ingest = new FileSystemDirectorMemoryIngestService({
      store,
      observationPath,
      auditRootPath: join(memoryRoot, "ingest"),
      clock: () => "2026-04-12T17:00:00.000Z",
    });

    await writeObservationLog(observationPath, [
      createEvaluationObservation(),
      createOutcomeObservation(),
    ]);

    const result = await ingest.ingestReport(createExecutionRunReport("failed"));
    const status = await store.getStatus();
    const auditDocument = JSON.parse(
      await readFile(join(memoryRoot, "ingest", "run-1.json"), "utf8"),
    ) as {
      status: string;
      recordId?: string;
      observationIds: string[];
      notes: string[];
    };

    expect(result.status).toBe("degraded");
    expect(result.recordId).toBeUndefined();
    expect(result.notes.join(" ")).toMatch(/review/i);
    expect(status.recordCount).toBe(0);
    expect(auditDocument.status).toBe("degraded");
    expect(auditDocument.recordId).toBeUndefined();
    expect(auditDocument.observationIds).toEqual([
      "observation-evaluation-1",
      "observation-outcome-1",
    ]);
    expect(auditDocument.notes.join(" ")).toMatch(/failed/i);
  });

  it("does not turn completed casual chatter runs into recallable director memory", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "director-memory-ingest-noise-"));
    const observationPath = join(rootPath, "observations.ndjson");
    const memoryRoot = join(rootPath, "memory");
    const store = new FileSystemDirectorMemoryStore({
      rootPath: memoryRoot,
      clock: () => "2026-04-12T18:00:00.000Z",
    });
    const ingest = new FileSystemDirectorMemoryIngestService({
      store,
      observationPath,
      auditRootPath: join(memoryRoot, "ingest"),
      clock: () => "2026-04-12T18:00:00.000Z",
    });

    await writeObservationLog(observationPath, [
      createEvaluationObservation(),
      createOutcomeObservation(),
    ]);

    const result = await ingest.ingestReport(
      createExecutionRunReport("completed", {
        goal: "今天天气不错，随便聊聊",
        previewSummary: "casual chat only",
      }),
    );
    const status = await store.getStatus();
    const auditDocument = JSON.parse(
      await readFile(join(memoryRoot, "ingest", "run-1.json"), "utf8"),
    ) as {
      status: string;
      recordId?: string;
      notes: string[];
    };

    expect(result.status).toBe("degraded");
    expect(result.recordId).toBeUndefined();
    expect(result.notes.join(" ")).toContain("low-signal casual run");
    expect(status.recordCount).toBe(0);
    expect(auditDocument.recordId).toBeUndefined();
  });
});

async function writeObservationLog(
  observationPath: string,
  observations: readonly DirectorObservationEnvelope[],
): Promise<void> {
  await mkdir(rootPathOf(observationPath), { recursive: true });
  await writeFile(
    observationPath,
    observations
      .map((observation) => JSON.stringify(observation))
      .join("\n")
      .concat("\n"),
    "utf8",
  );
}

function rootPathOf(path: string): string {
  return path.split("/").slice(0, -1).join("/") || ".";
}

function createEvaluationObservation(): DirectorObservationEnvelope {
  return {
    schemaId: "director.observation.v1",
    observationId: "observation-evaluation-1",
    recordedAt: "2026-04-12T09:49:00.000Z",
    source: "evaluation",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    workingContext: {
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      operatorId: "operator-1",
      goal: "Create a launch teaser.",
      projectLabel: "Project One",
      projectId: "project-1",
      groupId: "group-1",
      generationType: "new",
      generationStyle: "immersive",
      sceneCount: 3,
      continuityPriority: "high",
      anchorIds: ["anchor-a", "anchor-b"],
    },
    recallHints: {
      preferredBindings: ["seedance"],
      requiredBindings: [],
      fallbackBindings: ["kling"],
      continuityAnchorIds: ["anchor-a", "anchor-b"],
      knowledgeSignalTags: ["continuity", "character"],
      deliverables: ["Create a launch teaser."],
    },
    recalledKnowledgePacks: [],
    recallStatus: "disabled",
    recallNotes: ["Memory recall disabled for fixture."],
    evaluation: {
      decision: "pass",
      actionGraphReadiness: "ready",
      selectedAdapters: ["mock-execution"],
      blockedReasons: [],
      warnings: [],
    },
    notes: ["fixture=evaluation"],
  };
}

function createOutcomeObservation(): DirectorObservationEnvelope {
  return {
    schemaId: "director.observation.v1",
    observationId: "observation-outcome-1",
    recordedAt: "2026-04-12T10:30:00.000Z",
    source: "outcome",
    snapshotId: "snapshot-1",
    runtimeId: "runtime-1",
    blueprintId: "blueprint-1",
    handoffId: "handoff-1",
    recalledKnowledgePacks: [],
    recallStatus: "disabled",
    recallNotes: ["Outcome fixtures do not perform recall."],
    outcome: {
      outcomeId: "outcome-1",
      status: "accepted",
      recordedAt: "2026-04-12T10:30:00.000Z",
      operatorId: "operator-1",
      notes: ["Looks good."],
    },
    notes: ["fixture=outcome"],
  };
}

function createExecutionRunReport(
  status: ExecutionRunReport["run"]["status"] = "completed",
  runOverrides: Partial<ExecutionRunReport["run"]> = {},
): ExecutionRunReport {
  return {
    schemaVersion: "director.execution.run.v1",
    reportId: "report-run-1",
    runId: "run-1",
    run: {
      schemaVersion: "director.execution.run.v1",
      runId: "run-1",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      blueprintId: "blueprint-1",
      handoffId: "handoff-1",
      actionGraphId: "graph-1",
      goal: "Create a launch teaser.",
      previewSummary: "Director approved a preview-safe run.",
      createdAt: "2026-04-12T10:00:00.000Z",
      startedAt: "2026-04-12T10:01:00.000Z",
      updatedAt: "2026-04-12T10:20:00.000Z",
      completedAt: "2026-04-12T10:20:00.000Z",
      status,
      assignments: [
        {
          runId: "run-1",
          assignmentId: "assignment-1",
          role: "researcher",
          objective: "Inspect the brief.",
          deliverable: "Research brief",
          actionClass: "read",
          approvalMode: "auto_allow",
          dependsOn: [],
          status: "completed",
          selectedAdapter: "mock-execution",
          createdAt: "2026-04-12T10:00:00.000Z",
          completedAt: "2026-04-12T10:05:00.000Z",
          result: {
            runId: "run-1",
            assignmentId: "assignment-1",
            status: "completed",
            recordedAt: "2026-04-12T10:05:00.000Z",
            workerId: "worker-1",
            summary: "Research completed.",
            adapterId: "mock-execution",
          },
        },
      ],
      events: [
        {
          eventId: "event-1",
          runId: "run-1",
          type: "run-created",
          occurredAt: "2026-04-12T10:00:00.000Z",
          message: "Run created.",
        },
      ],
      notes: ["preview-only"],
      ...runOverrides,
    },
    recordedAt: "2026-04-12T10:21:00.000Z",
    summary: ["run status=completed"],
    flags: ["preview-only"],
    events: [
      {
        eventId: "event-1",
        runId: "run-1",
        type: "run-created",
        occurredAt: "2026-04-12T10:00:00.000Z",
        message: "Run created.",
      },
    ],
  };
}
