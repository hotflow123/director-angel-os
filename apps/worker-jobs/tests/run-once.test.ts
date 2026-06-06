import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { SKILL_SNAPSHOT_UPSERT_KIND } from "@hotflow/skills";
import { projectSessionTaskState } from "@hotflow/tasks-core";
import { afterEach, describe, expect, test } from "vitest";

import { runWorkerJobsCli } from "../src/main.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function createWorkerEnv() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-worker-run-once-"));
  cleanupPaths.push(workspaceRoot);

  const dataDir = join(workspaceRoot, ".hotflow");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  const dbPath = join(dataDir, "sessions", "worker.sqlite");

  return {
    workspaceRoot,
    dataDir,
    dbPath,
    env: {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_WORKER_SESSION_DB_PATH: dbPath,
    },
  };
}

function seedCommittedTurn(store: SessionStore, sessionId: string, turnId: string): void {
  store.createSession({ sessionId });
  store.appendJournal(sessionId, {
    eventType: "user.input",
    turnId,
    payload: { text: "Summarize the repo" },
    createdAtMs: 100,
  });
  store.appendJournal(sessionId, {
    eventType: "tool.result",
    turnId,
    payload: {
      toolName: "filesystem.read_text",
      ok: true,
      output: { text: "Repository summary" },
      error: null,
    },
    createdAtMs: 110,
  });
  store.createCheckpoint(sessionId, {
    state: {
      lastTurnId: turnId,
      lastAssistantOutput: "Repository summary",
    },
    createdAtMs: 120,
  });
}

describe("worker-jobs run-once", () => {
  test("emits a structured report and persists proposal queue/outbox deltas", async () => {
    const { workspaceRoot, dataDir, dbPath, env } = createWorkerEnv();
    const store = new SessionStore({ dbPath });
    try {
      seedCommittedTurn(store, "sess_wave11", "turn_wave11");
    } finally {
      store.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-once", "--session-id", "sess_wave11", "--turn-id", "turn_wave11"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(existsSync(dbPath)).toBe(true);

    const report = JSON.parse(stdout) as {
      status: string;
      sourceSessionId: string;
      sourceTurnId: string;
      proposalStatus: string;
      provenance: string;
      proposalQueueDelta: number;
      proposalOutboxDelta: number;
    };

    expect(report).toMatchObject({
      status: "ok",
      sourceSessionId: "sess_wave11",
      sourceTurnId: "turn_wave11",
      proposalStatus: "pending",
      proposalKind: SKILL_SNAPSHOT_UPSERT_KIND,
      proposalQueueDelta: 1,
      proposalOutboxDelta: 1,
    });
    expect(report.provenance).toContain("worker-jobs");

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, "sess_wave11", {
        createIfMissing: false,
      });
      expect(taskState.proposalQueue).toHaveLength(1);
      expect(taskState.proposalOutbox).toHaveLength(1);
      expect(taskState.proposalQueue[0]).toMatchObject({
        kind: SKILL_SNAPSHOT_UPSERT_KIND,
        sourceSessionId: "sess_wave11",
        sourceTurnId: "turn_wave11",
      });
    } finally {
      resultStore.close();
    }
  });

  test("rejects missing --session-id", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runWorkerJobsCli(["run-once", "--turn-id", "turn_missing"], {
      io: {
        stdout(message) {
          stdout += message;
        },
        stderr(message) {
          stderr += message;
        },
      },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("run-once requires --session-id and --turn-id.");
  });

  test("rejects missing required run-once args", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runWorkerJobsCli(["run-once", "--session-id", "sess_missing"], {
      io: {
        stdout(message) {
          stdout += message;
        },
        stderr(message) {
          stderr += message;
        },
      },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("run-once requires --session-id and --turn-id.");
  });

  test("fails loudly when the session does not exist", async () => {
    const { env } = createWorkerEnv();

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-once", "--session-id", "sess_missing_session", "--turn-id", "turn_missing_session"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown session: sess_missing_session");
  });

  test("fails loudly when the committed snapshot is empty", async () => {
    const { dbPath, env } = createWorkerEnv();
    const store = new SessionStore({ dbPath });
    try {
      store.createSession({ sessionId: "sess_empty_snapshot" });
    } finally {
      store.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-once", "--session-id", "sess_empty_snapshot", "--turn-id", "turn_empty_snapshot"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Session sess_empty_snapshot has no committed snapshot.");
  });

  test("fails loudly when the committed snapshot has no turn to summarize", async () => {
    const { dbPath, env } = createWorkerEnv();
    const store = new SessionStore({ dbPath });
    try {
      store.createSession({ sessionId: "sess_missing_turn" });
      store.appendJournal("sess_missing_turn", {
        eventType: "tasks.todo_write",
        payload: {
          items: [{ id: "todo_1", content: "task-only state", status: "todo" }],
          updatedAtMs: 100,
        },
        createdAtMs: 100,
      });
    } finally {
      store.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["run-once", "--session-id", "sess_missing_turn", "--turn-id", "turn_missing_turn"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Session sess_missing_turn has no committed turn to summarize.");
  });
});
