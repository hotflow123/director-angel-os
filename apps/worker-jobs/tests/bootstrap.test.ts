import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { SKILL_SNAPSHOT_UPSERT_KIND } from "@hotflow/skills";
import { projectSessionTaskState } from "@hotflow/tasks-core";
import { afterEach, describe, expect, test } from "vitest";

import { bootstrapWorkerJobs, resolveWorkerSessionDbPath } from "../src/bootstrap.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("worker-jobs bootstrap", () => {
  test("resolves worker session db path from override", () => {
    expect(
      resolveWorkerSessionDbPath(
        {
          dataDir: "/workspace/.hotflow",
          sessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        },
        {
          HOTFLOW_WORKER_SESSION_DB_PATH: "/tmp/hotflow-worker.sqlite",
        },
      ),
    ).toBe("/tmp/hotflow-worker.sqlite");
  });

  test("reads committed session snapshot and writes only proposal queue/outbox", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-worker-jobs-"));
    cleanupPaths.push(workspaceRoot);

    const dataDir = join(workspaceRoot, ".hotflow");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    const dbPath = join(dataDir, "sessions", "worker.sqlite");

    const seedStore = new SessionStore({ dbPath });
    const sessionId = "sess_worker_jobs";
    try {
      seedStore.createSession({ sessionId });
      seedStore.appendJournal(sessionId, {
        eventType: "user.input",
        turnId: "turn_worker_1",
        payload: { text: "Summarize the repo" },
        createdAtMs: 100,
      });
      seedStore.appendJournal(sessionId, {
        eventType: "tool.call_planned",
        turnId: "turn_worker_1",
        payload: {
          toolCallId: "call_1",
          toolName: "filesystem.read_text",
          args: { path: "README.md" },
        },
        createdAtMs: 110,
      });
      seedStore.appendJournal(sessionId, {
        eventType: "tool.result",
        turnId: "turn_worker_1",
        payload: {
          toolName: "filesystem.read_text",
          ok: true,
          output: { text: "Agent OS repository details" },
          error: null,
        },
        createdAtMs: 120,
      });
      seedStore.appendJournal(sessionId, {
        eventType: "assistant.output",
        turnId: "turn_worker_1",
        payload: { text: "Todo list has been persisted." },
        createdAtMs: 130,
      });
      seedStore.createCheckpoint(sessionId, {
        state: {
          tasks: { items: [] },
          lastAssistantOutput: "Todo list has been persisted.",
        },
        createdAtMs: 140,
      });
    } finally {
      seedStore.close();
    }

    const runtime = bootstrapWorkerJobs({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: dataDir,
        HOTFLOW_WORKER_SESSION_DB_PATH: dbPath,
      },
    });
    try {
      const result = await runtime.jobs.trajectorySummary({
        sessionId,
        proposalId: "proposal_worker_1",
        provenance: "worker-jobs/tests",
      });

      expect(result.sessionId).toBe(sessionId);
      expect(result.sourceTurnId).toBe("turn_worker_1");
      expect(result.proposal).toMatchObject({
        id: "proposal_worker_1",
        kind: SKILL_SNAPSHOT_UPSERT_KIND,
        sourceSessionId: sessionId,
        sourceTurnId: "turn_worker_1",
        provenance: "worker-jobs/tests",
      });
      expect(result.proposal.payload).toMatchObject({
        trajectoryRef: "journal://sess_worker_jobs/turn_worker_1",
        trigger: "Summarize the repo",
        riskLevel: "low",
        confidence: expect.any(Number),
        dedupeKey: expect.any(String),
        evidenceSummary: expect.stringContaining("Summarize the repo"),
        explanation: expect.any(String),
        snapshot: {
          id: "skill_sess_worker_jobs_turn_worker_1",
          title: "Trajectory Pattern turn_worker_1",
          toolNames: ["filesystem.read_text"],
        },
      });
      expect(result.metrics).toMatchObject({
        totalJournalEvents: 4,
        journalEventsSinceCheckpoint: 0,
        toolCallCount: 1,
        toolResultCount: 1,
        assistantOutputCount: 1,
      });

      const taskState = projectSessionTaskState(runtime.sessionStore, sessionId, {
        createIfMissing: false,
      });
      expect(taskState.proposalQueue).toHaveLength(1);
      expect(taskState.proposalOutbox).toHaveLength(1);
      expect(taskState.proposalQueue[0]?.provenance).toBe("worker-jobs/tests");
      expect(taskState.proposalQueue[0]?.kind).toBe(SKILL_SNAPSHOT_UPSERT_KIND);

      const journalEvents = runtime.sessionStore.journal
        .list(sessionId)
        .map((entry) => entry.eventType);
      expect(
        journalEvents.filter((eventType) => eventType === "tasks.proposal_enqueued"),
      ).toHaveLength(1);
      expect(journalEvents.filter((eventType) => eventType === "tasks.todo_write")).toHaveLength(0);
    } finally {
      runtime.close();
    }
  });
});
